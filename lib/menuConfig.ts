/**
 * 사이드바에서 사람별로 숨길 수 있는 메뉴 항목 목록.
 * 각 항목의 `key`는 app/sidebar.tsx의 GROUPS 항목에도 그대로 붙어 있다 —
 * 두 곳이 항상 같은 key를 써야 allowed_users.hidden_menu_items 값이 제대로 매칭된다.
 * href가 없는(준비중) 항목은 어차피 들어갈 페이지가 없으니 권한 대상에서 뺐다.
 */
export interface MenuItemConfig {
  key: string
  label: string
}

export const RESTRICTABLE_MENU_ITEMS: MenuItemConfig[] = [
  { key: 'projects', label: '프로젝트 List' },
  { key: 'weekly', label: '주간/월간보고' },
  { key: 'overtime', label: '연장근무' },
  { key: 'trip', label: '출장지원' },
  { key: 'web', label: 'WEB 검색' },
  { key: 'proposal_db', label: '제안서 DB' },
]
