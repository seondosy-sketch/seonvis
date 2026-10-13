import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * lib/access.ts는 관리자·메뉴 권한 판정의 유일한 지점이라, 예전에 8군데 복사본이 서로 다르게
 * 동작하며 만들던 문제(대문자 이메일 거부, env 관리자 403, 미승인 사용자 조회 에러)를
 * 여기서 회귀 테스트로 고정한다. DB 접근은 Supabase 클라이언트를 대역으로 바꿔 검증한다.
 */

// allowed_users 조회 결과를 테스트마다 바꿔 끼운다. null이면 "행 없음".
let allowedUserRow: { email: string; is_admin: boolean; menu_permissions: unknown } | null = null
/** upsert로 들어온 payload 기록 — env 관리자 is_admin 동기화 확인용 */
const upserts: unknown[] = []
/** allowed_users 조회에 쓰인 email 값 기록 — 정규화 확인용 */
const queriedEmails: string[] = []

vi.mock('@/lib/supabase-admin', () => ({
  createSupabaseAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: (_col: string, value: string) => {
          queriedEmails.push(value)
          return { maybeSingle: async () => ({ data: allowedUserRow }) }
        },
      }),
      upsert: async (payload: unknown) => {
        upserts.push(payload)
        return { error: null }
      },
    }),
  }),
}))

vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: sessionUser } }) },
  }),
}))

let sessionUser: { email: string } | null = null

const {
  canReadMenu,
  canWriteMenu,
  isEnvAdminEmail,
  menuPermissionOf,
  normalizeEmail,
  parseAdminEmails,
  requireAdminAccess,
  resolveAccessByEmail,
  resolveSessionAccess,
} = await import('./access')

beforeEach(() => {
  allowedUserRow = null
  sessionUser = null
  upserts.length = 0
  queriedEmails.length = 0
  delete process.env.ADMIN_EMAILS
})

describe('parseAdminEmails', () => {
  it('콤마 구분 목록을 소문자·trim·중복 제거해 파싱', () => {
    expect(parseAdminEmails(' A@seon.co.kr , b@seon.co.kr,A@SEON.CO.KR ,, ')).toEqual([
      'a@seon.co.kr',
      'b@seon.co.kr',
    ])
  })

  it('값이 없으면 빈 배열', () => {
    expect(parseAdminEmails(undefined)).toEqual([])
    expect(parseAdminEmails('')).toEqual([])
  })
})

describe('isEnvAdminEmail', () => {
  it('대소문자·공백이 달라도 같은 사람으로 인정한다', () => {
    // 예전 복사본들은 세션 원문과 env 원문을 그대로 비교해 이 경우를 거부했다.
    expect(isEnvAdminEmail(' Admin@Seon.co.kr ', 'admin@seon.co.kr')).toBe(true)
    expect(isEnvAdminEmail('admin@seon.co.kr', 'ADMIN@SEON.CO.KR')).toBe(true)
  })

  it('목록에 없으면 false', () => {
    expect(isEnvAdminEmail('other@seon.co.kr', 'admin@seon.co.kr')).toBe(false)
  })
})

describe('normalizeEmail', () => {
  it('소문자로 바꾸고 양끝 공백을 없앤다', () => {
    expect(normalizeEmail('  User@Seon.CO.KR \n')).toBe('user@seon.co.kr')
  })
})

