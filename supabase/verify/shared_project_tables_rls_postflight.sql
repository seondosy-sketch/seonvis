-- 공용 표 읽기 정책 보정 — 적용 후 확인 (읽기 전용). 결과: table_name / check_name / verdict / detail
with expected(table_name, old_policy, keys, write_count) as (values
    ('projects', 'authenticated users can read projects', array['attendance', 'interview_db', 'lodging', 'overtime', 'projects', 'trip', 'weekly'], 3),
    ('project_notes', 'select_authenticated', array['projects', 'weekly'], 3),
    ('project_tooltips', 'select_authenticated', array['projects', 'trip', 'weekly'], 3),
    ('performing_projects', 'select_authenticated', array['weekly'], 3),
    ('expected_projects', 'select_authenticated', array['weekly'], 3),
    ('weekly_meta', 'select_authenticated', array['weekly'], 3),
    ('evaluation_types', 'eval_types_select', array['interview_db'], 3),
    ('evaluation_roles', 'eval_roles_select', array['interview_db'], 3),
    ('evaluation_question_categories', 'eval_categories_select', array['interview_db'], 3)
),
pol as (
  select c.relname::text as table_name, p.polname::text as policy_name, p.polcmd,
         array(select case when r = 0 then 'public' else pg_catalog.pg_get_userbyid(r)::text end from pg_catalog.unnest(p.polroles) r) as roles,
         pg_catalog.pg_get_expr(p.polqual, p.polrelid) as qual
  from pg_catalog.pg_policy p join pg_catalog.pg_class c on c.oid = p.polrelid
  where c.relnamespace = 'public'::regnamespace and c.relname in ('projects', 'project_notes', 'project_tooltips', 'performing_projects', 'expected_projects', 'weekly_meta', 'evaluation_types', 'evaluation_roles', 'evaluation_question_categories')
),
fn as (
  select p.oid, p.prosecdef, p.proconfig, p.provolatile, pg_catalog.pg_get_userbyid(p.proowner)::text as owner, p.proacl,
         pg_catalog.pg_get_functiondef(p.oid) as def
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname = 'menu_any_readable'
)
select * from (
  select e.table_name, '1 기존 전체 읽기 정책 제거' as check_name,
         case when exists (select 1 from pol where pol.table_name = e.table_name and pol.policy_name = e.old_policy) then 'FAIL' else 'OK' end as verdict,
         '' as detail
  from expected e
  union all
  select e.table_name, '2 menu_read: SELECT to authenticated, 메뉴 키 일치',
         case when exists (select 1 from pol where pol.table_name = e.table_name and pol.policy_name = 'menu_read' and pol.polcmd = 'r'
                             and pol.roles = array['authenticated']
                             and array(select m[1] from pg_catalog.regexp_matches(pol.qual, '''([a-z_]+)''::text', 'g') m order by 1) = e.keys) then 'OK' else 'FAIL' end,
         coalesce((select array_to_string(pol.roles, ',') || ' USING ' || pol.qual from pol where pol.table_name = e.table_name and pol.policy_name = 'menu_read'), '(없음)')
  from expected e
  union all
  select e.table_name, '3 읽기 가능 정책은 menu_read 하나',
         case when (select count(*) from pol where pol.table_name = e.table_name and pol.polcmd in ('r', '*')) = 1 then 'OK' else 'FAIL' end,
         (select count(*) from pol where pol.table_name = e.table_name and pol.polcmd in ('r', '*'))::text || '개'
  from expected e
  union all
  select e.table_name, '4 쓰기 정책 수 그대로',
         case when (select count(*) from pol where pol.table_name = e.table_name and pol.polcmd in ('a', 'w', 'd')) = e.write_count then 'OK' else 'FAIL' end,
         (select count(*) from pol where pol.table_name = e.table_name and pol.polcmd in ('a', 'w', 'd'))::text || ' / 예상 ' || e.write_count
  from expected e
  union all
  select e.table_name, '5 교체 전 정의 백업(명령·역할 포함)',
         case when exists (select 1 from private.shared_rls_policy_backup b where b.table_name = e.table_name and b.policy_name = e.old_policy
                             and pg_catalog.to_jsonb(b) ->> 'cmd' = 'r' and pg_catalog.array_length(b.roles, 1) >= 1) then 'OK'
              when exists (select 1 from private.shared_rls_policy_backup b where b.table_name = e.table_name and b.policy_name = e.old_policy) then 'INFO(이전 버전 백업 — cmd 없음, 되돌리기는 SELECT로 복원)'
              else 'FAIL' end,
         coalesce((select 'cmd=' || coalesce(pg_catalog.to_jsonb(b) ->> 'cmd', '-') || ' roles=' || array_to_string(b.roles, ',')
                   from private.shared_rls_policy_backup b where b.table_name = e.table_name and b.policy_name = e.old_policy), '')
  from expected e
  union all
  select '(함수)', 'SECURITY DEFINER·STABLE', case when (select prosecdef and provolatile = 's' from fn) then 'OK' else 'FAIL' end,
         coalesce((select 'owner=' || owner from fn), '함수 없음')
  union all
  select '(함수)', 'search_path 고정', case when (select array_to_string(proconfig, ';') from fn) like 'search_path=%' then 'OK' else 'FAIL' end,
         coalesce((select array_to_string(proconfig, ';') from fn), '-')
  union all
  select '(함수)', '동적 SQL 없음', case when (select def !~* '\mexecute\M' from fn) then 'OK' else 'FAIL' end, ''
  union all
  select '(함수)', 'PUBLIC 실행권한 없음', case when (select proacl is null or array_to_string(proacl, ',') ~ '(^|,)=X/' from fn) then 'FAIL' else 'OK' end,
         coalesce((select array_to_string(proacl, ',') from fn), '-')
  union all
  select '(함수)', 'EXECUTE:' || r,
         case when (r = 'authenticated') = pg_catalog.has_function_privilege(r, (select oid from fn), 'EXECUTE') then 'OK' else 'FAIL' end,
         'EXECUTE=' || pg_catalog.has_function_privilege(r, (select oid from fn), 'EXECUTE')::text || case when r = 'authenticated' then ' (정책 평가에 필요)' else '' end
  from pg_catalog.unnest(array['anon', 'authenticated', 'service_role']) r
  where exists (select 1 from fn)
  union all
  select '(백업표)', '클라이언트 권한 없음',
         case when pg_catalog.has_table_privilege('authenticated', 'private.shared_rls_policy_backup', 'SELECT')
                or pg_catalog.has_table_privilege('anon', 'private.shared_rls_policy_backup', 'SELECT') then 'FAIL' else 'OK' end, ''
) x
order by 1, 2;
