/**
 * 대시보드 메뉴 폴더 → 메뉴 권한 키 (lib/menuConfig.ts RESTRICTABLE_MENU_ITEMS, app/sidebar.tsx GROUPS와 같은 키).
 * 각 폴더의 layout.tsx가 requireMenu(이 키)를 부른다 — lib/auth/menuRoutes.test.ts가 폴더·레이아웃·키 일치를 검사한다.
 * 제안서 DB(proposal_db)는 외부 링크라 이 앱 안에 경로가 없다. 홈(/)·위젯(/widget)은 메뉴 권한 대상이 아니다.
 */
export const MENU_ROUTE_KEYS: Readonly<Record<string, string>> = {
  projects: 'projects',
  weekly: 'weekly',
  overtime: 'overtime',            // /overtime, /overtime/dashboard, /overtime/print, /overtime/plan
  'field-overtime': 'field_overtime',
  leave: 'leave',
  engineers: 'engineers',
  sites: 'sites',
  attendance: 'attendance',
  lodging: 'lodging',
  trip: 'trip',
  web: 'web',
  interviews: 'interview_db',
}

/** 메뉴 권한 대상이 아닌 대시보드 폴더 — 관리자 화면은 각 page.tsx가 ADMIN_EMAILS로 따로 막는다 */
export const UNGUARDED_DASHBOARD_DIRS: readonly string[] = ['admin', 'widget', 'no-access']
