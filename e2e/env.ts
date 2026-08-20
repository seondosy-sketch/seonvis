import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * .env.local을 Playwright 프로세스에 읽어 넣는다.
 *
 * Next.js는 자기 프로세스에서 .env.local을 알아서 읽지만 Playwright는 그렇지 않다. 새 의존성
 * (dotenv)을 추가하지 않기 위해 필요한 만큼만 직접 파싱한다 — 이미 process.env에 있는 값은
 * 덮어쓰지 않는다(커맨드라인으로 준 값이 우선).
 *
 * 값은 어디에도 출력하지 않는다.
 */
export function loadEnvLocal(): void {
  const file = path.resolve(__dirname, '..', '.env.local')
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return // 없으면 그냥 넘어간다 — 부족한 값은 아래 requireTestAuthEnv가 알려준다.
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    if (process.env[key] !== undefined) continue
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}

/**
 * Test Auth를 쓸 수 있는 상태인지 확인하고, 아니면 무엇이 없는지 알려준다.
 * 값 자체는 메시지에 담지 않는다(이름만).
 */
export function requireTestAuthEnv(): void {
  const missing = [
    process.env.TEST_AUTH_ENABLED === 'true' ? null : 'TEST_AUTH_ENABLED=true',
    process.env.TEST_AUTH_EMAIL ? null : 'TEST_AUTH_EMAIL',
    process.env.TEST_AUTH_PASSWORD ? null : 'TEST_AUTH_PASSWORD',
  ].filter(Boolean)

  if (missing.length > 0) {
    throw new Error(
      `Test Auth 환경변수가 없어 UI 테스트를 실행할 수 없습니다: ${missing.join(', ')}\n`
      + '.env.local에 설정하세요 — docs/testing/test-auth.md 참고.',
    )
  }
}

/** 로그인된 테스트 사용자의 이메일(화면 표시 확인에 쓴다). */
export function testAuthEmail(): string {
  return (process.env.TEST_AUTH_EMAIL ?? '').trim().toLowerCase()
}

/** 저장된 세션 파일 경로 — .gitignore 대상이다. */
export const STORAGE_STATE = '.playwright/.auth/user.json'
