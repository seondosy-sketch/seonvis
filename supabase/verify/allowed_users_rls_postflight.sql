-- allowed_users RLS 수정 확인 — 읽기 전용(SELECT 한 문장). 결과: check_name / verdict / detail (개인정보 없음)
with pol as (
  select p.polname::text as name,
         case p.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT' when 'w' then 'UPDATE' when 'd' then 'DELETE' else 'ALL' end as cmd,
         array(select r.rolname::text from pg_catalog.pg_roles r where r.oid = any (p.polroles) order by 1) as roles,
         (0 = any (p.polroles)) as to_public,
         pg_catalog.pg_get_expr(p.polqual, p.polrelid) as qual,
         pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) as withcheck
  from pg_catalog.pg_policy p
  where p.polrelid = 'public.allowed_users'::regclass
),
fn as (
  select p.oid, p.prosecdef, p.proconfig, p.provolatile, pg_catalog.pg_get_userbyid(p.proowner)::text as owner, p.proacl
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname = 'allowed_users_is_admin'
)
select * from (
  select 'rls_enabled' as check_name,
         case when c.relrowsecurity then 'OK' else 'FAIL' end as verdict,
         'enabled=' || c.relrowsecurity::text || ' forced=' || c.relforcerowsecurity::text as detail
  from pg_catalog.pg_class c where c.oid = 'public.allowed_users'::regclass
  union all
  select 'policy_count', case when (select count(*) from pol) = 2 then 'OK' else 'FAIL' end, (select count(*) from pol)::text || '개'
  union all
  select 'policy:' || name,
         case when cmd = 'SELECT' and roles = array['authenticated'] and not to_public and qual !~* '\mfrom\s+(public\.)?allowed_users\M' then 'OK' else 'FAIL' end,
         cmd || ' to ' || case when to_public then 'public' else array_to_string(roles, ',') end || ' USING ' || coalesce(qual, '-')
  from pol
  union all
  select 'no_write_policy', case when not exists (select 1 from pol where cmd <> 'SELECT') then 'OK' else 'FAIL' end,
         coalesce((select string_agg(name || ':' || cmd, ', ') from pol where cmd <> 'SELECT'), '쓰기 정책 없음 — 쓰기는 service role(관리자 API)만')
  union all
  select 'fn_exists', case when exists (select 1 from fn) then 'OK' else 'FAIL' end, 'private.allowed_users_is_admin()'
  union all
  select 'fn_security_definer', case when (select prosecdef from fn) then 'OK' else 'FAIL' end, coalesce((select prosecdef::text from fn), '-')
  union all
  select 'fn_search_path', case when (select array_to_string(proconfig, ';') from fn) like 'search_path=%' then 'OK' else 'FAIL' end,
         coalesce((select array_to_string(proconfig, ';') from fn), '(없음)')
  union all
  select 'fn_owner_and_volatility', 'INFO', coalesce((select 'owner=' || owner || ' volatile=' || provolatile::text from fn), '-')
  union all
  select 'fn_acl', 'INFO', coalesce((select array_to_string(proacl, ',') from fn), '(default = PUBLIC 실행 가능)')
  union all
  select 'fn_execute:' || r,
         case when r = 'authenticated' then (case when pg_catalog.has_function_privilege(r, (select oid from fn), 'EXECUTE') then 'OK' else 'FAIL' end)
              else (case when pg_catalog.has_function_privilege(r, (select oid from fn), 'EXECUTE') then 'FAIL' else 'OK' end) end,
         'EXECUTE=' || pg_catalog.has_function_privilege(r, (select oid from fn), 'EXECUTE')::text
           || case when r = 'authenticated' then ' (정책 평가에 필요 — 정책은 호출자 권한으로 함수를 실행한다)' else '' end
  from unnest(array['anon', 'authenticated', 'service_role']) r
  where exists (select 1 from fn)
  union all
  select 'fn_public_acl', case when (select proacl is null or array_to_string(proacl, ',') ~ '(^|,)=X/' from fn) then 'FAIL' else 'OK' end, 'PUBLIC 실행권한 없음이어야 OK'
  union all
  select 'private_schema_usage:' || r,
         case when pg_catalog.has_schema_privilege(r, 'private', 'USAGE') then 'FAIL' else 'OK' end,
         'USAGE=' || pg_catalog.has_schema_privilege(r, 'private', 'USAGE')::text || ' (없으면 SQL·REST로 함수를 이름으로 직접 부를 수 없다)'
  from unnest(array['anon', 'authenticated', 'service_role']) r
  union all
  select 'menu_permission_unchanged', 'INFO',
         (select 'secdef=' || p.prosecdef::text || ' config=' || coalesce(array_to_string(p.proconfig, ';'), '-')
          from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'private' and p.proname = 'menu_permission')
) x
order by check_name;