describe('resolveAccessByEmail', () => {
  it('env 관리자는 allowed_users 행이 없어도 관리자로 인정한다', async () => {
    process.env.ADMIN_EMAILS = 'admin@seon.co.kr'
    const access = await resolveAccessByEmail('Admin@seon.co.kr')
    expect(access).toEqual({ email: 'admin@seon.co.kr', isAdmin: true, menuPermissions: {} })
  })

  it('env 관리자의 is_admin을 DB에도 맞춰 둔다 (RLS가 is_admin만 보기 때문)', async () => {
    process.env.ADMIN_EMAILS = 'admin@seon.co.kr'
    await resolveAccessByEmail('admin@seon.co.kr')
    expect(upserts).toEqual([{ email: 'admin@seon.co.kr', is_admin: true }])
  })

  it('is_admin이 이미 true면 동기화 쓰기를 하지 않는다', async () => {
    process.env.ADMIN_EMAILS = 'admin@seon.co.kr'
    allowedUserRow = { email: 'admin@seon.co.kr', is_admin: true, menu_permissions: {} }
    await resolveAccessByEmail('admin@seon.co.kr')
    expect(upserts).toEqual([])
  })

  it('env에 없어도 allowed_users.is_admin이 true면 관리자다', async () => {
    allowedUserRow = { email: 'boss@seon.co.kr', is_admin: true, menu_permissions: { lodging: 'none' } }
    const access = await resolveAccessByEmail('boss@seon.co.kr')
    expect(access?.isAdmin).toBe(true)
  })

  it('승인 행이 없고 관리자도 아니면 null (미승인)', async () => {
    expect(await resolveAccessByEmail('stranger@example.com')).toBeNull()
  })

  it('이메일이 비어 있으면 null', async () => {
    expect(await resolveAccessByEmail(null)).toBeNull()
    expect(await resolveAccessByEmail('   ')).toBeNull()
  })

  it('조회 전에 이메일을 정규화한다 (대문자 계정도 같은 행을 찾는다)', async () => {
    allowedUserRow = { email: 'user@seon.co.kr', is_admin: false, menu_permissions: {} }
    const access = await resolveAccessByEmail(' User@Seon.co.kr ')
    expect(queriedEmails).toEqual(['user@seon.co.kr'])
    expect(access?.email).toBe('user@seon.co.kr')
  })

  it('menu_permissions가 null이면 빈 객체로 다룬다', async () => {
    allowedUserRow = { email: 'user@seon.co.kr', is_admin: false, menu_permissions: null }
    const access = await resolveAccessByEmail('user@seon.co.kr')
    expect(access?.menuPermissions).toEqual({})
  })
})

describe('resolveSessionAccess / requireAdminAccess', () => {
  it('세션이 없으면 null', async () => {
    expect(await resolveSessionAccess()).toBeNull()
    expect(await requireAdminAccess()).toBeNull()
  })

  it('승인 사용자는 신원을 주지만 requireAdminAccess는 null', async () => {
    sessionUser = { email: 'User@seon.co.kr' }
    allowedUserRow = { email: 'user@seon.co.kr', is_admin: false, menu_permissions: {} }
    expect((await resolveSessionAccess())?.email).toBe('user@seon.co.kr')
    expect(await requireAdminAccess()).toBeNull()
  })

  it('관리자 세션은 requireAdminAccess가 신원을 준다', async () => {
    process.env.ADMIN_EMAILS = 'admin@seon.co.kr'
    sessionUser = { email: 'admin@seon.co.kr' }
    expect((await requireAdminAccess())?.isAdmin).toBe(true)
  })
})

describe('menuPermissionOf / canReadMenu / canWriteMenu', () => {
  const user = (permissions: Record<string, 'none' | 'read' | 'write'>) => ({
    email: 'user@seon.co.kr',
    isAdmin: false,
    menuPermissions: permissions,
  })

  it('신원이 없으면 none', () => {
    expect(menuPermissionOf(null, 'lodging')).toBe('none')
    expect(canReadMenu(null, 'lodging')).toBe(false)
    expect(canWriteMenu(null, 'lodging')).toBe(false)
  })

  it('관리자는 권한 맵과 무관하게 write', () => {
    const admin = { email: 'admin@seon.co.kr', isAdmin: true, menuPermissions: { lodging: 'none' as const } }
    expect(menuPermissionOf(admin, 'lodging')).toBe('write')
    expect(canWriteMenu(admin, 'lodging')).toBe(true)
  })

  it('키가 없으면 write (lib/menuConfig.ts·RLS 함수와 같은 기본값)', () => {
    expect(menuPermissionOf(user({}), 'lodging')).toBe('write')
  })

  it('read는 조회만, none은 전부 거부', () => {
    const readOnly = user({ lodging: 'read' })
    expect(canReadMenu(readOnly, 'lodging')).toBe(true)
    expect(canWriteMenu(readOnly, 'lodging')).toBe(false)

    const hidden = user({ lodging: 'none' })
    expect(canReadMenu(hidden, 'lodging')).toBe(false)
    expect(canWriteMenu(hidden, 'lodging')).toBe(false)
  })
})
