-- 월 목표 선입력 2단계 — 검사 / 적용 (운영 SQL Editor, 한 번에 전체 실행)
--
-- 구조: 맨 바깥에는 begin · DO 블록 하나 · 결과 SELECT · commit만 있다(맨 바깥 insert/update/delete 없음).
--   예전 파일은 맨 바깥에서 임시표(ot_target_opts·ot_target_input)에 값을 넣었는데, 운영 SQL Editor가 실행 전에
--   그 표를 찾다가 relation "ot_target_opts" does not exist(42P01)로 멈췄다. 그래서 입력값은 DO 블록 안 배열 변수로 받는다.
--
-- 사용법 (값은 SQL Editor 안에서만 고친다. 이 파일에 실제 UUID를 저장하지 않는다)
--   1) [설정] v_labels(급여기간)·v_expected(재직 미래사업팀 인원)를 확인한다.
--   2) [입력표] v_ids: 1단계 목록(_1_list.sql) 화면의 overtime_employee_id를 화면순번 순서로(주소록_uuid 아님).
--      v_hours: 같은 순서의 목표시간. 이름으로 고르지 않는다 — 동명이인도 UUID로 구분된다.
--   3) v_apply = false(기본)로 한 번 실행 → 오류 없이 끝나고 마지막 표 t00이 OK, t01이 기간마다 NONE(0행)인지 확인.
--   4) (별도 승인 후) v_apply = true로 바꿔 한 번만 실행 → t00 OK, t01이 기간마다 OK(v_expected행), t02 분포가 입력과 같은지 확인.
--   ⚠ 언제나 파일 전체를 한 번에 실행한다. 결과 SELECT만 골라 실행하면 검사가 돌지 않는다 → t00이 FAIL로 알리고
--     t01·t02는 나오지 않는다. 결과를 다시 보고 싶으면 v_apply = false로 파일 전체를 다시 실행한다(적용 후라면 c11로 중단 —
--     그때는 overtime_monthly_target_precheck.sql로 확인).
-- 대상 = 재직 미래사업팀 직원(overtime_employees.is_active AND 주소록 연결 + company '미래사업팀' + '재직').
--   운영 기준 8명(주소록에 연결된 직원은 9명이지만 그중 1명은 비활성). 대상 인원이 v_expected와 다르면 적용하지 않는다.
-- 검사(하나라도 실패하면 raise → 아무것도 바뀌지 않음): c01 급여기간 없음·형식·중복 / c02 입력 줄 수 / c03 대상 인원 /
--   c04 재직이지만 대상 아님 / c05 자리표시 ID / c06 빈칸 / c07 범위(0~300) / c07b 소수 셋째 자리 이상(numeric(5,2) 반올림 방지) /
--   c08 중복 ID / c09 대상이 아닌 ID / c10 누락된 대상 직원 / c11 기존 목표 있음(덮어쓰기 없음).
--   목표시간 0 = 그 기간 연장근무 0시간(양수 입력 전부 차단).
-- 안전: 전체가 한 트랜잭션 — 여러 급여기간이 모두 들어가거나 모두 안 들어간다. 적용 후 행 수와 값을 다시 확인해
--   다르면 raise로 전체 되돌림. 같은 값으로 apply = true를 두 번 실행하면 c11로 중단된다.
-- 출력: 이름·UUID를 내지 않는다(실패 사유도 항목 번호와 개수만). 이름 확인은 1단계 화면에서.
-- 되돌리기(월 목표 강제조건 activation 전에만): overtime_monthly_targets_3_rollback.sql

begin;

do $$
declare
  -- ── [설정] ──────────────────────────────────────────────────────────────
  v_labels   text[]    := array['2026-10', '2026-11'];   -- 적용할 급여기간
  v_expected int       := 8;                             -- 재직 미래사업팀 인원
  v_apply    boolean   := false;                         -- false = 검사만, true = 적용
  -- ── [입력표] 같은 순서로 v_expected개씩 ──────────────────────────────────
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
  v_hours numeric[] := array[20, 20, 20, 20, 20, 20, 20, 20]::numeric[];
  -- ───────────────────────────────────────────────────────────────────────
  -- 실패 사유는 pg_catalog.array_append로 모은다(text[] || '문자열'은 오른쪽이 배열 리터럴로 해석된다)
  v_fail text[] := array[]::text[];
  v_label text;
  v_written int;
  v_after int;
