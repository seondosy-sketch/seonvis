-- 메뉴 권한 무효값 기본 거부 — private.menu_permission(text) · private.menu_any_readable(text[]) 재정의 (forward migration)
--
-- 왜: 지금까지 두 함수는 menu_permissions 값이 'none'이 아니면 모두 허용했다(fail-open).
--   그래서 'NONE', 'Read', '', null 같은 잘못된 저장값이 쓰기/읽기 권한으로 통했다.
-- 새 규칙 (lib/menuConfig.ts permissionFor와 같다 — lib/auth/permissionRuleSync.test.ts가 고정):
--   allowed_users.is_admin              → 'write' (메뉴별 설정과 무관)
--   allowed_users 행 없음(미승인)        → 'none'
--   menu_permissions 자체가 null        → 키 없음과 같다 → 'write'
--   menu_permissions가 객체가 아님      → 'none'
--   키 없음                             → 'write' (문서화된 기본값, 변경 없음)
--   값이 정확히 'none'|'read'|'write'   → 그 값
--   그 밖의 값('NONE', 'Read', '', null, true 등) → 'none'
--
-- 바꾸는 것: 두 함수의 본문만. 함수 이름·인자·반환형·SECURITY DEFINER·STABLE·권한(GRANT)은 그대로이고,
--   search_path는 pg_catalog, pg_temp로 고정하고 모든 이름에 스키마를 붙인다(menu_permission은 원래 search_path = public).
--   이 함수를 쓰는 RLS 정책·RPC는 다시 만들 필요가 없다(정책은 함수 OID를 참조).
-- 적용 순서: supabase/migration_menu_permission_function.sql(원래 menu_permission) 이후 언제든.
--   menu_any_readable은 supabase/migration_shared_project_tables_rls.sql이 만든다 — 그 migration보다 먼저 실행하면
--   이 파일이 함수를 새로 만들고, 나중에 그 migration을 실행해도 같은 본문으로 다시 정의된다(그 파일도 같은 규칙으로 갱신).
-- 재실행 가능(create or replace). 한 트랜잭션.
-- 확인: supabase/verify/menu_permission_strict_postflight.sql   되돌리기: supabase/verify/menu_permission_strict_rollback.sql
-- 개발 DB 동작 시험: supabase/dev/menu_permission_strict_check.sql

begin;

create schema if not exists private;

-- 메뉴 하나의 권한('none' | 'read' | 'write')
create or replace function private.menu_permission(menu_key text)
returns text
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select coalesce(
    (
      select case
               when u.is_admin then 'write'
               when u.menu_permissions is null or pg_catalog.jsonb_typeof(u.menu_permissions) = 'null' then 'write'
               when pg_catalog.jsonb_typeof(u.menu_permissions) <> 'object' then 'none'
               when not (u.menu_permissions ? menu_key) then 'write'
               when pg_catalog.jsonb_typeof(u.menu_permissions -> menu_key) = 'string'
                    and (u.menu_permissions ->> menu_key) in ('none', 'read', 'write') then u.menu_permissions ->> menu_key
               else 'none'
             end
      from public.allowed_users u
      where u.email = (auth.jwt() ->> 'email')
    ),
    'none'
  )
$$;

revoke all on function private.menu_permission(text) from public;
grant execute on function private.menu_permission(text) to authenticated;

-- 여러 메뉴 중 하나라도 none이 아니면 true (공용 표 읽기 정책용) — 위와 같은 규칙
create or replace function private.menu_any_readable(p_keys text[])
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select coalesce(
    (select u.is_admin
            or exists (select 1 from pg_catalog.unnest(p_keys) as k(menu_key)
                       where case
                               when u.is_admin then 'write'
                               when u.menu_permissions is null or pg_catalog.jsonb_typeof(u.menu_permissions) = 'null' then 'write'
                               when pg_catalog.jsonb_typeof(u.menu_permissions) <> 'object' then 'none'
                               when not (u.menu_permissions ? k.menu_key) then 'write'
                               when pg_catalog.jsonb_typeof(u.menu_permissions -> k.menu_key) = 'string'
                                    and (u.menu_permissions ->> k.menu_key) in ('none', 'read', 'write') then u.menu_permissions ->> k.menu_key
                               else 'none'
                             end <> 'none')
       from public.allowed_users u
      where u.email = (auth.jwt() ->> 'email')),
    false)
$$;
revoke all on function private.menu_any_readable(text[]) from public, anon, authenticated, service_role;
grant execute on function private.menu_any_readable(text[]) to authenticated;   -- 정책은 호출자 권한으로 함수를 실행한다

commit;

-- 확인 (읽기만): 두 함수의 설정
select p.proname::text as function_name, p.prosecdef as security_definer, p.provolatile::text as volatility,
       array_to_string(p.proconfig, ';') as config
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'private' and p.proname in ('menu_permission', 'menu_any_readable')
order by 1;
