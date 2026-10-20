-- 연장근무 자동배정 화면 검증용 가짜 데이터 — 개발용 Supabase(zaot…iyas) 전용. 운영에서 실행 금지.
--
-- 안전장치
--  1) 전체가 DO 블록 하나 = 한 트랜잭션. 중간에 하나라도 실패하면 지운 것·넣은 것 모두 되돌아간다.
--  2) 시작 전에 "운영 흔적"을 검사해 하나라도 있으면 아무것도 하지 않고 중단한다
--     (시험용이 아닌 직원·연장근무 기록·초안이 있거나, 프로젝트·승인 사용자가 개발 DB 규모를 넘으면).
--  3) DELETE는 아래 고정 UUID와 고정 시험 이메일로만 고른다. 이름 LIKE·도메인·"고아 행" 같은 넓은 조건은 쓰지 않는다.
--  4) 지우는 순서는 FK 자식 → 부모. 다른 데이터가 걸려 있으면 FK 오류로 전체가 되돌아간다(남의 행을 대신 지우지 않음).
--  5) 여러 번 실행해도 결과가 같다(먼저 이 파일의 행을 고정 ID로 지우고 다시 넣는다).
--
-- 넣는 것(30행): allowed_users 1, overtime_employees 4, overtime_employee_tasks 12, projects 5,
--                overtime_projects 1, overtime_work_records 3, overtime_monthly_targets 4
-- 참여 프로젝트(overtime_project_members)는 넣지 않는다 — 화면 '설정' 탭에서 체크하는 것이 검증 항목.
-- 정리: overtime_ui_seed_cleanup.sql
do $$
declare
  -- 이 파일이 넣는 시험직원
  emp uuid[] := array['f1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000002',
                      'f1000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000004']::uuid[];
  -- 이 파일이 넣는 입찰 프로젝트(projects)
  src uuid[] := array['f2000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000002',
                      'f2000000-0000-4000-8000-000000000003', 'f2000000-0000-4000-8000-000000000004',
                      'f2000000-0000-4000-8000-000000000005']::uuid[];
  manual_proj uuid := 'f3000000-0000-4000-8000-000000000001';
  -- 이전 동작 시험(overtime_behavior_test.sql)이 넣은 행
  old_emp uuid[] := array['e1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002',
                          'e1000000-0000-4000-8000-000000000003']::uuid[];
  old_src uuid := 'd1000000-0000-4000-8000-000000000001';
  old_proj uuid := 'a1000000-0000-4000-8000-000000000001';
  test_emails text[] := array['ot-ui-test@example.com', 'ot-test-writer@example.invalid', 'ot-test-admin@example.invalid'];

  all_emp uuid[];
  all_src uuid[];
  test_proj uuid[];   -- 시험 overtime_projects (수동 1건 + 동기화가 시험 입찰에서 만든 행)
  test_runs uuid[];