begin
  if to_regclass('public.overtime_monthly_targets') is null then
    raise exception '중단: Migration A가 적용되지 않았다(overtime_monthly_targets 없음)';
  end if;

  -- 공통 검사
  if coalesce(array_length(v_labels, 1), 0) = 0 then v_fail := pg_catalog.array_append(v_fail, 'c01 급여기간 없음'::text); end if;
  if exists (select 1 from unnest(v_labels) l where l is null or l !~ '^[0-9]{4}-(0[1-9]|1[0-2])$') then v_fail := pg_catalog.array_append(v_fail, 'c01 급여기간 형식'::text); end if;
  if exists (select 1 from unnest(v_labels) l group by l having count(*) > 1) then v_fail := pg_catalog.array_append(v_fail, 'c01 급여기간 중복'::text); end if;
  if coalesce(array_length(v_ids, 1), 0) <> v_expected or coalesce(array_length(v_hours, 1), 0) <> v_expected then
    v_fail := pg_catalog.array_append(v_fail, ('c02 입력 줄 수(ID ' || coalesce(array_length(v_ids, 1), 0) || ' / 시간 ' || coalesce(array_length(v_hours, 1), 0) || ') ≠ ' || v_expected)::text);
  end if;
  if (select count(*) from public.overtime_employees e join public.engineer_contacts c on c.employee_id = e.id
      where e.is_active and c.company = '미래사업팀' and c.employment_status = '재직') <> v_expected then
    v_fail := pg_catalog.array_append(v_fail, 'c03 대상 인원 ≠ 재직인원'::text);
  end if;
  if exists (select 1 from public.overtime_employees e where e.is_active
             and not exists (select 1 from public.engineer_contacts c where c.employee_id = e.id
                             and c.company = '미래사업팀' and c.employment_status = '재직')) then
    v_fail := pg_catalog.array_append(v_fail, 'c04 재직이지만 대상 아님'::text);
  end if;
  if exists (select 1 from unnest(v_ids) i where i = '00000000-0000-0000-0000-000000000000') then v_fail := pg_catalog.array_append(v_fail, 'c05 자리표시 ID 남음'::text); end if;
  if exists (select 1 from unnest(v_ids) i where i is null) or exists (select 1 from unnest(v_hours) h where h is null) then
    v_fail := pg_catalog.array_append(v_fail, 'c06 빈칸'::text);
  end if;
  if exists (select 1 from unnest(v_hours) h where h < 0 or h > 300) then v_fail := pg_catalog.array_append(v_fail, 'c07 범위(0~300) 밖'::text); end if;
  if exists (select 1 from unnest(v_hours) h where h <> round(h, 2)) then v_fail := pg_catalog.array_append(v_fail, 'c07b 소수 셋째 자리 이상'::text); end if;
  if exists (select 1 from unnest(v_ids) i group by i having count(*) > 1) then v_fail := pg_catalog.array_append(v_fail, 'c08 중복 ID'::text); end if;
  if exists (select 1 from unnest(v_ids) i where i is not null and not exists (
               select 1 from public.overtime_employees e join public.engineer_contacts c on c.employee_id = e.id
               where e.id = i and e.is_active and c.company = '미래사업팀' and c.employment_status = '재직')) then
    v_fail := pg_catalog.array_append(v_fail, 'c09 대상이 아닌 ID'::text);
  end if;
  if exists (select 1 from public.overtime_employees e join public.engineer_contacts c on c.employee_id = e.id
             where e.is_active and c.company = '미래사업팀' and c.employment_status = '재직'
               and not (e.id = any (coalesce(v_ids, array[]::uuid[])))) then
    v_fail := pg_catalog.array_append(v_fail, 'c10 누락된 대상 직원'::text);
  end if;
  -- 기간별: 기존 목표(덮어쓰기 없음)
  foreach v_label in array coalesce(v_labels, array[]::text[]) loop
    if exists (select 1 from public.overtime_monthly_targets t where t.period_label = v_label and t.employee_id = any (v_ids)) then
      v_fail := pg_catalog.array_append(v_fail, ('c11 기존 목표 있음 ' || v_label)::text);
    end if;
  end loop;

  if array_length(v_fail, 1) > 0 then
    raise exception '중단(아무것도 바꾸지 않음): %', array_to_string(v_fail, ' / ');
  end if;

  if v_apply then
    insert into public.overtime_monthly_targets (employee_id, period_label, target_hours)
    select i.id, l.label, i.h
    from unnest(v_ids, v_hours) as i(id, h)
    cross join unnest(v_labels) as l(label)
    on conflict (employee_id, period_label) do nothing;
    get diagnostics v_written = row_count;
    if v_written <> v_expected * array_length(v_labels, 1) then
      raise exception '중단(전체 되돌림): 적용 행 수 % ≠ 기대 %', v_written, v_expected * array_length(v_labels, 1);
    end if;

    -- 적용 후 확인: 기간마다 대상 직원 전원이 입력한 시간 그대로
    foreach v_label in array v_labels loop
      select count(*) into v_after
      from unnest(v_ids, v_hours) as i(id, h)
      join public.overtime_monthly_targets t on t.employee_id = i.id and t.period_label = v_label and t.target_hours = i.h;
      if v_after <> v_expected then
        raise exception '중단(전체 되돌림): % 적용 후 일치 % ≠ %', v_label, v_after, v_expected;
      end if;
    end loop;
    raise notice '적용 완료: %행', v_written;
  else
    raise notice '검사 전부 통과 — v_apply = false라 아무것도 쓰지 않았다';
  end if;

  -- 결과 SELECT로 넘기는 값 — 모든 검사(와 적용)를 통과한 뒤에만, 이 트랜잭션 안에서만(set_config 세 번째 인자 true).
  --   xact는 이 트랜잭션 번호다. 결과 SELECT만 따로 실행하면 값이 없거나 번호가 달라 t00이 FAIL이 된다.
  perform pg_catalog.set_config('ot_apply.labels', array_to_string(v_labels, ','), true);
  perform pg_catalog.set_config('ot_apply.state', case when v_apply then 'applied' else 'checked' end, true);
  perform pg_catalog.set_config('ot_apply.xact', pg_catalog.pg_current_xact_id()::text, true);
