import { normalizeMenuPermissions, permissionFor, type MenuPermission } from '@/lib/menuConfig'

/**
 * 접근 판정 규칙 — 순수 함수만(DB·쿠키·Next API 없음). 서버 조회는 lib/auth/menuAccess.ts가 하고,
 * 위젯 토큰(lib/widget/token.ts)처럼 쿠키 세션이 없는 경로도 같은 규칙을 쓰도록 여기 모았다.
 *
 * 관리자 판정의 유일한 근거는 DB allowed_users.is_admin이다(RLS private.menu_permission·
 * private.menu_any_readable, RPC private.overtime_is_admin과 같은 근거). 환경변수 ADMIN_EMAILS는
 * 어떤 인증·권한 판정에도 쓰지 않는다 — lib/auth/adminEmailsUsage.test.ts가 고정한다.
 *   allowed_users 행 없음 → 미승인(관리자 아님, 모든 메뉴 none)
 *   is_admin = true        → 승인 + 모든 메뉴 write(menu_permissions 값과 무관)
 *   그 외                  → 승인 + menu_permissions(permissionFor: 키 없으면 write, 무효값은 none)
 */

/** allowed_users에서 판정에 필요한 열 */
export interface AllowedUserRow {
  is_admin?: boolean | null
  menu_permissions?: unknown
}

export interface MenuAccess {
  email: string
  /** DB allowed_users.is_admin(서버가 매 요청 조회) — 클라이언트가 보낸 값은 쓰지 않는다 */
  isAdmin: boolean
  /** allowed_users에 행이 있음 — false면 미승인 사용자 */
  approved: boolean
  /** 메뉴 키별 확정 권한(무효값은 이미 none으로 해석됨). 관리자는 비워 둔다(전부 write) */
  permissions: Record<string, MenuPermission>
}

export type AccessDecisionInput = Pick<MenuAccess, 'isAdmin' | 'approved' | 'permissions'>

/** 세션 이메일 + allowed_users 행(없으면 null) → 접근 정보 */
export function resolveMenuAccess(email: string, row: AllowedUserRow | null | undefined): MenuAccess {
  if (!row) return { email, isAdmin: false, approved: false, permissions: {} }
  const isAdmin = row.is_admin === true
  return {
    email,
    isAdmin,
    approved: true,
    permissions: isAdmin ? {} : normalizeMenuPermissions(row.menu_permissions),
  }
}

/** 순수 판정 — 관리자는 모든 메뉴 write, 미승인은 none, 그 외 menu_permissions(키 없으면 write, 무효값 none) */
export function menuPermissionOf(access: AccessDecisionInput, key: string): MenuPermission {
  if (access.isAdmin) return 'write'
  if (!access.approved) return 'none'
  return permissionFor(access.permissions, key)
}

/** API 판정 — 비로그인(null)·미승인은 false, read는 read·write 허용, write는 write만 */
export function hasMenuPermission(access: AccessDecisionInput | null, key: string, need: 'read' | 'write'): boolean {
  if (!access || !access.approved) return false
  const p = menuPermissionOf(access, key)
  return need === 'write' ? p === 'write' : p !== 'none'
}

/**
 * 미래봇(/api/chat, /api/chat/execute) 권한 — 대화에 프로젝트 List 데이터가 들어가므로 projects 권한만 본다.
 *   none(또는 미승인) → 사용 불가(403), read → 조회형 대화, write → 조회 + 등록·수정 실행.
 *   다른 메뉴 권한(weekly·trip 등)이 있다는 이유로 허용하지 않는다.
 */
export function chatMode(access: AccessDecisionInput | null): MenuPermission {
  if (!access || !access.approved) return 'none'
  return menuPermissionOf(access, 'projects')
}
