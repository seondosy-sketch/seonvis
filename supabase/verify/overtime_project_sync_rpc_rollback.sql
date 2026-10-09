-- 프로젝트 동기화 RPC(migration_overtime_project_sync_rpc.sql) 되돌리기 — 함수만 지운다. 데이터는 건드리지 않는다.
--
-- 되돌리기 순서: overtime_planning_c_rollback → overtime_cap_isolation_guard_rollback → overtime_monthly_target_rollback → overtime_planning_rollback_b → overtime_project_sync_rpc_rollback → overtime_planning_rollback_a
--   이 RPC는 A·B에 의존하지 않는다(overtime_projects·projects만 사용). 순서상 B 다음·A 앞에 두지만 단독 실행도 가능하다.
-- ⚠ 신버전 화면(app/api/overtime/sync-projects)은 이 RPC로만 프로젝트를 동기화한다. 이 롤백은 화면도 구버전으로
--   되돌린 뒤에만 실행한다(아니면 연장근무 프로젝트 목록이 더 이상 갱신되지 않는다 — 화면은 기존 목록으로 계속 동작).
begin;
drop function if exists public.overtime_apply_project_sync(jsonb, jsonb);
commit;

select 'overtime_apply_project_sync_remaining' as check_name,
       (to_regprocedure('public.overtime_apply_project_sync(jsonb,jsonb)') is not null)::text as value;