end $$;

-- 결과 (이름·UUID 없음). 급여기간은 위 DO 블록의 v_labels.
--   t00: 이 트랜잭션에서 DO 블록이 끝까지 실행됐는가 — 결과 SELECT만 단독 실행하면 FAIL(그때 t01·t02는 나오지 않는다)
--   t01: 대상 직원 중 목표 행 수 — 검사만이면 NONE(0), 적용 후면 OK(대상 인원), 그 밖은 FAIL
with gate as (
  select pg_catalog.current_setting('ot_apply.state', true) as state,
         pg_catalog.current_setting('ot_apply.labels', true) as labels,
         coalesce(pg_catalog.current_setting('ot_apply.xact', true), '')
           = coalesce(pg_catalog.pg_current_xact_id_if_assigned()::text, '-') as same_xact
),
run as (
  select coalesce(g.state in ('checked', 'applied') and g.same_xact and coalesce(g.labels, '') <> '', false) as ok,
         g.state, g.labels
  from gate g
),
scope as (
  select e.id from public.overtime_employees e join public.engineer_contacts c on c.employee_id = e.id
  where e.is_active and c.company = '미래사업팀' and c.employment_status = '재직'
),
labels as (
  select l as label
  from run r cross join unnest(pg_catalog.string_to_array(r.labels, ',')) as l
  where r.ok
)
select 't00 파일 전체 실행 확인' as check_name,
       case when r.ok then 'OK' else 'FAIL' end as verdict,
       case when not r.ok then '결과 SELECT만 단독 실행한 상태다(이 트랜잭션에 DO 블록 결과 없음) — 파일 전체를 한 번에 실행한다'
            when r.state = 'applied' then '이번 실행: 적용(v_apply = true)'
            else '이번 실행: 검사만(v_apply = false) — 아무것도 쓰지 않음' end as detail
from run r
union all
select 't01 ' || l.label || ' 대상 직원 목표 행',
       case when (select state from run) = 'applied'
            then case when n.cnt = (select count(*) from scope) then 'OK' else 'FAIL' end
            else case when n.cnt = 0 then 'NONE' else 'FAIL' end end,
       n.cnt::text || ' / ' || (select count(*) from scope) || '명'
from labels l
cross join lateral (select count(*) as cnt from public.overtime_monthly_targets t
                    where t.period_label = l.label and t.employee_id in (select id from scope)) n
union all
select 't02 ' || l.label || ' 목표시간 분포', 'INFO',
       coalesce((select string_agg(h || 'h×' || cnt, ', ' order by h)
                 from (select t.target_hours::text as h, count(*) as cnt from public.overtime_monthly_targets t
                       where t.period_label = l.label group by t.target_hours) d), '(없음)')
from labels l
union all
select 't03 전체 목표 행(모든 기간)', 'INFO', count(*)::text || '행' from public.overtime_monthly_targets
union all
select 't04 월 목표 강제조건 트리거', 'INFO',
       case when exists (select 1 from pg_catalog.pg_trigger where tgname = 'overtime_work_records_ab_monthly_target')
            then '있음(activation 적용됨)' else '없음(activation 전)' end
order by 1;

commit;
