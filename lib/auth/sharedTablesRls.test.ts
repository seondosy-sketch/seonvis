import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { MENU_ROUTE_KEYS } from './menuRoutes'

// 공용 표 읽기 정책(supabase/migration_shared_project_tables_rls.sql)과 실제 소비 코드가 어긋나지 않게 고정한다.
//  - 브라우저(로그인 사용자 권한)로 표를 읽는 코드가 있으면, 그 화면의 메뉴 키가 정책 허용 목록에 있어야 한다
//    (없으면 그 메뉴만 가진 사용자는 화면이 빈다).
//  - 정책 허용 목록에 있는 메뉴 키는 실제로 그 표를 읽는 화면이 있어야 한다(필요 없는 메뉴에 열어 두지 않는다).
const root = path.resolve(__dirname, '..', '..')
const migration = readFileSync(path.join(root, 'supabase', 'migration_shared_project_tables_rls.sql'), 'utf8')

const TABLES = ['projects', 'project_notes', 'project_tooltips', 'performing_projects', 'expected_projects', 'weekly_meta',
  'evaluation_types', 'evaluation_roles', 'evaluation_question_categories'] as const

function policyKeys(table: string): string[] {
  const m = migration.match(new RegExp(`create policy "menu_read" on public\\.${table}\\s+for select to authenticated\\s+using \\(private\\.menu_any_readable\\(array\\[([^\\]]*)\\]`))
  if (!m) throw new Error(`정책 없음: ${table}`)
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1]).sort()
}

// 대시보드 폴더 밖에서 표를 읽는 코드 — 어느 메뉴 화면이 쓰는지 / 서버 권한(service role)인지
const OUTSIDE: Record<string, { key: string | null; server?: boolean; note: string }> = {
  'app/dashboard.tsx': { key: 'weekly', note: '주간/월간보고 화면 본체(app/(dashboard)/weekly/page.tsx가 import)' },
  'lib/overtime/projectOrder.ts': { key: 'overtime', note: '연장근무 프로젝트 정렬(공사번호)' },
  'app/(dashboard)/page.tsx': { key: null, note: '홈 — 메뉴 키 없음, 사용자의 관련 메뉴 권한만큼만 보인다' },
  'app/api/chat/route.ts': { key: 'projects', note: '미래봇 — chatMode(projects)로 서버에서 먼저 막음' },
  'app/api/chat/execute/route.ts': { key: 'projects', note: '미래봇 실행 — projects write' },
  'app/api/projects/export/route.ts': { key: 'projects', server: true, note: 'service role + 서버 권한 확인' },
  'app/api/attendance/export/route.ts': { key: 'attendance', server: true, note: 'service role + 서버 권한 확인' },
  'app/api/overtime/sync-projects/route.ts': { key: 'overtime', server: true, note: 'service role + 서버 권한 확인' },
  'lib/widget/summary.ts': { key: null, server: true, note: '홈 위젯 이미지 — service role, 토큰으로 사용자 확인' },
  'lib/googleCalendar/reconcile.ts': { key: null, server: true, note: '구글 캘린더 동기화 — service role(관리자)' },
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p)
  }
  return out
}
const sources = [...walk(path.join(root, 'app')), ...walk(path.join(root, 'lib'))]
  .map(p => ({ rel: path.relative(root, p).split(path.sep).join('/'), src: readFileSync(p, 'utf8') }))

// 읽는 코드만(…from('표').select) — 쓰기만 하는 곳(예: 프로젝트 이름 변경 시 performing_projects.update — weekly write 필요)은 읽기 정책 대상이 아니다
function consumers(table: string) {
  const re = new RegExp(`from\\(['"]${table}['"]\\)\\s*\\.select\\(`)
  return sources.filter(f => re.test(f.src)).map(f => f.rel)
}
function menuOf(rel: string): { key: string | null; server: boolean } {
  if (rel in OUTSIDE) return { key: OUTSIDE[rel].key, server: !!OUTSIDE[rel].server }
  const m = rel.match(/^app\/\(dashboard\)\/([^/]+)\//)
  if (m && m[1] in MENU_ROUTE_KEYS) return { key: MENU_ROUTE_KEYS[m[1]], server: false }
  throw new Error(`분류되지 않은 소비 코드: ${rel} — OUTSIDE 표에 추가하고 정책 메뉴를 검토한다`)
}

describe('공용 표 읽기 정책 ↔ 소비 코드', () => {
  it.each(TABLES)('%s — 브라우저로 읽는 화면의 메뉴는 모두 허용 목록에 있다', table => {
    const allowed = policyKeys(table)
    for (const rel of consumers(table)) {
      const { key, server } = menuOf(rel)
      if (server || key === null) continue
      expect({ rel, key, allowed: allowed.includes(key) }).toEqual({ rel, key, allowed: true })
    }
  })

  it.each(TABLES)('%s — 허용 목록의 메뉴는 실제로 이 표를 읽는 화면이 있다(최소 범위)', table => {
    const used = new Set(consumers(table).map(menuOf).filter(x => !x.server && x.key).map(x => x.key))
    expect(policyKeys(table).filter(k => !used.has(k))).toEqual([])
  })

  it('정책 매트릭스 고정', () => {
    expect(Object.fromEntries(TABLES.map(t => [t, policyKeys(t)]))).toEqual({
      projects: ['attendance', 'interview_db', 'lodging', 'overtime', 'projects', 'trip', 'weekly'],
      project_notes: ['projects', 'weekly'],
      project_tooltips: ['projects', 'trip', 'weekly'],
      performing_projects: ['weekly'],
      expected_projects: ['weekly'],
      weekly_meta: ['weekly'],
      evaluation_types: ['interview_db'],
      evaluation_roles: ['interview_db'],
      evaluation_question_categories: ['interview_db'],
    })
  })

  it('정책은 allowed_users를 직접 읽지 않고 SECURITY DEFINER 함수만 부른다(재귀 방지)', () => {
    const policies = [...migration.matchAll(/create policy "menu_read"[\s\S]*?;/g)].map(m => m[0])
    expect(policies).toHaveLength(TABLES.length)
    for (const p of policies) expect(p).not.toMatch(/allowed_users/)
    expect(migration).toMatch(/create or replace function private\.menu_any_readable\(p_keys text\[\]\)[\s\S]*?stable\s+security definer\s+set search_path = pg_catalog, pg_temp/)
    expect(migration).toMatch(/grant execute on function private\.menu_any_readable\(text\[\]\) to authenticated;/)
  })

  it('미래봇은 서버에서 프로젝트 권한으로 먼저 막는다', () => {
    const chat = sources.find(f => f.rel === 'app/api/chat/route.ts')!.src
    expect(chat.indexOf("chatMode(await getMenuAccess()) === 'none'")).toBeGreaterThan(-1)
    expect(chat.indexOf("chatMode(await getMenuAccess()) === 'none'")).toBeLessThan(chat.indexOf(".from('projects')"))
  })
})
