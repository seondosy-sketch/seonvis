import { beforeEach, describe, expect, it, vi } from 'vitest'

// requireMenu의 이동(redirect)과 판정을 DB 없이 시험한다 — 세션·allowed_users 조회는 가짜로 바꾼다
const state: { email: string | null; row: { email: string; menu_permissions: Record<string, string> } | null; adminQueries: number } = {
  email: null, row: null, adminQueries: 0,
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
      select: () => ({
        eq: () => ({
          maybeSingle: async () => { state.adminQueries++; return { data: state.row } },
        }),
      }),
    }),
  }),
}))

const { adminEmailList, chatMode, menuPermissionOf, requireMenu } = await import('./menuAccess')

async function outcome(key: string): Promise<string> {
  try { return `ALLOW:${await requireMenu(key)}` } catch (e) { return String((e as Error).message) }
}

beforeEach(() => {
  state.email = null; state.row = null; state.adminQueries = 0
  vi.stubEnv('ADMIN_EMAILS', 'boss@example.com')
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
  it('ADMIN_EMAILS 파싱 — 공백·빈 값 제거', () => {
    expect(adminEmailList(' a@x.com, ,b@x.com ')).toEqual(['a@x.com', 'b@x.com'])
    expect(adminEmailList('')).toEqual([])
    expect(adminEmailList(undefined)).toEqual(['boss@example.com'])  // 인자 없으면 환경변수 ADMIN_EMAILS
  })
})

describe('requireMenu — 직접 URL 접근 차단(화면을 그리기 전에 이동)', () => {
  it('비로그인 → /login', async () => {
    expect(await outcome('projects')).toBe('REDIRECT:/login')
  })
  it('미승인(allowed_users 행 없음) → /unauthorized', async () => {
    state.email = 'stranger@example.com'
    expect(await outcome('projects')).toBe('REDIRECT:/unauthorized')
  })
  it('none → /no-access (페이지가 렌더되지 않으므로 데이터 요청도 없음)', async () => {
    state.email = 'u@example.com'
    state.row = { email: 'u@example.com', menu_permissions: { projects: 'none' } }
    expect(await outcome('projects')).toBe('REDIRECT:/no-access?menu=projects')
  })
  it('read → 허용(read) — 쓰기 버튼은 PermissionsProvider, 쓰기 API는 서버·RLS가 막는다', async () => {
    state.email = 'u@example.com'
    state.row = { email: 'u@example.com', menu_permissions: { leave: 'read' } }
    expect(await outcome('leave')).toBe('ALLOW:read')
  })
  it('write(키 없음 포함) → 허용(write)', async () => {
    state.email = 'u@example.com'
    state.row = { email: 'u@example.com', menu_permissions: { overtime: 'write' } }
    expect(await outcome('overtime')).toBe('ALLOW:write')
    expect(await outcome('sites')).toBe('ALLOW:write')
  })
  it('관리자(ADMIN_EMAILS) → 메뉴 권한과 관계없이 write, allowed_users 조회 없음', async () => {
    state.email = 'boss@example.com'
    expect(await outcome('projects')).toBe('ALLOW:write')
    expect(state.adminQueries).toBe(0)
  })
  it('대소문자 — allowed_users는 소문자로 조회(기존 레이아웃과 같은 규칙)', async () => {
    state.email = 'U@Example.com'
    state.row = { email: 'u@example.com', menu_permissions: { projects: 'none' } }
    expect(await outcome('projects')).toBe('REDIRECT:/no-access?menu=projects')
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
