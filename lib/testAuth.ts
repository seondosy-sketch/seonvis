/**
 * 개발환경 전용 Test Auth 게이트.
 *
 * 왜 있는가
 *   미래Hub 로그인은 Google OAuth 하나뿐이라(app/login/page.tsx) 자동화 도구가 화면에 들어갈 수
 *   없었다. 사람 계정의 비밀번호·OTP·쿠키를 쓰지 않고 인증 화면만 건너뛰기 위해, 개발환경에서만
 *   동작하는 별도 경로를 둔다(app/api/test-auth/login/route.ts).
 *
 * 무엇을 하지 않는가 — 이게 더 중요하다
 *   권한을 우회하지 않는다. Test Auth는 **전용 Supabase Auth 사용자로 실제 로그인**해서 평소와
 *   똑같은 쿠키 세션을 만든다. 따라서 JWT의 email이 실제로 들어 있고, allowed_users ·
 *   menu_permissions · RLS(private.menu_permission)가 그대로 적용된다.
 *   "개발이면 통과" 같은 DB 세션 없는 허위 인증이 아니다 — 그렇게 하면 화면은 열리지만 Supabase
 *   질의가 auth.jwt()를 못 받아 조용히 빈 결과가 나오고, 검증의 의미가 사라진다.
 *
 * production 안전장치는 여러 겹이다(아래 resolveTestAuth 순서 참고). 특히 실수로 Vercel
 * production 환경에 TEST_AUTH_ENABLED=true가 들어가더라도 NODE_ENV / VERCEL_ENV 단계에서 먼저
 * 막힌다. 이 파일은 순수 함수라 그 판정을 단위테스트로 고정해 둔다(lib/testAuth.test.ts).
 */

/** 판정에 쓰는 환경변수만 받는다(process.env를 그대로 넣어도 된다). */
export interface TestAuthEnv {
  NODE_ENV?: string
  /** Vercel이 주는 배포 환경 구분: production | preview | development */
  VERCEL_ENV?: string
  TEST_AUTH_ENABLED?: string
  TEST_AUTH_EMAIL?: string
  TEST_AUTH_PASSWORD?: string
}

export type TestAuthDenialReason =
  /** production 빌드/런타임 — 어떤 환경변수를 넣어도 여기서 끝난다. */
  | 'production-node-env'
  /** Vercel production/preview 배포 — NODE_ENV가 어떻든 배포된 환경에서는 쓰지 않는다. */
  | 'deployed-environment'
  | 'not-enabled'
  | 'missing-email'
  | 'missing-password'
  /** 요청이 지목한 이메일이 허용 목록(= TEST_AUTH_EMAIL) 밖이다. */
  | 'email-not-allowlisted'

export type TestAuthDecision =
  | { ok: true; email: string; password: string }
  | { ok: false; status: 404 | 403; reason: TestAuthDenialReason }

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

/**
 * Test Auth를 허용할지 판정한다.
 *
 * 거부는 대부분 404다 — production에서 "이런 경로가 있다"는 사실 자체를 알리지 않기 위함이다.
 * 403은 경로가 살아 있는 개발환경에서 허용되지 않은 이메일을 요청한 경우에만 쓴다.
 *
 * @param requestedEmail 호출자가 명시한 이메일(없으면 설정된 테스트 이메일을 쓴다)
 */
export function resolveTestAuth(env: TestAuthEnv, requestedEmail?: string | null): TestAuthDecision {
  // 1) production NODE_ENV — next build/start, Vercel 배포가 모두 여기 걸린다.
  if (env.NODE_ENV === 'production') {
    return { ok: false, status: 404, reason: 'production-node-env' }
  }

  // 2) 배포된 환경(Vercel production/preview)은 NODE_ENV와 무관하게 거부한다.
  const vercelEnv = env.VERCEL_ENV?.trim().toLowerCase()
  if (vercelEnv === 'production' || vercelEnv === 'preview') {
    return { ok: false, status: 404, reason: 'deployed-environment' }
  }

  // 3) 명시적으로 켜야 한다. 기본값은 꺼짐이다.
  if (env.TEST_AUTH_ENABLED?.trim() !== 'true') {
    return { ok: false, status: 404, reason: 'not-enabled' }
  }

  // 4) 테스트 계정 정보가 없으면 동작하지 않는다(코드에 이메일/비밀번호를 넣어두지 않는다).
  const email = env.TEST_AUTH_EMAIL?.trim() ? normalizeEmail(env.TEST_AUTH_EMAIL) : ''
  if (!email) return { ok: false, status: 404, reason: 'missing-email' }

  const password = env.TEST_AUTH_PASSWORD ?? ''
  if (!password) return { ok: false, status: 404, reason: 'missing-password' }

  // 5) 이메일을 지목했다면 설정된 값과 정확히 같아야 한다(allowlist는 한 개다).
  if (requestedEmail != null && requestedEmail.trim() !== '' && normalizeEmail(requestedEmail) !== email) {
    return { ok: false, status: 403, reason: 'email-not-allowlisted' }
  }

  return { ok: true, email, password }
}

/**
 * Test Auth 경로가 살아 있는 환경인지(이메일을 지목하지 않은 상태의 판정).
 * proxy.ts가 로그인 리다이렉트 예외를 이 값에 따라서만 열기 위해 쓴다 — production에서는 false라
 * 예외가 아예 생기지 않는다.
 */
export function isTestAuthAvailable(env: TestAuthEnv): boolean {
  return resolveTestAuth(env).ok
}

/** 개발환경에서 자동화 도구가 세션을 얻는 경로. */
export const TEST_AUTH_LOGIN_PATH = '/api/test-auth/login'
/** 세션을 정리하는 경로. */
export const TEST_AUTH_LOGOUT_PATH = '/api/test-auth/logout'
/** proxy.ts의 로그인 리다이렉트 예외로 열어줄 경로들. */
export const TEST_AUTH_PATHS = [TEST_AUTH_LOGIN_PATH, TEST_AUTH_LOGOUT_PATH] as const
