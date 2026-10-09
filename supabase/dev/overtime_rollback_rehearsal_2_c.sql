-- 연장근무 되돌리기 리허설 2단계 — Migration C 되돌리기
--
-- ████████████████████████████████████████████████████████████████████████████
-- ⚠ 경고 — 개발용 Supabase 전용 "전체 되돌리기 리허설". 운영에서 실행 금지.
--   이 리허설은 개발 DB의 연장근무 자동배정 데이터(실행·초안·자동확정 기록·월 목표·참여업무)를 지운다(5단계).
--   A 되돌리기(8단계)는 overtime_work_records의 자동배정 칸(source 등)과 새 표 4개를 지운다. 지운 데이터는 되살리지 않는다
--   (리허설 뒤 화면 시험 데이터가 필요하면 supabase/dev/overtime_ui_seed.sql을 다시 실행한다).
--   리허설 동안 개발 서버(next dev)를 멈춘다 — 화면이 되돌려진 sync_team_employees(이름 매칭)를 부르지 않게.
--   위 내용을 읽었으면 아래 "set local overtime.rehearsal_ack" 줄 맨 앞의 "-- "를 지우고 실행한다.
--   지우지 않으면 안전장치가 아무것도 바꾸지 않고 멈춘다(파일마다 매번).
-- 순서: _1_state → _2_c → _3_isolation → _4_monthly → _5_purge → _6_b → _7_sync_rpc → _8_a → (정방향 재적용: _9_forward 목록)
--       → _10_compare. 각 단계 뒤 overtime_rollback_rehearsal_check.sql(상태 확인).
-- 되돌리기 순서: overtime_planning_c_rollback → overtime_cap_isolation_guard_rollback → overtime_monthly_target_rollback → overtime_planning_rollback_b → overtime_project_sync_rpc_rollback → overtime_planning_rollback_a
-- ████████████████████████████████████████████████████████████████████████████
--
-- 이 단계: supabase/verify/overtime_planning_c_rollback.sql의 begin;~commit; 본문을 그대로(글자 그대로 — 정적 시험이 확인) 아래 안전장치 뒤에 넣었다.
-- 다음: overtime_rollback_rehearsal_check.sql 실행(step 비워 두면 이 단계 'c'로 자동 판정) → 전부 OK면 다음 단계.

begin;
-- set local overtime.rehearsal_ack = 'yes';   -- ← 맨 위 경고를 읽었으면 이 줄 맨 앞의 "-- "를 지운다

do $$
begin
  if coalesce(current_setting('overtime.rehearsal_ack', true), '') <> 'yes' then
    raise exception '중단: 맨 위 경고를 읽고 set local overtime.rehearsal_ack 줄의 주석을 푼 뒤 실행한다';
  end if;
  -- 개발 DB 확인 (overtime_behavior_test.sql과 같은 기준)
  if (select count(*) from public.projects) > 10 then
    raise exception '중단: projects가 10건을 넘습니다 — 개발용 DB가 아닌 것 같습니다';
  end if;
  if exists (select 1 from public.overtime_employees e
             where e.id::text not like 'e1000000-0000-4000-8000-00000000000_' and e.id::text not like 'f1000000-0000-4000-8000-00000000000_') then
    raise exception '중단: 시험용이 아닌 연장근무 직원이 있습니다 — 개발용 DB가 아닌 것 같습니다';
  end if;
  if exists (select 1 from public.overtime_work_records r
             where r.employee_id::text not like 'e1000000-0000-4000-8000-00000000000_' and r.employee_id::text not like 'f1000000-0000-4000-8000-00000000000_') then
    raise exception '중단: 시험용이 아닌 연장근무 기록이 있습니다 — 개발용 DB가 아닌 것 같습니다';
  end if;
  if to_regclass('private.overtime_rehearsal_snapshot') is null then
    raise exception '중단: 1단계(overtime_rollback_rehearsal_1_state.sql)를 먼저 실행한다';
  end if;
end $$;

-- ↓ supabase/verify/overtime_planning_c_rollback.sql 본문 시작
do $$
begin
  if to_regprocedure('public.overtime_confirm_run(uuid,uuid[])') is null
     or to_regprocedure('private.overtime_drafts_guard()') is null
     or not exists (select 1 from pg_catalog.pg_trigger t
                    where t.tgname = 'overtime_assignment_drafts_guard'
                      and t.tgrelid = to_regclass('public.overtime_assignment_drafts')) then
    raise exception 'C 되돌리기 중단: Migration B가 없다 — B 함수를 되살리지 않는다';
  end if;
end $$;

-- 1. 초안 보호 트리거 함수 (906b8fe 본문)
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
revoke all on function private.overtime_drafts_guard() from public, anon, authenticated, service_role;

-- 2. 초안 저장 RPC (906b8fe 본문)
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
revoke all on function public.overtime_save_assignment_run(jsonb, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.overtime_save_assignment_run(jsonb, jsonb) to authenticated;

-- 3. 확정 RPC (906b8fe 본문)
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
revoke all on function public.overtime_confirm_run(uuid, uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.overtime_confirm_run(uuid, uuid[]) to authenticated;

-- 4. 직원 동기화 (906b8fe 본문)
create or replace function public.sync_team_employees()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  rec record;
  eid uuid;
begin
  if private.menu_permission('overtime') = 'none' and private.menu_permission('field_overtime') = 'none' then
    raise exception 'permission denied' using errcode = '42501';
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
-- ↑ supabase/verify/overtime_planning_c_rollback.sql 본문 끝

insert into private.overtime_rehearsal_snapshot (kind, name, fp) values ('step', 'c', pg_catalog.now()::text);

commit;

select 'c'::text as check_name, 'INFO'::text as status,
       '2단계 완료 — overtime_rollback_rehearsal_check.sql로 상태 확인'::text as detail;
