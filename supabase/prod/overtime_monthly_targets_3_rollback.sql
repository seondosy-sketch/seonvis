-- 월 목표 선입력 되돌리기 — 2단계로 넣은 "지정 ID × 급여기간" 목표 행을 정확히 지운다 (운영 SQL Editor, 한 번에 전체 실행)
--
-- ⚠ 월 목표 강제조건(overtime_monthly_target_activation.sql) 적용 전에만 쓴다. 적용 후 목표를 지우면
--   그 기간 수동 연장근무 입력이 전부 막힌다(목표 없음) → 강제조건이 있으면 이 스크립트는 중단한다.
-- 구조: 맨 바깥에는 begin · DO 블록 하나 · 결과 SELECT · commit만 있다(맨 바깥 insert/update/delete 없음 —
--   운영 SQL Editor가 맨 바깥 임시표 쓰기를 실행 전에 relation does not exist(42P01)로 막았다). 입력값은 DO 블록 안 배열 변수.
-- 사용법 (값은 SQL Editor 안에서만 고친다. 이 파일에 실제 UUID를 저장하지 않는다)
--   1) v_labels·v_expected·v_ids를 2단계 적용 때와 같게 적는다(이름으로 고르지 않는다). v_ids는 v_expected개.
--   2) v_apply = false(기본)로 실행 → r00 OK, r10 OK(지울 행 = v_expected × 급여기간 수), r11 OK(0행 삭제) 확인. 아무것도 지우지 않는다.
--   3) (별도 승인 후) v_apply = true로 바꿔 한 번 실행 → r00·r10·r11 OK, r20(이번 rollback 대상 ID의 남은 행)이 기간마다 0행 OK.
--   ⚠ 언제나 파일 전체를 한 번에 실행한다. 결과 SELECT만 골라 실행하면 r00·r10·r11이 FAIL로 알리고 r20·r30은 나오지 않는다.
-- 검사(하나라도 실패하면 raise → 아무것도 지우지 않음): r01 급여기간 없음·형식·중복 / r02 ID 수 ≠ v_expected·빈칸 /
--   r03 자리표시 ID / r04 중복 ID / r05 overtime_employees에 없는 ID /
--   r06 지정 ID × 급여기간 목표 행이 정확히 v_expected × 급여기간 수(기본 8 × 2 = 16)가 아님 — 한 행이라도 없거나 많으면 중단.
-- 삭제 뒤 확인(다르면 raise → 전체 되돌림): r07 실제 삭제 행 = 기대 행 / r08 지정 범위 남은 행 0 / r09 범위 밖 행 수 그대로.
-- 대상 판단: 지금의 "재직 미래사업팀" 여부는 묻지 않는다 — rollback은 2단계가 넣은 그 ID·급여기간 행을 지우는 일이고,
--   그 사이 직원이 비활성·주소록 변경돼도 되돌릴 수 있어야 한다. 대신 ID가 overtime_employees에 있고(r05)
--   지정 ID × 급여기간 행이 빠짐없이 정확히 있어야(r06) 지운다. 다른 직원·다른 급여기간 행은 검사·삭제 대상이 아니다.
-- 출력: 이름·UUID를 내지 않는다(건수만).

begin;

do $$
declare
  -- ── [설정] ──────────────────────────────────────────────────────────────
  v_labels   text[]  := array['2026-10', '2026-11'];   -- 되돌릴 급여기간
  v_expected int     := 8;                             -- 2단계 v_expected와 같은 인원(= v_ids 개수)
  v_apply    boolean := false;                         -- false = 검사만, true = 삭제
  -- ── [입력표] 2단계 v_ids와 같은 목록, v_expected개 ──────────────────────
  v_ids uuid[] := array[
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000000000'
  ]::uuid[];
  -- ───────────────────────────────────────────────────────────────────────
  -- 실패 사유는 pg_catalog.array_append로 모은다(text[] || '문자열'은 오른쪽이 배열 리터럴로 해석된다)
  v_fail text[] := array[]::text[];
  v_want int;              -- 지울 행 = v_expected × 급여기간 수
  v_found int;             -- 지정 ID × 급여기간 중 실제 있는 행
  v_outside int;           -- 지정 범위 밖 행(삭제 전)
  v_deleted int := 0;
  v_left int;
  v_outside_after int;
