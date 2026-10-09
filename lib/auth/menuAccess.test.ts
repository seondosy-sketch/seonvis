import { beforeEach, describe, expect, it, vi } from 'vitest'

// requireMenu·requireAdminPage·getAdminAccess·canUseMenu의 이동(redirect)과 판정을 DB 없이 시험한다
// — 세션·allowed_users 조회는 가짜로 바꾼다(주입한 행이 곧 "DB 값").
type Row = { email: string; is_admin?: boolean; menu_permissions: unknown }
const state: { email: string | null; row: Row | null; adminQueries: number; lastSelect: string; lastEq: string } = {
  email: null, row: null, adminQueries: 0, lastSelect: '', lastEq: '',
}

vi.mock('next/navigation', () => ({
  redirect: (to: string) => { throw new Error(`REDIRECT:${to}`) },
}))
vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.email ? { email: state.email } : null } }) },
  }),
}))
vi.mock('@/lib/supabase-admin', () => ({
  createSupabaseAdminClient: () => ({
    from: () => ({
      select: (cols: string) => {
        state.lastSelect = cols
        return {
          eq: (_col: string, value: string) => {
            state.lastEq = value
            return { maybeSingle: async () => { state.adminQueries++; return { data: state.row } } }
          },
        }
      },
    }),
  }),
}))

const { canUseMenu, chatMode, getAdminAccess, getMenuAccess, menuPermissionOf, requireAdminPage, requireMenu } = await import('./menuAccess')

async function outcome(key: string): Promise<string> {
  try { return `ALLOW:${await requireMenu(key)}` } catch (e) { return String((e as Error).message) }
}
async function adminPage(): Promise<string> {
  try { await requireAdminPage(); return 'ALLOW' } catch (e) { return String((e as Error).message) }
}

const ALL_NONE = {
  projects: 'none', weekly: 'none', overtime: 'none', field_overtime: 'none', leave: 'none', engineers: 'none', sites: 'none',
  attendance: 'none', lodging: 'none', trip: 'none', web: 'none', proposal_db: 'none', interview_db: 'none',
}

beforeEach(() => {
  state.email = null; state.row = null; state.adminQueries = 0; state.lastSelect = ''; state.lastEq = ''
  // 시나리오 2·3에서 "ADMIN_EMAILS에만 있는" 계정을 만들기 위해 설정해 둔다 — 판정에는 쓰이지 않아야 한다
  vi.stubEnv('ADMIN_EMAILS', 'boss@example.com,envonly@example.com')
})

describe('menuPermissionOf — 순수 판정', () => {
  it('관리자는 모든 메뉴 write', () => {
    expect(menuPermissionOf({ isAdmin: true, approved: true, permissions: { projects: 'none' } }, 'projects')).toBe('write')
  })
  it('미승인은 none', () => {
    expect(menuPermissionOf({ isAdmin: false, approved: false, permissions: {} }, 'projects')).toBe('none')
  })
  it('키가 없으면 write(기존 permissionFor 기본값), 있으면 그 값', () => {
    const a = { isAdmin: false, approved: true, permissions: { projects: 'none' as const, leave: 'read' as const } }
    expect(menuPermissionOf(a, 'projects')).toBe('none')
    expect(menuPermissionOf(a, 'leave')).toBe('read')
    expect(menuPermissionOf(a, 'overtime')).toBe('write')
  })
})

