-- 연장근무 자동배정 — Migration C: 확정·공휴일·직원 연결 보정 (forward corrective migration)
--
-- ⚠ 초안. 개발 DB에서 먼저 실행한다(supabase/dev 순서는 docs/overtime-planning-db.md "Migration C"). 운영 적용은 별도 승인.
-- 대상: A·B(+ 월 목표 강제조건 + 격리수준 방어)가 이미 적용된 DB. 0단계에서 A·B가 있는지 확인하고 없으면 중단한다.
-- 신규 설치(A·B를 처음 적용하는 DB)는 A·B 파일에 같은 수정이 들어 있으므로 C를 다시 적용해도 내용이 바뀌지 않는다(no-op).
--
-- 고치는 것 (함수 4개를 create or replace — 본문은 A·B의 현재 정의와 글자 그대로 같다, lib/overtime/sql/overtimeSql.test.ts가 확인)
--   1) private.overtime_drafts_guard()       — 상태 전이·draft가 아닌 행의 UPDATE에서 주말·공휴일·사유·시간 칸을 다시 계산하지 않는다
--   2) public.overtime_confirm_run(...)       — 확정 직전 초안의 달력 값을 한 번 다시 계산하고, 그 값 그대로 최종기록을 만든다
--                                              (새로 공휴일이 된 날에 사유가 없으면 고정 문구 '확정 시 공휴일 변경 반영')
--   3) public.overtime_save_assignment_run(...) — 초안의 선택 키 is_holiday가 지금 공휴일 표와 다르면 OVERTIME_HOLIDAY_CHANGED(55000)
--   4) public.sync_team_employees()           — 미연결 주소록과 미연결 재직 직원이 둘 다 있으면 OVERTIME_EMPLOYEE_LINK_REQUIRED(55000)
-- 원인: 확정 RPC가 초안 사유로 기록을 만든 뒤 상태만 바꾸는 UPDATE에서 초안 트리거가 공휴일을 다시 계산해, 그 사이 공휴일이
--   바뀌었으면 초안 사유만 달라졌다 → 확정취소 비교(OVERTIME_CONFIRMED_RECORD_CHANGED)가 영구히 실패.
-- 바꾸지 않는 것: 데이터(기존 초안·기록 UPDATE 없음), 트리거 정의, 테이블, 정책, 확정취소·폐기 RPC, 월 목표·격리수준 함수
--   (migration_overtime_monthly_target_guard.sql·migration_overtime_cap_isolation_guard.sql은 이 4개 함수를 정의하지 않는다).
-- 이미 버그로 사유가 어긋난 확정 초안은 그대로 남는다 — overtime_planning_c_preflight.sql c07이 건수를 보여준다.
-- 권한: B·A와 같은 revoke/grant를 다시 적용한다. 한 트랜잭션, 다시 실행해도 같은 결과.
-- 확인: supabase/verify/overtime_planning_c_preflight.sql(직전) → 이 파일 → overtime_planning_c_postflight.sql(직후)
-- 되돌리기: supabase/verify/overtime_planning_c_rollback.sql
-- 되돌리기 순서: overtime_planning_c_rollback → overtime_cap_isolation_guard_rollback → overtime_monthly_target_rollback → overtime_planning_rollback_b → overtime_project_sync_rpc_rollback → overtime_planning_rollback_a

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- 0. 전제 확인 — A·B 적용, 직원 연결 상태
-- ════════════════════════════════════════════════════════════════════════════
do $$
begin
  if to_regclass('public.overtime_assignment_drafts') is null
     or to_regclass('public.overtime_monthly_targets') is null
     or to_regclass('public.engineer_contacts_employee_id_key') is null
     or to_regprocedure('private.overtime_pay_period(text)') is null then
    raise exception 'Migration C 중단: Migration A가 적용되지 않았다';
  end if;
  if to_regprocedure('public.overtime_save_assignment_run(jsonb,jsonb)') is null
     or to_regprocedure('public.overtime_confirm_run(uuid,uuid[])') is null
     or to_regprocedure('public.overtime_unconfirm_drafts(uuid[])') is null
     or to_regprocedure('private.overtime_drafts_guard()') is null
     or not exists (select 1 from pg_catalog.pg_trigger t
                    where t.tgname = 'overtime_assignment_drafts_guard'
                      and t.tgrelid = to_regclass('public.overtime_assignment_drafts')) then
    raise exception 'Migration C 중단: Migration B가 적용되지 않았다';
  end if;
  -- 직원 분리 방지 (migration A 0단계·sync_team_employees 0단계와 같은 조건) — 아무것도 바꾸기 전에 확인
  if exists (select 1 from public.engineer_contacts c where c.company = '미래사업팀' and c.employee_id is null)
     and exists (select 1 from public.overtime_employees e
                 where e.is_active and not exists (select 1 from public.engineer_contacts c where c.employee_id = e.id)) then
    raise exception 'OVERTIME_EMPLOYEE_LINK_REQUIRED: 연결 안 된 주소록 %명 / 직원 %명',
      (select count(*) from public.engineer_contacts c where c.company = '미래사업팀' and c.employee_id is null),
      (select count(*) from public.overtime_employees e
        where e.is_active and not exists (select 1 from public.engineer_contacts c where c.employee_id = e.id))
      using errcode = '55000';
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. 초안 보호 트리거 함수 (migration_overtime_planning_b_activate.sql 2-3과 같은 본문)
-- ════════════════════════════════════════════════════════════════════════════
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

  -- 상태 전이 또는 draft가 아닌 행: 달력 플래그·사유·시간 칸을 다시 계산하지 않는다(저장된 스냅샷 유지)
  if tg_op = 'UPDATE' and (old.status <> 'draft' or new.status <> 'draft') then
    new.updated_at := pg_catalog.now();
    return new;
  end if;

  -- 이하 편집 가능한 상태(INSERT, draft → draft UPDATE)만
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
revoke all on function private.overtime_drafts_guard() from public, anon, authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. 초안 저장 RPC (migration_overtime_planning_b_activate.sql 3-1과 같은 본문)
-- ════════════════════════════════════════════════════════════════════════════
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
  v_changed date;
