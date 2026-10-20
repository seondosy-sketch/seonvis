-- 격리수준 방어(migration_overtime_cap_isolation_guard.sql) 되돌리기 — 두 검사 함수를 원래 본문으로 교체한다. 데이터는 건드리지 않는다.
--
-- 되돌리기 순서: overtime_planning_c_rollback → overtime_cap_isolation_guard_rollback → overtime_monthly_target_rollback → overtime_planning_rollback_b → overtime_project_sync_rpc_rollback → overtime_planning_rollback_a
--   이 파일은 월 목표 되돌리기(overtime_monthly_target_rollback.sql)보다 먼저 실행한다.
-- 방어: 각 함수는 "지금 DB에 있을 때만" 원래 본문으로 바꾼다(to_regprocedure 확인 후 EXECUTE).
--   순서를 바꿔 월 목표 되돌리기 뒤에 실행해도 private.overtime_assert_monthly_target을 되살리지 않고,
--   B 되돌리기 뒤에 실행해도 private.overtime_assert_weekly_cap을 되살리지 않는다
--   (되살아나면 overtime_planning_rollback_a.sql의 월 목표 잔존 검사에서 A 되돌리기가 멈춘다).
begin;

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

commit;

select 'isolation_rollback_' || x.name as check_name,
       case when not x.present then 'INFO' when x.has_guard then 'FAIL' else 'OK' end as status,
       case when not x.present then '함수 없음 (되살리지 않음)' when x.has_guard then '격리수준 방어가 남아 있다' else '원래 본문' end as detail
from (
  select 'weekly_cap' as name,
         to_regprocedure('private.overtime_assert_weekly_cap(uuid,date,numeric,uuid,numeric)') is not null as present,
         coalesce(pg_catalog.pg_get_functiondef(to_regprocedure('private.overtime_assert_weekly_cap(uuid,date,numeric,uuid,numeric)'))
                  like '%OVERTIME_ISOLATION_UNSUPPORTED%', false) as has_guard
  union all
  select 'monthly_target',
         to_regprocedure('private.overtime_assert_monthly_target(uuid,date,numeric,uuid,numeric)') is not null,
         coalesce(pg_catalog.pg_get_functiondef(to_regprocedure('private.overtime_assert_monthly_target(uuid,date,numeric,uuid,numeric)'))
                  like '%OVERTIME_ISOLATION_UNSUPPORTED%', false)
) x
order by 1;
