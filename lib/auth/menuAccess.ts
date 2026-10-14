import { cache } from 'react'
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import type { MenuPermission } from '@/lib/menuConfig'
import { hasMenuPermission, menuPermissionOf, resolveMenuAccess, type MenuAccess } from './accessRules'

export { chatMode, hasMenuPermission, menuPermissionOf, resolveMenuAccess } from './accessRules'
export type { AllowedUserRow, MenuAccess } from './accessRules'

/**
 * 메뉴·관리자 접근 권한 — 서버 전용(레이아웃·서버 컴포넌트·API 라우트에서만 import).
 *
 * 사이드바에서 메뉴를 숨기는 것은 접근통제가 아니다. 메뉴 폴더마다 있는 layout.tsx가 requireMenu(key)로
 * 화면을 그리기 전에 서버에서 막는다 — none이면 페이지(클라이언트 컴포넌트)가 아예 렌더되지 않으므로
 * 브라우저에서 데이터 요청도 생기지 않는다. read/write 구분(쓰기 버튼 비활성)은 PermissionsProvider,
 * 최종 방어는 각 표의 RLS(private.menu_permission)와 API 라우트의 서버 확인(canUseMenu·getAdminAccess)이다.
 *
 * 판정 규칙(lib/auth/accessRules.ts):
 *   로그인 없음 → /login, allowed_users 행 없음 → /unauthorized(미승인),
 *   allowed_users.is_admin → 전체 write, 그 외 menu_permissions[key](키 없으면 write, 무효값 none).
 *   관리자 근거는 DB is_admin 하나뿐이다 — 환경변수 ADMIN_EMAILS는 판정에 쓰지 않는다.
 * getMenuAccess는 매 요청 DB에서 다시 읽고(React cache로 한 요청 안에서는 한 번만), 클라이언트가 보낸 값은 믿지 않는다.
 *
 * 이메일 대조: 세션 이메일을 소문자·trim해서 allowed_users.email과 정확히 비교한다(기존 레이아웃 규칙 그대로).
 *   DB 정책은 JWT email을 그대로 비교하지만, allowed_users.email은 저장 시 항상 소문자로 넣으므로
 *   Supabase Auth의 (소문자) 이메일에서는 두 방식이 같은 행을 찾는다. 대소문자 정규화 정책 변경은 이번 범위 밖.
 */
export const getMenuAccess = cache(async (): Promise<MenuAccess | null> => {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return null

  // allowed_users는 service role로 읽는다(RLS와 무관하게 정확히 — 기존 레이아웃과 같은 방식).
  // 조회 오류도 행 없음과 같게 미승인으로 본다(실패 시 거부).
  const { data } = await createSupabaseAdminClient()
    .from('allowed_users')
    .select('email, is_admin, menu_permissions')
    .eq('email', user.email.toLowerCase().trim())
    .maybeSingle()
  return resolveMenuAccess(user.email, data)
})

/**
 * 메뉴 폴더 layout.tsx에서 호출 — 권한이 없으면 화면을 그리기 전에 이동시킨다.
 *   로그인 없음 → /login, 미승인 → /unauthorized, 이 메뉴 none → /no-access
 */
export async function requireMenu(key: string): Promise<MenuPermission> {
  const access = await getMenuAccess()
  if (!access) redirect('/login')
  if (!access.approved) redirect('/unauthorized')
  const permission = menuPermissionOf(access, key)
  if (permission === 'none') redirect(`/no-access?menu=${encodeURIComponent(key)}`)
  return permission
}

/** 관리자 화면(app/(dashboard)/admin/**) — 로그인 없음 → /login, 관리자(is_admin) 아님 → /unauthorized */
export async function requireAdminPage(): Promise<MenuAccess> {
  const access = await getMenuAccess()
  if (!access) redirect('/login')
  if (!access.isAdmin) redirect('/unauthorized')
  return access
}

/** 관리자 API — 관리자(allowed_users.is_admin)면 접근 정보, 아니면 null(라우트가 403) */
export async function getAdminAccess(): Promise<MenuAccess | null> {
  const access = await getMenuAccess()
  return access?.isAdmin ? access : null
}

/** 메뉴 API — 이 메뉴에 need 이상 권한이 있는지(비로그인·미승인·부족이면 false → 라우트가 403) */
export async function canUseMenu(key: string, need: 'read' | 'write'): Promise<boolean> {
  return hasMenuPermission(await getMenuAccess(), key, need)
}
