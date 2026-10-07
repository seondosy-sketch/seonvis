-- 연장근무(제안서팀) 자동배정 — Migration B: 강제조건·RPC 활성화 (Phase 4 화면 배포와 동시에)
--
-- ⚠ 초안. 어떤 DB에도 실행하지 않았다.
-- 의존: Migration A(migration_overtime_planning_a_base.sql)가 먼저 적용돼 있어야 한다(0단계에서 확인).
-- 적용 시점: Phase 4 화면(주간 합계 표시·저장 전 사전검증·친화적 오류 안내)과 같은 배포에서. 이 파일을 먼저
--   적용하면 수동 입력에 주 12시간이 걸리는데 화면이 DB 오류 원문을 그대로 보여주게 된다.
-- 적용 직전 overtime_planning_preflight.sql로 기록 수·초과 주를 다시 확인하고, 직후 overtime_planning_postflight_b.sql.
--
-- 보호 방식 — "누가 실행 중인가"를 권한으로 판단한다(설정값이 아니라):
--   자동배정 RPC는 SECURITY DEFINER이고 테이블 소유자가 소유한다. 그래서 RPC 안에서 일어난 쓰기는
--   current_user = 테이블 소유자다. 브라우저(PostgREST)·service role의 직접 쓰기는 current_user가
--   authenticated / service_role이다. 보호 트리거는 SECURITY INVOKER로 두어 이 current_user를 그대로 보고,
--   "테이블 소유자 맥락이 아니면" 자동확정 기록·초안·실행 기록의 생성·변경·삭제를 막는다.
--   사용자가 SET으로 바꿀 수 있는 값(GUC)에 의존하지 않는다. 소유자 권한을 가진 DB 관리자(SQL 편집기)는
--   막지 않는다 — 그 권한이면 어차피 트리거 자체를 끌 수 있으므로 보안 경계가 아니다.
--   INVOKER 트리거 본문은 private 객체를 부르지 않는다(authenticated에는 private USAGE가 없다).
--
-- 모든 함수는 만든 직후 PUBLIC·anon·authenticated·service_role 권한을 전부 회수하고, 사용자가 직접 부르는
-- RPC 4개만 authenticated에 다시 준다. 트리거 함수는 트리거로만 실행된다(트리거 발동 시 EXECUTE 검사 없음).

begin;

do $$
begin
  if to_regclass('public.overtime_assignment_drafts') is null
     or to_regclass('public.overtime_monthly_targets') is null
     or to_regprocedure('private.overtime_pay_period(text)') is null then
    raise exception 'Migration A가 적용되지 않았다';
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. private 헬퍼 (SECURITY DEFINER — RPC·트리거가 소유자 권한으로만 부른다)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function private.overtime_require_write()
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if private.menu_permission('overtime') <> 'write' then
    raise exception 'permission denied' using errcode = '42501';
  end if;
end $$;

-- 관리자 = DB의 allowed_users.is_admin (JWT email로 조회). 클라이언트 입력은 받지 않는다.
create or replace function private.overtime_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select u.is_admin from public.allowed_users u where u.email = (auth.jwt() ->> 'email')), false)
$$;

-- 직원의 해당 주(월~일) 최종기록 합계 — RLS와 무관하게 전부(권한 때문에 작게 세면 한도가 뚫린다)
create or replace function private.overtime_week_total(p_employee uuid, p_date date, p_exclude_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(r.hours), 0)
  from public.overtime_work_records r
  where r.employee_id = p_employee
    and r.work_date between private.overtime_week_start(p_date) and private.overtime_week_start(p_date) + 6
    and (p_exclude_id is null or r.id <> p_exclude_id)
$$;

