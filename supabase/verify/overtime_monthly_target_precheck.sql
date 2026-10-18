-- 월 목표 강제조건 켜기 전 확인 — 재직 직원 전원에게 해당 급여기간 목표 행이 있는가 (읽기 전용, SELECT 한 문장)
--
-- 언제: supabase/prod/overtime_monthly_targets_2_apply.sql 적용 뒤, supabase/prod/overtime_monthly_target_activation.sql 직전.
--   FAIL이 하나라도 있으면 activation을 실행하지 않는다(실행해도 activation 맨 앞 DO 블록이 오늘 급여기간 기준으로 다시 막는다).
-- [설정] labels: 확인할 급여기간 라벨('YYYY-MM' = 전월 21일 ~ 당월 20일). 오늘 기간과, 21일 경계가 7일 안이면 다음 기간까지 넣는다.
--   mt01이 "오늘 기준으로 activation이 요구하는 라벨"을 계산해 [설정]에 빠진 라벨이 있으면 FAIL로 알려 준다.
-- 대상: overtime_employees.is_active = true 전원(월 목표 트리거는 직원 구분 없이 모든 기록에 걸린다).
-- 결과: check_name / status(OK·FAIL·INFO) / detail. 이름은 내지 않는다(직원 UUID만) — 이름 확인은 _1_list.sql 화면에서.
-- ⚠ mt20은 목표가 없는 직원의 UUID를 그대로 낸다. 이름은 없지만 UUID도 직원 식별자다 — 운영 결과의 mt20 원문을
--   대화창·문서·로그·이슈에 붙이거나 내보내지(Export·CSV) 않는다. 보고에는 기간별 누락 인원 수(mt10)만 쓴다.

with
opts as (select array['2026-10', '2026-11']::text[] as labels),   -- [설정] 확인할 급여기간 라벨
today as (select (pg_catalog.now() at time zone 'Asia/Seoul')::date as d),
cur as (
  -- private.overtime_pay_period_label과 같은 규칙(21일부터 다음 달 라벨) — 함수가 아직 없을 수 있어 직접 계산
  select pg_catalog.to_char(
           case when extract(day from t.d) >= 21 then (pg_catalog.date_trunc('month', t.d::timestamp) + interval '1 month')
                else pg_catalog.date_trunc('month', t.d::timestamp) end,
           'YYYY-MM') as label,
         extract(day from t.d) between 14 and 20 as near_boundary,
         t.d
  from today t
),
required as (
  select c.label from cur c
  union all
  select pg_catalog.to_char(pg_catalog.to_date(c.label || '-01', 'YYYY-MM-DD') + interval '1 month', 'YYYY-MM') from cur c where c.near_boundary
),
lbl as (select unnest(o.labels) as label from opts o),
missing as (
  select l.label, e.id as employee_id
  from lbl l cross join public.overtime_employees e
  where e.is_active
    and not exists (select 1 from public.overtime_monthly_targets t where t.employee_id = e.id and t.period_label = l.label)
),
checks(sort_key, check_name, status, detail) as (
  select 0, 'mt00_today', 'INFO',
         '오늘(Asia/Seoul) ' || c.d || ' → 급여기간 ' || c.label
         || case when c.near_boundary then ' (21일 경계 7일 이내 — 다음 기간 목표도 필요)' else '' end
  from cur c
  union all
  -- <> all (…)은 괄호 안 subquery를 "행 집합"으로 읽어 text <> text[](42883)이 된다 → ::text[]로 배열 하나와 비교
  select 1, 'mt01_required_labels_in_settings',
         case when not exists (select 1 from required r where r.label <> all ((select labels from opts)::text[])) then 'OK' else 'FAIL' end,
         'activation이 요구하는 라벨: ' || (select string_agg(r.label, ', ' order by r.label) from required r)
         || ' / [설정]: ' || (select array_to_string(labels, ', ') from opts)
  union all
  select 2, 'mt02_label_format',
         case when bool_and(l.label ~ '^[0-9]{4}-(0[1-9]|1[0-2])$') then 'OK' else 'FAIL' end,
         string_agg(l.label, ', ')
  from lbl l
  union all
  select 3, 'mt03_active_employees', 'INFO', count(*) || '명 재직(is_active)'
  from public.overtime_employees e where e.is_active
  union all
  -- 주소록 미연결 재직 직원은 _2_apply.sql 대상(주소록 연결 미래사업팀 재직)에서 빠져 목표를 넣을 수 없다 → 연결 먼저
  select 4, 'mt04_active_unlinked',
         case when count(*) = 0 then 'OK' else 'FAIL' end,
         count(*) || '명 (주소록 미연결 재직 직원 — overtime_employee_link_check.sql로 연결 후 목표 입력)'
  from public.overtime_employees e
  where e.is_active and not exists (select 1 from public.engineer_contacts c where c.employee_id = e.id)
  union all
  select 10, 'mt10_missing_count:' || l.label,
         case when count(m.employee_id) = 0 then 'OK' else 'FAIL' end,
         count(m.employee_id) || '명 목표 없음'
  from lbl l left join missing m on m.label = l.label
  group by l.label
  union all
  select 20, 'mt20_missing_employee:' || m.label, 'FAIL', 'employee_id=' || m.employee_id
  from missing m
)
select check_name, status, detail from checks order by sort_key, check_name, detail;
