-- ============================================================================
-- 연장근무 자동배정 — 공휴일 변경 후 확정·확정취소 시험 (Migration C) — 개발용 Supabase 전용
--
-- ⚠ 개발용 프로젝트의 SQL Editor에서만 실행한다. 전체를 한 번에 실행한다.
--   안전장치(하나라도 걸리면 아무것도 바꾸지 않고 중단) — overtime_behavior_test.sql과 같은 기준:
--     Migration B·월 목표 강제조건이 없음 / projects가 10건 초과 / 시험용(e1…·f1…)이 아닌 연장근무 직원·기록이 있음 /
--     2026년 공휴일 데이터가 없음 / 시험 날짜(2026-11-05)가 이미 공휴일 / 이 시험의 고정 ID·이메일이 이미 있음
-- 데이터: 시험 전체가 DO 블록 하나 안의 하위 트랜잭션에서 돌고, 끝에서 일부러 예외를 내 그 하위 트랜잭션을 통째로 되돌린다.
--   → 공휴일·직원·초안·기록·계정 등 이 시험이 만든 것은 하나도 남지 않는다(정리 파일 불필요, 결과 표의 Z 행이 확인).
--   결과는 되돌리기 전에 변수에 모아 두었다가 임시 표(ot_h_results)에 옮겨 출력한다.
-- 시나리오 (직원1 = e2…01, 직원2 = e2…02, 시험 날짜 D = 2026-11-05 목요일, 급여기간 2026-11):
--   H01 일반 사용자(overtime write)가 초안 저장 — D(평일, is_holiday:false 전송)·2026-11-06
--   H03 관리자(소유자 권한)가 D를 공휴일로 등록 → H04 낡은 미리보기(is_holiday:false) 저장은 OVERTIME_HOLIDAY_CHANGED
--   H05 일반 사용자 확정 → 확정 직전 재계산: 초안·기록 모두 is_holiday=true, 사유 '확정 시 공휴일 변경 반영'(같은 값)
--   H07 D 공휴일 삭제(다시 변경) → H08 일반 사용자 확정취소 거부 → H09 관리자 확정취소 성공(예전 코드는 RECORD_CHANGED)
--   H10 D의 자동기록 삭제·초안 draft 복귀, 다른 기록(직원1 수동·직원2 수동·11-06 자동) 그대로
--   H12 다시 확정 → 재계산으로 is_holiday=false·사유 NULL, H13 관리자 확정취소 다시 성공
-- 역할 전환은 overtime_behavior_test.sql과 같다: set_config('request.jwt.claims', …, true) + set local role authenticated.
-- 결과: check_name / status(OK·FAIL·INFO) / detail — status가 전부 OK(또는 INFO)여야 한다.
-- 고정 ID: 직원 e2000000-0000-4000-8000-00000000000{1,2}, 프로젝트 a2000000-…-01, 참여 c2…, 업무 b2…,
--          실행 rule_version 'ot-holiday-test', 계정 ot-holiday-writer/admin@example.invalid, 공휴일 이름 'ZZ시험공휴일'.
-- ============================================================================

-- 0. 안전장치 (아무것도 바꾸기 전)
do $$
begin
  if to_regprocedure('public.overtime_confirm_run(uuid,uuid[])') is null then
    raise exception '중단: Migration B가 적용되지 않은 DB입니다';
  end if;
  if to_regprocedure('private.overtime_assert_monthly_target(uuid,date,numeric,uuid,numeric)') is null then
    raise exception '중단: 월 목표 강제조건(migration_overtime_monthly_target_guard.sql)이 적용되지 않은 DB입니다';
  end if;
  if (select count(*) from public.projects) > 10 then
    raise exception '중단: projects가 10건을 넘습니다 — 개발용 DB가 아닌 것 같습니다';
  end if;
  -- 시험용 고정 ID(동작 시험 e1…, 화면 seed f1…)가 아닌 직원·기록이 있으면 운영 DB로 보고 중단
  if exists (select 1 from public.overtime_employees e
             where e.id::text not like 'e1000000-0000-4000-8000-00000000000_' and e.id::text not like 'f1000000-0000-4000-8000-00000000000_') then
    raise exception '중단: 시험용이 아닌 연장근무 직원이 있습니다 — 개발용 DB가 아닌 것 같습니다';
  end if;
  if exists (select 1 from public.overtime_work_records r
             where r.employee_id::text not like 'e1000000-0000-4000-8000-00000000000_' and r.employee_id::text not like 'f1000000-0000-4000-8000-00000000000_') then
    raise exception '중단: 시험용이 아닌 연장근무 기록이 있습니다 — 개발용 DB가 아닌 것 같습니다';
  end if;
  if not exists (select 1 from public.holidays where extract(year from holiday_date) = 2026) then
    raise exception '중단: 2026년 공휴일 데이터가 없습니다(초안 저장 RPC가 OVERTIME_HOLIDAYS_MISSING으로 막음)';
  end if;
  if exists (select 1 from public.holidays where holiday_date = '2026-11-05') then
    raise exception '중단: 시험 날짜 2026-11-05가 이미 공휴일입니다 — 시험 날짜를 바꿔야 합니다';
  end if;
  if exists (select 1 from public.overtime_employees where id::text like 'e2000000-0000-4000-8000-00000000000_')
     or exists (select 1 from public.overtime_projects where id = 'a2000000-0000-4000-8000-000000000001')
     or exists (select 1 from public.allowed_users where email in ('ot-holiday-writer@example.invalid', 'ot-holiday-admin@example.invalid')) then
    raise exception '중단: 이 시험의 고정 ID·계정이 이미 있습니다 — 남은 행을 먼저 확인합니다';
  end if;
