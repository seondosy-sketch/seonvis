import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { MENU_PERMISSION_VALUES, permissionFor, type MenuPermission } from '@/lib/menuConfig'

// TS(lib/menuConfig.ts permissionFor)와 DB(private.menu_permission · private.menu_any_readable)의 권한 해석이 같은지
// SQL 본문의 CASE 분기를 해석해 확인한다. 모르는 분기 모양이 나오면 실패한다 — SQL을 바꾸면 여기 해석기도 함께 고친다.
const root = path.resolve(__dirname, '..', '..')
const read = (p: string) => readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n')
const strict = read('supabase/migration_menu_permission_strict.sql')
const shared = read('supabase/migration_shared_project_tables_rls.sql')

function functionBody(sql: string, signature: string): string {
  const start = sql.indexOf(`create or replace function ${signature}`)
  if (start < 0) throw new Error(`함수 없음: ${signature}`)
  const open = sql.indexOf('$$', start)
  const close = sql.indexOf('$$', open + 2)
  return sql.slice(open + 2, close)
}

type Input = { isAdmin: boolean; raw: unknown; key: string }
type Branch = { when: (i: Input) => boolean; then: (i: Input) => string; source: string }

/** CASE … END 한 개를 분기 목록으로 해석한다 */
function parseCase(body: string): Branch[] {
  const m = body.match(/case\s+([\s\S]*?)\s+end\b/)
  if (!m) throw new Error('CASE 없음')
  const parts = m[1].split(/\s*\bwhen\b\s+/).filter(Boolean)
  const branches: Branch[] = []
  for (const part of parts) {
    const elseSplit = part.split(/\s+\belse\b\s+/)
    const [cond, result] = elseSplit[0].split(/\s+\bthen\b\s+/)
    branches.push({ when: condition(cond.replace(/\s+/g, ' ').trim()), then: value(result.trim()), source: cond.trim() })
    if (elseSplit[1] !== undefined) branches.push({ when: () => true, then: value(elseSplit[1].trim()), source: 'else' })
  }
  return branches
}

const own = (raw: unknown, key: string) => Object.prototype.hasOwnProperty.call(raw, key)
const isObject = (raw: unknown) => typeof raw === 'object' && raw !== null && !Array.isArray(raw)

function condition(c: string): (i: Input) => boolean {
  const k = '(?:k\\.)?menu_key'
  if (c === 'u.is_admin') return i => i.isAdmin
  if (c === "u.menu_permissions is null or pg_catalog.jsonb_typeof(u.menu_permissions) = 'null'") return i => i.raw === null
  if (c === "pg_catalog.jsonb_typeof(u.menu_permissions) <> 'object'") return i => !isObject(i.raw)
  if (new RegExp(`^not \\(u\\.menu_permissions \\? ${k}\\)$`).test(c)) return i => !own(i.raw, i.key)
  const valid = c.match(new RegExp(`^pg_catalog\\.jsonb_typeof\\(u\\.menu_permissions -> ${k}\\) = 'string' and \\(u\\.menu_permissions ->> ${k}\\) in \\(([^)]*)\\)$`))
  if (valid) {
    const list = [...valid[1].matchAll(/'([^']*)'/g)].map(x => x[1])
    return i => {
      const v = (i.raw as Record<string, unknown>)[i.key]
      return typeof v === 'string' && list.includes(v)
    }
  }
  throw new Error(`해석할 수 없는 SQL 조건: ${c}`)
}

function value(r: string): (i: Input) => string {
  const lit = r.match(/^'([a-z]+)'$/)
  if (lit) return () => lit[1]
  if (/^u\.menu_permissions ->> (k\.)?menu_key$/.test(r)) return i => (i.raw as Record<string, string>)[i.key]
  throw new Error(`해석할 수 없는 SQL 결과: ${r}`)
}

function evalSql(branches: Branch[], i: Input): string {
  for (const b of branches) if (b.when(i)) return b.then(i)
  throw new Error('어느 분기에도 맞지 않음')
}

/** JSON으로 저장 가능한 입력들(DB에는 undefined가 없다) */
const RAWS: unknown[] = [
  null, {}, [], ['projects'], 'write', 1, true,
  { projects: 'none' }, { projects: 'read' }, { projects: 'write' },
  { projects: 'NONE' }, { projects: 'Read' }, { projects: 'WRITE' }, { projects: '' }, { projects: ' read' }, { projects: 'read ' },
  { projects: null }, { projects: true }, { projects: 0 }, { projects: ['write'] }, { projects: { v: 'write' } },
  { weekly: 'none' }, { weekly: 'NONE', projects: 'read' },
]
const KEYS = ['projects', 'weekly']

