-- 연장근무 되돌리기 리허설 9단계 — 정방향 재적용 순서 (읽기 전용 목록. 이 파일은 아무것도 바꾸지 않는다)
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
-- 아래 목록의 원본 migration 파일을 표의 순서대로 하나씩 SQL Editor에서 그대로 실행한다(파일마다 별도 실행).
-- 각 파일 뒤 overtime_rollback_rehearsal_check.sql의 step을 표의 "확인 step" 값으로 적고 실행해 전부 OK인지 본다.
--   1 supabase/migration_overtime_planning_a_base.sql       (확인 step fwd_a)
--     A 재실행 안전성: create … if not exists / create or replace / drop … if exists만 쓰고 기존 행 UPDATE·DELETE가 없다.
--     0단계 안전장치가 직원 연결 상태(미연결 재직 직원 + 미연결 미래사업팀 주소록)를 확인한다 — 1단계에서 이미 확인했다.
--   2 supabase/migration_overtime_project_sync_rpc.sql      (확인 step fwd_sync_rpc)
--   3 supabase/migration_overtime_planning_b_activate.sql   (확인 step fwd_b) — B 파일이 이미 C 수정본을 포함한다
--   4 supabase/migration_overtime_monthly_target_guard.sql  (확인 step fwd_monthly)
--   5 supabase/migration_overtime_cap_isolation_guard.sql   (확인 step fwd_isolation)
--   6 supabase/migration_overtime_planning_c_corrections.sql (확인 step fwd_c) — 내용상 no-op(같은 본문)
--   그 다음 overtime_rollback_rehearsal_10_compare.sql.
-- 주의: 5단계에서 월 목표를 지웠으므로 4번(월 목표 강제조건) 뒤에는 개발 화면의 수동 입력이 OVERTIME_MONTHLY_TARGET_MISSING으로
--   막힌다. 리허설이 끝난 뒤 overtime_ui_seed.sql을 다시 실행하면 시험 직원 목표가 다시 들어간다.
-- 결과: check_name / status / detail — 지금 DB에서 각 단위가 적용돼 있는지(INFO).

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

commit;

with units(seq, file, present) as (
  values
    (1, 'supabase/migration_overtime_planning_a_base.sql', to_regclass('public.overtime_assignment_drafts') is not null),
    (2, 'supabase/migration_overtime_project_sync_rpc.sql', to_regprocedure('public.overtime_apply_project_sync(jsonb,jsonb)') is not null),
    (3, 'supabase/migration_overtime_planning_b_activate.sql', to_regprocedure('public.overtime_confirm_run(uuid,uuid[])') is not null),
    (4, 'supabase/migration_overtime_monthly_target_guard.sql', exists (select 1 from pg_catalog.pg_trigger where tgname = 'overtime_work_records_ab_monthly_target')),
    (5, 'supabase/migration_overtime_cap_isolation_guard.sql',
        coalesce(pg_catalog.pg_get_functiondef(to_regprocedure('private.overtime_assert_monthly_target(uuid,date,numeric,uuid,numeric)')) like '%OVERTIME_ISOLATION_UNSUPPORTED%', false)),
    (6, 'supabase/migration_overtime_planning_c_corrections.sql',
        coalesce(pg_catalog.pg_get_functiondef(to_regprocedure('public.overtime_confirm_run(uuid,uuid[])')) like '%확정 시 공휴일 변경 반영%', false)
        and coalesce(pg_catalog.pg_get_functiondef(to_regprocedure('public.sync_team_employees()')) like '%OVERTIME_EMPLOYEE_LINK_REQUIRED%', false))
)
select 'f' || seq || '_reapply' as check_name, 'INFO' as status,
       file || ' — 지금 ' || case when present then '적용됨' else '미적용' end as detail
from units
order by seq;
