-- 연장근무 자동배정 Phase 3A — 운영 DB 시스템 카탈로그 확인 (읽기 전용)
--
-- Supabase SQL Editor에 전체를 붙여 넣고 한 번 실행한다.
-- - SELECT 한 문장뿐이다(카탈로그 조회 + pg_get_* 정의 출력 함수). 데이터·스키마를 바꾸지 않는다.
-- - SQL Editor는 여러 문장을 실행하면 마지막 결과만 보여주므로, 전부 UNION ALL로 묶어 표 하나로 낸다.
-- - 결과 컬럼: check_name(어떤 확인인지) / object_name(대상) / detail(내용). 행 데이터·개인정보는 조회하지 않는다.
-- - 결과는 Export → Copy as CSV(또는 Markdown)로 복사해 전달한다.

with
tbl(name) as (
  values ('overtime_employees'), ('overtime_employee_tasks'), ('overtime_projects'), ('overtime_project_members'),
         ('overtime_work_records'), ('engineer_contacts'), ('holidays'), ('allowed_users')
),
tbl_oid as (
  select name, to_regclass('public.' || name) as oid from tbl
),

-- 01 Postgres 버전
c01 as (
  select '01_version'::text as check_name, 'server'::text as object_name, version()::text as detail
),

-- 02 컬럼 (overtime_* 전체 + 다른 테이블은 이번 설계가 의존하는 컬럼만) — numeric 정밀도 확인 포함
c02 as (
  select '02_column', c.table_name || '.' || c.column_name,
         c.data_type
         || coalesce('(' || c.numeric_precision || ',' || c.numeric_scale || ')', '')
         || case when c.is_nullable = 'NO' then ' NOT NULL' else ' NULL' end
         || coalesce(' DEFAULT ' || c.column_default, '')
  from information_schema.columns c
  where c.table_schema = 'public'
    and (c.table_name like 'overtime\_%'
         or (c.table_name = 'engineer_contacts' and c.column_name in ('id', 'employee_id', 'company', 'employment_status'))
         or (c.table_name = 'holidays')
         or (c.table_name = 'allowed_users' and c.column_name in ('email', 'is_admin', 'menu_permissions')))
),

-- 03 제약조건 전문 (PK·UNIQUE·CHECK·FK, FK의 ON DELETE 포함)
c03 as (
  select '03_constraint', t.name || '.' || con.conname,
         con.contype || ': ' || pg_get_constraintdef(con.oid)
  from tbl_oid t join pg_constraint con on con.conrelid = t.oid
),

-- 04 overtime_employees.name 단독 UNIQUE의 정확한 이름 (제약 또는 인덱스)
c04 as (
  select '04_employee_name_unique', con.conname, pg_get_constraintdef(con.oid)
  from pg_constraint con
  join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
  where con.conrelid = to_regclass('public.overtime_employees') and con.contype = 'u'
    and array_length(con.conkey, 1) = 1 and a.attname = 'name'
  union all
  select '04_employee_name_unique', i.indexrelid::regclass::text, pg_get_indexdef(i.indexrelid)
  from pg_index i
  where i.indrelid = to_regclass('public.overtime_employees') and i.indisunique and not i.indisprimary
),

-- 05 인덱스
c05 as (
  select '05_index', ix.tablename || '.' || ix.indexname, ix.indexdef
  from pg_indexes ix
  where ix.schemaname = 'public' and ix.tablename in (select name from tbl)
),

-- 06 트리거 (내부 FK 트리거 제외)
c06 as (
  select '06_trigger', t.name || '.' || tg.tgname, pg_get_triggerdef(tg.oid)
  from tbl_oid t join pg_trigger tg on tg.tgrelid = t.oid
  where not tg.tgisinternal
),

-- 07 RLS 활성화 / FORCE
c07 as (
  select '07_rls', t.name,
         'enabled=' || cl.relrowsecurity || ' forced=' || cl.relforcerowsecurity
  from tbl_oid t join pg_class cl on cl.oid = t.oid
),

-- 08 RLS 정책 전문
c08 as (
  select '08_policy', p.tablename || '.' || p.policyname,
         p.cmd || ' ' || p.permissive || ' roles=' || array_to_string(p.roles, ',')
         || ' USING ' || coalesce(p.qual, '-') || ' CHECK ' || coalesce(p.with_check, '-')
  from pg_policies p
  where p.schemaname = 'public' and p.tablename in (select name from tbl)
),

