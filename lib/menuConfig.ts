/**
 * 사람별 권한을 설정할 수 있는 메뉴 항목 목록.
 * 각 항목의 `key`는 app/sidebar.tsx의 GROUPS 항목에도 그대로 붙어 있다 —
 * 두 곳이 항상 같은 key를 써야 allowed_users.menu_permissions 값이 제대로 매칭된다.
 * href가 없는(준비중) 항목은 어차피 들어갈 페이지가 없으니 권한 대상에서 뺐다.
 */
export interface MenuItemConfig {
  key: string
  label: string
}

/**
 * 항목별 권한 3단계 (allowed_users.menu_permissions jsonb 값):
 *   none  = 사이드바에서 숨김
 *   read  = 페이지는 보이지만 추가/수정/삭제 UI 비활성화
 *   write = 전체 사용 (키가 없을 때의 기본값)
 * 화면(layout requireMenu)·API(서버 확인)·DB(RLS private.menu_permission)가 같은 규칙으로 각각 확인한다
 * — docs/menu-access-control.md.
 */
export type MenuPermission = 'none' | 'read' | 'write'

/** 유효한 저장값 — 이 셋과 정확히 같은 문자열만 인정한다(대소문자·공백 다르면 무효). */
export const MENU_PERMISSION_VALUES: readonly MenuPermission[] = ['none', 'read', 'write']

export const PERMISSION_LABEL: Record<MenuPermission, string> = {
  write: '쓰기',
  read: '읽기',
  none: '숨김',
}

export function isMenuPermission(value: unknown): value is MenuPermission {
  return typeof value === 'string' && (MENU_PERMISSION_VALUES as readonly string[]).includes(value)
}

/**
 * 메뉴 권한 판정 — 이 앱의 유일한 menu_permissions 해석 함수(화면·API·위젯·관리자 화면 공용).
 * DB의 private.menu_permission / private.menu_any_readable
 * (supabase/migration_menu_permission_strict.sql)과 반드시 같은 규칙이다 — lib/auth/permissionRuleSync.test.ts가 고정한다.
 *   menu_permissions 자체가 없음(null) → 키 없음과 같다 → 'write'
 *   객체가 아님(배열·문자열 등)        → 'none' (잘못된 저장값은 거부)
 *   키 없음(값 undefined 포함)          → 'write' (문서화된 기본값 — 새 메뉴가 추가돼도 자동으로 쓰기)
 *   값이 정확히 'none'|'read'|'write'   → 그 값
 *   그 밖의 값('NONE', 'Read', '', null, true 등) → 'none' (모르는 값은 허용하지 않는다)
 * 관리자(allowed_users.is_admin)는 이 함수 전에 lib/auth/accessRules.ts가 'write'로 처리한다.
 */
export function permissionFor(permissions: unknown, key: string): MenuPermission {
  if (permissions === null || permissions === undefined) return 'write'
  if (typeof permissions !== 'object' || Array.isArray(permissions)) return 'none'
  if (!Object.prototype.hasOwnProperty.call(permissions, key)) return 'write'
  const value = (permissions as Record<string, unknown>)[key]
  if (value === undefined) return 'write'   // JSON으로 저장되면 키가 사라지는 값 — DB에서는 "키 없음"
  return isMenuPermission(value) ? value : 'none'
}

export const RESTRICTABLE_MENU_ITEMS: MenuItemConfig[] = [
  { key: 'projects', label: '프로젝트 List' },
  { key: 'weekly', label: '주간/월간보고' },
  { key: 'overtime', label: '연장근무' },
  { key: 'field_overtime', label: '연장근무(실근무)' },
  { key: 'leave', label: '휴가관리' },
  { key: 'engineers', label: '기술인 주소록' },
  { key: 'sites', label: '현장 현황' },
  { key: 'attendance', label: '기술인 출근부' },
  { key: 'lodging', label: '숙박관리' },
  { key: 'trip', label: '출장지원' },
  { key: 'web', label: 'WEB 검색' },
  { key: 'proposal_db', label: '제안서 DB' },
  { key: 'interview_db', label: '면접 DB' },
]

/**
 * DB에서 읽은 menu_permissions(검증 안 된 jsonb)를 메뉴 키별 확정값으로 바꾼다 — 서버에서 한 번 해석해
 * 화면(PermissionsProvider·사이드바)에는 유효한 값만 내려보내기 위함이다. 모든 메뉴 키를 채우므로
 * 클라이언트에서 permissionFor를 다시 불러도 같은 결과다.
 */
export function normalizeMenuPermissions(
  raw: unknown,
  keys: readonly string[] = RESTRICTABLE_MENU_ITEMS.map(m => m.key),
): Record<string, MenuPermission> {
  return Object.fromEntries(keys.map(k => [k, permissionFor(raw, k)]))
}
