-- ============================================================================
-- 연장근무 자동배정 2차 변경(Migration B) 동작 시험 — 개발용 Supabase 전용
--
-- ⚠ 개발용 프로젝트의 SQL Editor에서만 실행한다.
--   안전장치(하나라도 걸리면 아무것도 바꾸지 않고 중단):
--     Migration B·월 목표 강제조건이 없음 / projects가 10건 초과 / 시험용이 아닌 연장근무 직원·기록이 있음
--   (운영 DB에는 실제 직원·기록이 있으므로 여기서 멈춘다)
-- 전제: 월 목표 = 급여기간 총 한도(migration_overtime_monthly_target_guard.sql) — 기록보다 목표를 먼저 넣는다.
-- 하는 일:
--   1) 지난 시험 데이터 정리(ZZ시험 직원·프로젝트·시험 계정만)
--   2) 가짜 데이터 준비 — 직원 3명, 프로젝트 1개, 업무, 월 목표, 시험 계정 2개(일반·관리자), 입찰 프로젝트 1개
--   3) 실제 로그인 사용자(authenticated) 권한·관리자·비로그인(anon)·서버키(service_role)로 바꿔 가며 시험
--   4) 시험 데이터 완전 정리(시작할 때와 같은 고정 ID·이메일만) → 결과 표 출력 — verdict가 전부 OK여야 한다
-- 고정 ID: 직원 e1000000-…-01~03, 프로젝트 a1000000-…-01, 입찰 d1000000-…-01, 참여 c1…, 업무 b1…,
--          실행 rule_version 'ot-behavior-test', 계정 ot-test-writer/admin@example.invalid.
-- 화면 시험용 seed(supabase/dev/overtime_ui_seed.sql, f1…·f2…·f3…)는 건드리지 않는다.
-- 중간에 멈춰 데이터가 남았으면 supabase/dev/overtime_behavior_test_cleanup.sql
-- ============================================================================

-- 0. 안전장치
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
end $$;

-- 1. 지난 시험 데이터 정리 (소유자 권한 — 자동확정 기록도 지울 수 있다)
do $$
declare
  ids uuid[] := array['e1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000003']::uuid[];
begin
  delete from public.overtime_work_records where employee_id = any (ids);
  delete from public.overtime_assignment_drafts where employee_id = any (ids);
  delete from public.overtime_assignment_runs where rule_version = 'ot-behavior-test';
  delete from public.overtime_monthly_targets where employee_id = any (ids);
  delete from public.overtime_member_tasks where employee_id = any (ids);
  delete from public.overtime_project_members where employee_id = any (ids);
  delete from public.overtime_employee_tasks where employee_id = any (ids);
  delete from public.overtime_projects where id = 'a1000000-0000-4000-8000-000000000001' or source_project_id = 'd1000000-0000-4000-8000-000000000001';
  delete from public.overtime_employees where id = any (ids);
  delete from public.projects where id = 'd1000000-0000-4000-8000-000000000001';
  delete from public.allowed_users where email in ('ot-test-writer@example.invalid', 'ot-test-admin@example.invalid');
end $$;

-- 결과·상태 보관용 임시 테이블과 기록 함수
create temp table if not exists ot_results (seq int generated always as identity, check_name text, verdict text, expected text, actual text);
truncate ot_results;
create temp table if not exists ot_state (key text primary key, val uuid);
truncate ot_state;

create or replace function pg_temp.ot_record(p_name text, p_expect text, p_err text) returns void language plpgsql as $f$
begin
  insert into ot_results (check_name, verdict, expected, actual)
  values (p_name,
          case when p_expect = '성공' then (case when p_err is null then 'OK' else 'FAIL' end)
               else (case when p_err is not null and position(p_expect in p_err) > 0 then 'OK' else 'FAIL' end) end,
          p_expect, coalesce(p_err, '성공'));
end $f$;

create or replace function pg_temp.ot_check(p_name text, p_ok boolean, p_expect text, p_actual text) returns void language plpgsql as $f$
begin
  insert into ot_results (check_name, verdict, expected, actual) values (p_name, case when p_ok then 'OK' else 'FAIL' end, p_expect, p_actual);
end $f$;

-- 2. 가짜 데이터 (소유자 권한)
insert into public.allowed_users (email, is_admin) values
  ('ot-test-writer@example.invalid', false),   -- menu_permissions 비어 있음 = 모든 메뉴 write
  ('ot-test-admin@example.invalid', true);