describe('관리자 판정 = DB allowed_users.is_admin (ADMIN_EMAILS 무시) — 화면·API 시나리오', () => {
  it('시나리오 1: is_admin=true + 모든 메뉴 none → 화면 전부 write, API 쓰기 허용, 관리자 화면·API 허용', async () => {
    state.email = 'admin@example.com'
    state.row = { email: 'admin@example.com', is_admin: true, menu_permissions: ALL_NONE }
    for (const key of Object.keys(ALL_NONE)) expect(await outcome(key)).toBe('ALLOW:write')
    expect(await canUseMenu('projects', 'write')).toBe(true)
    expect(await canUseMenu('overtime', 'write')).toBe(true)
    expect(await canUseMenu('interview_db', 'write')).toBe(true)
    expect(await adminPage()).toBe('ALLOW')
    expect((await getAdminAccess())?.isAdmin).toBe(true)
    expect(chatMode(await getMenuAccess())).toBe('write')
  })

  it('시나리오 2: is_admin=false + ADMIN_EMAILS에만 있음 → 일반 사용자(menu_permissions 적용), 관리자 아님', async () => {
    state.email = 'envonly@example.com'
    state.row = { email: 'envonly@example.com', is_admin: false, menu_permissions: { projects: 'none', leave: 'read' } }
    expect(await outcome('projects')).toBe('REDIRECT:/no-access?menu=projects')
    expect(await outcome('leave')).toBe('ALLOW:read')
    expect(await outcome('sites')).toBe('ALLOW:write')
    expect(await canUseMenu('projects', 'read')).toBe(false)
    expect(await canUseMenu('leave', 'write')).toBe(false)
    expect(await adminPage()).toBe('REDIRECT:/unauthorized')
    expect(await getAdminAccess()).toBeNull()
    expect((await getMenuAccess())?.isAdmin).toBe(false)
  })

  it('시나리오 3: allowed_users 행 없음 + ADMIN_EMAILS에 있음 → 미승인', async () => {
    state.email = 'boss@example.com'
    state.row = null
    expect(await outcome('projects')).toBe('REDIRECT:/unauthorized')
    expect(await canUseMenu('projects', 'read')).toBe(false)
    expect(await adminPage()).toBe('REDIRECT:/unauthorized')
    expect(await getAdminAccess()).toBeNull()
    expect(await getMenuAccess()).toMatchObject({ approved: false, isAdmin: false })
    expect(chatMode(await getMenuAccess())).toBe('none')
  })

  it('시나리오 4: 일반 사용자 projects read → 화면 read, API 읽기만', async () => {
    state.email = 'u@example.com'
    state.row = { email: 'u@example.com', is_admin: false, menu_permissions: { projects: 'read' } }
    expect(await outcome('projects')).toBe('ALLOW:read')
    expect(await canUseMenu('projects', 'read')).toBe(true)
    expect(await canUseMenu('projects', 'write')).toBe(false)
    expect(chatMode(await getMenuAccess())).toBe('read')
  })

  it('시나리오 5: 일반 사용자 projects write → 화면·API 쓰기', async () => {
    state.email = 'u@example.com'
    state.row = { email: 'u@example.com', is_admin: false, menu_permissions: { projects: 'write' } }
    expect(await outcome('projects')).toBe('ALLOW:write')
    expect(await canUseMenu('projects', 'write')).toBe(true)
    expect(await adminPage()).toBe('REDIRECT:/unauthorized')
  })

  it('시나리오 6: 일반 사용자 overtime write → 연장근무 화면·API 쓰기, 다른 메뉴 none은 그대로', async () => {
    state.email = 'u@example.com'
    state.row = { email: 'u@example.com', is_admin: false, menu_permissions: { ...ALL_NONE, overtime: 'write' } }
    expect(await outcome('overtime')).toBe('ALLOW:write')
    expect(await canUseMenu('overtime', 'write')).toBe(true)
    expect(await outcome('projects')).toBe('REDIRECT:/no-access?menu=projects')
    expect(await canUseMenu('projects', 'read')).toBe(false)
  })

  it('시나리오 7: 비로그인 → /login, API 거부, DB 조회 없음', async () => {
    expect(await outcome('projects')).toBe('REDIRECT:/login')
    expect(await adminPage()).toBe('REDIRECT:/login')
    expect(await canUseMenu('projects', 'read')).toBe(false)
    expect(await getAdminAccess()).toBeNull()
    expect(state.adminQueries).toBe(0)
  })

  it('is_admin은 매 호출 DB에서 읽는다(is_admin 열을 조회, 캐시된 클라이언트 값 없음)', async () => {
    state.email = 'admin@example.com'
    state.row = { email: 'admin@example.com', is_admin: true, menu_permissions: {} }
    expect(await canUseMenu('projects', 'write')).toBe(true)
    state.row = { email: 'admin@example.com', is_admin: false, menu_permissions: { projects: 'none' } }   // DB에서 관리자 해제
    expect(await canUseMenu('projects', 'write')).toBe(false)
    expect(state.lastSelect).toContain('is_admin')
    expect(state.adminQueries).toBe(2)
  })

  it('is_admin이 true가 아니면(null·문자열 등) 관리자가 아니다', async () => {
    state.email = 'u@example.com'
    state.row = { email: 'u@example.com', is_admin: 'true' as unknown as boolean, menu_permissions: { projects: 'none' } }
    expect(await getAdminAccess()).toBeNull()
    expect(await outcome('projects')).toBe('REDIRECT:/no-access?menu=projects')
  })
})

