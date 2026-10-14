-- 메뉴 권한 무효값 기본 거부 되돌리기 — 두 함수를 migration_menu_permission_strict.sql 이전 본문으로 그대로 복원한다.
--   private.menu_permission(text)    ← supabase/migration_menu_permission_function.sql 본문(search_path = public, 키 없으면 write,
--                                       값이 무엇이든 그대로 돌려줌 — 무효값 허용)
--   private.menu_any_readable(text[]) ← supabase/migration_shared_project_tables_rls.sql 이전 본문(coalesce(값, 'write') <> 'none')
--     이 함수가 지금 없으면(공용 표 보정을 적용하지 않았거나 되돌림) 만들지 않는다.
-- 권한(GRANT)은 원래 파일과 같은 문장으로 다시 맞춘다. 정책·데이터는 건드리지 않는다. 한 트랜잭션.
-- 주의: 이후 migration_shared_project_tables_rls.sql을 다시 실행하면 menu_any_readable은 새 규칙(무효값 거부)으로 다시 정의된다.
-- 다시 적용하려면: supabase/migration_menu_permission_strict.sql (그대로 재실행 가능)
begin;

create or replace function private.menu_permission(menu_key text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select case
               when u.is_admin then 'write'
               else coalesce(u.menu_permissions ->> menu_key, 'write')
             end
      from allowed_users u
      where u.email = (auth.jwt() ->> 'email')
    ),
    'none'
  )
$$;

revoke all on function private.menu_permission(text) from public;
grant execute on function private.menu_permission(text) to authenticated;

do $do$
begin
  if to_regprocedure('private.menu_any_readable(text[])') is null then
    raise notice 'private.menu_any_readable 없음 — 복원하지 않는다';
    return;
  end if;
  execute $sql$
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
                       where coalesce(u.menu_permissions ->> k.menu_key, 'write') <> 'none')
       from public.allowed_users u
      where u.email = (auth.jwt() ->> 'email')),
    false)
$$
  $sql$;
  revoke all on function private.menu_any_readable(text[]) from public, anon, authenticated, service_role;
  grant execute on function private.menu_any_readable(text[]) to authenticated;
end $do$;

commit;

-- 확인 (읽기만) — 되돌린 뒤에는 두 함수 모두 예전 규칙(키 없음·무효값 → write)이어야 한다
select 'rollback:' || p.proname::text as check_name,
       case when p.prosrc ~ 'coalesce\(u\.menu_permissions ->> (k\.)?menu_key, ''write''\)' then 'OK'
            else 'FAIL' end as status,
       case when p.prosrc ~ 'coalesce\(u\.menu_permissions ->> (k\.)?menu_key, ''write''\)' then '예전 규칙(무효값 허용)으로 복원됨'
            when p.prosrc ~ 'else ''none''' then '아직 새 규칙(무효값 거부)'
            else '알 수 없는 본문' end || ' / search_path=' || coalesce(array_to_string(p.proconfig, ';'), '') as detail
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'private' and p.proname in ('menu_permission', 'menu_any_readable')
order by 1;
