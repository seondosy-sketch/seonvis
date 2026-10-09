-- 연장근무 되돌리기 리허설 6단계 — Migration B 되돌리기
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
-- 이 단계: supabase/verify/overtime_planning_rollback_b.sql의 begin;~commit; 본문을 그대로(글자 그대로 — 정적 시험이 확인) 아래 안전장치 뒤에 넣었다.
-- 전제: 5단계(_5_purge)로 자동배정 데이터를 지웠어야 한다(B 되돌리기가 스스로 확인하고 멈춘다).
-- 다음: overtime_rollback_rehearsal_check.sql 실행(step 비워 두면 이 단계 'b'로 자동 판정) → 전부 OK면 다음 단계.

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

-- ↓ supabase/verify/overtime_planning_rollback_b.sql 본문 시작
do $$
begin
  if exists (select 1 from public.overtime_assignment_runs) or exists (select 1 from public.overtime_assignment_drafts)
     or exists (select 1 from public.overtime_work_records where source = 'auto') then
    raise exception 'rollback B 중단: 자동배정 데이터가 있다';
  end if;
  if exists (select 1 from pg_catalog.pg_trigger where tgname = 'overtime_work_records_ab_monthly_target')
     or to_regprocedure('private.overtime_assert_monthly_target(uuid,date,numeric,uuid,numeric)') is not null then
    raise exception 'rollback B 중단: 월 목표 강제조건이 남아 있다 — overtime_cap_isolation_guard_rollback.sql → overtime_monthly_target_rollback.sql 먼저';
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
-- ↑ supabase/verify/overtime_planning_rollback_b.sql 본문 끝

insert into private.overtime_rehearsal_snapshot (kind, name, fp) values ('step', 'b', pg_catalog.now()::text);

commit;

select 'b'::text as check_name, 'INFO'::text as status,
       '6단계 완료 — overtime_rollback_rehearsal_check.sql로 상태 확인'::text as detail;
