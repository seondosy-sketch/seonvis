import { beforeEach, describe, expect, it, vi } from 'vitest'

// 쿠키 세션 밖의 관리자·승인 판정 — 홈 위젯 토큰, 구글 캘린더 연동 가드, 개발용 시험 로그인.
// 모두 DB allowed_users(is_admin) 하나로 판정하고 ADMIN_EMAILS는 무시해야 한다. DB·세션은 가짜(주입한 행)로 바꾼다.
type UserRow = { email: string; is_admin: boolean; menu_permissions: unknown } | null
const db: { sessionEmail: string | null; userRow: UserRow; widgetRow: { email: string; revoked_at: null; last_used_at: string | null } | null; signIns: number } = {
  sessionEmail: null, userRow: null, widgetRow: null, signIns: 0,
}

vi.mock('next/navigation', () => ({
  redirect: (to: string) => { throw new Error(`REDIRECT:${to}`) },
}))
vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: db.sessionEmail ? { email: db.sessionEmail } : null } }),
      signInWithPassword: async () => { db.signIns++; return { data: { session: { access_token: 'fake' } }, error: null } },
    },
  }),
}))
vi.mock('@/lib/supabase-admin', () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      const b: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'is', 'order', 'limit', 'update']) b[m] = () => b
      b.insert = async () => ({ error: null })
      b.maybeSingle = async () => ({
        data: table === 'widget_tokens' ? db.widgetRow : table === 'allowed_users' ? db.userRow : null,
      })
      return b
    },
  }),
}))

const { resolveWidgetToken } = await import('@/lib/widget/token')
const { requireAdmin, requireAllowedUser } = await import('@/lib/googleCalendar/guard')
const testLogin = await import('@/app/api/test-auth/login/route')

beforeEach(() => {
  db.sessionEmail = null; db.userRow = null; db.widgetRow = null; db.signIns = 0
  vi.stubEnv('ADMIN_EMAILS', 'envonly@example.com')
})

describe('홈 위젯 토큰 — 매 요청 DB 판정', () => {
  const token = 'wgt_0123456789abcdef0123456789abcdef'
  it('is_admin=true(메뉴 전부 none) → 관리자', async () => {
    db.widgetRow = { email: 'admin@example.com', revoked_at: null, last_used_at: null }
    db.userRow = { email: 'admin@example.com', is_admin: true, menu_permissions: { weekly: 'none', projects: 'none' } }
    expect(await resolveWidgetToken(token)).toMatchObject({ email: 'admin@example.com', isAdmin: true })
  })
  it('ADMIN_EMAILS에만 있음(is_admin=false) → 일반 사용자, menu_permissions 적용(무효값 none)', async () => {
    db.widgetRow = { email: 'envonly@example.com', revoked_at: null, last_used_at: null }
    db.userRow = { email: 'envonly@example.com', is_admin: false, menu_permissions: { weekly: 'none', projects: 'NONE' } }
    const id = await resolveWidgetToken(token)
    expect(id?.isAdmin).toBe(false)
    expect(id?.menuPermissions.weekly).toBe('none')
    expect(id?.menuPermissions.projects).toBe('none')
  })
  it('allowed_users 행 없음(ADMIN_EMAILS에 있어도) → 거부(null)', async () => {
    db.widgetRow = { email: 'envonly@example.com', revoked_at: null, last_used_at: null }
    db.userRow = null
    expect(await resolveWidgetToken(token)).toBeNull()
  })
})

describe('구글 캘린더 연동 가드', () => {
  it('is_admin=true → 관리자 기능 허용', async () => {
    db.sessionEmail = 'admin@example.com'
    db.userRow = { email: 'admin@example.com', is_admin: true, menu_permissions: {} }
    expect(await requireAdmin()).toBe('admin@example.com')
    expect(await requireAllowedUser()).toBe('admin@example.com')
  })
  it('ADMIN_EMAILS에만 있음(is_admin=false) → 관리자 기능 거부, 승인 사용자 기능만', async () => {
    db.sessionEmail = 'envonly@example.com'
    db.userRow = { email: 'envonly@example.com', is_admin: false, menu_permissions: {} }
    expect(await requireAdmin()).toBeNull()
    expect(await requireAllowedUser()).toBe('envonly@example.com')
  })
  it('행 없음(ADMIN_EMAILS에 있어도) → 둘 다 거부', async () => {
    db.sessionEmail = 'envonly@example.com'
    expect(await requireAdmin()).toBeNull()
    expect(await requireAllowedUser()).toBeNull()
  })
  it('비로그인 → 거부', async () => {
    expect(await requireAdmin()).toBeNull()
    expect(await requireAllowedUser()).toBeNull()
  })
})

describe('개발용 시험 로그인(/api/test-auth/login) — 승인·관리자 판정', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('VERCEL_ENV', '')
    vi.stubEnv('TEST_AUTH_ENABLED', 'true')
    vi.stubEnv('TEST_AUTH_EMAIL', 'envonly@example.com')
    vi.stubEnv('TEST_AUTH_PASSWORD', 'unit-test-placeholder')   // 가짜 값 — 로그인은 위 mock이 처리
  })
  const call = () => testLogin.POST(new Request('http://localhost/api/test-auth/login', { method: 'POST', body: '{}' }))

  it('allowed_users 행 없음 + ADMIN_EMAILS에 있음 → 403, 세션 만들지 않음', async () => {
    const res = await call()
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ reason: 'not-in-allowed-users' })
    expect(db.signIns).toBe(0)
  })
  it('is_admin=false + ADMIN_EMAILS에 있음 → 로그인, isAdmin=false', async () => {
    db.userRow = { email: 'envonly@example.com', is_admin: false, menu_permissions: { projects: 'read' } }
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, isAdmin: false })
  })
  it('is_admin=true → 로그인, isAdmin=true', async () => {
    db.userRow = { email: 'envonly@example.com', is_admin: true, menu_permissions: {} }
    const res = await call()
    expect(await res.json()).toMatchObject({ ok: true, isAdmin: true })
  })
})
