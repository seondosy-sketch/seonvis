-- 연장근무 월 목표 강제조건 — 운영용 통합 activation (한 트랜잭션)
--
-- ⚠ 운영 적용은 별도 승인. 이 파일은 아래 두 원본 migration의 본문을 순서대로 한 트랜잭션에 묶은 것이다:
--   1) supabase/migration_overtime_monthly_target_guard.sql   (월 목표 트리거·함수)
--   2) supabase/migration_overtime_cap_isolation_guard.sql    (주 12시간·월 목표 검사의 REPEATABLE READ 거부)
-- 원본을 따로 적용하면 1)과 2) 사이에 "월 목표 검사에 격리수준 방어가 없는" 순간이 생긴다
-- (DB 직접 접속 + REPEATABLE READ에서만 가능한 경쟁조건). 운영에서는 이 파일 하나로 둘을 동시에 켠다.
-- 생성: scratchpad build_activation.py — 원본 본문을 그대로 복사(수정 없음). 원본이 바뀌면 다시 생성한다.
--
-- 적용 전 필수: 해당 급여기간의 재직 직원 월 목표 입력 완료(supabase/prod/overtime_monthly_targets_1_list.sql → _2_apply.sql),
--              supabase/prod/overtime_prod_checklist.md의 "0. 적용 전 baseline"(기록 수 재확인)·3단계(월 목표 선입력) 항목.
-- 적용 후: supabase/verify/overtime_monthly_target_postflight.sql (isolation_guard 포함 전부 OK)
-- 되돌리기: supabase/verify/overtime_monthly_target_rollback.sql → supabase/verify/overtime_cap_isolation_guard_rollback.sql
--          (월 목표 트리거·함수 제거 후, 주 12시간 함수를 B 원본 본문으로 되돌림)

begin;

do $$
begin
  if to_regprocedure('private.overtime_pay_period(text)') is null
     or to_regclass('public.overtime_monthly_targets') is null
     or to_regprocedure('private.overtime_work_records_weekly_cap()') is null
     or to_regprocedure('private.overtime_assert_weekly_cap(uuid, date, numeric, uuid, numeric)') is null then
    raise exception 'Migration A·B가 적용되지 않았다';
  end if;
end $$;

-- ════════════════ 1) migration_overtime_monthly_target_guard.sql 본문 ════════════════
-- 근무일 → 급여기간 라벨 'YYYY-MM' (21일부터는 다음 달 라벨). lib/overtime/monthlyCap.ts payPeriodOf와 같은 규칙.
create or replace function private.overtime_pay_period_label(p_date date)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select pg_catalog.to_char(
    case when extract(day from p_date) >= 21 then (pg_catalog.date_trunc('month', p_date::timestamp) + interval '1 month')
         else pg_catalog.date_trunc('month', p_date::timestamp) end,
    'YYYY-MM')
$$;

-- 월 목표 검사 — 트리거가 이 함수 하나만 쓴다 (DEFINER: RLS와 무관하게 합산·목표 조회)
--   p_exclude_id: 수정 중인 행(합계에서 뺀다), p_previous_same_period: 같은 직원·같은 기간 안의 수정이면 변경 전 시간
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
end $$;

create or replace function private.overtime_work_records_monthly_target()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prev numeric := 0;
begin
  if tg_op = 'UPDATE' then
    -- 직원·날짜·시간 그대로(업무명·비고·시각만 수정)면 검사하지 않는다
    if new.employee_id = old.employee_id and new.work_date = old.work_date and new.hours = old.hours then
      return new;
    end if;
    -- 같은 직원·같은 급여기간 안의 수정이면 변경 전 시간이 "기존 합계"에 있었다. 다른 기간으로 옮기거나
    -- 직원을 바꾸면 도착 기간에는 원래 없던 행이므로 0.
    if old.employee_id = new.employee_id
       and private.overtime_pay_period_label(old.work_date) = private.overtime_pay_period_label(new.work_date) then
      v_prev := old.hours;
    end if;
  end if;
  perform private.overtime_assert_monthly_target(new.employee_id, new.work_date, new.hours, new.id, v_prev);
  return new;
end $$;

drop trigger if exists overtime_work_records_ab_monthly_target on public.overtime_work_records;
create trigger overtime_work_records_ab_monthly_target
  before insert or update on public.overtime_work_records
  for each row execute function private.overtime_work_records_monthly_target();

-- 클라이언트가 부를 이유가 없다 — 모든 역할에서 회수(트리거 발동에는 EXECUTE 검사가 없다)
revoke all on function private.overtime_pay_period_label(date) from public, anon, authenticated, service_role;
revoke all on function private.overtime_assert_monthly_target(uuid, date, numeric, uuid, numeric) from public, anon, authenticated, service_role;
revoke all on function private.overtime_work_records_monthly_target() from public, anon, authenticated, service_role;

-- ════════════════ 2) migration_overtime_cap_isolation_guard.sql 본문 ════════════════
-- 주 12시간 — migration_overtime_planning_b_activate.sql과 같은 본문 + 격리수준 확인
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
  -- lock 뒤 재조회가 최신 기록을 보려면 READ COMMITTED여야 한다(REPEATABLE READ면 경쟁조건)
  if pg_catalog.current_setting('transaction_isolation') = 'repeatable read' then
    raise exception 'OVERTIME_ISOLATION_UNSUPPORTED: 연장근무 기록은 REPEATABLE READ 트랜잭션에서 쓸 수 없다' using errcode = '25001';
  end if;
  -- 같은 직원·주의 동시 변경 직렬화(둘 다 11h를 보고 통과하는 경쟁 방지)
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('overtime_week:' || p_employee::text || ':' || v_week::text, 0));
  v_others := private.overtime_week_total(p_employee, p_date, p_exclude_id);
  v_new := v_others + p_new_hours;
  if v_new > 12 and v_new > v_others + coalesce(p_previous_same_week, 0) then
    raise exception 'OVERTIME_WEEKLY_CAP: % 주 합계 %시간 (한도 12시간)', v_week, v_new using errcode = '23514';
  end if;
end $$;

-- 월 목표 — migration_overtime_monthly_target_guard.sql과 같은 본문 + 격리수준 확인
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
  if pg_catalog.current_setting('transaction_isolation') = 'repeatable read' then
    raise exception 'OVERTIME_ISOLATION_UNSUPPORTED: 연장근무 기록은 REPEATABLE READ 트랜잭션에서 쓸 수 없다' using errcode = '25001';
  end if;
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
end $$;

-- create or replace는 권한을 유지하지만, 확실히 하기 위해 다시 회수
revoke all on function private.overtime_assert_weekly_cap(uuid, date, numeric, uuid, numeric) from public, anon, authenticated, service_role;
revoke all on function private.overtime_assert_monthly_target(uuid, date, numeric, uuid, numeric) from public, anon, authenticated, service_role;

commit;

-- 확인 (읽기만)
select p.proname::text as function_name,
       (pg_catalog.pg_get_functiondef(p.oid) like '%OVERTIME_ISOLATION_UNSUPPORTED%')::text as has_isolation_guard
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'private' and p.proname in ('overtime_assert_weekly_cap', 'overtime_assert_monthly_target')
union all
select 'trigger:' || t.tgname::text, t.tgenabled::text
from pg_catalog.pg_trigger t
where t.tgrelid = 'public.overtime_work_records'::regclass and not t.tgisinternal
order by 1;