begin
  perform private.overtime_require_write();
  select pp.period_start, pp.period_end into v_start, v_end from private.overtime_pay_period(v_label) pp;

  -- 급여기간에 걸친 연도의 공휴일 데이터가 하나도 없으면 주말·공휴일 판정을 믿을 수 없다
  for v_year in select distinct extract(year from g)::int from generate_series(v_start, v_end, interval '1 day') g loop
    if not exists (select 1 from public.holidays h where extract(year from h.holiday_date) = v_year) then
      raise exception 'OVERTIME_HOLIDAYS_MISSING: %년 공휴일 데이터 없음', v_year using errcode = '55000';
    end if;
  end loop;

  -- 미리보기 뒤 공휴일 변경: 초안의 is_holiday(보낸 경우만)가 지금 공휴일 표와 다르면 아무것도 쓰기 전에 거부
  select x.work_date into v_changed
  from jsonb_to_recordset(coalesce(p_drafts, '[]'::jsonb)) as x(work_date date, is_holiday boolean)
  where x.is_holiday is not null
    and x.is_holiday is distinct from (exists (select 1 from public.holidays h where h.holiday_date = x.work_date))
  order by x.work_date
  limit 1;
  if v_changed is not null then
    raise exception 'OVERTIME_HOLIDAY_CHANGED: % 공휴일 여부가 다름', v_changed using errcode = '55000';
  end if;

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
revoke all on function public.overtime_save_assignment_run(jsonb, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.overtime_save_assignment_run(jsonb, jsonb) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. 확정 RPC (migration_overtime_planning_b_activate.sql 3-2와 같은 본문)
-- ════════════════════════════════════════════════════════════════════════════
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
  v_fresh public.overtime_assignment_drafts;
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

    -- 확정 직전 달력 재계산 1회: draft → draft UPDATE라 초안 트리거가 주말·공휴일·사유를 현재 공휴일 표로 다시 계산한다.
    -- 사유는 여기서 먼저 정한다(주말·공휴일이면 기존 사유, 없으면 고정 문구 / 아니면 NULL) — 트리거의 '수동 수정' 기본값을 쓰지 않는다.
    update public.overtime_assignment_drafts x
    set exception_reason = case
          when extract(isodow from x.work_date) in (6, 7)
               or exists (select 1 from public.holidays h where h.holiday_date = x.work_date)
          then coalesce(x.exception_reason, '확정 시 공휴일 변경 반영')
          else null
        end
    where x.id = d.id;
    select * into v_fresh from public.overtime_assignment_drafts x where x.id = d.id;

    -- 주 12시간은 overtime_work_records_b_weekly_cap 트리거가 같은 규칙 함수로 검사한다.
    -- note(수동 메모)는 비우고, 주말·공휴일 사유는 전용 컬럼으로 옮긴다. 값은 방금 다시 읽은 초안(v_fresh) 그대로.
    insert into public.overtime_work_records
      (employee_id, project_id, work_date, task_description, start_time, end_time, hours, break_hours, note,
       source, assignment_run_id, assignment_draft_id,
       employee_name_snapshot, project_name_snapshot, task_name_snapshot, assignment_exception_reason, confirmed_at)
    select v_fresh.employee_id, v_fresh.project_id, v_fresh.work_date, v_fresh.task_name, v_fresh.start_time, v_fresh.end_time,
           v_fresh.hours, v_fresh.break_hours, '',
           'auto', v_fresh.run_id, v_fresh.id,
           e.name, op.name, v_fresh.task_name, v_fresh.exception_reason, v_now
    from public.overtime_employees e, public.overtime_projects op
    where e.id = v_fresh.employee_id and op.id = v_fresh.project_id;

    -- 상태만 바꾼다 — 초안 트리거는 상태 전이에서 달력 값을 다시 계산하지 않으므로 v_fresh 값이 유지된다
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
revoke all on function public.overtime_confirm_run(uuid, uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.overtime_confirm_run(uuid, uuid[]) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. 직원 동기화 (migration_overtime_planning_a_base.sql 3과 같은 본문)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.sync_team_employees()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  rec record;
  eid uuid;
  v_unlinked_contacts int;
  v_unlinked_employees int;
begin
  if private.menu_permission('overtime') = 'none' and private.menu_permission('field_overtime') = 'none' then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  -- 0) 직원 분리 방지 — 데이터를 바꾸기 전에 확인한다
  select count(*) into v_unlinked_contacts
  from public.engineer_contacts c where c.company = '미래사업팀' and c.employee_id is null;
  select count(*) into v_unlinked_employees
  from public.overtime_employees e
  where e.is_active and not exists (select 1 from public.engineer_contacts c where c.employee_id = e.id);
  if v_unlinked_contacts > 0 and v_unlinked_employees > 0 then
    raise exception 'OVERTIME_EMPLOYEE_LINK_REQUIRED: 연결 안 된 주소록 %명 / 직원 %명', v_unlinked_contacts, v_unlinked_employees
      using errcode = '55000', hint = 'supabase/verify/overtime_employee_link_check.sql로 확인 후 주소록에서 직원을 연결한다';
  end if;

  -- 1) for update: 동시 실행 시 두 번째 호출은 이미 연결된 행을 다시 평가해 건너뛴다
  --    (engineer_contacts_employee_id_key도 같은 직원 이중 연결을 막는다)
  for rec in
    select c.id, c.name, c.rank, c.employment_status
    from public.engineer_contacts c
    where c.company = '미래사업팀' and c.employee_id is null
    order by c.created_at, c.id
    for update
  loop
    insert into public.overtime_employees (name, position, is_active, sort_order)
    values (rec.name, rec.rank, rec.employment_status = '재직',
            coalesce((select max(e.sort_order) from public.overtime_employees e), 0) + 10)
    returning id into eid;
    update public.engineer_contacts set employee_id = eid where id = rec.id;
  end loop;

  -- 2) 바뀐 행만 쓴다(같은 값이면 UPDATE 없음)
  update public.overtime_employees e
  set name = c.name,
      position = c.rank,
      is_active = (c.company = '미래사업팀' and c.employment_status = '재직')
  from public.engineer_contacts c
  where c.employee_id = e.id
    and (e.name, e.position, e.is_active)
        is distinct from (c.name, c.rank, (c.company = '미래사업팀' and c.employment_status = '재직'));

  -- 3) 연결이 끊긴 직원 비활성
  if exists (select 1 from public.engineer_contacts c where c.company = '미래사업팀' and c.employment_status = '재직') then
    update public.overtime_employees e
    set is_active = false
    where e.is_active
      and not exists (select 1 from public.engineer_contacts c where c.employee_id = e.id);
  end if;
end $$;
revoke all on function public.sync_team_employees() from public, anon, authenticated, service_role;
grant execute on function public.sync_team_employees() to authenticated, service_role;

commit;

-- 확인 (읽기만) — 자세한 확인은 overtime_planning_c_postflight.sql
select p.oid::regprocedure::text as function_name,
       (pg_catalog.pg_get_functiondef(p.oid) like any (array['%상태 전이 또는 draft가 아닌 행%',
                                                            '%확정 시 공휴일 변경 반영%',
                                                            '%OVERTIME_HOLIDAY_CHANGED%',
                                                            '%OVERTIME_EMPLOYEE_LINK_REQUIRED%']))::text as has_c_fix
from pg_catalog.pg_proc p
where p.oid in (to_regprocedure('private.overtime_drafts_guard()'), to_regprocedure('public.overtime_confirm_run(uuid,uuid[])'),
                to_regprocedure('public.overtime_save_assignment_run(jsonb,jsonb)'), to_regprocedure('public.sync_team_employees()'))
order by 1;