end $$;

-- 결과 표와 기록 함수(순수 함수 — 표에 쓰지 않는다)
create temp table if not exists ot_h_results (seq int generated always as identity, check_name text, status text, detail text);
truncate ot_h_results;

create or replace function pg_temp.ot_h_err(p_name text, p_expect text, p_err text) returns jsonb language sql immutable as $f$
  select jsonb_build_object('c', p_name,
    's', case when p_expect = '성공' then (case when p_err is null then 'OK' else 'FAIL' end)
              else (case when p_err is not null and position(p_expect in p_err) > 0 then 'OK' else 'FAIL' end) end,
    'd', '기대=' || p_expect || ' / 실제=' || coalesce(p_err, '성공'))
$f$;
create or replace function pg_temp.ot_h_chk(p_name text, p_ok boolean, p_detail text) returns jsonb language sql immutable as $f$
  select jsonb_build_object('c', p_name, 's', case when coalesce(p_ok, false) then 'OK' else 'FAIL' end, 'd', coalesce(p_detail, '-'))
$f$;

do $$
declare
  c_writer constant text := '{"email":"ot-holiday-writer@example.invalid","role":"authenticated"}';
  c_admin constant text := '{"email":"ot-holiday-admin@example.invalid","role":"authenticated"}';
  c_emp1 constant uuid := 'e2000000-0000-4000-8000-000000000001';
  c_emp2 constant uuid := 'e2000000-0000-4000-8000-000000000002';
  c_proj constant uuid := 'a2000000-0000-4000-8000-000000000001';
  c_day constant date := '2026-11-05';
  c_reason constant text := '확정 시 공휴일 변경 반영';
  v_out jsonb := '[]'::jsonb;
  v_err text;
  v_run uuid;
  v_draft uuid;
  v_res jsonb;
  v_fp_before text;
  v_fp_after text;
  v_d public.overtime_assignment_drafts;
  v_r public.overtime_work_records;
  v_drafts jsonb;
