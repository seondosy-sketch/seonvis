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
 * 접근 제어가 layout(UI 레벨)에서 이루어지는 기존 방식과 동일하게, 읽기 제한도
 * UI 레벨이다 — 직접 API 호출까지 막는 DB 단 권한(RLS)은 아니다.
 */
export type MenuPermission = 'none' | 'read' | 'write'

export const PERMISSION_LABEL: Record<MenuPermission, string> = {
  write: '쓰기',
  read: '읽기',
  none: '숨김',
}

export function permissionFor(
  permissions: Record<string, MenuPermission> | null | undefined,
  key: string,
): MenuPermission {
  return permissions?.[key] ?? 'write'
}

export const RESTRICTABLE_MENU_ITEMS: MenuItemConfig[] = [
  { key: 'projects', label: '프로젝트 List' },
  { key: 'weekly', label: '주간/월간보고' },
  { key: 'overtime', label: '연장근무' },
  { key: 'leave', label: '휴가관리' },
  { key: 'engineers', label: '기술인 주소록' },
  { key: 'sites', label: '현장 현황' },
  { key: 'attendance', label: '기술인 출퇴근부' },
  { key: 'trip', label: '출장지원' },
  { key: 'web', label: 'WEB 검색' },
  { key: 'proposal_db', label: '제안서 DB' },
]
