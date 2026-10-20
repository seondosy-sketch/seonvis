-- 연장근무 월 목표·주 12시간 강제조건 — 격리수준 방어 (경쟁조건 보정)
--
-- ⚠ 개발용 Supabase(zaot…iyas)에서 먼저 실행한다. 운영 적용은 별도 승인.
-- 의존: migration_overtime_planning_b_activate.sql, migration_overtime_monthly_target_guard.sql
--
-- 왜 필요한가
--   두 검사 함수는 "직원×급여기간"(월 목표)·"직원×주"(주 12시간) advisory lock을 잡은 뒤 합계를 다시 읽는다.
--   READ COMMITTED(Supabase·PostgREST·RPC의 기본)에서는 lock을 기다린 뒤의 SELECT가 새 스냅샷으로
--   먼저 끝난 트랜잭션의 기록을 보므로 동시 입력 두 건이 둘 다 통과하는 일이 없다.
--   그러나 REPEATABLE READ에서는 트랜잭션 첫 문장의 스냅샷을 끝까지 쓰므로, lock을 기다렸다가도
--   상대가 넣은 기록을 보지 못한다 → 남은 2시간에 2시간짜리 두 건이 모두 통과할 수 있다.
--   (SERIALIZABLE은 PostgreSQL이 충돌을 감지해 한쪽을 직렬화 실패로 되돌린다.)
--   API(PostgREST·RPC)로는 격리수준을 바꿀 수 없어 지금 화면·REST 경로에서는 생기지 않지만,
--   DB에 직접 접속하는 도구가 REPEATABLE READ로 쓰면 가능하다 → 그 경우는 쓰기 자체를 거부한다.
--
-- 바꾸는 것: 두 검사 함수에 격리수준 확인 한 줄씩. 나머지 본문·권한·트리거는 그대로(같은 이름으로 교체).
-- 데이터는 바꾸지 않는다.

begin;

do $$
begin
  if to_regprocedure('private.overtime_assert_weekly_cap(uuid, date, numeric, uuid, numeric)') is null
     or to_regprocedure('private.overtime_assert_monthly_target(uuid, date, numeric, uuid, numeric)') is null then
    raise exception 'Migration B와 월 목표 migration이 적용되지 않았다';
  end if;
end $$;

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

select p.proname::text as function_name,
       (pg_catalog.pg_get_functiondef(p.oid) like '%OVERTIME_ISOLATION_UNSUPPORTED%')::text as has_isolation_guard
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'private' and p.proname in ('overtime_assert_weekly_cap', 'overtime_assert_monthly_target')
order by 1;
