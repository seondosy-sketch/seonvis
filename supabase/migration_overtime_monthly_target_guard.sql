-- 연장근무(제안서팀) — 월 목표시간 = 급여기간 직원별 총 연장근무 한도 (DB 강제조건)
--
-- ⚠ 개발용 Supabase(zaot…iyas)에서만 먼저 실행한다. 운영 적용은 별도 승인.
-- 의존: Migration A·B(migration_overtime_planning_a_base.sql / _b_activate.sql)가 적용돼 있어야 한다.
--
-- 규칙 (화면 사전검증 lib/overtime/monthlyCap.ts와 같다)
--   급여기간 = 전월 21일 ~ 당월 20일, 라벨 'YYYY-MM'(당월). 합산 = 그 기간의 모든 기록(수동·자동확정, 모든 프로젝트).
--   INSERT·UPDATE에서 "변경 후 합계(after)"와 "변경 전 합계(before)"를 근무일이 속한 급여기간(도착 기간) 기준으로 계산한다.
--     목표 행 없음      → after < before(줄어듦)일 때만 허용, 아니면 OVERTIME_MONTHLY_TARGET_MISSING
--     after ≤ 목표       → 허용 (목표와 같아도 허용, 목표 0이면 양수 입력은 모두 차단)
--     after > 목표       → after < before(초과 상태에서 줄이는 수정)일 때만 허용, 아니면 OVERTIME_MONTHLY_TARGET_EXCEEDED
--   UPDATE에서 직원·근무일·시간이 그대로면(업무명·비고·시각만 수정) 검사하지 않는다(주 12시간 트리거와 같은 방식).
--   날짜를 다른 급여기간으로 옮기면 도착 기간만 검사한다(출발 기간은 합계가 줄기만 함).
--   DELETE는 검사하지 않는다(합계가 줄기만 함). 자동확정 기록 삭제 금지는 기존 a_protect 트리거가 그대로 막는다.
--   목표를 기존 합계보다 낮춰도 기존 기록은 바꾸지 않는다 — 그 직원은 이후 증가만 막힌다.
--
-- 누가 실행하든 적용된다: authenticated(화면·REST 직접 호출), service_role, SECURITY DEFINER RPC(확정 등) 모두.
--   소유자 맥락 예외를 두지 않는다(주 12시간 트리거와 같음). 확정 RPC는 자체 월 목표 검사도 그대로 한다.
-- 트리거 순서(이름 알파벳순): a_protect(자동기록 잠금) → ab_monthly_target(월 목표) → b_weekly_cap(주 12시간).
--
-- 기존 데이터: 바꾸지 않는다(백필·수정 없음). 트리거는 이후의 INSERT·UPDATE에만 동작한다.
-- 되돌리기: supabase/verify/overtime_monthly_target_rollback.sql

begin;

do $$
begin
  if to_regprocedure('private.overtime_pay_period(text)') is null
     or to_regclass('public.overtime_monthly_targets') is null
     or to_regprocedure('private.overtime_work_records_weekly_cap()') is null then
    raise exception 'Migration A·B가 적용되지 않았다';
  end if;
end $$;

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

commit;

-- 확인 (읽기만): 트리거 순서와 함수 권한
select t.tgname::text as trigger_name, t.tgenabled::text as enabled
from pg_catalog.pg_trigger t
where t.tgrelid = 'public.overtime_work_records'::regclass and not t.tgisinternal
order by t.tgname;
