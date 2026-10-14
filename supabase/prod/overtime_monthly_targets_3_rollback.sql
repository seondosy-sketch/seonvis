-- 월 목표 선입력 되돌리기 — 2단계로 넣은 한 급여기간의 목표를 지운다 (운영 SQL Editor)
--
-- ⚠ 월 목표 강제조건(overtime_monthly_target_activation.sql) 적용 전에만 쓴다. 적용 후 목표를 지우면
--   그 기간 수동 연장근무 입력이 전부 막힌다(목표 없음) → 강제조건이 있으면 이 스크립트는 중단한다.
-- 지우는 대상: 지정한 급여기간의, 아래 목록의 employee_id 행만(이름으로 고르지 않는다). 한 트랜잭션.

begin;

create temp table ot_target_rollback (employee_id uuid) on commit drop;
-- 2단계 입력표와 같은 employee_id 목록을 적는다
insert into ot_target_rollback (employee_id) values
  ('00000000-0000-0000-0000-000000000000');

do $$
declare
  v_label text := '2026-10';   -- 되돌릴 급여기간
  v_deleted int;
begin
  if exists (select 1 from pg_catalog.pg_trigger where tgname = 'overtime_work_records_ab_monthly_target') then
    raise exception '중단: 월 목표 강제조건이 이미 켜져 있다 — 목표를 지우면 입력이 막힌다. 강제조건을 먼저 되돌린다';
  end if;
  if exists (select 1 from ot_target_rollback where employee_id = '00000000-0000-0000-0000-000000000000') then
    raise exception '중단: 자리표시 ID(000…)가 남아 있다';
  end if;
  delete from public.overtime_monthly_targets t
  using ot_target_rollback r
  where t.employee_id = r.employee_id and t.period_label = v_label;
  get diagnostics v_deleted = row_count;
  raise notice '삭제 %행 (급여기간 %)', v_deleted, v_label;
end $$;

select t.period_label, count(*) as remaining_targets
from public.overtime_monthly_targets t
group by t.period_label order by 1;

commit;
