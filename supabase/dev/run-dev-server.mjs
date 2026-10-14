// 개발용 Supabase(.env.dev.local)로 next dev를 띄운다 — 연장근무 자동배정 화면 검증 전용.
//
// Next는 이미 process.env에 있는 값을 .env.local로 덮어쓰지 않는다. 그래서 여기서 개발용 값을 먼저
// 환경변수로 넣고 next dev를 실행하면, 앱 전체가 개발용 DB를 본다.
// 운영 DB를 건드리지 않도록 시작 전에 확인한다:
//   - 개발용 URL의 ref가 SUPABASE_PROJECT_REF와 같아야 하고
//   - 운영(.env.local) URL의 ref와 달라야 하며
//   - service role key도 운영 값과 달라야 한다.
// 어느 하나라도 아니면 실행하지 않는다. 키·비밀번호 값은 출력하지 않는다.
import { readFileSync, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..')
const PORT = process.env.DEVDB_PORT ?? '3100'

function parseEnv(file) {
  const out = {}
  if (!existsSync(file)) return out
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    let v = m[2]
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    out[m[1]] = v
  }
  return out
}
const refOf = url => (url ?? '').match(/^https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] ?? null
function stop(msg) { console.error(`[dev-db] 중단: ${msg}`); process.exit(1) }

const dev = parseEnv(path.join(root, '.env.dev.local'))
const prod = parseEnv(path.join(root, '.env.local'))

const devRef = refOf(dev.NEXT_PUBLIC_SUPABASE_URL)
const prodRef = refOf(prod.NEXT_PUBLIC_SUPABASE_URL)
if (!devRef) stop('.env.dev.local의 NEXT_PUBLIC_SUPABASE_URL이 비었거나 형식이 다릅니다')
if (!dev.SUPABASE_PROJECT_REF || dev.SUPABASE_PROJECT_REF !== devRef) stop('개발용 URL과 SUPABASE_PROJECT_REF가 다릅니다')
if (!prodRef || devRef === prodRef) stop('개발용 DB가 운영 DB와 같거나 구분할 수 없습니다')
if (!dev.NEXT_PUBLIC_SUPABASE_ANON_KEY || !dev.SUPABASE_SERVICE_ROLE_KEY) stop('개발용 키가 비었습니다')
if (dev.SUPABASE_SERVICE_ROLE_KEY === prod.SUPABASE_SERVICE_ROLE_KEY) stop('개발용 service role key가 운영과 같습니다')

const env = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: dev.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: dev.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: dev.SUPABASE_SERVICE_ROLE_KEY,
  // 관리자 = 개발 DB allowed_users.is_admin뿐이다. ADMIN_EMAILS는 앱이 읽지 않으므로 넘기지 않는다
  // (.env 파일에 값이 남아 있어도 권한에 아무 효과가 없다 — lib/auth/adminEmailsUsage.test.ts).
  TEST_AUTH_ENABLED: dev.TEST_AUTH_EMAIL && dev.TEST_AUTH_PASSWORD ? 'true' : 'false',
  TEST_AUTH_EMAIL: dev.TEST_AUTH_EMAIL ?? '',
  TEST_AUTH_PASSWORD: dev.TEST_AUTH_PASSWORD ?? '',
  // 외부 서비스 연동은 끈다 — 개발 DB 시험 중 실제 캘린더·AI를 호출하지 않게
  GOOGLE_SA_CLIENT_EMAIL: '',
  GOOGLE_SA_PRIVATE_KEY: '',
  GEMINI_API_KEY: '',
}

console.log(`[dev-db] 개발용 DB(${devRef.slice(0, 4)}…${devRef.slice(-4)})로 실행 — 운영(${prodRef.slice(0, 4)}…${prodRef.slice(-4)})과 다름 확인`)
console.log(`[dev-db] 시험 로그인: ${env.TEST_AUTH_ENABLED === 'true' ? '켜짐' : '꺼짐(.env.dev.local에 TEST_AUTH_EMAIL/PASSWORD 필요)'} · 포트 ${PORT}`)

const child = spawn(process.execPath, [path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', '-p', PORT], { cwd: root, env, stdio: 'inherit' })
child.on('exit', code => process.exit(code ?? 0))