-- 주 12시간 규칙 — 트리거와 확정 RPC가 이 함수 하나만 쓴다.
--   변경 후 합계 ≤ 12 → 허용 / > 12 이고 변경 전보다 커짐 → 거부 (과거 초과 주는 줄이거나 그대로면 허용)
create or replace function private.overtime_assert_weekly_cap(
  p_employee uuid, p_date date, p_new_hours numeric, p_exclude_id uuid, p_previous_same_week numeric
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_week date := private.overtime_week_start(p_date);
  v_others numeric;
  v_new numeric;
begin
  -- 같은 직원·주의 동시 변경 직렬화(둘 다 11h를 보고 통과하는 경쟁 방지)
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('overtime_week:' || p_employee::text || ':' || v_week::text, 0));
  v_others := private.overtime_week_total(p_employee, p_date, p_exclude_id);
  v_new := v_others + p_new_hours;
  if v_new > 12 and v_new > v_others + coalesce(p_previous_same_week, 0) then
    raise exception 'OVERTIME_WEEKLY_CAP: % 주 합계 %시간 (한도 12시간)', v_week, v_new using errcode = '23514';
  end if;
end $$;

-- 실행 상태를 초안 상태로부터 다시 계산(discarded는 명시적 폐기라 유지)
create or replace function private.overtime_refresh_run_status(p_run_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cur text;
  v_draft int;
  v_conf int;
  v_other int;
  v_new text;
begin
  select r.status into v_cur from public.overtime_assignment_runs r where r.id = p_run_id;
  if v_cur is null or v_cur = 'discarded' then return v_cur; end if;
  select count(*) filter (where d.status = 'draft'),
         count(*) filter (where d.status = 'confirmed'),
         count(*) filter (where d.status in ('superseded', 'discarded'))
    into v_draft, v_conf, v_other
  from public.overtime_assignment_drafts d where d.run_id = p_run_id;
  if v_draft = 0 and v_conf = 0 and v_other = 0 then return v_cur; end if;  -- 배정 0건 실행은 그대로
  v_new := case
    when v_draft > 0 and v_conf > 0 then 'partially_confirmed'
    when v_draft > 0 then 'draft'
    when v_conf > 0 then 'confirmed'
    else 'superseded'
  end;
  if v_new is distinct from v_cur then
    update public.overtime_assignment_runs
    set status = v_new,
        confirmed_at = case when v_new = 'confirmed' then coalesce(confirmed_at, now()) else null end
    where id = p_run_id;
  end if;
  return v_new;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. 트리거
-- ════════════════════════════════════════════════════════════════════════════

-- 2-1. 최종기록 보호 (INVOKER — 호출자 current_user를 본다). 이름순으로 주간 검사보다 먼저 실행.
--   - 신규 기록의 source 기본값 'manual' (기존 행은 건드리지 않음)
--   - auto 기록: 테이블 소유자 맥락(= 자동배정 RPC)에서만 생성·수정·삭제
--   - source 변경: 기존(NULL)→manual 표시만 허용
create or replace function private.overtime_work_records_protect()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  v_owner_ctx boolean := current_user = (select pg_catalog.pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid = tg_relid);
begin
  if tg_op = 'DELETE' then
    if old.source = 'auto' and not v_owner_ctx then
      raise exception 'OVERTIME_AUTO_RECORD_LOCKED' using errcode = '42501',
        detail = '자동배정 확정 기록은 관리자 확정취소로만 지울 수 있다';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.source is null then new.source := 'manual'; end if;
    if new.source = 'auto' and not v_owner_ctx then
      raise exception 'OVERTIME_AUTO_RECORD_LOCKED' using errcode = '42501',
        detail = '자동배정 기록은 확정 RPC로만 만든다';
    end if;
    return new;
  end if;
  -- UPDATE
  if old.source = 'auto' and not v_owner_ctx then
    raise exception 'OVERTIME_AUTO_RECORD_LOCKED' using errcode = '42501',
      detail = '자동배정 확정 기록은 직접 수정할 수 없다';
  end if;
  if new.source is distinct from old.source and not (old.source is null and new.source = 'manual') and not v_owner_ctx then
    raise exception 'OVERTIME_SOURCE_IMMUTABLE' using errcode = '42501';
  end if;
  return new;
end $$;

-- 2-2. 주 12시간 (DEFINER — RLS와 무관하게 합산). DELETE는 검사하지 않는다(합계가 줄기만 함).
create or replace function private.overtime_work_records_weekly_cap()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prev numeric := 0;
begin
  if tg_op = 'UPDATE' then
    -- 직원·날짜·시간 그대로(업무명·비고만 수정)면 검사하지 않는다
    if new.employee_id = old.employee_id and new.work_date = old.work_date and new.hours = old.hours then
      return new;
    end if;
    -- 같은 직원·같은 주 안의 수정이면 변경 전 시간이 "기존 합계"에 있었다. 다른 주로 옮기거나 직원을
    -- 바꾸면 대상 주에는 원래 없던 행이므로 0.
    if old.employee_id = new.employee_id
       and private.overtime_week_start(old.work_date) = private.overtime_week_start(new.work_date) then
      v_prev := old.hours;
    end if;
  end if;
  perform private.overtime_assert_weekly_cap(new.employee_id, new.work_date, new.hours, new.id, v_prev);
  return new;
end $$;

drop trigger if exists overtime_work_records_a_protect on public.overtime_work_records;
create trigger overtime_work_records_a_protect
  before insert or update or delete on public.overtime_work_records
  for each row execute function private.overtime_work_records_protect();

drop trigger if exists overtime_work_records_b_weekly_cap on public.overtime_work_records;
create trigger overtime_work_records_b_weekly_cap
  before insert or update on public.overtime_work_records
  for each row execute function private.overtime_work_records_weekly_cap();

-- 2-3. 초안 보호 (INVOKER). 생성·삭제·상태전이는 소유자 맥락(RPC)만. 담당자 수정은 잠금 처리.
--   시간 칸은 항상 프리셋 값으로 채우고(클라이언트 값 무시), 주말·공휴일 여부는 DB가 계산한다.
create or replace function private.overtime_drafts_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  v_owner_ctx boolean := current_user = (select pg_catalog.pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid = tg_relid);
begin
  if tg_op = 'DELETE' then
    if not v_owner_ctx then
      raise exception 'OVERTIME_DRAFT_DELETE_FORBIDDEN' using errcode = '42501', detail = '초안은 지우지 않고 discarded로 바꾼다';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if not v_owner_ctx then
      raise exception 'OVERTIME_DRAFT_RPC_ONLY' using errcode = '42501';
    end if;
  elsif not v_owner_ctx then
    if old.status <> 'draft' then
      raise exception 'OVERTIME_DRAFT_NOT_EDITABLE' using errcode = '42501';
    end if;
    if new.status not in ('draft', 'discarded') then
      raise exception 'OVERTIME_DRAFT_STATUS_RPC_ONLY' using errcode = '42501';
    end if;
    if new.run_id <> old.run_id or new.employee_id <> old.employee_id
       or new.confirmed_at is distinct from old.confirmed_at then
      raise exception 'OVERTIME_DRAFT_IMMUTABLE_FIELD' using errcode = '42501';
    end if;
    if (new.project_id, new.work_date, new.task_id, new.time_type)
       is distinct from (old.project_id, old.work_date, old.task_id, old.time_type) then
      new.manually_edited := true;
      new.locked := true;
    end if;
    if new.task_id is distinct from old.task_id then
      if new.task_id is null then
        raise exception 'OVERTIME_DRAFT_TASK_REQUIRED' using errcode = '23514';
      end if;
      -- 호출자 권한(RLS)으로 읽는다 — overtime 읽기 권한이 있어야 하며 쓰기 사용자는 갖고 있다
      select t.task_name into new.task_name
      from public.overtime_employee_tasks t where t.id = new.task_id and t.employee_id = new.employee_id;
      if not found then
        raise exception 'OVERTIME_DRAFT_TASK_NOT_ALLOWED' using errcode = '23514';
      end if;
    end if;
  end if;

  -- 2h/3h 프리셋 (lib/overtime/time.ts TIME_TYPE_PRESETS, 초안 CHECK와 같은 값)
  if new.time_type = '2h' then
    new.start_time := '18:00'; new.end_time := '21:00'; new.break_hours := 1; new.hours := 2;
  elsif new.time_type = '3h' then
    new.start_time := '18:00'; new.end_time := '22:00'; new.break_hours := 1; new.hours := 3;
  else
    raise exception 'OVERTIME_INVALID_TIME_TYPE' using errcode = '22023';
  end if;
  new.is_weekend := extract(isodow from new.work_date) in (6, 7);
  new.is_holiday := exists (select 1 from public.holidays h where h.holiday_date = new.work_date);
  if new.is_weekend or new.is_holiday then
    if new.exception_reason is null then
      if tg_op = 'INSERT' then
        raise exception 'OVERTIME_DRAFT_EXCEPTION_REASON_REQUIRED' using errcode = '23514';
      end if;
      new.exception_reason := '수동 수정';
    end if;
  else
    new.exception_reason := null;  -- 평일 일반 배정은 사유 없음
  end if;
  if tg_op = 'UPDATE' then new.updated_at := pg_catalog.now(); end if;
  return new;
end $$;

drop trigger if exists overtime_assignment_drafts_guard on public.overtime_assignment_drafts;
create trigger overtime_assignment_drafts_guard
  before insert or update or delete on public.overtime_assignment_drafts
  for each row execute function private.overtime_drafts_guard();

-- 2-4. 실행 기록 보호 (INVOKER) — 소유자 맥락(RPC)만
create or replace function private.overtime_runs_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if current_user <> (select pg_catalog.pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid = tg_relid) then
    raise exception 'OVERTIME_RUN_RPC_ONLY' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'UPDATE' then new.updated_at := pg_catalog.now(); end if;
  return new;
end $$;

drop trigger if exists overtime_assignment_runs_guard on public.overtime_assignment_runs;
create trigger overtime_assignment_runs_guard
  before insert or update or delete on public.overtime_assignment_runs
  for each row execute function private.overtime_runs_guard();

-- ════════════════════════════════════════════════════════════════════════════
-- 3. RPC (SECURITY DEFINER, search_path 고정, 첫 줄에서 권한 확인, 객체는 schema-qualified)
-- ════════════════════════════════════════════════════════════════════════════

-- 3-1. 초안 저장 — 실행 기록 + 초안을 한 트랜잭션으로. 범위 안의 잠기지 않은 이전 draft는 superseded.
-- p_run:    { period_label, seed, scope, scope_employee_id?, scope_project_id?, rule_version, input_snapshot, result_summary }
-- p_drafts: [{ employee_id, project_id, work_date, task_id, time_type, exception_reason? }]
--           시간 칸·업무명·주말/공휴일 여부는 DB가 채운다. JSON 키는 정해진 이름으로만 읽는다(식별자로 쓰지 않음).
create or replace function public.overtime_save_assignment_run(p_run jsonb, p_drafts jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_label text := p_run ->> 'period_label';
  v_scope text := coalesce(p_run ->> 'scope', 'all');
  v_scope_emp uuid := nullif(p_run ->> 'scope_employee_id', '')::uuid;
  v_scope_proj uuid := nullif(p_run ->> 'scope_project_id', '')::uuid;
  v_start date;
  v_end date;
  v_run_id uuid;
  v_year int;
  v_bad record;
  v_week record;
  v_target record;
begin
  perform private.overtime_require_write();
  select pp.period_start, pp.period_end into v_start, v_end from private.overtime_pay_period(v_label) pp;

  -- 급여기간에 걸친 연도의 공휴일 데이터가 하나도 없으면 주말·공휴일 판정을 믿을 수 없다
  for v_year in select distinct extract(year from g)::int from generate_series(v_start, v_end, interval '1 day') g loop
    if not exists (select 1 from public.holidays h where extract(year from h.holiday_date) = v_year) then
      raise exception 'OVERTIME_HOLIDAYS_MISSING: %년 공휴일 데이터 없음', v_year using errcode = '55000';
    end if;
  end loop;

  -- 같은 급여기간의 저장·확정 직렬화
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('overtime_period:' || v_label, 0));

  insert into public.overtime_assignment_runs
    (period_label, seed, scope, scope_employee_id, scope_project_id, rule_version, input_snapshot, result_summary)
  values
    (v_label, (p_run ->> 'seed')::bigint, v_scope, v_scope_emp, v_scope_proj,
     coalesce(p_run ->> 'rule_version', ''), coalesce(p_run -> 'input_snapshot', '{}'::jsonb),
     coalesce(p_run -> 'result_summary', '{}'::jsonb))
  returning id into v_run_id;

  update public.overtime_assignment_drafts d
  set status = 'superseded'
  where d.status = 'draft' and not d.locked and not d.manually_edited
    and d.work_date between v_start and v_end
    and (v_scope = 'all'
         or (v_scope = 'employee' and d.employee_id = v_scope_emp)
         or (v_scope = 'project' and d.project_id = v_scope_proj));

  insert into public.overtime_assignment_drafts
    (run_id, employee_id, project_id, work_date, task_id, task_name, time_type, exception_reason)
  select v_run_id, x.employee_id, x.project_id, x.work_date, x.task_id, coalesce(t.task_name, ''), x.time_type, x.exception_reason
  from jsonb_to_recordset(coalesce(p_drafts, '[]'::jsonb))
         as x(employee_id uuid, project_id uuid, work_date date, task_id uuid, time_type text, exception_reason text)
  left join public.overtime_employee_tasks t on t.id = x.task_id and t.employee_id = x.employee_id;

  -- 초안 단위 검증 (하나라도 어긋나면 예외 → 전체 롤백)
  select q.employee_id, q.work_date, q.reason into v_bad
  from (
    select d.employee_id, d.work_date,
      case
        when d.work_date not between v_start and v_end then '급여기간 밖 날짜'
        when v_scope = 'employee' and d.employee_id <> v_scope_emp then '실행 범위(직원) 밖'
        when v_scope = 'project' and d.project_id <> v_scope_proj then '실행 범위(프로젝트) 밖'
        when not exists (select 1 from public.overtime_employees e where e.id = d.employee_id and e.is_active) then '재직 중이 아닌 직원'
        when not exists (select 1 from public.overtime_project_members m where m.project_id = d.project_id and m.employee_id = d.employee_id) then '참여 프로젝트가 아님'
        when not exists (select 1 from public.overtime_projects op where op.id = d.project_id and op.status = '진행중'
                           and op.start_date is not null and op.end_date is not null
                           and d.work_date between op.start_date and op.end_date) then '프로젝트 대상기간 밖'
        when t.id is null then '업무 없음 또는 그 직원의 업무가 아님'
        when exists (select 1 from public.overtime_member_tasks mt join public.overtime_project_members m on m.id = mt.member_id
                      where m.project_id = d.project_id and m.employee_id = d.employee_id)
             and not exists (select 1 from public.overtime_member_tasks mt join public.overtime_project_members m on m.id = mt.member_id
                      where m.project_id = d.project_id and m.employee_id = d.employee_id and mt.task_id = d.task_id)
          then '이 프로젝트에 지정되지 않은 업무'
      end as reason
    from public.overtime_assignment_drafts d
    left join public.overtime_employee_tasks t on t.id = d.task_id and t.employee_id = d.employee_id
    where d.run_id = v_run_id
  ) q
  where q.reason is not null
  limit 1;
  if v_bad.reason is not null then
    raise exception 'OVERTIME_DRAFT_INVALID: % (직원 %, %)', v_bad.reason, v_bad.employee_id, v_bad.work_date using errcode = '23514';
  end if;

  -- 주 12시간: 최종기록 + 살아 있는 초안(draft)
  select w.employee_id, w.week_start, w.total into v_week
  from (
    select k.employee_id, k.week_start,
           (select coalesce(sum(r.hours), 0) from public.overtime_work_records r
             where r.employee_id = k.employee_id and r.work_date between k.week_start and k.week_start + 6)
         + (select coalesce(sum(d2.hours), 0) from public.overtime_assignment_drafts d2
             where d2.employee_id = k.employee_id and d2.status = 'draft' and d2.work_date between k.week_start and k.week_start + 6) as total
    from (select distinct d.employee_id, private.overtime_week_start(d.work_date) as week_start
          from public.overtime_assignment_drafts d where d.run_id = v_run_id) k
  ) w
  where w.total > 12
  limit 1;
  if v_week.employee_id is not null then
    raise exception 'OVERTIME_WEEKLY_CAP: 직원 % / % 주 합계 %시간 (한도 12시간)', v_week.employee_id, v_week.week_start, v_week.total using errcode = '23514';
  end if;

  -- 월 목표: 행이 있어야 하고(미입력 차단, 0시간은 유효), 최종기록 + 살아 있는 초안 ≤ 목표
  select k.employee_id, tg.id as target_id, tg.target_hours,
         (select coalesce(sum(r.hours), 0) from public.overtime_work_records r
           where r.employee_id = k.employee_id and r.work_date between v_start and v_end)
       + (select coalesce(sum(d2.hours), 0) from public.overtime_assignment_drafts d2
           where d2.employee_id = k.employee_id and d2.status = 'draft' and d2.work_date between v_start and v_end) as total
    into v_target
  from (select distinct d.employee_id from public.overtime_assignment_drafts d where d.run_id = v_run_id) k
  left join public.overtime_monthly_targets tg on tg.employee_id = k.employee_id and tg.period_label = v_label
  where tg.id is null
     or (select coalesce(sum(r.hours), 0) from public.overtime_work_records r
          where r.employee_id = k.employee_id and r.work_date between v_start and v_end)
      + (select coalesce(sum(d2.hours), 0) from public.overtime_assignment_drafts d2
          where d2.employee_id = k.employee_id and d2.status = 'draft' and d2.work_date between v_start and v_end) > tg.target_hours
  limit 1;
  if v_target.employee_id is not null then
    if v_target.target_id is null then
      raise exception 'OVERTIME_MONTHLY_TARGET_MISSING: 직원 % 월 목표시간 미입력', v_target.employee_id using errcode = '23514';
    end if;
    raise exception 'OVERTIME_MONTHLY_TARGET: 직원 % 목표 % / 합계 %', v_target.employee_id, v_target.target_hours, v_target.total using errcode = '23514';
  end if;

  perform private.overtime_refresh_run_status(r.id)
  from public.overtime_assignment_runs r
  where r.period_label = v_label and r.id <> v_run_id and r.status in ('draft', 'partially_confirmed');

  return v_run_id;
end $$;

-- 3-2. 확정 — 초안 → 최종기록. p_employee_ids가 null이면 전체.
create or replace function public.overtime_confirm_run(p_run_id uuid, p_employee_ids uuid[] default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run public.overtime_assignment_runs;
  v_start date;
  v_end date;
  d public.overtime_assignment_drafts;
  v_now timestamptz := now();
  v_count int := 0;
  v_target record;
  v_status text;
begin
  perform private.overtime_require_write();
  select * into v_run from public.overtime_assignment_runs r where r.id = p_run_id for update;
  if v_run.id is null then
    raise exception 'OVERTIME_RUN_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_run.status not in ('draft', 'partially_confirmed') then
    raise exception 'OVERTIME_RUN_NOT_CONFIRMABLE: %', v_run.status using errcode = '55000';
  end if;
  select pp.period_start, pp.period_end into v_start, v_end from private.overtime_pay_period(v_run.period_label) pp;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('overtime_period:' || v_run.period_label, 0));

  for d in
    select * from public.overtime_assignment_drafts x
    where x.run_id = p_run_id and x.status = 'draft'
      and (p_employee_ids is null or x.employee_id = any (p_employee_ids))
    order by x.employee_id, x.work_date
    for update
  loop
    if d.work_date not between v_start and v_end then
      raise exception 'OVERTIME_CONFIRM_INVALID: 급여기간 밖 (직원 %, %)', d.employee_id, d.work_date using errcode = '23514';
    end if;
    if not exists (select 1 from public.overtime_employees e where e.id = d.employee_id and e.is_active) then
      raise exception 'OVERTIME_CONFIRM_INVALID: 재직 중이 아닌 직원 (직원 %, %)', d.employee_id, d.work_date using errcode = '23514';
    end if;
    if not exists (select 1 from public.overtime_project_members m where m.project_id = d.project_id and m.employee_id = d.employee_id) then
      raise exception 'OVERTIME_CONFIRM_INVALID: 참여 프로젝트가 아님 (직원 %, %)', d.employee_id, d.work_date using errcode = '23514';
    end if;
    if not exists (select 1 from public.overtime_projects op where op.id = d.project_id and op.status = '진행중'
                     and op.start_date is not null and op.end_date is not null
                     and d.work_date between op.start_date and op.end_date) then
      raise exception 'OVERTIME_CONFIRM_INVALID: 프로젝트 대상기간 밖 (직원 %, %)', d.employee_id, d.work_date using errcode = '23514';
    end if;
    if exists (select 1 from public.overtime_work_records r where r.employee_id = d.employee_id and r.work_date = d.work_date and r.source = 'auto') then
      raise exception 'OVERTIME_CONFIRM_INVALID: 같은 날 자동배정 기록이 이미 있음 (직원 %, %)', d.employee_id, d.work_date using errcode = '23505';
    end if;

    -- 주 12시간은 overtime_work_records_b_weekly_cap 트리거가 같은 규칙 함수로 검사한다.
    -- note(수동 메모)는 비우고, 주말·공휴일 사유는 전용 컬럼으로 옮긴다.
    insert into public.overtime_work_records
      (employee_id, project_id, work_date, task_description, start_time, end_time, hours, break_hours, note,
       source, assignment_run_id, assignment_draft_id,
       employee_name_snapshot, project_name_snapshot, task_name_snapshot, assignment_exception_reason, confirmed_at)
    select d.employee_id, d.project_id, d.work_date, d.task_name, d.start_time, d.end_time, d.hours, d.break_hours, '',
           'auto', d.run_id, d.id,
           e.name, op.name, d.task_name, d.exception_reason, v_now
    from public.overtime_employees e, public.overtime_projects op
    where e.id = d.employee_id and op.id = d.project_id;

    update public.overtime_assignment_drafts set status = 'confirmed', confirmed_at = v_now where id = d.id;
    v_count := v_count + 1;
  end loop;

  -- 월 목표: 행이 있어야 하고 확정 후 급여기간 최종기록 합계 ≤ 목표
  select k.employee_id, tg.id as target_id, tg.target_hours,
         (select coalesce(sum(r.hours), 0) from public.overtime_work_records r
           where r.employee_id = k.employee_id and r.work_date between v_start and v_end) as total
    into v_target
  from (select distinct x.employee_id from public.overtime_assignment_drafts x
        where x.run_id = p_run_id and x.status = 'confirmed' and x.confirmed_at = v_now) k
  left join public.overtime_monthly_targets tg on tg.employee_id = k.employee_id and tg.period_label = v_run.period_label
  where tg.id is null
     or (select coalesce(sum(r.hours), 0) from public.overtime_work_records r
          where r.employee_id = k.employee_id and r.work_date between v_start and v_end) > tg.target_hours
  limit 1;
  if v_target.employee_id is not null then
    if v_target.target_id is null then
      raise exception 'OVERTIME_MONTHLY_TARGET_MISSING: 직원 % 월 목표시간 미입력', v_target.employee_id using errcode = '23514';
    end if;
    raise exception 'OVERTIME_MONTHLY_TARGET: 직원 % 목표 % / 합계 %', v_target.employee_id, v_target.target_hours, v_target.total using errcode = '23514';
  end if;

  v_status := private.overtime_refresh_run_status(p_run_id);
  return jsonb_build_object('confirmed', v_count, 'run_status', v_status);
end $$;

-- 3-3. 확정취소 (관리자만) — 실행·초안·최종기록의 연결과 값이 확정 당시와 같을 때만 기록을 지운다.
create or replace function public.overtime_unconfirm_drafts(p_draft_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  d public.overtime_assignment_drafts;
  r public.overtime_work_records;
  v_count int := 0;
begin
  if not private.overtime_is_admin() then
    raise exception 'permission denied (admin only)' using errcode = '42501';
  end if;

  for d in select * from public.overtime_assignment_drafts x where x.id = any (p_draft_ids) order by x.id for update loop
    if d.status <> 'confirmed' then
      raise exception 'OVERTIME_DRAFT_NOT_CONFIRMED: %', d.id using errcode = '55000';
    end if;
    select * into r from public.overtime_work_records w where w.assignment_draft_id = d.id for update;
    if r.id is null then
      raise exception 'OVERTIME_CONFIRMED_RECORD_MISSING: %', d.id using errcode = 'P0002';
    end if;
    -- 확정 당시 값과 하나라도 다르면(외부 경로 변경) 거부
    if (r.source, r.assignment_run_id, r.employee_id, r.project_id, r.work_date, r.hours, r.start_time, r.end_time,
        r.break_hours, r.task_description, r.task_name_snapshot, r.assignment_exception_reason, r.confirmed_at)
       is distinct from
       ('auto'::text, d.run_id, d.employee_id, d.project_id, d.work_date, d.hours, d.start_time, d.end_time,
        d.break_hours, d.task_name, d.task_name, d.exception_reason, d.confirmed_at) then
      raise exception 'OVERTIME_CONFIRMED_RECORD_CHANGED: %', d.id using errcode = '55000';
    end if;
    delete from public.overtime_work_records where id = r.id;
    update public.overtime_assignment_drafts set status = 'draft', confirmed_at = null where id = d.id;
    v_count := v_count + 1;
  end loop;

  perform private.overtime_refresh_run_status(x.run_id)
  from (select distinct y.run_id from public.overtime_assignment_drafts y where y.id = any (p_draft_ids)) x;
  return jsonb_build_object('unconfirmed', v_count);
end $$;

-- 3-4. 실행 폐기 — 남은 draft 초안만 discarded. 확정분은 그대로.
create or replace function public.overtime_discard_run(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run public.overtime_assignment_runs;
  v_count int;
begin
  perform private.overtime_require_write();
  select * into v_run from public.overtime_assignment_runs r where r.id = p_run_id for update;
  if v_run.id is null then
    raise exception 'OVERTIME_RUN_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_run.status not in ('draft', 'partially_confirmed') then
    raise exception 'OVERTIME_RUN_NOT_DISCARDABLE: %', v_run.status using errcode = '55000';
  end if;
  update public.overtime_assignment_drafts set status = 'discarded' where run_id = p_run_id and status = 'draft';
  get diagnostics v_count = row_count;
  if exists (select 1 from public.overtime_assignment_drafts x where x.run_id = p_run_id and x.status = 'confirmed') then
    perform private.overtime_refresh_run_status(p_run_id);
  else
    update public.overtime_assignment_runs set status = 'discarded', discarded_at = now() where id = p_run_id;
  end if;
  return jsonb_build_object('discarded', v_count);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. 함수 권한 — 전부 회수 후 사용자 RPC 4개만 authenticated
-- ════════════════════════════════════════════════════════════════════════════
revoke all on function private.overtime_require_write() from public, anon, authenticated, service_role;
revoke all on function private.overtime_is_admin() from public, anon, authenticated, service_role;
revoke all on function private.overtime_week_total(uuid, date, uuid) from public, anon, authenticated, service_role;
revoke all on function private.overtime_assert_weekly_cap(uuid, date, numeric, uuid, numeric) from public, anon, authenticated, service_role;
revoke all on function private.overtime_refresh_run_status(uuid) from public, anon, authenticated, service_role;
revoke all on function private.overtime_work_records_protect() from public, anon, authenticated, service_role;
revoke all on function private.overtime_work_records_weekly_cap() from public, anon, authenticated, service_role;
revoke all on function private.overtime_drafts_guard() from public, anon, authenticated, service_role;
revoke all on function private.overtime_runs_guard() from public, anon, authenticated, service_role;

revoke all on function public.overtime_save_assignment_run(jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.overtime_confirm_run(uuid, uuid[]) from public, anon, authenticated, service_role;
revoke all on function public.overtime_unconfirm_drafts(uuid[]) from public, anon, authenticated, service_role;
revoke all on function public.overtime_discard_run(uuid) from public, anon, authenticated, service_role;
grant execute on function public.overtime_save_assignment_run(jsonb, jsonb) to authenticated;
grant execute on function public.overtime_confirm_run(uuid, uuid[]) to authenticated;
grant execute on function public.overtime_unconfirm_drafts(uuid[]) to authenticated;
grant execute on function public.overtime_discard_run(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. 초안 수동 수정 정책 (authenticated, write). 생성·삭제 정책은 두지 않는다.
-- ════════════════════════════════════════════════════════════════════════════
drop policy if exists "menu_update" on public.overtime_assignment_drafts;
create policy "menu_update" on public.overtime_assignment_drafts
  for update to authenticated
  using (private.menu_permission('overtime') = 'write')
  with check (private.menu_permission('overtime') = 'write');

commit;
