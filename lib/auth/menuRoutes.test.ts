import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { RESTRICTABLE_MENU_ITEMS } from '@/lib/menuConfig'
import { MENU_ROUTE_KEYS, UNGUARDED_DASHBOARD_DIRS } from './menuRoutes'

// 직접 URL 접근 회귀 방지 — 메뉴 화면 폴더마다 서버 layout.tsx가 requireMenu(맞는 키)를 부르는지 파일로 검사한다.
// 사이드바 숨김(SidebarContainer)만으로는 접근통제가 되지 않는다.
const root = path.resolve(__dirname, '..', '..')
const dashboard = path.join(root, 'app', '(dashboard)')
const read = (p: string) => readFileSync(p, 'utf8')

const dashboardDirs = readdirSync(dashboard, { withFileTypes: true })
  .filter(d => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('('))
  .map(d => d.name)

describe('메뉴 경로 가드', () => {
  it('대시보드의 모든 화면 폴더는 메뉴 가드 대상이거나 명시적 예외다', () => {
    const unknown = dashboardDirs.filter(d => !(d in MENU_ROUTE_KEYS) && !UNGUARDED_DASHBOARD_DIRS.includes(d))
    expect(unknown).toEqual([])
  })

  it.each(Object.entries(MENU_ROUTE_KEYS))('/%s 는 layout.tsx에서 requireMenu(%j)로 막는다', (dir, key) => {
    const layout = path.join(dashboard, dir, 'layout.tsx')
    expect(existsSync(layout)).toBe(true)
    const src = read(layout)
    expect(src).toContain("from '@/lib/auth/menuAccess'")
    expect(src).toContain(`await requireMenu('${key}')`)
    expect(src).not.toMatch(/^['"]use client['"]/m)   // 서버 컴포넌트여야 화면 렌더 전에 막는다
  })

  it('가드 키는 모두 권한 설정 가능한 메뉴 키다', () => {
    const keys = new Set(RESTRICTABLE_MENU_ITEMS.map(m => m.key))
    expect(Object.values(MENU_ROUTE_KEYS).filter(k => !keys.has(k))).toEqual([])
  })

  it('사이드바의 내부 링크(href "/…")와 키가 가드 표와 같다', () => {
    const sidebar = read(path.join(root, 'app', 'sidebar.tsx'))
    const pairs = [...sidebar.matchAll(/key: '([a-z_]+)', href: '\/([a-z-]+)'/g)].map(m => [m[2], m[1]])
    expect(pairs.length).toBeGreaterThan(5)
    for (const [dir, key] of pairs) expect(MENU_ROUTE_KEYS[dir]).toBe(key)
  })

  it('연장근무 하위(dashboard·print·plan)는 /overtime 레이아웃 아래에 있어 같은 가드를 받는다', () => {
    for (const sub of ['dashboard', 'print', 'plan']) {
      expect(existsSync(path.join(dashboard, 'overtime', sub, 'page.tsx'))).toBe(true)
    }
    // plan은 기존 화면 권한(useMenuPermission('overtime'))도 그대로
    expect(read(path.join(dashboard, 'overtime', 'plan', 'page.tsx'))).toContain("useMenuPermission('overtime')")
  })

  it('관리자 화면은 서버에서 ADMIN_EMAILS로 막는다', () => {
    for (const p of ['admin/page.tsx', 'admin/calendar/page.tsx']) {
      const src = read(path.join(dashboard, p))
      expect(src).toContain("redirect('/unauthorized')")
      expect(src).toMatch(/ADMIN_EMAILS/)
    }
  })
})

describe('데이터 API의 서버 권한 확인 (RLS만 최종 방어선으로 두지 않는다)', () => {
  const api = (p: string) => read(path.join(root, 'app', 'api', p, 'route.ts'))
  it.each([
    ['projects/export', "'projects'"],
    ['attendance/export', "'attendance'"],
    ['lodging/export', "'lodging'"],
    ['interviews/import', "'interview_db'"],
    ['overtime/sync-projects', "'overtime'"],
  ])('%s — 메뉴 권한(%s)을 서버에서 확인', (p, key) => {
    const src = api(p)
    expect(src).toMatch(/permissionFor\(/)
    expect(src).toContain(key)
    expect(src).toMatch(/status: 403/)
    // ADMIN_EMAILS 관리자는 화면과 같게 허용(allowed_users.is_admin만 보던 불일치 수정)
    if (p !== 'overtime/sync-projects') expect(src).toContain('adminEmailList().includes(user.email)')
  })
  it('chat — 프로젝트 List none이면 403(대화에 프로젝트 전체가 들어간다)', () => {
    const src = api('chat')
    expect(src).toContain("chatMode(await getMenuAccess()) === 'none'")
    expect(src).toMatch(/status: 403/)
  })
  it('chat/execute — 프로젝트 등록·수정은 프로젝트 List write만', () => {
    const src = api('chat/execute')
    expect(src).toContain("chatMode(await getMenuAccess()) !== 'write'")
    expect(src).toMatch(/status: 403/)
    // 권한 확인이 DB 쓰기보다 먼저
    expect(src.indexOf('getMenuAccess()')).toBeLessThan(src.indexOf(".from('projects')"))
  })
  it('관리자 API는 ADMIN_EMAILS로 403', () => {
    for (const p of ['admin/users', 'admin/access-requests']) {
      const src = api(p)
      expect(src).toMatch(/ADMIN_EMAILS/)
      expect(src).toMatch(/status: 403/)
    }
  })
})