begin
  v_out := v_out || jsonb_build_object('c', 'H00 C 적용 여부', 's', 'INFO', 'd',
    case when coalesce(pg_catalog.pg_get_functiondef(to_regprocedure('public.overtime_confirm_run(uuid,uuid[])')) like '%' || c_reason || '%', false)
         then 'C 적용됨' else 'C 미적용 — H05b·H09가 FAIL로 나오는 것이 원래 버그' end);

  begin  -- ── 시험 하위 트랜잭션: 끝에서 OT_HOLIDAY_TEST_ROLLBACK으로 전부 되돌린다 ──

    -- 가짜 데이터 (소유자 권한). 메뉴 권한은 명시한다(키 없음의 기본값에 기대지 않음).
    insert into public.allowed_users (email, is_admin, menu_permissions) values
      ('ot-holiday-writer@example.invalid', false, '{"overtime":"write","leave":"read"}'::jsonb),
      ('ot-holiday-admin@example.invalid', true, '{"overtime":"write","leave":"read"}'::jsonb);
    insert into public.overtime_employees (id, name, position, is_active, sort_order) values
      (c_emp1, 'ZZ휴일시험1', '사원', true, 9101),
      (c_emp2, 'ZZ휴일시험2', '사원', true, 9102);
    insert into public.overtime_projects (id, name, status, sort_order, start_date, end_date) values
      (c_proj, 'ZZ휴일시험프로젝트', '진행중', 9101, '2026-10-01', '2026-11-30');
    insert into public.overtime_project_members (id, project_id, employee_id) values
      ('c2000000-0000-4000-8000-000000000001', c_proj, c_emp1),
      ('c2000000-0000-4000-8000-000000000002', c_proj, c_emp2);
    insert into public.overtime_employee_tasks (id, employee_id, task_name, sort_order) values
      ('b2000000-0000-4000-8000-000000000001', c_emp1, 'ZZ휴일검토', 10),
      ('b2000000-0000-4000-8000-000000000002', c_emp2, 'ZZ휴일작성', 10);
    insert into public.overtime_monthly_targets (employee_id, period_label, target_hours) values
      (c_emp1, '2026-11', 40), (c_emp2, '2026-11', 40);
    -- 확정취소가 건드리면 안 되는 기록: 직원1 수동(11-02), 직원2 수동(같은 날 D)
    insert into public.overtime_work_records (employee_id, project_id, work_date, task_description, start_time, end_time, hours, break_hours) values
      (c_emp1, c_proj, '2026-11-02', 'ZZ휴일검토', '18:00', '21:00', 2, 1),
      (c_emp2, c_proj, c_day, 'ZZ휴일작성', '18:00', '21:00', 2, 1);

    v_drafts := jsonb_build_array(
      jsonb_build_object('employee_id', c_emp1, 'project_id', c_proj, 'work_date', c_day,
                         'task_id', 'b2000000-0000-4000-8000-000000000001', 'time_type', '2h', 'is_holiday', false),
      jsonb_build_object('employee_id', c_emp1, 'project_id', c_proj, 'work_date', '2026-11-06',
                         'task_id', 'b2000000-0000-4000-8000-000000000001', 'time_type', '3h', 'is_holiday', false));

    -- H01 일반 사용자 초안 저장 (is_holiday 키 포함)
    v_err := null;
    perform set_config('request.jwt.claims', c_writer, true);
    execute 'set local role authenticated';
    begin
      v_run := public.overtime_save_assignment_run(
        jsonb_build_object('period_label', '2026-11', 'seed', 1, 'scope', 'employee', 'scope_employee_id', c_emp1,
                           'rule_version', 'ot-holiday-test', 'input_snapshot', '{}'::jsonb, 'result_summary', '{}'::jsonb),
        v_drafts);
    exception when others then v_err := sqlerrm;
    end;
    execute 'reset role';
    v_out := v_out || pg_temp.ot_h_err('H01 일반 사용자 초안 저장(is_holiday 키)', '성공', v_err);
    select * into v_d from public.overtime_assignment_drafts where run_id = v_run and work_date = c_day;
    v_draft := v_d.id;
    v_out := v_out || pg_temp.ot_h_chk('H02 저장 직후 D 초안: 평일·공휴일 아님·사유 없음',
      v_d.id is not null and not v_d.is_weekend and not v_d.is_holiday and v_d.exception_reason is null,
      'is_holiday=' || coalesce(v_d.is_holiday::text, '없음') || ' 사유=' || coalesce(v_d.exception_reason, 'NULL'));

    -- H03 D를 공휴일로 등록 (소유자 권한 = 관리자가 휴가관리에서 등록한 것과 같은 결과)
    insert into public.holidays (holiday_date, name, holiday_type) values (c_day, 'ZZ시험공휴일', '회사휴무');
    v_out := v_out || pg_temp.ot_h_chk('H03 D 공휴일 등록', exists (select 1 from public.holidays where holiday_date = c_day), c_day::text);

    -- H04 공휴일 변경 전에 만든 미리보기(is_holiday:false)를 그대로 저장 → 거부
    v_err := null;
    perform set_config('request.jwt.claims', c_writer, true);
    execute 'set local role authenticated';
    begin
      perform public.overtime_save_assignment_run(
        jsonb_build_object('period_label', '2026-11', 'seed', 2, 'scope', 'employee', 'scope_employee_id', c_emp1,
                           'rule_version', 'ot-holiday-test', 'input_snapshot', '{}'::jsonb, 'result_summary', '{}'::jsonb),
        v_drafts);
    exception when others then v_err := sqlerrm;
    end;
    execute 'reset role';
    v_out := v_out || pg_temp.ot_h_err('H04 낡은 미리보기 저장 거부', 'OVERTIME_HOLIDAY_CHANGED', v_err);

    -- 확정취소가 건드리면 안 되는 기록의 지문(수동 기록 전부 + 다른 직원 기록)
    select md5(coalesce(string_agg(r.id::text || r.employee_id || r.work_date || r.hours || coalesce(r.source, '') || r.task_description
                                   || coalesce(r.assignment_exception_reason, ''), '|' order by r.id), ''))
      into v_fp_before
    from public.overtime_work_records r
    where r.employee_id in (c_emp1, c_emp2) and (r.source is distinct from 'auto' or r.employee_id <> c_emp1);

    -- H05 일반 사용자 확정 → 확정 직전 재계산
    v_err := null;
    perform set_config('request.jwt.claims', c_writer, true);
    execute 'set local role authenticated';
    begin
      v_res := public.overtime_confirm_run(v_run, null);
    exception when others then v_err := sqlerrm;
    end;
    execute 'reset role';
    v_out := v_out || pg_temp.ot_h_err('H05 일반 사용자 확정', '성공', v_err);
    select * into v_d from public.overtime_assignment_drafts where id = v_draft;
    select * into v_r from public.overtime_work_records where assignment_draft_id = v_draft;
    v_out := v_out || pg_temp.ot_h_chk('H05b 확정 후 D: 초안·기록 모두 공휴일 반영, 사유 같음(고정 문구)',
      v_d.status = 'confirmed' and v_d.is_holiday and v_d.exception_reason = c_reason
      and v_r.id is not null and v_r.assignment_exception_reason is not distinct from v_d.exception_reason,
      '초안 status=' || coalesce(v_d.status, '없음') || ' is_holiday=' || coalesce(v_d.is_holiday::text, '없음')
      || ' 사유=' || coalesce(v_d.exception_reason, 'NULL') || ' / 기록 사유=' || coalesce(v_r.assignment_exception_reason, 'NULL'));
    v_out := v_out || pg_temp.ot_h_chk('H06 확정 후 11-06(평일) 초안·기록 사유 NULL',
      exists (select 1 from public.overtime_assignment_drafts d join public.overtime_work_records r on r.assignment_draft_id = d.id
              where d.run_id = v_run and d.work_date = '2026-11-06' and d.status = 'confirmed'
                and d.exception_reason is null and r.assignment_exception_reason is null and not d.is_holiday),
      '11-06');

    -- H07 D 공휴일 다시 변경(삭제) — 확정 초안·기록은 그대로여야 한다
    delete from public.holidays where holiday_date = c_day and name = 'ZZ시험공휴일';
    select * into v_d from public.overtime_assignment_drafts where id = v_draft;
    v_out := v_out || pg_temp.ot_h_chk('H07 공휴일 삭제 후에도 확정 초안 스냅샷 유지',
      not exists (select 1 from public.holidays where holiday_date = c_day) and v_d.is_holiday and v_d.exception_reason = c_reason,
      'is_holiday=' || coalesce(v_d.is_holiday::text, '없음') || ' 사유=' || coalesce(v_d.exception_reason, 'NULL'));

    -- H08 일반 사용자 확정취소 거부
    v_err := null;
    perform set_config('request.jwt.claims', c_writer, true);
    execute 'set local role authenticated';
    begin
      perform public.overtime_unconfirm_drafts(array[v_draft]);
    exception when others then v_err := sqlerrm;
    end;
    execute 'reset role';
    v_out := v_out || pg_temp.ot_h_err('H08 일반 사용자 확정취소 거부', 'admin only', v_err);

    -- H09 관리자 확정취소 — 기록과 초안 스냅샷이 같으므로 성공해야 한다
    v_err := null;
    perform set_config('request.jwt.claims', c_admin, true);
    execute 'set local role authenticated';
    begin
      v_res := public.overtime_unconfirm_drafts(array[v_draft]);
    exception when others then v_err := sqlerrm;
    end;
    execute 'reset role';
    v_out := v_out || pg_temp.ot_h_err('H09 관리자 확정취소(공휴일 두 번 변경 뒤)', '성공', v_err);
    select * into v_d from public.overtime_assignment_drafts where id = v_draft;
    v_out := v_out || pg_temp.ot_h_chk('H10 D 자동기록 삭제·초안 draft 복귀·실행 partially_confirmed',
      not exists (select 1 from public.overtime_work_records where assignment_draft_id = v_draft)
      and v_d.status = 'draft' and v_d.confirmed_at is null
      and (select status from public.overtime_assignment_runs where id = v_run) = 'partially_confirmed',
      '초안 status=' || coalesce(v_d.status, '없음') || ' / 실행=' || coalesce((select status from public.overtime_assignment_runs where id = v_run), '없음'));

    select md5(coalesce(string_agg(r.id::text || r.employee_id || r.work_date || r.hours || coalesce(r.source, '') || r.task_description
                                   || coalesce(r.assignment_exception_reason, ''), '|' order by r.id), ''))
      into v_fp_after
    from public.overtime_work_records r
    where r.employee_id in (c_emp1, c_emp2) and (r.source is distinct from 'auto' or r.employee_id <> c_emp1);
    v_out := v_out || pg_temp.ot_h_chk('H11 수동 기록·다른 직원 기록 그대로, 11-06 자동기록 유지',
      v_fp_before = v_fp_after
      and (select count(*) from public.overtime_work_records where employee_id = c_emp1 and source is distinct from 'auto') = 1
      and (select count(*) from public.overtime_work_records where employee_id = c_emp2) = 1
      and exists (select 1 from public.overtime_work_records where employee_id = c_emp1 and work_date = '2026-11-06' and source = 'auto'),
      case when v_fp_before = v_fp_after then '지문 같음' else '지문 다름' end);

    -- H12 다시 확정 → 공휴일이 아니므로 재계산 결과 is_holiday=false·사유 NULL
    v_err := null;
    perform set_config('request.jwt.claims', c_writer, true);
    execute 'set local role authenticated';
    begin
      v_res := public.overtime_confirm_run(v_run, null);
    exception when others then v_err := sqlerrm;
    end;
    execute 'reset role';
    v_out := v_out || pg_temp.ot_h_err('H12 공휴일 해제 뒤 다시 확정', '성공', v_err);
    select * into v_d from public.overtime_assignment_drafts where id = v_draft;
    select * into v_r from public.overtime_work_records where assignment_draft_id = v_draft;
    v_out := v_out || pg_temp.ot_h_chk('H12b 재확정: 초안·기록 모두 공휴일 아님·사유 NULL',
      v_d.status = 'confirmed' and not v_d.is_holiday and v_d.exception_reason is null
      and v_r.id is not null and v_r.assignment_exception_reason is null,
      'is_holiday=' || coalesce(v_d.is_holiday::text, '없음') || ' 초안 사유=' || coalesce(v_d.exception_reason, 'NULL')
      || ' 기록 사유=' || coalesce(v_r.assignment_exception_reason, 'NULL'));

    -- H13 관리자 확정취소 다시 성공
    v_err := null;
    perform set_config('request.jwt.claims', c_admin, true);
    execute 'set local role authenticated';
    begin
      v_res := public.overtime_unconfirm_drafts(array[v_draft]);
    exception when others then v_err := sqlerrm;
    end;
    execute 'reset role';
    v_out := v_out || pg_temp.ot_h_err('H13 관리자 확정취소(재확정분)', '성공', v_err);

    raise exception 'OT_HOLIDAY_TEST_ROLLBACK';
  exception when others then
    if sqlerrm <> 'OT_HOLIDAY_TEST_ROLLBACK' then
      v_out := v_out || pg_temp.ot_h_chk('X 예기치 않은 오류(시험 중단, 변경은 모두 되돌림)', false, sqlerrm);
    end if;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);

  insert into ot_h_results (check_name, status, detail)
  select x ->> 'c', x ->> 's', x ->> 'd' from jsonb_array_elements(v_out) with ordinality as t(x, n) order by n;
end $$;

-- Z. 남은 시험 데이터 0 (하위 트랜잭션 되돌림 확인)
insert into ot_h_results (check_name, status, detail)
select 'Z 시험 데이터 남지 않음(공휴일 포함)',
       case when n = 0 then 'OK' else 'FAIL' end, n::text || '행'
from (select (select count(*) from public.overtime_employees where id::text like 'e2000000-0000-4000-8000-00000000000_')
           + (select count(*) from public.overtime_projects where id = 'a2000000-0000-4000-8000-000000000001')
           + (select count(*) from public.overtime_assignment_runs where rule_version = 'ot-holiday-test')
           + (select count(*) from public.holidays where name = 'ZZ시험공휴일' or holiday_date = '2026-11-05')
           + (select count(*) from public.allowed_users where email in ('ot-holiday-writer@example.invalid', 'ot-holiday-admin@example.invalid')) as n) z;

select check_name, status, detail from ot_h_results order by seq;