describe('무효 권한값은 기본 거부', () => {
  it.each(['NONE', 'Read', '', ' read', 'admin', null, true, 1, { v: 'write' }])('저장값 %j → none(/no-access, API 거부)', async (bad) => {
    state.email = 'u@example.com'
    state.row = { email: 'u@example.com', is_admin: false, menu_permissions: { projects: bad } }
    expect(await outcome('projects')).toBe('REDIRECT:/no-access?menu=projects')
    expect(await canUseMenu('projects', 'read')).toBe(false)
  })
  it('menu_permissions가 객체가 아니면 모든 메뉴 none', async () => {
    state.email = 'u@example.com'
    state.row = { email: 'u@example.com', is_admin: false, menu_permissions: ['projects'] }
    expect(await outcome('projects')).toBe('REDIRECT:/no-access?menu=projects')
    expect(await outcome('weekly')).toBe('REDIRECT:/no-access?menu=weekly')
  })
  it('관리자는 무효값이 있어도 write', async () => {
    state.email = 'admin@example.com'
    state.row = { email: 'admin@example.com', is_admin: true, menu_permissions: { projects: 'NONE' } }
    expect(await outcome('projects')).toBe('ALLOW:write')
  })
  it('화면에 내려가는 permissions는 확정값만(무효값은 none으로 해석됨)', async () => {
    state.email = 'u@example.com'
    state.row = { email: 'u@example.com', is_admin: false, menu_permissions: { projects: 'NONE', leave: 'read' } }
    const access = await getMenuAccess()
    expect(access?.permissions.projects).toBe('none')
    expect(access?.permissions.leave).toBe('read')
    expect(access?.permissions.sites).toBe('write')
  })
})

describe('requireMenu — 직접 URL 접근 차단(화면을 그리기 전에 이동)', () => {
  it('none → /no-access (페이지가 렌더되지 않으므로 데이터 요청도 없음)', async () => {
    state.email = 'u@example.com'
    state.row = { email: 'u@example.com', menu_permissions: { projects: 'none' } }
    expect(await outcome('projects')).toBe('REDIRECT:/no-access?menu=projects')
  })
  it('write(키 없음 포함) → 허용(write)', async () => {
    state.email = 'u@example.com'
    state.row = { email: 'u@example.com', menu_permissions: { overtime: 'write' } }
    expect(await outcome('overtime')).toBe('ALLOW:write')
    expect(await outcome('sites')).toBe('ALLOW:write')
  })
  it('대소문자 — allowed_users는 소문자·trim으로 조회(기존 레이아웃과 같은 규칙, 변경 없음)', async () => {
    state.email = 'U@Example.com'
    state.row = { email: 'u@example.com', menu_permissions: { projects: 'none' } }
    expect(await outcome('projects')).toBe('REDIRECT:/no-access?menu=projects')
    expect(state.lastEq).toBe('u@example.com')
  })
})

describe('chatMode — 미래봇은 프로젝트 List 권한만 본다', () => {
  const user = (permissions: Record<string, 'none' | 'read' | 'write'>) => ({ isAdmin: false, approved: true, permissions })
  it('projects none → 사용 불가(/api/chat 403)', () => {
    expect(chatMode(user({ projects: 'none' }))).toBe('none')
  })
  it('다른 메뉴가 write여도 projects none이면 사용 불가', () => {
    expect(chatMode(user({ projects: 'none', weekly: 'write', trip: 'write', overtime: 'write', interview_db: 'write' }))).toBe('none')
  })
  it('projects read → 조회형 대화만(실행 403)', () => {
    expect(chatMode(user({ projects: 'read' }))).toBe('read')
  })
  it('projects write(키 없음 포함) → 조회 + 실행', () => {
    expect(chatMode(user({ projects: 'write' }))).toBe('write')
    expect(chatMode(user({}))).toBe('write')
  })
  it('관리자 → write, 미승인·비로그인 → none', () => {
    expect(chatMode({ isAdmin: true, approved: true, permissions: { projects: 'none' } })).toBe('write')
    expect(chatMode({ isAdmin: false, approved: false, permissions: {} })).toBe('none')
    expect(chatMode(null)).toBe('none')
  })
})
