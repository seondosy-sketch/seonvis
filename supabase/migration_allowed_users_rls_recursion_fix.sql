-- allowed_users RLS 무한 재귀(42P17) 수정
--
-- ⚠ 개발용 Supabase(zaot…iyas)에서 먼저 검증한다. 운영 적용은 별도 승인.
--
-- 원인 (supabase/migration_allowed_users.sql, 운영 catalog 2026-10-03에도 같은 정의 존재)
--   policy "admins_read_all" USING (EXISTS (SELECT 1 FROM allowed_users WHERE email = jwt email AND is_admin))
--   → 정책 안의 하위 조회가 같은 테이블 allowed_users를 다시 읽고, 그 조회에 다시 같은 정책이 붙는다.
--   PostgreSQL이 이를 감지해 authenticated의 SELECT 전체를 "infinite recursion detected in policy" 로 거부한다
--   (자기 행만 읽으려 해도 실패 — 두 정책이 PERMISSIVE로 OR 결합되므로 admins_read_all도 항상 평가된다).
--   지금 화면이 멀쩡한 이유: 앱은 allowed_users를 전부 service role(서버)로 읽고(RLS 우회), 다른 표의 정책은
--   SECURITY DEFINER 함수(private.menu_permission 등)로 우회해 읽기 때문. 브라우저·authenticated 직접 조회만 깨져 있다.
--
-- 수정
--   관리자 판정을 SECURITY DEFINER 함수 private.allowed_users_is_admin()로 옮긴다. 함수는 테이블 소유자 권한으로
--   allowed_users를 읽으므로(소유자는 RLS 미적용, FORCE RLS 아님) 정책이 자기 자신을 다시 평가하지 않는다.
--   - 일반 사용자: 자기 행(jwt email)만 읽음 — users_read_own (그대로, 대상 역할만 authenticated로 좁힘)
--   - 관리자(allowed_users.is_admin): 전체 읽기 — admins_read_all (함수 사용)
--   - 쓰기 정책은 원래도 없다 → 쓰기는 service role(관리자 API)만. 이 동작은 바꾸지 않는다.
--   - private.menu_permission 등 기존 함수·다른 표 정책은 건드리지 않는다.
--   - 함수: STABLE, search_path 고정(public, pg_temp — 이름은 모두 스키마를 붙여 쓴다), PUBLIC·anon·service_role 실행권한 회수,
--     정책 평가에 필요한 authenticated만 EXECUTE. private 스키마 USAGE는 새로 주지 않는다(정책은 OID로 함수를 부른다).
-- 되돌리기: supabase/verify/allowed_users_rls_recursion_rollback.sql
-- 확인: supabase/dev/allowed_users_rls_check.sql (데이터를 남기지 않는 시험)

begin;

create or replace function private.allowed_users_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select u.is_admin from public.allowed_users u where u.email = (auth.jwt() ->> 'email')),
    false
  )
$$;

revoke all on function private.allowed_users_is_admin() from public, anon, authenticated, service_role;
grant execute on function private.allowed_users_is_admin() to authenticated;

drop policy if exists "admins_read_all" on public.allowed_users;
create policy "admins_read_all" on public.allowed_users
  for select to authenticated
  using (private.allowed_users_is_admin());

drop policy if exists "users_read_own" on public.allowed_users;
create policy "users_read_own" on public.allowed_users
  for select to authenticated
  using ((auth.jwt() ->> 'email') = email);

commit;

-- 확인 (읽기만)
select pol.polname::text as policy_name,
       pg_catalog.pg_get_expr(pol.polqual, pol.polrelid) as using_expr,
       array(select r.rolname::text from pg_catalog.pg_roles r where r.oid = any (pol.polroles)) as roles
from pg_catalog.pg_policy pol
where pol.polrelid = 'public.allowed_users'::regclass
order by 1;