-- 09 함수 속성: SECURITY DEFINER·변동성·search_path·EXECUTE 권한
c09 as (
  select '09_function_attr', n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         'definer=' || p.prosecdef
         || ' volatility=' || p.provolatile
         || ' config=' || coalesce(array_to_string(p.proconfig, ';'), '-')
         || ' acl=' || coalesce(p.proacl::text, '(default)')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where (n.nspname = 'private')
     or (n.nspname = 'public' and p.proname in ('sync_team_employees', 'attendance_replace_director', 'can_view_private_legacy'))
),

-- 10 함수 정의 전문 — 이번 설계가 계약에 의존하는 두 함수만
c10 as (
  select '10_function_def', n.nspname || '.' || p.proname, pg_get_functiondef(p.oid)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where (n.nspname = 'private' and p.proname = 'menu_permission')
     or (n.nspname = 'public' and p.proname = 'sync_team_employees')
),

-- 11 private 스키마 USAGE (authenticated=false가 설계 전제)
c11 as (
  select '11_private_usage', r.rolname,
         'usage=' || has_schema_privilege(r.rolname, 'private', 'USAGE')
  from pg_roles r where r.rolname in ('authenticated', 'anon', 'service_role')
),

-- 12 함수 기본 권한 (새 함수에 anon EXECUTE가 자동 부여되는지)
c12 as (
  select '12_default_acl',
         pg_get_userbyid(d.defaclrole) || ' / ' || coalesce(d.defaclnamespace::regnamespace::text, '(all)'),
         'objtype=' || d.defaclobjtype || ' acl=' || d.defaclacl::text
  from pg_default_acl d
  where d.defaclobjtype = 'f'
),

-- 13 새로 만들 객체 이름 충돌 (detail이 전부 '없음'이어야 함)
c13 as (
  select '13_name_conflict', x.name, coalesce(x.found, '없음')
  from (values
    ('table overtime_monthly_targets', to_regclass('public.overtime_monthly_targets')::text),
    ('table overtime_member_tasks', to_regclass('public.overtime_member_tasks')::text),
    ('table overtime_assignment_runs', to_regclass('public.overtime_assignment_runs')::text),
    ('table overtime_assignment_drafts', to_regclass('public.overtime_assignment_drafts')::text),
    ('index engineer_contacts_employee_id_key', to_regclass('public.engineer_contacts_employee_id_key')::text),
    ('rpc overtime_save_assignment_run', to_regprocedure('public.overtime_save_assignment_run(jsonb,jsonb)')::text),
    ('rpc overtime_confirm_run', to_regprocedure('public.overtime_confirm_run(uuid,uuid[])')::text),
    ('rpc overtime_unconfirm_drafts', to_regprocedure('public.overtime_unconfirm_drafts(uuid[])')::text),
    ('rpc overtime_discard_run', to_regprocedure('public.overtime_discard_run(uuid)')::text),
    ('rpc overtime_apply_project_sync', to_regprocedure('public.overtime_apply_project_sync(jsonb,jsonb)')::text),
    ('policy holidays.overtime_select', (select policyname::text from pg_policies
                                          where schemaname = 'public' and tablename = 'holidays' and policyname = 'overtime_select'))
  ) as x(name, found)
),

-- 14 기록 현황 (건수만 — 개인정보 없음)
c14 as (
  select '14_counts', 'overtime_work_records', count(*)::text from overtime_work_records
  union all
  select '14_counts', 'weeks_over_12h',
         count(*)::text
  from (select employee_id from overtime_work_records
        group by employee_id, date_trunc('week', work_date::timestamp) having sum(hours) > 12) w
  union all
  select '14_counts', 'engineer_contacts.employee_id duplicated',
         count(*)::text
  from (select employee_id from engineer_contacts where employee_id is not null
        group by employee_id having count(*) > 1) d
  union all
  select '14_counts', 'holidays by year', coalesce(string_agg(y || ':' || n, ', ' order by y), '0')
  from (select extract(year from holiday_date)::text y, count(*)::text n from holidays group by 1) h
)

select check_name, object_name, detail
from (
  select * from c01 union all select * from c02 union all select * from c03 union all select * from c04
  union all select * from c05 union all select * from c06 union all select * from c07 union all select * from c08
  union all select * from c09 union all select * from c10 union all select * from c11 union all select * from c12
  union all select * from c13 union all select * from c14
) all_checks
order by check_name, object_name;
