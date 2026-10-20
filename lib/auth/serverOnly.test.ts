import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// service role 클라이언트(lib/supabase-admin.ts)는 서버 전용이다 — 'server-only' 표시가 있고,
// 브라우저 컴포넌트('use client')가 직접 import하지 않는다(간접 import는 Next 빌드가 'server-only'로 막는다).
const root = path.resolve(__dirname, '..', '..')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

describe('service role 클라이언트는 서버 전용', () => {
  it("lib/supabase-admin.ts는 import 'server-only'로 시작한다", () => {
    // core.autocrlf=true로 체크아웃하면 CRLF가 된다 — 줄바꿈만 LF로 맞추고 선두 import 검사는 그대로 둔다
    const src = readFileSync(path.join(root, 'lib', 'supabase-admin.ts'), 'utf8').replace(/\r\n?/g, '\n')
    expect(src).toMatch(/^(\/\/.*\n)*import 'server-only'\n/)
  })

  it("'use client' 파일은 lib/supabase-admin을 import하지 않는다", () => {
    const offenders = [...walk(path.join(root, 'app')), ...walk(path.join(root, 'lib'))]
      .map(p => ({ rel: path.relative(root, p).split(path.sep).join('/'), src: readFileSync(p, 'utf8') }))
      .filter(f => /^\s*['"]use client['"]/.test(f.src) && /from ['"](@\/lib\/supabase-admin|(\.\.?\/)+supabase-admin)['"]/.test(f.src))
      .map(f => f.rel)
    expect(offenders).toEqual([])
  })
})
