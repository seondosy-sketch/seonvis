-- 연장근무 되돌리기 리허설 3단계 — 격리수준 방어 되돌리기
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
-- 이 단계: supabase/verify/overtime_cap_isolation_guard_rollback.sql의 begin;~commit; 본문을 그대로(글자 그대로 — 정적 시험이 확인) 아래 안전장치 뒤에 넣었다.
-- 다음: overtime_rollback_rehearsal_check.sql 실행(step 비워 두면 이 단계 'isolation'로 자동 판정) → 전부 OK면 다음 단계.

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

-- ↓ supabase/verify/overtime_cap_isolation_guard_rollback.sql 본문 시작
do $do$
begin
  -- 원본: migration_overtime_planning_b_activate.sql
  if to_regprocedure('private.overtime_assert_weekly_cap(uuid, date, numeric, uuid, numeric)') is not null then
    execute $fn$
create or replace function private.overtime_assert_weekly_cap(
  p_employee uuid, p_date date, p_new_hours numeric, p_exclude_id uuid, p_previous_same_week numeric
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_week date := private.overtime_week_start(p_date);
  v_others numeric;
  v_new numeric;
begin
  -- 같은 직원·주의 동시 변경 직렬화(둘 다 11h를 보고 통과하는 경쟁 방지)
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('overtime_week:' || p_employee::text || ':' || v_week::text, 0));
  v_others := private.overtime_week_total(p_employee, p_date, p_exclude_id);
  v_new := v_others + p_new_hours;
  if v_new > 12 and v_new > v_others + coalesce(p_previous_same_week, 0) then
    raise exception 'OVERTIME_WEEKLY_CAP: % 주 합계 %시간 (한도 12시간)', v_week, v_new using errcode = '23514';
  end if;
end $$
$fn$;
    revoke all on function private.overtime_assert_weekly_cap(uuid, date, numeric, uuid, numeric) from public, anon, authenticated, service_role;
  end if;

  -- 원본: migration_overtime_monthly_target_guard.sql
  if to_regprocedure('private.overtime_assert_monthly_target(uuid, date, numeric, uuid, numeric)') is not null then
    execute $fn$
create or replace function private.overtime_assert_monthly_target(
  p_employee uuid, p_date date, p_new_hours numeric, p_exclude_id uuid, p_previous_same_period numeric
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_label text := private.overtime_pay_period_label(p_date);
  v_start date;
  v_end date;
  v_others numeric;
  v_before numeric;
  v_after numeric;
  v_target numeric;
  v_found boolean;
begin
  select pp.period_start, pp.period_end into v_start, v_end from private.overtime_pay_period(v_label) pp;
  -- 같은 직원·급여기간의 동시 변경 직렬화 (둘 다 여유를 보고 통과하는 경쟁 방지)
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('overtime_month:' || p_employee::text || ':' || v_label, 0));

  select coalesce(sum(r.hours), 0) into v_others
  from public.overtime_work_records r
  where r.employee_id = p_employee and r.work_date between v_start and v_end
    and (p_exclude_id is null or r.id <> p_exclude_id);
  v_before := v_others + coalesce(p_previous_same_period, 0);
  v_after := v_others + p_new_hours;

  select t.target_hours, true into v_target, v_found
  from public.overtime_monthly_targets t
  where t.employee_id = p_employee and t.period_label = v_label;

  if v_after < v_before then
    return;  -- 합계가 줄어드는 수정은 목표 유무·초과 여부와 관계없이 허용
  end if;
  if not coalesce(v_found, false) or v_target is null then
    raise exception 'OVERTIME_MONTHLY_TARGET_MISSING: % 급여기간 목표 없음 (현재 %시간 → %시간)', v_label, v_before, v_after
      using errcode = '23514';
  end if;
  if v_after > v_target then
    raise exception 'OVERTIME_MONTHLY_TARGET_EXCEEDED: % 급여기간 목표 %시간 / 현재 %시간 → %시간 (%시간 초과)',
      v_label, v_target, v_before, v_after, v_after - v_target
      using errcode = '23514';
  end if;
end $$
$fn$;
    revoke all on function private.overtime_assert_monthly_target(uuid, date, numeric, uuid, numeric) from public, anon, authenticated, service_role;
  end if;
end $do$;
-- ↑ supabase/verify/overtime_cap_isolation_guard_rollback.sql 본문 끝

insert into private.overtime_rehearsal_snapshot (kind, name, fp) values ('step', 'isolation', pg_catalog.now()::text);

commit;

select 'isolation'::text as check_name, 'INFO'::text as status,
       '3단계 완료 — overtime_rollback_rehearsal_check.sql로 상태 확인'::text as detail;
