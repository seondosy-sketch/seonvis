-- 연장근무 동작 시험 데이터 정리 — 개발용 Supabase 전용
-- overtime_behavior_test.sql이 넣은 ZZ시험 직원·프로젝트·초안·기록·시험 계정만 지운다(소유자 권한).
do $$
declare
  ids uuid[] := array['e1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000003']::uuid[];
begin
  if (select count(*) from public.projects) > 10 then
    raise exception '중단: projects가 10건을 넘습니다 — 개발용 DB가 아닌 것 같습니다';
  end if;
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

select 'remaining_test_rows' as item,
       (select count(*) from public.overtime_employees where name like 'ZZ시험%')
     + (select count(*) from public.overtime_projects where name like 'ZZ시험%')
     + (select count(*) from public.allowed_users where email like 'ot-test-%') as value;