insert into public.overtime_employees (id, name, position, is_active, sort_order) values
  ('e1000000-0000-4000-8000-000000000001', 'ZZ시험직원1', '사원', true, 9001),
  ('e1000000-0000-4000-8000-000000000002', 'ZZ시험직원2', '사원', true, 9002),
  ('e1000000-0000-4000-8000-000000000003', 'ZZ시험직원3', '사원', true, 9003);

insert into public.overtime_projects (id, name, status, sort_order, start_date, end_date) values
  ('a1000000-0000-4000-8000-000000000001', 'ZZ시험프로젝트', '진행중', 9001, '2026-10-01', '2026-11-30');

insert into public.overtime_project_members (id, project_id, employee_id) values
  ('c1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001'),
  ('c1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002'),
  ('c1000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000003');

insert into public.overtime_employee_tasks (id, employee_id, task_name, sort_order) values
  ('b1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'ZZ검토', 10),
  ('b1000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000002', 'ZZ작성', 10),
  ('b1000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000003', 'ZZ정리', 10);

-- 2026-11 급여기간(10/21~11/20) 월 목표 — 기록보다 먼저 넣는다(월 목표 = 총 한도, 목표 없으면 입력 차단).
-- 직원1 40h(주 12시간 시험이 월 목표에 걸리지 않게 넉넉히), 직원2 20h, 직원3은 목표 없음(T13·T21).
insert into public.overtime_monthly_targets (employee_id, period_label, target_hours) values
  ('e1000000-0000-4000-8000-000000000001', '2026-11', 40),
  ('e1000000-0000-4000-8000-000000000002', '2026-11', 20);

insert into public.projects (id, name, announce_date, submit_date, interview_date, bid_date, status) values
  ('d1000000-0000-4000-8000-000000000001', 'ZZ시험입찰', '2026-10-01', '2026-11-10', '2026-11-15', '2026-11-20', '진행중');

-- ── 3. 시험 ────────────────────────────────────────────────────────────────
-- 일반 사용자 = ot-test-writer, 직원1의 2026-10-26(월)~11-01(일) 주로 수동 입력·주 12시간 시험

-- T01 수동 입력 — 보호·주간 트리거가 일반 사용자 권한에서도 동작(트리거 함수 EXECUTE 회수 상태), source='manual' 자동 기록
do $$
declare v_err text;
begin
  perform set_config('request.jwt.claims', '{"email":"ot-test-writer@example.invalid","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin
    insert into public.overtime_work_records (employee_id, project_id, work_date, task_description, start_time, end_time, hours, break_hours)
    values ('e1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', '2026-10-26', 'ZZ검토', '18:00', '22:00', 3, 1);
  exception when others then v_err := sqlerrm;
  end;
  execute 'reset role';
  perform pg_temp.ot_record('T01 일반 사용자 수동 입력(트리거 동작)', '성공', v_err);
  perform pg_temp.ot_check('T01b 신규 수동기록 source=manual 자동 기록',
    (select source from public.overtime_work_records where employee_id = 'e1000000-0000-4000-8000-000000000001' and work_date = '2026-10-26') = 'manual',
    'manual', coalesce((select source from public.overtime_work_records where employee_id = 'e1000000-0000-4000-8000-000000000001' and work_date = '2026-10-26'), '없음'));
end $$;

-- T02 주 합계 정확히 12h 허용 (3h × 4일)
do $$
declare v_err text;
begin
  perform set_config('request.jwt.claims', '{"email":"ot-test-writer@example.invalid","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin
    insert into public.overtime_work_records (employee_id, project_id, work_date, task_description, start_time, end_time, hours, break_hours) values
      ('e1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', '2026-10-27', 'ZZ검토', '18:00', '22:00', 3, 1),
      ('e1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', '2026-10-28', 'ZZ검토', '18:00', '22:00', 3, 1),
      ('e1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', '2026-10-29', 'ZZ검토', '18:00', '22:00', 3, 1);
  exception when others then v_err := sqlerrm;
  end;
  execute 'reset role';
  perform pg_temp.ot_record('T02 주 합계 12h(경계값) 허용', '성공', v_err);
end $$;

-- T03 13h 이상 차단
do $$
declare v_err text;
begin
  perform set_config('request.jwt.claims', '{"email":"ot-test-writer@example.invalid","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin
    insert into public.overtime_work_records (employee_id, project_id, work_date, task_description, start_time, end_time, hours, break_hours)
    values ('e1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', '2026-10-30', 'ZZ검토', '18:00', '21:00', 2, 1);
  exception when others then v_err := sqlerrm;
  end;
  execute 'reset role';
  perform pg_temp.ot_record('T03 주 합계 12h 초과 입력 차단', 'OVERTIME_WEEKLY_CAP', v_err);
end $$;

-- T04 시간을 바꾸지 않는 수정(업무명)은 허용 / T05 시간을 늘리는 수정은 차단
do $$
declare v_err text; v_err2 text;
begin
  perform set_config('request.jwt.claims', '{"email":"ot-test-writer@example.invalid","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin
    update public.overtime_work_records set task_description = 'ZZ검토(수정)'
    where employee_id = 'e1000000-0000-4000-8000-000000000001' and work_date = '2026-10-29';
  exception when others then v_err := sqlerrm;
  end;
  begin
    update public.overtime_work_records set hours = 4, end_time = '23:00'
    where employee_id = 'e1000000-0000-4000-8000-000000000001' and work_date = '2026-10-29';
  exception when others then v_err2 := sqlerrm;
  end;
  execute 'reset role';
  perform pg_temp.ot_record('T04 한도 꽉 찬 주에서 시간 그대로인 수정 허용', '성공', v_err);
  perform pg_temp.ot_record('T05 한도 꽉 찬 주에서 시간을 늘리는 수정 차단', 'OVERTIME_WEEKLY_CAP', v_err2);
end $$;

-- T06 다른 주로 옮기는 수정 허용 / T07 수동기록 삭제 허용
do $$
declare v_err text; v_err2 text;
begin
  perform set_config('request.jwt.claims', '{"email":"ot-test-writer@example.invalid","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin
    update public.overtime_work_records set work_date = '2026-11-04'
    where employee_id = 'e1000000-0000-4000-8000-000000000001' and work_date = '2026-10-29';
  exception when others then v_err := sqlerrm;
  end;
  begin
    delete from public.overtime_work_records where employee_id = 'e1000000-0000-4000-8000-000000000001' and work_date = '2026-10-26';
  exception when others then v_err2 := sqlerrm;
  end;
  execute 'reset role';
  perform pg_temp.ot_record('T06 다른 주로 날짜를 옮기는 수정 허용', '성공', v_err);
  perform pg_temp.ot_record('T07 수동기록 삭제 허용(기존 흐름 유지)', '성공', v_err2);
end $$;

-- T08 일반 사용자가 자동배정(auto) 기록을 직접 만들 수 없다
do $$
declare v_err text;
begin
  perform set_config('request.jwt.claims', '{"email":"ot-test-writer@example.invalid","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin
    insert into public.overtime_work_records (employee_id, project_id, work_date, task_description, start_time, end_time, hours, break_hours, source, assignment_run_id, assignment_draft_id, confirmed_at)
    values ('e1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', '2026-11-09', 'ZZ검토', '18:00', '21:00', 2, 1, 'auto', gen_random_uuid(), gen_random_uuid(), now());
  exception when others then v_err := sqlerrm;
  end;
  execute 'reset role';
  perform pg_temp.ot_record('T08 auto 기록 직접 생성 차단', 'OVERTIME_AUTO_RECORD_LOCKED', v_err);
end $$;

-- T09 월 목표 저장 시 created_by·updated_by에 로그인 이메일(auth.jwt, INVOKER 트리거)
do $$
declare v_err text;
begin
  perform set_config('request.jwt.claims', '{"email":"ot-test-writer@example.invalid","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin
    insert into public.overtime_monthly_targets (employee_id, period_label, target_hours) values ('e1000000-0000-4000-8000-000000000001', '2026-12', 10);
    update public.overtime_monthly_targets set target_hours = 12 where employee_id = 'e1000000-0000-4000-8000-000000000001' and period_label = '2026-12';
  exception when others then v_err := sqlerrm;
  end;
  execute 'reset role';
  perform pg_temp.ot_record('T09 월 목표 저장(일반 사용자)', '성공', v_err);
  perform pg_temp.ot_check('T09b 월 목표 created_by/updated_by = 로그인 이메일',
    exists (select 1 from public.overtime_monthly_targets where employee_id = 'e1000000-0000-4000-8000-000000000001' and period_label = '2026-12'
            and created_by = 'ot-test-writer@example.invalid' and updated_by = 'ot-test-writer@example.invalid' and target_hours = 12),
    'ot-test-writer@… 둘 다',
    coalesce((select created_by || ' / ' || updated_by from public.overtime_monthly_targets where employee_id = 'e1000000-0000-4000-8000-000000000001' and period_label = '2026-12'), '없음'));
end $$;

-- T10 자동배정 초안 저장(RPC) — 직원2, 평일 2건 + 토요일 1건(사유 포함)
do $$
declare v_err text; v_run uuid;
begin
  perform set_config('request.jwt.claims', '{"email":"ot-test-writer@example.invalid","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin
    v_run := public.overtime_save_assignment_run(
      '{"period_label":"2026-11","seed":1,"scope":"all","rule_version":"ot-behavior-test","input_snapshot":{},"result_summary":{"issues":[{"code":"SINGLE_DAY_PROJECT_BLOCK"}]}}'::jsonb,
      '[{"employee_id":"e1000000-0000-4000-8000-000000000002","project_id":"a1000000-0000-4000-8000-000000000001","work_date":"2026-11-02","task_id":"b1000000-0000-4000-8000-000000000002","time_type":"3h"},
        {"employee_id":"e1000000-0000-4000-8000-000000000002","project_id":"a1000000-0000-4000-8000-000000000001","work_date":"2026-11-03","task_id":"b1000000-0000-4000-8000-000000000002","time_type":"2h"},
        {"employee_id":"e1000000-0000-4000-8000-000000000002","project_id":"a1000000-0000-4000-8000-000000000001","work_date":"2026-11-07","task_id":"b1000000-0000-4000-8000-000000000002","time_type":"2h","exception_reason":"시험 주말 사유"}]'::jsonb);
  exception when others then v_err := sqlerrm;
  end;
  execute 'reset role';
  if v_run is not null then insert into ot_state values ('run', v_run); end if;
  perform pg_temp.ot_record('T10 초안 저장 RPC(일반 사용자)', '성공', v_err);
  perform pg_temp.ot_check('T10b 초안 3건, 3h 초안은 18:00~22:00 휴게1, 토요일 초안은 주말·사유',
    (select count(*) from public.overtime_assignment_drafts where run_id = v_run) = 3
    and exists (select 1 from public.overtime_assignment_drafts where run_id = v_run and work_date = '2026-11-02' and start_time = '18:00' and end_time = '22:00' and break_hours = 1 and hours = 3)
    and exists (select 1 from public.overtime_assignment_drafts where run_id = v_run and work_date = '2026-11-07' and is_weekend and exception_reason = '시험 주말 사유'),
    '3건·프리셋·주말 사유',
    (select count(*)::text || '건' from public.overtime_assignment_drafts where run_id = v_run));
end $$;

-- T11 초안을 화면에서 직접 만들 수 없다 / T12 초안 수정은 되고 자동으로 잠긴다
do $$
declare v_err text; v_err2 text; v_run uuid := (select val from ot_state where key = 'run');
begin
  perform set_config('request.jwt.claims', '{"email":"ot-test-writer@example.invalid","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin
    insert into public.overtime_assignment_drafts (run_id, employee_id, project_id, work_date, task_id, task_name, time_type, start_time, end_time, break_hours, hours)
    values (v_run, 'e1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', '2026-11-05', 'b1000000-0000-4000-8000-000000000002', 'ZZ작성', '2h', '18:00', '21:00', 1, 2);
  exception when others then v_err := sqlerrm;
  end;
  begin
    update public.overtime_assignment_drafts set time_type = '3h' where run_id = v_run and work_date = '2026-11-03';
  exception when others then v_err2 := sqlerrm;
  end;
  execute 'reset role';
  -- INSERT는 BEFORE 트리거가 RLS 검사보다 먼저 돈다 → 보호 트리거가 먼저 막는다(RLS에도 insert 정책이 없어 이중으로 막힘)
  perform pg_temp.ot_record('T11 초안 직접 생성 차단', 'OVERTIME_DRAFT_RPC_ONLY', v_err);
  perform pg_temp.ot_record('T12 초안 수정(일반 사용자)', '성공', v_err2);
  perform pg_temp.ot_check('T12b 수정한 초안은 3h로 바뀌고 manually_edited·locked = true',
    exists (select 1 from public.overtime_assignment_drafts where run_id = v_run and work_date = '2026-11-03' and hours = 3 and end_time = '22:00' and manually_edited and locked),
    '3h, 잠금', coalesce((select hours::text || 'h edited=' || manually_edited || ' locked=' || locked from public.overtime_assignment_drafts where run_id = v_run and work_date = '2026-11-03'), '없음'));
end $$;

-- T13 월 목표 없는 직원(직원3) 초안 저장 차단
do $$
declare v_err text;
begin
  perform set_config('request.jwt.claims', '{"email":"ot-test-writer@example.invalid","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin
    perform public.overtime_save_assignment_run(
      '{"period_label":"2026-11","seed":2,"scope":"employee","scope_employee_id":"e1000000-0000-4000-8000-000000000003","rule_version":"ot-behavior-test","input_snapshot":{},"result_summary":{}}'::jsonb,
      '[{"employee_id":"e1000000-0000-4000-8000-000000000003","project_id":"a1000000-0000-4000-8000-000000000001","work_date":"2026-11-02","task_id":"b1000000-0000-4000-8000-000000000003","time_type":"2h"}]'::jsonb);
  exception when others then v_err := sqlerrm;
  end;
  execute 'reset role';
  perform pg_temp.ot_record('T13 월 목표 미입력 직원 초안 저장 차단', 'OVERTIME_MONTHLY_TARGET_MISSING', v_err);
end $$;

-- T14 확정 RPC — 최종기록 3건(auto), 이름 스냅샷, 주말 사유는 전용 칸·비고는 빈 값
do $$
declare v_err text; v_res jsonb; v_run uuid := (select val from ot_state where key = 'run');
begin
  perform set_config('request.jwt.claims', '{"email":"ot-test-writer@example.invalid","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin
    v_res := public.overtime_confirm_run(v_run, null);
  exception when others then v_err := sqlerrm;
  end;
  execute 'reset role';
  perform pg_temp.ot_record('T14 확정 RPC(일반 사용자)', '성공', v_err);
  perform pg_temp.ot_check('T14b auto 기록 3건·스냅샷·전용 사유 칸·비고 빈 값·실행 상태 confirmed',
    (select count(*) from public.overtime_work_records where assignment_run_id = v_run and source = 'auto'
       and employee_name_snapshot = 'ZZ시험직원2' and project_name_snapshot = 'ZZ시험프로젝트' and task_name_snapshot = 'ZZ작성' and note = '') = 3
    and exists (select 1 from public.overtime_work_records where assignment_run_id = v_run and work_date = '2026-11-07' and assignment_exception_reason = '시험 주말 사유')
    and (select status from public.overtime_assignment_runs where id = v_run) = 'confirmed',
    '3건, confirmed', coalesce(v_res::text, '없음') || ' / run=' || coalesce((select status from public.overtime_assignment_runs where id = v_run), '없음'));
end $$;

-- T15 확정 기록 직접 수정·삭제 차단 / T16 일반 사용자 확정취소 차단
do $$
declare v_err text; v_err2 text; v_err3 text; v_run uuid := (select val from ot_state where key = 'run');
begin
  perform set_config('request.jwt.claims', '{"email":"ot-test-writer@example.invalid","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin
    update public.overtime_work_records set note = '임의 수정' where assignment_run_id = v_run and work_date = '2026-11-02';
  exception when others then v_err := sqlerrm;
  end;
  begin
    delete from public.overtime_work_records where assignment_run_id = v_run and work_date = '2026-11-02';
  exception when others then v_err2 := sqlerrm;
  end;
  begin
    perform public.overtime_unconfirm_drafts(array(select id from public.overtime_assignment_drafts where run_id = v_run and work_date = '2026-11-02'));
  exception when others then v_err3 := sqlerrm;
  end;
  execute 'reset role';
  perform pg_temp.ot_record('T15 확정 기록 직접 수정 차단', 'OVERTIME_AUTO_RECORD_LOCKED', v_err);
  perform pg_temp.ot_record('T15b 확정 기록 직접 삭제 차단', 'OVERTIME_AUTO_RECORD_LOCKED', v_err2);
  perform pg_temp.ot_record('T16 일반 사용자 확정취소 차단', 'admin only', v_err3);
end $$;

-- T17 관리자 확정취소 — 기록 1건 삭제, 초안은 draft로, 실행은 partially_confirmed
do $$
declare v_err text; v_res jsonb; v_run uuid := (select val from ot_state where key = 'run');
begin
  perform set_config('request.jwt.claims', '{"email":"ot-test-admin@example.invalid","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin
    v_res := public.overtime_unconfirm_drafts(array(select id from public.overtime_assignment_drafts where run_id = v_run and work_date = '2026-11-02'));
  exception when others then v_err := sqlerrm;
  end;
  execute 'reset role';
  perform pg_temp.ot_record('T17 관리자 확정취소', '성공', v_err);
  perform pg_temp.ot_check('T17b 기록 2건 남음·초안 draft 복귀·실행 partially_confirmed',
    (select count(*) from public.overtime_work_records where assignment_run_id = v_run) = 2
    and (select status from public.overtime_assignment_drafts where run_id = v_run and work_date = '2026-11-02') = 'draft'
    and (select status from public.overtime_assignment_runs where id = v_run) = 'partially_confirmed',
    '2건, draft, partially_confirmed',
    coalesce(v_res::text, '없음') || ' / run=' || coalesce((select status from public.overtime_assignment_runs where id = v_run), '없음'));
end $$;

-- T18 비로그인(anon)은 RPC 실행 불가 / T19 일반 사용자는 프로젝트 동기화 RPC 실행 불가
do $$
declare v_err text; v_err2 text;
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';
  begin
    perform public.overtime_save_assignment_run('{}'::jsonb, '[]'::jsonb);
  exception when others then v_err := sqlerrm;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"email":"ot-test-writer@example.invalid","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin
    perform public.overtime_apply_project_sync('[]'::jsonb, '[]'::jsonb);
  exception when others then v_err2 := sqlerrm;
  end;
  execute 'reset role';
  perform pg_temp.ot_record('T18 비로그인 RPC 실행 차단', 'permission denied', v_err);
  perform pg_temp.ot_record('T19 일반 사용자 동기화 RPC 실행 차단', 'permission denied', v_err2);
end $$;

-- T20 동기화 RPC(service_role) — 원본과 다른 계획 거부, 맞는 계획 반영, 같은 계획 반복은 변경 0
do $$
declare v_err text; v_err2 text; v_res jsonb; v_res2 jsonb;
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role service_role';
  begin
    perform public.overtime_apply_project_sync(
      '[{"source_project_id":"d1000000-0000-4000-8000-000000000001","name":"엉뚱한 이름","start_date":"2026-10-01","end_date":"2026-11-15","status":"진행중","sort_order":9100}]'::jsonb, '[]'::jsonb);
  exception when others then v_err := sqlerrm;
  end;
  begin
    v_res := public.overtime_apply_project_sync(
      '[{"source_project_id":"d1000000-0000-4000-8000-000000000001","name":"ZZ시험입찰","start_date":"2026-10-01","end_date":"2026-11-15","status":"진행중","sort_order":9100}]'::jsonb, '[]'::jsonb);
    v_res2 := public.overtime_apply_project_sync(
      '[{"source_project_id":"d1000000-0000-4000-8000-000000000001","name":"ZZ시험입찰","start_date":"2026-10-01","end_date":"2026-11-15","status":"진행중","sort_order":9100}]'::jsonb, '[]'::jsonb);
  exception when others then v_err2 := sqlerrm;
  end;
  execute 'reset role';
  perform pg_temp.ot_record('T20 동기화 RPC가 원본과 다른 계획 거부', 'OVERTIME_SYNC_PLAN_MISMATCH', v_err);
  perform pg_temp.ot_record('T20b 동기화 RPC 맞는 계획 반영', '성공', v_err2);
  perform pg_temp.ot_check('T20c 첫 반영 inserted=1, 같은 계획 반복은 inserted=0·updated=0(멱등)',
    (v_res ->> 'inserted') = '1' and (v_res2 ->> 'inserted') = '0' and (v_res2 ->> 'updated') = '0',
    '1 → 0/0', coalesce(v_res::text, '없음') || ' → ' || coalesce(v_res2::text, '없음'));
end $$;

-- T21 월 목표 없는 직원(직원3)의 수동 입력 차단 / T22 목표를 합계까지 낮춘 뒤 추가 입력 차단(기존 기록은 그대로)
do $$
declare v_err text; v_err2 text; v_before int; v_after int;
begin
  perform set_config('request.jwt.claims', '{"email":"ot-test-writer@example.invalid","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin
    insert into public.overtime_work_records (employee_id, project_id, work_date, task_description, start_time, end_time, hours, break_hours)
    values ('e1000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', '2026-11-10', 'ZZ정리', '18:00', '21:00', 2, 1);
  exception when others then v_err := sqlerrm;
  end;
  -- 직원2: 2026-11 합계(확정 기록)까지 목표를 낮춘다 → 기록은 남고, 2시간 추가는 차단
  select count(*) into v_before from public.overtime_work_records where employee_id = 'e1000000-0000-4000-8000-000000000002';
  update public.overtime_monthly_targets
     set target_hours = (select coalesce(sum(hours), 0) from public.overtime_work_records
                          where employee_id = 'e1000000-0000-4000-8000-000000000002' and work_date between '2026-10-21' and '2026-11-20')
   where employee_id = 'e1000000-0000-4000-8000-000000000002' and period_label = '2026-11';
  begin
    insert into public.overtime_work_records (employee_id, project_id, work_date, task_description, start_time, end_time, hours, break_hours)
    values ('e1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', '2026-11-10', 'ZZ작성', '18:00', '21:00', 2, 1);
  exception when others then v_err2 := sqlerrm;
  end;
  select count(*) into v_after from public.overtime_work_records where employee_id = 'e1000000-0000-4000-8000-000000000002';
  execute 'reset role';
  perform pg_temp.ot_record('T21 월 목표 없는 직원 수동 입력 차단', 'OVERTIME_MONTHLY_TARGET_MISSING', v_err);
  perform pg_temp.ot_record('T22 목표 = 합계일 때 추가 입력 차단', 'OVERTIME_MONTHLY_TARGET_EXCEEDED', v_err2);
  perform pg_temp.ot_check('T22b 목표를 낮춰도 기존 기록은 그대로', v_before = v_after and v_before > 0, '기록 수 유지', v_before || ' → ' || v_after);
end $$;

-- 4. 시험 데이터 완전 정리 (시작할 때와 같은 고정 ID·이메일만, 소유자 권한)
do $$
declare
  ids uuid[] := array['e1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000003']::uuid[];
begin
  delete from public.overtime_work_records where employee_id = any (ids);
  delete from public.overtime_assignment_drafts where employee_id = any (ids);
  delete from public.overtime_assignment_runs where rule_version = 'ot-behavior-test';
  delete from public.overtime_monthly_targets where employee_id = any (ids);
  delete from public.overtime_member_tasks where employee_id = any (ids);
  delete from public.overtime_project_members where employee_id = any (ids);
  delete from public.overtime_employee_tasks where employee_id = any (ids);
  delete from public.overtime_projects where id = 'a1000000-0000-4000-8000-000000000001' or source_project_id = 'd1000000-0000-4000-8000-000000000001';
  delete from public.overtime_employees where id = any (ids);
  delete from public.projects where id = 'd1000000-0000-4000-8000-000000000001';
  delete from public.allowed_users where email in ('ot-test-writer@example.invalid', 'ot-test-admin@example.invalid');
end $$;

select pg_temp.ot_check('Z 시험 데이터 정리 — 남은 행 0',
  (select count(*) from public.overtime_employees where id::text like 'e1000000-0000-4000-8000-00000000000_')
  + (select count(*) from public.overtime_assignment_runs where rule_version = 'ot-behavior-test')
  + (select count(*) from public.projects where id = 'd1000000-0000-4000-8000-000000000001')
  + (select count(*) from public.allowed_users where email like 'ot-test-%@example.invalid') = 0,
  '0', ((select count(*) from public.overtime_employees where id::text like 'e1000000-0000-4000-8000-00000000000_')
  + (select count(*) from public.overtime_assignment_runs where rule_version = 'ot-behavior-test')
  + (select count(*) from public.projects where id = 'd1000000-0000-4000-8000-000000000001')
  + (select count(*) from public.allowed_users where email like 'ot-test-%@example.invalid'))::text);

-- 5. 결과
select seq, check_name, verdict, expected, actual from ot_results order by seq;
