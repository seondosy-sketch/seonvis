-- 월 목표 DB 강제조건 설치 확인 — 읽기 전용(SELECT 한 문장). 개발용 Supabase SQL Editor에서 실행.
-- 결과: check_name / verdict(OK·FAIL·INFO) / detail
with fn as (
  select p.oid, p.proname::text as name, p.prosecdef, p.proconfig, p.provolatile,
         pg_catalog.pg_get_userbyid(p.proowner)::text as owner,
         pg_catalog.pg_get_functiondef(p.oid) as def
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.proname in ('overtime_pay_period_label', 'overtime_assert_monthly_target', 'overtime_work_records_monthly_target',
                      'overtime_assert_weekly_cap', 'overtime_work_records_weekly_cap', 'overtime_work_records_protect')
),
trg as (
  select t.tgname::text as name, t.tgenabled::text as enabled, pg_catalog.pg_get_triggerdef(t.oid) as def
  from pg_catalog.pg_trigger t
  where t.tgrelid = 'public.overtime_work_records'::regclass and not t.tgisinternal
),
roles as (select unnest(array['anon', 'authenticated', 'service_role']) as r)
select * from (
  -- 1. 함수 3개 존재
  select 'functions_created' as check_name,
         case when (select count(*) from fn where name in ('overtime_pay_period_label', 'overtime_assert_monthly_target', 'overtime_work_records_monthly_target')) = 3 then 'OK' else 'FAIL' end as verdict,
         (select string_agg(name, ', ' order by name) from fn where name in ('overtime_pay_period_label', 'overtime_assert_monthly_target', 'overtime_work_records_monthly_target')) as detail
  union all
  -- 2. 트리거 정의 (pg_get_triggerdef 원문)
  select 'triggerdef:' || name,
         case when enabled = 'O' and def like '%BEFORE%' and def like '%FOR EACH ROW%' then 'OK' else 'FAIL' end,
         def
  from trg
  union all
  -- 3. 같은 이벤트(INSERT·UPDATE) BEFORE ROW 트리거의 실제 발동 순서(이름 바이트 순)
  select 'fire_order_insert_update', 'INFO',
         (select string_agg(name, ' → ' order by name collate "C") from trg where def like '%BEFORE%INSERT%')
  union all
  select 'fire_order_expected',
         case when (select string_agg(name, ' → ' order by name collate "C") from trg where def like '%BEFORE%INSERT%')
                   = 'overtime_work_records_a_protect → overtime_work_records_ab_monthly_target → overtime_work_records_b_weekly_cap'
              then 'OK' else 'FAIL' end,
         'a_protect(잠금) → ab_monthly_target(월 목표) → b_weekly_cap(주 12시간)'
  union all
  -- 4. SECURITY DEFINER / 고정 search_path / 소유자
  select 'secdef_searchpath:' || name,
         case
           when name = 'overtime_work_records_protect' then case when not prosecdef then 'OK' else 'FAIL' end   -- 잠금은 INVOKER(current_user 판단)
           when name = 'overtime_pay_period_label' then case when proconfig is not null then 'OK' else 'FAIL' end
           else case when prosecdef and proconfig is not null then 'OK' else 'FAIL' end
         end,
         'secdef=' || prosecdef::text || ' config=' || coalesce(array_to_string(proconfig, ';'), '(없음)') || ' owner=' || owner || ' volatile=' || provolatile::text
  from fn
  union all
  -- 5. 월 목표 검사 함수의 직렬화 lock
  select 'monthly_advisory_lock',
         case when (select def from fn where name = 'overtime_assert_monthly_target') like '%pg_advisory_xact_lock%overtime_month:%' then 'OK' else 'FAIL' end,
         '직원×급여기간 transaction advisory lock'
  union all
  -- 6. 직접 실행 권한 — anon/authenticated/service_role 모두 없어야 함
  select 'execute:' || roles.r || ':' || fn.name,
         case when pg_catalog.has_function_privilege(roles.r, fn.oid, 'EXECUTE') then 'FAIL' else 'OK' end,
         'EXECUTE=' || pg_catalog.has_function_privilege(roles.r, fn.oid, 'EXECUTE')::text
  from fn cross join roles
  where fn.name in ('overtime_pay_period_label', 'overtime_assert_monthly_target', 'overtime_work_records_monthly_target')
  union all
  -- proacl이 NULL(기본 권한)이면 PUBLIC 실행 가능, '=X/소유자' 항목이 있어도 PUBLIC 실행 가능 → FAIL
  select 'execute:public_acl', case when bool_or(p.proacl is null or array_to_string(p.proacl, ',') ~ '(^|,)=X/') then 'FAIL' else 'OK' end,
         string_agg(p.proname::text || ':' || coalesce(array_to_string(p.proacl, ','), '(default)'), ' | ')
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname in ('overtime_pay_period_label', 'overtime_assert_monthly_target', 'overtime_work_records_monthly_target')
  union all
  -- 7. private 스키마 USAGE — 클라이언트 역할은 없어야 함
  select 'schema_usage:' || roles.r,
         case when pg_catalog.has_schema_privilege(roles.r, 'private', 'USAGE') then 'FAIL' else 'OK' end,
         'USAGE=' || pg_catalog.has_schema_privilege(roles.r, 'private', 'USAGE')::text
  from roles
  union all
  -- 8. 테이블 소유자(트리거 함수 소유자와 같아야 DEFINER 합산이 RLS와 무관)
  select 'table_owner', 'INFO', pg_catalog.pg_get_userbyid(c.relowner)::text
  from pg_catalog.pg_class c where c.oid = 'public.overtime_work_records'::regclass
  union all
  -- 9. 라벨 함수 경계 확인(읽기만 — 함수는 소유자로 실행됨)
  select 'label_boundaries',
         case when private.overtime_pay_period_label('2026-10-20') = '2026-10'
               and private.overtime_pay_period_label('2026-10-21') = '2026-11'
               and private.overtime_pay_period_label('2026-12-21') = '2027-01'
               and private.overtime_pay_period_label('2027-01-20') = '2027-01' then 'OK' else 'FAIL' end,
         '10/20→2026-10, 10/21→2026-11, 12/21→2027-01, 1/20→2027-01'
  union all
  -- 10. 격리수준 방어(경쟁조건 보정 migration 적용 여부)
  select 'isolation_guard:' || name,
         case when def like '%OVERTIME_ISOLATION_UNSUPPORTED%' then 'OK' else 'FAIL' end,
         case when def like '%OVERTIME_ISOLATION_UNSUPPORTED%' then 'REPEATABLE READ 거부' else '미적용 — migration_overtime_cap_isolation_guard.sql 필요' end
  from fn where name in ('overtime_assert_weekly_cap', 'overtime_assert_monthly_target')
  union all
  select 'current_isolation', 'INFO', pg_catalog.current_setting('transaction_isolation')
) x
order by check_name;