const BODIES: [string, string][] = [
  ['strict migration: private.menu_permission', functionBody(strict, 'private.menu_permission(menu_key text)')],
  ['strict migration: private.menu_any_readable', functionBody(strict, 'private.menu_any_readable(p_keys text[])')],
  ['공용 표 migration: private.menu_any_readable', functionBody(shared, 'private.menu_any_readable(p_keys text[])')],
]

describe('TS ↔ SQL 메뉴 권한 규칙 일치', () => {
  it.each(BODIES)('%s — 유효값 목록이 TS와 같다', (_name, body) => {
    const m = body.match(/\) in \(([^)]*)\) then/)
    expect(m).not.toBeNull()
    expect([...m![1].matchAll(/'([^']*)'/g)].map(x => x[1])).toEqual([...MENU_PERMISSION_VALUES])
    expect(body).toMatch(/else 'none'/)
    expect(body).not.toMatch(/coalesce\(u\.menu_permissions ->> (k\.)?menu_key, 'write'\)/)   // 예전 fail-open
  })

  it.each(BODIES)('%s — 모든 입력에서 permissionFor와 같은 결과', (_name, body) => {
    const branches = parseCase(body)
    for (const raw of RAWS) {
      for (const key of KEYS) {
        for (const isAdmin of [false, true]) {
          const expected: MenuPermission = isAdmin ? 'write' : permissionFor(raw, key)
          expect({ raw, key, isAdmin, sql: evalSql(branches, { isAdmin, raw, key }) }).toEqual({ raw, key, isAdmin, sql: expected })
        }
      }
    }
  })

  it('menu_any_readable은 "판정 <> none"으로 읽기 여부를 정하고, 관리자·행 없음 처리가 menu_permission과 같다', () => {
    for (const [, body] of BODIES.slice(1)) {
      expect(body).toMatch(/end <> 'none'\)/)
      expect(body).toMatch(/select u\.is_admin\s+or exists/)
      expect(body).toMatch(/false\)\s*$/)          // 행 없음 → false(읽기 불가)
    }
    expect(BODIES[0][1]).toMatch(/'none'\s*\)\s*$/)   // menu_permission 행 없음 → 'none'
  })

  it('두 migration의 menu_any_readable 본문이 같다(어느 쪽을 나중에 실행해도 같은 규칙)', () => {
    expect(BODIES[1][1]).toBe(BODIES[2][1])
  })

  it('SECURITY DEFINER · STABLE · search_path 고정 · 스키마 이름 · 권한', () => {
    for (const sig of ['private.menu_permission\\(menu_key text\\)', 'private.menu_any_readable\\(p_keys text\\[\\]\\)']) {
      expect(strict).toMatch(new RegExp(`create or replace function ${sig}[\\s\\S]*?stable\\s+security definer\\s+set search_path = pg_catalog, pg_temp`))
    }
    expect(strict).toMatch(/from public\.allowed_users u/)
    expect(strict).toMatch(/revoke all on function private\.menu_permission\(text\) from public;/)
    expect(strict).toMatch(/grant execute on function private\.menu_permission\(text\) to authenticated;/)
    expect(strict).toMatch(/revoke all on function private\.menu_any_readable\(text\[\]\) from public, anon, authenticated, service_role;/)
    expect(strict).toMatch(/grant execute on function private\.menu_any_readable\(text\[\]\) to authenticated;/)
    expect(strict.match(/^begin;$/gm)).toHaveLength(1)
    expect(strict.match(/^commit;$/gm)).toHaveLength(1)
  })

  it('되돌리기는 이전 본문(예전 규칙)을 그대로 복원한다', () => {
    const rollback = read('supabase/verify/menu_permission_strict_rollback.sql')
    const original = read('supabase/migration_menu_permission_function.sql')
    expect(functionBody(rollback, 'private.menu_permission(menu_key text)')).toBe(functionBody(original, 'private.menu_permission(menu_key text)'))
    const sharedAtHead = `
  select coalesce(
    (select u.is_admin
            or exists (select 1 from pg_catalog.unnest(p_keys) as k(menu_key)
                       where coalesce(u.menu_permissions ->> k.menu_key, 'write') <> 'none')
       from public.allowed_users u
      where u.email = (auth.jwt() ->> 'email')),
    false)
`
    expect(functionBody(rollback, 'private.menu_any_readable(p_keys text[])')).toBe(sharedAtHead)
  })
})
