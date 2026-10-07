-- 연장근무 자동배정 화면 검증용 가짜 데이터 정리 — 개발용 Supabase(zaot…iyas) 전용. 운영에서 실행 금지.
-- overtime_ui_seed.sql이 넣은 행과, 화면 시험 중 그 시험직원·시험 프로젝트로 생긴 초안·실행·확정기록·목표·참여관계만 지운다.
-- 전체가 DO 블록 하나 = 한 트랜잭션(실패하면 전부 되돌림). 고정 UUID·고정 이메일로만 고르고, FK 자식 → 부모 순으로 지운다.
-- 시험 로그인 사용자(Authentication)는 SQL로 지우지 않는다 — 대시보드 Authentication → Users에서 직접 삭제.
do $$
declare
  emp uuid[] := array['f1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000002',
                      'f1000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000004']::uuid[];
  src uuid[] := array['f2000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000002',
                      'f2000000-0000-4000-8000-000000000003', 'f2000000-0000-4000-8000-000000000004',
                      'f2000000-0000-4000-8000-000000000005']::uuid[];
  manual_proj uuid := 'f3000000-0000-4000-8000-000000000001';
  behavior_emp uuid[] := array['e1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002',
                               'e1000000-0000-4000-8000-000000000003']::uuid[];
  test_proj uuid[];
  test_runs uuid[];
begin
  select coalesce(array_agg(id), '{}') into test_proj
  from public.overtime_projects where id = manual_proj or source_project_id = any (src);

  -- 운영 흔적 검사 (seed와 같은 기준)
  -- 동작 시험(overtime_behavior_test.sql)의 e1… 직원·기록은 시험용으로 인정하되 여기서는 지우지 않는다
  if exists (select 1 from public.overtime_employees where not (id = any (emp)) and not (id = any (behavior_emp))) then
    raise exception '중단: 시험용이 아닌 연장근무 직원이 있습니다 — 개발용 DB가 아닌 것 같습니다';
  end if;
  if exists (select 1 from public.overtime_work_records where not (employee_id = any (emp)) and not (employee_id = any (behavior_emp))) then
    raise exception '중단: 시험용이 아닌 연장근무 기록이 있습니다 — 개발용 DB가 아닌 것 같습니다';
  end if;
  if (select count(*) from public.projects where not (id = any (src))) > 5 then
    raise exception '중단: 시험용이 아닌 프로젝트가 5건을 넘습니다 — 개발용 DB가 아닌 것 같습니다';
  end if;

  select coalesce(array_agg(distinct id), '{}') into test_runs from (
    select d.run_id as id from public.overtime_assignment_drafts d where d.employee_id = any (emp)
    union select r.id from public.overtime_assignment_runs r
      where r.scope_employee_id = any (emp) or r.scope_project_id = any (test_proj)
  ) x;

  delete from public.overtime_work_records where employee_id = any (emp);
  delete from public.overtime_assignment_drafts where employee_id = any (emp);
  delete from public.overtime_assignment_runs where id = any (test_runs);
  delete from public.overtime_monthly_targets where employee_id = any (emp);
  delete from public.overtime_member_tasks where employee_id = any (emp);
  delete from public.overtime_project_members where employee_id = any (emp);
  delete from public.overtime_employee_tasks where employee_id = any (emp);
  delete from public.overtime_projects where id = any (test_proj);
  delete from public.overtime_employees where id = any (emp);
  delete from public.projects where id = any (src);
  delete from public.allowed_users where email = 'ot-ui-test@example.com';
end $$;

select 'remaining_test_rows' as item,
       ((select count(*) from public.overtime_employees where id::text like 'f1000000-0000-4000-8000-00000000000_')
      + (select count(*) from public.projects where id::text like 'f2000000-0000-4000-8000-00000000000_')
      + (select count(*) from public.overtime_projects where id = 'f3000000-0000-4000-8000-000000000001')
      + (select count(*) from public.allowed_users where email = 'ot-ui-test@example.com'))::text as value;