begin
  all_emp := emp || old_emp;
  all_src := src || old_src;
  select coalesce(array_agg(id), '{}') into test_proj
  from public.overtime_projects
  where id in (manual_proj, old_proj) or source_project_id = any (all_src);

  -- ── 운영 흔적 검사: 하나라도 걸리면 중단(아무것도 바뀌지 않음) ──
  if exists (select 1 from public.overtime_employees where not (id = any (all_emp))) then
    raise exception '중단: 시험용이 아닌 연장근무 직원이 있습니다 — 개발용 DB가 아닌 것 같습니다';
  end if;
  if exists (select 1 from public.overtime_work_records where not (employee_id = any (all_emp))) then
    raise exception '중단: 시험용이 아닌 연장근무 기록이 있습니다 — 개발용 DB가 아닌 것 같습니다';
  end if;
  if exists (select 1 from public.overtime_assignment_drafts where not (employee_id = any (all_emp))) then
    raise exception '중단: 시험용이 아닌 자동배정 초안이 있습니다 — 개발용 DB가 아닌 것 같습니다';
  end if;
  if (select count(*) from public.projects where not (id = any (all_src))) > 5 then
    raise exception '중단: 시험용이 아닌 프로젝트가 5건을 넘습니다 — 개발용 DB가 아닌 것 같습니다';
  end if;
  if (select count(*) from public.allowed_users where not (email = any (test_emails))) > 3 then
    raise exception '중단: 승인 사용자가 3명을 넘습니다 — 개발용 DB가 아닌 것 같습니다';
  end if;

  -- ── 이전 시험 행 정리 (고정 ID·고정 이메일만, FK 자식 → 부모 순) ──
  -- 정리 대상 실행 기록: 시험직원 초안이 있는 실행 + 시험직원·시험 프로젝트를 범위로 한 실행 + 동작 시험 실행
  select coalesce(array_agg(distinct id), '{}') into test_runs from (
    select d.run_id as id from public.overtime_assignment_drafts d where d.employee_id = any (all_emp)
    union select r.id from public.overtime_assignment_runs r
      where r.scope_employee_id = any (all_emp) or r.scope_project_id = any (test_proj) or r.rule_version = 'ot-behavior-test'
  ) x;

  delete from public.overtime_work_records where employee_id = any (all_emp);          -- 확정 기록(자동·수동)
  delete from public.overtime_assignment_drafts where employee_id = any (all_emp);
  -- 위에서 고른 실행 중, 시험직원이 아닌 초안이 하나도 없는 것만 (있으면 FK로 막혀 전체 되돌림)
  delete from public.overtime_assignment_runs where id = any (test_runs);
  delete from public.overtime_monthly_targets where employee_id = any (all_emp);
  delete from public.overtime_member_tasks where employee_id = any (all_emp);
  delete from public.overtime_project_members where employee_id = any (all_emp);
  delete from public.overtime_employee_tasks where employee_id = any (all_emp);
  delete from public.overtime_projects where id = any (test_proj);
  delete from public.overtime_employees where id = any (all_emp);
  delete from public.projects where id = any (all_src);
  delete from public.allowed_users where email = any (test_emails);

  -- ── 넣기 ──
  -- 시험 로그인 계정 승인·권한 (Authentication 사용자는 사람이 같은 이메일로 직접 만든다)
  --  연장근무 write, 휴가관리 read(공휴일 표 읽기에 필요), 나머지 메뉴 none. 관리자 아님.
  --  확정 취소(관리자) 시험은 나중에 is_admin을 잠깐 켠다 — 그 SQL은 그때 따로 안내.
  insert into public.allowed_users (email, is_admin, menu_permissions) values
    ('ot-ui-test@example.com', false, jsonb_build_object(
      'overtime', 'write', 'leave', 'read',
      'projects', 'none', 'weekly', 'none', 'field_overtime', 'none', 'engineers', 'none', 'sites', 'none',
      'attendance', 'none', 'lodging', 'none', 'trip', 'none', 'web', 'none', 'proposal_db', 'none', 'interview_db', 'none'));

  insert into public.overtime_employees (id, name, position, is_active, sort_order) values
    (emp[1], '시험직원가', '과장', true, 1),
    (emp[2], '시험직원나', '대리', true, 2),
    (emp[3], '시험직원다', '사원', true, 3),
    (emp[4], '시험직원라', '사원', true, 4);

  insert into public.overtime_employee_tasks (employee_id, task_name, sort_order)
  select e.id, t.name, t.ord
  from unnest(emp) as e(id)
  cross join (values ('도면 검토', 10), ('보고서 작성', 20), ('자료 정리', 30)) as t(name, ord);

  -- 입찰 프로젝트 — 화면을 열면 서버 동기화가 연장근무 프로젝트로 옮긴다. 2026-10 급여기간 = 9/21~10/20
  insert into public.projects (id, project_number, name, announce_date, submit_date, interview_date, bid_date, interview_written, status) values
    (src[1], 'T-001', '시험 A 설계공모',   '2026-09-15', '2026-10-06', '2026-10-14', null, false, '진행중'),          -- 대상 9/15~10/14
    (src[2], 'T-002', '시험 B 서면평가',   '2026-09-25', '2026-10-08', null, null, true, '진행중'),                  -- 대상 9/25~10/8
    (src[3], 'T-003', '시험 C 입찰',       '2026-10-01', '2026-10-27', null, '2026-10-30', false, '진행중'),         -- 대상 10/1~10/30
    (src[4], 'T-004', '시험 D 개찰경과',   '2026-09-01', '2026-09-20', null, '2026-09-28', false, '진행중'),         -- 확인 필요
    (src[5], 'T-005', '시험 E 공고일없음', null,         '2026-10-10', null, null, false, '진행중');                 -- 배정 불가

  -- 월 목표 — 급여기간 직원별 총 한도. 월 목표 DB 강제조건(migration_overtime_monthly_target_guard.sql)이 있으면
  -- 목표 없는 기간에는 기록을 넣을 수 없으므로 기록보다 먼저 넣는다.
  -- 2026-10: 시험직원라는 일부러 비워 둔다(미입력 → 자동배정·수동 입력 차단 확인용)
  -- 2026-09(8/21~9/20): 시험직원가의 9/19 기록용
  insert into public.overtime_monthly_targets (employee_id, period_label, target_hours) values
    (emp[1], '2026-10', 30),
    (emp[2], '2026-10', 24),
    (emp[3], '2026-10', 0),
    (emp[1], '2026-09', 10);

  -- 수동 등록 프로젝트 + 기존 수동기록 (자동배정이 바꾸지 않는 시간, 주 12시간 계산에 포함)
  insert into public.overtime_projects (id, name, status, sort_order, start_date, end_date) values
    (manual_proj, '시험 내부업무', '진행중', 900, null, null);
  insert into public.overtime_work_records (employee_id, project_id, work_date, task_description, start_time, end_time, hours, break_hours, note) values
    (emp[1], manual_proj, '2026-09-19', '자료 정리', '09:00', '13:00', 4, 0, ''),  -- 급여기간 전, 같은 주(9/14~20)
    (emp[1], manual_proj, '2026-09-22', '도면 검토', '18:00', '22:00', 3, 1, ''),
    (emp[1], manual_proj, '2026-09-23', '도면 검토', '18:00', '22:00', 3, 1, '');
