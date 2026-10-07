-- 공용 표 읽기 정책 보정 — 적용 전 확인 (읽기 전용, 운영·개발 모두). 결과를 저장해 둔다.
-- 개인정보 없음: 정책 이름·대상 역할·조건식만. 결과: table_name / check_name / verdict / detail
with expected(table_name, old_policy, old_quals, write_count) as (values
    ('projects', 'authenticated users can read projects', array['true'], 3),
    ('project_notes', 'select_authenticated', array['(auth.role() = ''authenticated''::text)'], 3),
    ('project_tooltips', 'select_authenticated', array['(auth.role() = ''authenticated''::text)'], 3),
    ('performing_projects', 'select_authenticated', array['(auth.role() = ''authenticated''::text)'], 3),
    ('expected_projects', 'select_authenticated', array['(auth.role() = ''authenticated''::text)'], 3),
    ('weekly_meta', 'select_authenticated', array['(auth.role() = ''authenticated''::text)'], 3),
    ('evaluation_types', 'eval_types_select', array['(auth.role() = ''authenticated''::text)'], 3),
    ('evaluation_roles', 'eval_roles_select', array['(auth.role() = ''authenticated''::text)'], 3),
    ('evaluation_question_categories', 'eval_categories_select', array['(auth.role() = ''authenticated''::text)'], 3)
),
pol as (
  select c.relname::text as table_name, p.polname::text as policy_name,
         case p.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT' when 'w' then 'UPDATE' when 'd' then 'DELETE' else 'ALL' end as cmd,
         p.polpermissive,
         array(select case when r = 0 then 'public' else pg_catalog.pg_get_userbyid(r)::text end from pg_catalog.unnest(p.polroles) r) as roles,
         pg_catalog.pg_get_expr(p.polqual, p.polrelid) as qual,
         pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) as with_check
  from pg_catalog.pg_policy p join pg_catalog.pg_class c on c.oid = p.polrelid
  where c.relnamespace = 'public'::regnamespace and c.relname in ('projects', 'project_notes', 'project_tooltips', 'performing_projects', 'expected_projects', 'weekly_meta', 'evaluation_types', 'evaluation_roles', 'evaluation_question_categories')
)
select * from (
  select e.table_name, '0 표 존재·RLS' as check_name,
         case when c.oid is null then 'FAIL' when c.relrowsecurity then 'OK' else 'FAIL' end as verdict,
         case when c.oid is null then '표 없음' else 'rls=' || c.relrowsecurity::text || ' forced=' || c.relforcerowsecurity::text end as detail
  from expected e left join pg_catalog.pg_class c on c.relname = e.table_name and c.relnamespace = 'public'::regnamespace
  union all
  select e.table_name, '1 기존 읽기 정책 = 예상',
         case when exists (select 1 from pol where pol.table_name = e.table_name and pol.policy_name = e.old_policy
                             and pol.cmd = 'SELECT' and pol.polpermissive and pol.qual = any (e.old_quals)) then 'OK'
              when exists (select 1 from pol where pol.table_name = e.table_name and pol.policy_name = 'menu_read') then 'INFO(이미 적용)'
              else 'FAIL' end,
         coalesce((select pol.policy_name || ' ' || array_to_string(pol.roles, ',') || ' USING ' || coalesce(pol.qual, '-')
                     from pol where pol.table_name = e.table_name and pol.policy_name = e.old_policy), '(없음)')
  from expected e
  union all
  select e.table_name, '2 다른 읽기 정책 없음',
         case when exists (select 1 from pol where pol.table_name = e.table_name and pol.cmd in ('SELECT', 'ALL')
                             and pol.policy_name not in (e.old_policy, 'menu_read')) then 'FAIL' else 'OK' end,
         coalesce((select string_agg(pol.policy_name || ':' || pol.cmd, ', ') from pol where pol.table_name = e.table_name
                     and pol.cmd in ('SELECT', 'ALL') and pol.policy_name not in (e.old_policy, 'menu_read')), '')
  from expected e
  union all
  select e.table_name, '3 쓰기 정책 수(INFO, 바꾸지 않음)',
         case when (select count(*) from pol where pol.table_name = e.table_name and pol.cmd in ('INSERT', 'UPDATE', 'DELETE')) = e.write_count then 'OK' else 'INFO' end,
         coalesce((select string_agg(pol.policy_name || ':' || pol.cmd, ', ' order by pol.policy_name) from pol
                     where pol.table_name = e.table_name and pol.cmd in ('INSERT', 'UPDATE', 'DELETE')), '(없음)')
  from expected e
  union all
  select '(공통)', '4 menu_permission 함수', case when to_regprocedure('private.menu_permission(text)') is not null then 'OK' else 'FAIL' end, ''
  union all
  select '(공통)', '5 새 함수 menu_any_readable', 'INFO',
         case when to_regprocedure('private.menu_any_readable(text[])') is null then '아직 없음' else '이미 있음' end
  union all
  select '(공통)', '6 같은 패턴의 전체 읽기 정책(대상 밖 표)', 'INFO',
         coalesce((select string_agg(c.relname || '.' || p.polname, ', ' order by c.relname)
                   from pg_catalog.pg_policy p join pg_catalog.pg_class c on c.oid = p.polrelid
                   where c.relnamespace = 'public'::regnamespace and c.relname not in ('projects', 'project_notes', 'project_tooltips', 'performing_projects', 'expected_projects', 'weekly_meta', 'evaluation_types', 'evaluation_roles', 'evaluation_question_categories')
                     and p.polcmd in ('r', '*')
                     and pg_catalog.pg_get_expr(p.polqual, p.polrelid) in ('true', '(auth.role() = ''authenticated''::text)')), '(없음)')
) x
order by 1, 2;
