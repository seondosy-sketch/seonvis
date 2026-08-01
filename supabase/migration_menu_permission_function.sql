-- 공용 RLS 헬퍼 — allowed_users.menu_permissions(none/read/write)를 Postgres RLS 정책에서
-- 직접 참조하기 위한 함수. 지금까지는 "권한 제어는 layout(UI) 레벨"이었고 RLS는
-- auth.role() = 'authenticated'만 확인했다 — 즉 menu_permissions로 'none'/'read'를 부여받은
-- 사용자도 브라우저 콘솔에서 supabase 클라이언트를 직접 호출하면 그대로 읽기/쓰기가 가능했다.
-- 이 함수를 참조하도록 테이블별 RLS 정책을 바꾸면, 어떤 경로로 요청이 오든(브라우저, curl 등)
-- Postgres가 최종 결정권을 가지게 된다. lodging(lodging_hotels/lodging_records)에 먼저 적용
-- (파일럿) — 검증 후 다른 테이블에도 같은 패턴으로 확장 예정.
--
-- private 스키마에 둔 이유: PostgREST는 public 스키마의 함수를 전부 /rest/v1/rpc/*로 자동
-- 노출한다. 이 함수는 RLS 정책 내부에서만 쓰는 헬퍼라 외부에서 직접 호출될 이유가 없고,
-- Supabase 어드바이저도 이를 경고한다(anon_security_definer_function_executable /
-- authenticated_security_definer_function_executable). private 스키마는 PostgREST 노출 대상이
-- 아니므로 여기 두면 RPC로는 호출이 막히고, 정책 안에서의 호출(정책 소유자 권한으로 평가)은
-- 영향받지 않는다.
--
-- security definer로 만든 이유: allowed_users에는 이미 자기참조 정책(admins_read_all)이 있어,
-- authenticated 권한으로 이 함수 안에서 allowed_users를 그대로 조회하면
-- "infinite recursion detected in policy for relation allowed_users"(42P17)가 난다.
-- security definer + 테이블 소유자 실행으로 allowed_users의 RLS 자체를 우회해 재귀를 끊는다.
--
-- 기본값(menu_permissions에 키가 없을 때 'write')은 lib/menuConfig.ts의 permissionFor()와
-- 반드시 일치시킨다 — 어긋나면 관리자가 UI에서 본 권한과 실제 DB 단 허용 범위가 달라진다.
-- allowed_users에 해당 email 행 자체가 없는 경우(미승인 사용자)는 'none'으로 안전하게 거부한다.

create schema if not exists private;

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
