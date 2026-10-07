-- allowed_users RLS 수정(migration_allowed_users_rls_recursion_fix.sql) 되돌리기
-- 원래 정의(supabase/migration_allowed_users.sql)로 정책 두 개를 복원하고 새 함수를 지운다. 데이터는 건드리지 않는다.
-- ⚠ 복원하면 authenticated 직접 조회의 무한 재귀(42P17)도 다시 생긴다(원래 상태).
begin;

drop policy if exists "admins_read_all" on public.allowed_users;
create policy "admins_read_all" on public.allowed_users
  for select using (
    exists (
      select 1 from allowed_users
      where email = auth.jwt() ->> 'email' and is_admin = true
    )
  );

drop policy if exists "users_read_own" on public.allowed_users;
create policy "users_read_own" on public.allowed_users
  for select using (auth.jwt() ->> 'email' = email);

drop function if exists private.allowed_users_is_admin();

commit;

select pol.polname::text as policy_name, pg_catalog.pg_get_expr(pol.polqual, pol.polrelid) as using_expr
from pg_catalog.pg_policy pol
where pol.polrelid = 'public.allowed_users'::regclass
order by 1;