begin
  if to_regclass('public.overtime_monthly_targets') is null then
    raise exception '중단: Migration A가 적용되지 않았다(overtime_monthly_targets 없음)';
  end if;
  if exists (select 1 from pg_catalog.pg_trigger where tgname = 'overtime_work_records_ab_monthly_target') then
    raise exception '중단: 월 목표 강제조건이 이미 켜져 있다 — 목표를 지우면 입력이 막힌다. 강제조건을 먼저 되돌린다';
  end if;

  if coalesce(array_length(v_labels, 1), 0) = 0 then v_fail := pg_catalog.array_append(v_fail, 'r01 급여기간 없음'::text); end if;
  if exists (select 1 from unnest(v_labels) l where l is null or l !~ '^[0-9]{4}-(0[1-9]|1[0-2])$') then v_fail := pg_catalog.array_append(v_fail, 'r01 급여기간 형식'::text); end if;
  if exists (select 1 from unnest(v_labels) l group by l having count(*) > 1) then v_fail := pg_catalog.array_append(v_fail, 'r01 급여기간 중복'::text); end if;
  if v_expected is null or v_expected < 1 or coalesce(array_length(v_ids, 1), 0) <> v_expected then
    v_fail := pg_catalog.array_append(v_fail, ('r02 ID 수 ' || coalesce(array_length(v_ids, 1), 0) || ' ≠ ' || coalesce(v_expected::text, '없음'))::text);
  end if;
  if exists (select 1 from unnest(v_ids) i where i is null) then v_fail := pg_catalog.array_append(v_fail, 'r02 빈칸'::text); end if;
  if exists (select 1 from unnest(v_ids) i where i = '00000000-0000-0000-0000-000000000000') then v_fail := pg_catalog.array_append(v_fail, 'r03 자리표시 ID 남음'::text); end if;
  if exists (select 1 from unnest(v_ids) i group by i having count(*) > 1) then v_fail := pg_catalog.array_append(v_fail, 'r04 중복 ID'::text); end if;
  if exists (select 1 from unnest(v_ids) i where i is not null and i <> '00000000-0000-0000-0000-000000000000'
             and not exists (select 1 from public.overtime_employees e where e.id = i)) then
    v_fail := pg_catalog.array_append(v_fail, 'r05 overtime_employees에 없는 ID'::text);
  end if;

  if array_length(v_fail, 1) > 0 then
    raise exception '중단(아무것도 지우지 않음): %', array_to_string(v_fail, ' / ');
  end if;

  -- 지정 범위 = v_ids × v_labels. 짝마다 한 행(employee_id·period_label unique)이 빠짐없이 있어야 한다.
  v_want := v_expected * array_length(v_labels, 1);
  select count(*) into v_found
  from unnest(v_ids) as i(id)
  cross join unnest(v_labels) as l(label)
  join public.overtime_monthly_targets t on t.employee_id = i.id and t.period_label = l.label;
  select count(*) into v_outside from public.overtime_monthly_targets t
  where not (t.employee_id = any (v_ids) and t.period_label = any (v_labels));
  if v_found <> v_want then
    raise exception '중단(아무것도 지우지 않음): r06 지정 범위(ID × 급여기간) 목표 행 % ≠ 기대 %', v_found, v_want;
  end if;

  if v_apply then
    delete from public.overtime_monthly_targets t
    where t.employee_id = any (v_ids) and t.period_label = any (v_labels);
    get diagnostics v_deleted = row_count;
    if v_deleted <> v_want then
      raise exception '중단(전체 되돌림): r07 실제 삭제 행 % ≠ 기대 %', v_deleted, v_want;
    end if;
    select count(*) into v_left from public.overtime_monthly_targets t
    where t.employee_id = any (v_ids) and t.period_label = any (v_labels);
    if v_left <> 0 then
      raise exception '중단(전체 되돌림): r08 삭제 후 지정 범위에 남은 행 %', v_left;
    end if;
    select count(*) into v_outside_after from public.overtime_monthly_targets t
    where not (t.employee_id = any (v_ids) and t.period_label = any (v_labels));
    if v_outside_after <> v_outside then
      raise exception '중단(전체 되돌림): r09 지정 범위 밖 행 % → %', v_outside, v_outside_after;
    end if;
    raise notice '삭제 %행 (급여기간 %)', v_deleted, array_to_string(v_labels, ', ');
  else
    raise notice '검사 전부 통과 — 지울 행 %행. v_apply = false라 아무것도 지우지 않았다', v_found;
  end if;

  -- 결과 SELECT로 넘기는 값 — 모든 검사(와 삭제 확인)를 통과한 뒤에만, 이 트랜잭션 안에서만(set_config 세 번째 인자 true).
  --   xact는 이 트랜잭션 번호다. 결과 SELECT만 따로 실행하면 값이 없거나 번호가 달라 r00이 FAIL이 된다. ids는 출력하지 않는다.
  perform pg_catalog.set_config('ot_rollback.labels', array_to_string(v_labels, ','), true);
  perform pg_catalog.set_config('ot_rollback.ids', array_to_string(v_ids, ','), true);
  perform pg_catalog.set_config('ot_rollback.want', v_want::text, true);
  perform pg_catalog.set_config('ot_rollback.found', v_found::text, true);
  perform pg_catalog.set_config('ot_rollback.deleted', v_deleted::text, true);
  perform pg_catalog.set_config('ot_rollback.state', case when v_apply then 'deleted' else 'checked' end, true);
  perform pg_catalog.set_config('ot_rollback.xact', pg_catalog.pg_current_xact_id()::text, true);
