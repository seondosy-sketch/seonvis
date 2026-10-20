-- 월 목표 DB 강제조건 되돌리기 — supabase/migration_overtime_monthly_target_guard.sql이 만든 것만 지운다.
--
-- 되돌리기 순서: overtime_planning_c_rollback → overtime_cap_isolation_guard_rollback → overtime_monthly_target_rollback → overtime_planning_rollback_b → overtime_project_sync_rpc_rollback → overtime_planning_rollback_a
--   격리수준 되돌리기(overtime_cap_isolation_guard_rollback.sql)를 먼저 실행한 뒤 이 파일을 실행한다.
--   (격리수준 되돌리기는 월 목표 함수가 있을 때만 원래 본문으로 바꾸므로, 이 파일 뒤에 실행돼도 함수를 되살리지는 않는다.)
-- 데이터는 건드리지 않는다(이 migration은 데이터를 바꾸지 않았다).
begin;
drop trigger if exists overtime_work_records_ab_monthly_target on public.overtime_work_records;
drop function if exists private.overtime_work_records_monthly_target();
drop function if exists private.overtime_assert_monthly_target(uuid, date, numeric, uuid, numeric);
drop function if exists private.overtime_pay_period_label(date);
commit;

select 'monthly_target_trigger_remaining' as check_name,
       count(*)::text as value
from pg_catalog.pg_trigger t
where t.tgrelid = 'public.overtime_work_records'::regclass and t.tgname = 'overtime_work_records_ab_monthly_target';
