import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// 관리자 판정의 유일한 근거는 DB allowed_users.is_admin이다. 환경변수 ADMIN_EMAILS를 인증·권한 판정에 다시 쓰는 코드가
// 생기지 않도록 app/·lib/·루트 TS 파일을 검사한다(주석 속 언급은 허용).
// 판정이 아닌 용도로 꼭 읽어야 하면 아래 ALLOWED에 파일과 이유를 적는다 — 지금은 없다.
const ALLOWED: Record<string, string> = {}

const root = path.resolve(__dirname, '..', '..')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx|js|mjs)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

/** 주석을 지운 코드 — 문자열 안의 // 는 드물어 단순 제거로 충분하다(검사가 더 엄격해지는 쪽) */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

const rootFiles = readdirSync(root).filter(n => /\.(ts|tsx|mjs)$/.test(n) && !/\.test\.tsx?$/.test(n)).map(n => path.join(root, n))
// 개발 실행기(supabase/dev/*.mjs)도 검사한다 — 앱에 ADMIN_EMAILS를 넘기지 않는다
const devRunners = readdirSync(path.join(root, 'supabase', 'dev')).filter(n => /\.(mjs|js|ts)$/.test(n)).map(n => path.join(root, 'supabase', 'dev', n))
const files = [...walk(path.join(root, 'app')), ...walk(path.join(root, 'lib')), ...rootFiles, ...devRunners]
  .map(p => ({ rel: path.relative(root, p).split(path.sep).join('/'), code: stripComments(readFileSync(p, 'utf8')) }))

describe('ADMIN_EMAILS는 인증·권한 판정에 쓰지 않는다', () => {
  it('검사 대상이 실제로 있다', () => {
    expect(files.length).toBeGreaterThan(50)
    expect(files.some(f => f.rel === 'lib/auth/menuAccess.ts')).toBe(true)
  })

  it('코드(주석 제외)에서 ADMIN_EMAILS를 읽는 파일이 없다(허용 목록 제외)', () => {
    const offenders = files.filter(f => /ADMIN_EMAILS/.test(f.code) && !(f.rel in ALLOWED)).map(f => f.rel)
    expect(offenders).toEqual([])
  })

  it('예전 판정 헬퍼(adminEmailList·getAdminEmails·adminEmails)가 남아 있지 않다', () => {
    const offenders = files.filter(f => /\b(adminEmailList|getAdminEmails|adminEmails)\s*\(/.test(f.code)).map(f => f.rel)
    expect(offenders).toEqual([])
  })

  it('관리자 화면·관리자 API는 DB 관리자 판정 헬퍼를 쓴다', () => {
    const src = (p: string) => files.find(f => f.rel === p)!.code
    expect(src('app/(dashboard)/admin/page.tsx')).toContain('await requireAdminPage()')
    expect(src('app/(dashboard)/admin/calendar/page.tsx')).toContain('await requireAdminPage()')
    for (const p of ['app/api/admin/users/route.ts', 'app/api/admin/access-requests/route.ts']) expect(src(p)).toContain('getAdminAccess()')
    expect(src('lib/googleCalendar/guard.ts')).toContain('getMenuAccess()')
    expect(src('lib/widget/token.ts')).toContain('resolveMenuAccess(')
    expect(src('app/api/widget/token/route.ts')).toContain('getMenuAccess()')
    expect(src('app/api/test-auth/login/route.ts')).toContain('resolveMenuAccess(')
  })

  it('관리자 판정은 allowed_users.is_admin을 읽는다(getMenuAccess·위젯 토큰 조회 열)', () => {
    const src = (p: string) => files.find(f => f.rel === p)!.code
    expect(src('lib/auth/menuAccess.ts')).toMatch(/\.select\('email, is_admin, menu_permissions'\)/)
    expect(src('lib/widget/token.ts')).toMatch(/\.select\('email, is_admin, menu_permissions'\)/)
    expect(src('lib/auth/accessRules.ts')).toMatch(/row\.is_admin === true/)
  })

  it('개발 실행기는 ADMIN_EMAILS를 앱에 넘기지 않고, 운영 DB 구분 안전장치는 그대로다', () => {
    const runner = files.find(f => f.rel === 'supabase/dev/run-dev-server.mjs')!.code
    expect(runner).not.toMatch(/ADMIN_EMAILS/)
    expect(runner).toContain("stop('개발용 DB가 운영 DB와 같거나 구분할 수 없습니다')")
    expect(runner).toContain("stop('개발용 service role key가 운영과 같습니다')")
  })

  it('문서·README·운영 절차에서 ADMIN_EMAILS를 현재 관리자 근거로 설명하지 않는다', () => {
    // ADMIN_EMAILS가 나오는 줄은 모두 "인가에 쓰지 않음"·is_admin 기준을 함께 적어야 한다(과거 설계 기록도 주석으로 표시)
    const docFiles = [
      path.join(root, 'README.md'),
      ...walkDocs(path.join(root, 'docs')),
      ...readdirSync(path.join(root, 'supabase', 'prod')).filter(n => n.endsWith('.md')).map(n => path.join(root, 'supabase', 'prod', n)),
    ]
    const ok = /is_admin|쓰지 않|주지 않|효과가 없|미사용/
    const offenders = docFiles.flatMap(p => readFileSync(p, 'utf8').split(String.fromCharCode(10))
      .map((line, i) => ({ line, at: `${path.relative(root, p).split(path.sep).join('/')}:${i + 1}` }))
      .filter(x => /ADMIN_EMAILS/.test(x.line) && !ok.test(x.line)).map(x => x.at))
    expect(offenders).toEqual([])
  })
})

function walkDocs(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) walkDocs(p, out)
    else if (name.endsWith('.md')) out.push(p)
  }
  return out
}
