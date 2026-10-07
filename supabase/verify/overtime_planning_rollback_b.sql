-- 연장근무 자동배정 — Migration B 복구 초안 (실행하지 않는다. 문제 시 별도 승인 후)
--
-- B만 되돌린다(A는 남김). B는 트리거·RPC·정책만 추가했고 데이터를 넣지 않으므로, 자동배정 데이터가
-- 생기기 전이면 안전하다. 자동배정 실행·초안·auto 기록이 이미 있으면 중단한다 — 그 상태에서 보호 트리거를
-- 지우면 auto 기록이 직접 수정 가능해지므로 먼저 보존 방안을 정한다.
-- migration 자체는 한 트랜잭션이라 실행 도중 실패하면 Postgres가 자동으로 전부 되돌린다.

begin;

do $$
begin
  if exists (select 1 from public.overtime_assignment_runs) or exists (select 1 from public.overtime_assignment_drafts)
     or exists (select 1 from public.overtime_work_records where source = 'auto') then
    raise exception 'rollback B 중단: 자동배정 데이터가 있다';
  end if;
end $$;

drop policy if exists "menu_update" on public.overtime_assignment_drafts;

drop function if exists public.overtime_save_assignment_run(jsonb, jsonb);
drop function if exists public.overtime_confirm_run(uuid, uuid[]);
drop function if exists public.overtime_unconfirm_drafts(uuid[]);
drop function if exists public.overtime_discard_run(uuid);

drop trigger if exists overtime_work_records_a_protect on public.overtime_work_records;
drop trigger if exists overtime_work_records_b_weekly_cap on public.overtime_work_records;
drop trigger if exists overtime_assignment_drafts_guard on public.overtime_assignment_drafts;
drop trigger if exists overtime_assignment_runs_guard on public.overtime_assignment_runs;

drop function if exists private.overtime_work_records_protect();
drop function if exists private.overtime_work_records_weekly_cap();
drop function if exists private.overtime_drafts_guard();
drop function if exists private.overtime_runs_guard();
drop function if exists private.overtime_refresh_run_status(uuid);
drop function if exists private.overtime_assert_weekly_cap(uuid, date, numeric, uuid, numeric);
drop function if exists private.overtime_week_total(uuid, date, uuid);
drop function if exists private.overtime_is_admin();
drop function if exists private.overtime_require_write();

-- B 동안 트리거가 신규 수동기록에 채운 source='manual'은 남는다(A의 CHECK가 허용하는 값, 의미 동일).

commit;

-- 프로젝트 동기화 RPC를 같이 적용했다면 따로:
--   drop function if exists public.overtime_apply_project_sync(jsonb, jsonb);
