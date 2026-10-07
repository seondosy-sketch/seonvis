import { cache } from 'react'
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { permissionFor, type MenuPermission } from '@/lib/menuConfig'

/**
 * 메뉴 접근 권한 — 서버 전용(레이아웃·서버 컴포넌트에서만 import).
 *
 * 사이드바에서 메뉴를 숨기는 것은 접근통제가 아니다. 메뉴 폴더마다 있는 layout.tsx가 requireMenu(key)로
 * 화면을 그리기 전에 서버에서 막는다 — none이면 페이지(클라이언트 컴포넌트)가 아예 렌더되지 않으므로
 * 브라우저에서 데이터 요청도 생기지 않는다. read/write 구분(쓰기 버튼 비활성)은 기존대로 PermissionsProvider,
 * 최종 방어는 각 표의 RLS(private.menu_permission)와 API 라우트의 서버 확인이다.
 *
 * 판정 규칙은 app/(dashboard)/layout.tsx가 쓰던 것과 같다:
 *   로그인 없음 → /login, ADMIN_EMAILS → 전체 write, allowed_users 행 없음 → /unauthorized(미승인),
 *   그 외 menu_permissions[key](키 없으면 write).
 * getMenuAccess는 React cache로 한 요청 안에서 한 번만 조회한다(대시보드 레이아웃과 메뉴 레이아웃이 함께 쓴다).
 */

export interface MenuAccess {
  email: string
  isAdmin: boolean
  /** allowed_users에 행이 있거나 ADMIN_EMAILS — false면 미승인 사용자 */
  approved: boolean
  permissions: Record<string, MenuPermission>
}

export function adminEmailList(raw: string | undefined = process.env.ADMIN_EMAILS): string[] {
  return (raw ?? '').split(',').map(e => e.trim()).filter(Boolean)
}

/** 순수 판정 — 관리자는 모든 메뉴 write, 미승인은 none, 그 외 menu_permissions(키 없으면 write) */
export function menuPermissionOf(access: Pick<MenuAccess, 'isAdmin' | 'approved' | 'permissions'>, key: string): MenuPermission {
  if (access.isAdmin) return 'write'
  if (!access.approved) return 'none'
  return permissionFor(access.permissions, key)
}

/**
 * 미래봇(/api/chat, /api/chat/execute) 권한 — 대화에 프로젝트 List 데이터가 들어가므로 projects 권한만 본다.
 *   none(또는 미승인) → 사용 불가(403), read → 조회형 대화, write → 조회 + 등록·수정 실행.
 *   다른 메뉴 권한(weekly·trip 등)이 있다는 이유로 허용하지 않는다.
 */
export function chatMode(access: Pick<MenuAccess, 'isAdmin' | 'approved' | 'permissions'> | null): MenuPermission {
  if (!access || !access.approved) return 'none'
  return menuPermissionOf(access, 'projects')
}

export const getMenuAccess = cache(async (): Promise<MenuAccess | null> => {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return null

  const isAdmin = adminEmailList().includes(user.email)
  if (isAdmin) return { email: user.email, isAdmin: true, approved: true, permissions: {} }

  // allowed_users는 service role로 읽는다(RLS와 무관하게 정확히 — 기존 레이아웃과 같은 방식)
  const { data } = await createSupabaseAdminClient()
    .from('allowed_users')
    .select('email, menu_permissions')
    .eq('email', user.email.toLowerCase().trim())
    .maybeSingle()
  return {
    email: user.email,
    isAdmin: false,
    approved: !!data,
    permissions: (data?.menu_permissions ?? {}) as Record<string, MenuPermission>,
  }
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