end $$;

-- 결과 (이름·UUID 없음)
--   r00: 이 트랜잭션에서 DO 블록이 끝까지 실행됐는가 — 결과 SELECT만 단독 실행하면 FAIL
--   r10: 삭제 전 지정 범위(ID × 급여기간) 행 = 기대 / r11: 실제 삭제 행(검사만이면 0)
--   r20: 이번 rollback 대상 ID의 남은 목표 행 — 삭제 후 0, 검사만이면 ID 수 그대로
--   r30·r31: 전체 직원 기준 목표 행(참고, INFO) — 다른 직원·다른 기간 행이 섞여 있으니 r20과 혼동하지 않는다
with gate as (
  select pg_catalog.current_setting('ot_rollback.state', true) as state,
         pg_catalog.current_setting('ot_rollback.labels', true) as labels,
         pg_catalog.current_setting('ot_rollback.ids', true) as ids,
         pg_catalog.current_setting('ot_rollback.want', true) as want,
         pg_catalog.current_setting('ot_rollback.found', true) as found,
         pg_catalog.current_setting('ot_rollback.deleted', true) as deleted,
         coalesce(pg_catalog.current_setting('ot_rollback.xact', true), '')
           = coalesce(pg_catalog.pg_current_xact_id_if_assigned()::text, '-') as same_xact
),
run as (
  select coalesce(g.state in ('checked', 'deleted') and g.same_xact
                  and coalesce(g.labels, '') <> '' and coalesce(g.ids, '') <> '' and coalesce(g.want, '') <> '', false) as ok,
         g.*
  from gate g
),
labels as (
  select l as label from run r cross join unnest(pg_catalog.string_to_array(r.labels, ',')) as l where r.ok
),
picked as (
  select x::uuid as id from run r cross join unnest(pg_catalog.string_to_array(r.ids, ',')) as x where r.ok
)
select 'r00 파일 전체 실행 확인' as check_name,
       case when r.ok then 'OK' else 'FAIL' end as verdict,
       case when not r.ok then '결과 SELECT만 단독 실행한 상태다(이 트랜잭션에 DO 블록 결과 없음) — 파일 전체를 한 번에 실행한다'
            when r.state = 'deleted' then '이번 실행: 삭제(v_apply = true)'
            else '이번 실행: 검사만(v_apply = false) — 아무것도 지우지 않음' end as detail
from run r
union all
select 'r10 삭제 전 지정 범위(ID × 급여기간) 행',
       case when r.ok and r.found = r.want then 'OK' else 'FAIL' end,
       coalesce(r.found, '?') || ' / 기대 ' || coalesce(r.want, '?') || '행'
from run r
union all
select 'r11 실제 삭제 행',
       case when not r.ok then 'FAIL'
            when r.state = 'deleted' and r.deleted = r.want then 'OK'
            when r.state = 'checked' and r.deleted = '0' then 'OK'
            else 'FAIL' end,
       coalesce(r.deleted, '?') || '행 삭제 / 기대 ' || case when r.state = 'checked' then '0(검사만)' else coalesce(r.want, '?') end || '행'
from run r
union all
select 'r20 ' || l.label || ' 이번 rollback 대상 ID의 남은 목표 행',
       case when (select state from run) = 'deleted'
            then case when n.cnt = 0 then 'OK' else 'FAIL' end
            else case when n.cnt = (select count(*) from picked) then 'OK' else 'FAIL' end end,
       n.cnt::text || '행 / 기대 ' || case when (select state from run) = 'deleted' then 0 else (select count(*) from picked) end || '행'
from labels l
cross join lateral (select count(*) as cnt from public.overtime_monthly_targets t
                    where t.period_label = l.label and t.employee_id in (select id from picked)) n
union all
select 'r30 ' || l.label || ' 전체 직원의 목표 행(참고)', 'INFO',
       (select count(*) from public.overtime_monthly_targets t where t.period_label = l.label)::text || '행'
from labels l
union all
select 'r31 전체 목표 행(모든 기간·참고)', 'INFO', count(*)::text || '행' from public.overtime_monthly_targets
union all
select 'r32 월 목표 강제조건 트리거', 'INFO',
       case when exists (select 1 from pg_catalog.pg_trigger where tgname = 'overtime_work_records_ab_monthly_target')
            then '있음(activation 적용됨)' else '없음(activation 전)' end
order by 1;

commit;