end $$;

-- 결과 확인 (읽기만) — 고정 ID 기준
select 'allowed_users' as item, count(*)::text as value from public.allowed_users where email = 'ot-ui-test@example.com'
union all select 'overtime_employees', count(*)::text from public.overtime_employees where id::text like 'f1000000-0000-4000-8000-00000000000_'
union all select 'overtime_employee_tasks', count(*)::text from public.overtime_employee_tasks where employee_id::text like 'f1000000-0000-4000-8000-00000000000_'
union all select 'projects', count(*)::text from public.projects where id::text like 'f2000000-0000-4000-8000-00000000000_'
union all select 'overtime_projects', count(*)::text from public.overtime_projects where id = 'f3000000-0000-4000-8000-000000000001'
union all select 'overtime_work_records', count(*)::text from public.overtime_work_records where employee_id::text like 'f1000000-0000-4000-8000-00000000000_'
union all select 'overtime_monthly_targets', count(*)::text from public.overtime_monthly_targets where employee_id::text like 'f1000000-0000-4000-8000-00000000000_'
union all select 'old_behavior_test_rows', ((select count(*) from public.overtime_employees where id::text like 'e1000000-0000-4000-8000-00000000000_')
                                           + (select count(*) from public.allowed_users where email like 'ot-test-%@example.invalid'))::text
union all select 'holidays_2026 (참고)', count(*)::text from public.holidays where holiday_date between '2026-01-01' and '2026-12-31';
