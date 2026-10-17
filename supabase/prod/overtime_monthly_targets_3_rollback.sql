-- 월 목표 선입력 되돌리기 — 2단계로 넣은 급여기간의 목표를 지운다 (운영 SQL Editor, 한 번에 전체 실행)
--
-- ⚠ 월 목표 강제조건(overtime_monthly_target_activation.sql) 적용 전에만 쓴다. 적용 후 목표를 지우면
--   그 기간 수동 연장근무 입력이 전부 막힌다(목표 없음) → 강제조건이 있으면 이 스크립트는 중단한다.
-- 구조: 맨 바깥에는 begin · DO 블록 하나 · 결과 SELECT · commit만 있다(맨 바깥 insert/update/delete 없음 —
--   운영 SQL Editor가 맨 바깥 임시표 쓰기를 실행 전에 relation does not exist(42P01)로 막았다). 입력값은 DO 블록 안 배열 변수.
-- 사용법 (값은 SQL Editor 안에서만 고친다. 이 파일에 실제 UUID를 저장하지 않는다)
--   1) v_labels·v_ids를 2단계 적용 때와 같게 적는다(이름으로 고르지 않는다).
--   2) v_apply = false(기본)로 실행 → 알림의 "지울 행" 수와 마지막 표를 확인. 아무것도 지우지 않는다.
--   3) (별도 승인 후) v_apply = true로 바꿔 한 번 실행 → 마지막 표 r01이 기간마다 0행인지 확인(2단계 대상 전원을 지웠을 때).
-- 지우는 대상: 지정한 급여기간의, v_ids에 있는 employee_id 행만. 한 트랜잭션 — 검사 실패면 아무것도 지우지 않는다.
-- 출력: 이름·UUID를 내지 않는다(건수만).

begin;

do $$
declare
  -- ── [설정] ──────────────────────────────────────────────────────────────
  v_labels text[]  := array['2026-10', '2026-11'];   -- 되돌릴 급여기간
  v_apply  boolean := false;                         -- false = 검사만, true = 삭제
  -- ── [입력표] 2단계 v_ids와 같은 목록 ─────────────────────────────────────
  v_ids uuid[] := array[
    '00000000-0000-0000-0000-000000000000'
  ]::uuid[];
  -- ───────────────────────────────────────────────────────────────────────
  -- 실패 사유는 pg_catalog.array_append로 모은다(text[] || '문자열'은 오른쪽이 배열 리터럴로 해석된다)
  v_fail text[] := array[]::text[];
  v_target int;
  v_deleted int;
begin
  if to_regclass('public.overtime_monthly_targets') is null then
    raise exception '중단: Migration A가 적용되지 않았다(overtime_monthly_targets 없음)';
  end if;
  if exists (select 1 from pg_catalog.pg_trigger where tgname = 'overtime_work_records_ab_monthly_target') then
    raise exception '중단: 월 목표 강제조건이 이미 켜져 있다 — 목표를 지우면 입력이 막힌다. 강제조건을 먼저 되돌린다';
  end if;
  -- 결과 SELECT가 같은 급여기간을 보도록 이 트랜잭션 안에서만 넘긴다(표에 쓰지 않는다)
  perform pg_catalog.set_config('ot_target.labels', array_to_string(coalesce(v_labels, array[]::text[]), ','), true);

  if coalesce(array_length(v_labels, 1), 0) = 0 then v_fail := pg_catalog.array_append(v_fail, 'r01 급여기간 없음'::text); end if;
  if exists (select 1 from unnest(v_labels) l where l is null or l !~ '^[0-9]{4}-(0[1-9]|1[0-2])$') then v_fail := pg_catalog.array_append(v_fail, 'r01 급여기간 형식'::text); end if;
  if coalesce(array_length(v_ids, 1), 0) = 0 then v_fail := pg_catalog.array_append(v_fail, 'r02 ID 없음'::text); end if;
  if exists (select 1 from unnest(v_ids) i where i is null) then v_fail := pg_catalog.array_append(v_fail, 'r02 빈칸'::text); end if;
  if exists (select 1 from unnest(v_ids) i where i = '00000000-0000-0000-0000-000000000000') then v_fail := pg_catalog.array_append(v_fail, 'r03 자리표시 ID 남음'::text); end if;
  if exists (select 1 from unnest(v_ids) i group by i having count(*) > 1) then v_fail := pg_catalog.array_append(v_fail, 'r04 중복 ID'::text); end if;

  if array_length(v_fail, 1) > 0 then
    raise exception '중단(아무것도 바꾸지 않음): %', array_to_string(v_fail, ' / ');
  end if;

  select count(*) into v_target from public.overtime_monthly_targets t
  where t.employee_id = any (v_ids) and t.period_label = any (v_labels);

  if not v_apply then
    raise notice '검사 전부 통과 — 지울 행 %행. v_apply = false라 아무것도 지우지 않았다', v_target;
    return;
  end if;

  delete from public.overtime_monthly_targets t
  where t.employee_id = any (v_ids) and t.period_label = any (v_labels);
  get diagnostics v_deleted = row_count;
  if v_deleted <> v_target then
    raise exception '중단(전체 되돌림): 삭제 % ≠ 확인한 행 %', v_deleted, v_target;
  end if;
  raise notice '삭제 %행 (급여기간 %)', v_deleted, array_to_string(v_labels, ', ');
end $$;

-- 결과 (이름·UUID 없음). r01: 지정 급여기간에 남은 목표 행 — 삭제 후 정상이면 0, r02: 기간별 전체 목표 행
with labels as (
  select l as label
  from unnest(pg_catalog.string_to_array(pg_catalog.current_setting('ot_target.labels', true), ',')) as l
)
select 'r01 ' || l.label || ' 남은 목표 행' as check_name, 'INFO' as verdict,
       (select count(*) from public.overtime_monthly_targets t where t.period_label = l.label)::text || '행' as detail
from labels l
union all
select 'r02 전체 목표 행(모든 기간)', 'INFO', count(*)::text || '행' from public.overtime_monthly_targets
union all
select 'r03 월 목표 강제조건 트리거', 'INFO',
       case when exists (select 1 from pg_catalog.pg_trigger where tgname = 'overtime_work_records_ab_monthly_target')
            then '있음(activation 적용됨)' else '없음(activation 전)' end
order by 1;

commit;
