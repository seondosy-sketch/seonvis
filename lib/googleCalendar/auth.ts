/**
 * 서비스 계정 액세스 토큰 발급 — 서버 전용.
 *
 * 관리자 개인 계정 OAuth 대신 서비스 계정을 쓰는 이유:
 *   - refresh token을 DB에 저장할 일이 없다(유출 대상 자체를 만들지 않는다)
 *   - Supabase Auth는 provider token을 보관·갱신하지 않으므로, 로그인 scope에 Calendar를
 *     붙여도 백그라운드 동기화에 쓸 수 없다
 *   - 팀원 9명 전원에게 캘린더 권한 동의를 요구하지 않아도 된다(최소 권한)
 *
 * 비밀은 Vercel/로컬 환경변수 두 개뿐이다.
 *   GOOGLE_SA_CLIENT_EMAIL  서비스 계정 이메일
 *   GOOGLE_SA_PRIVATE_KEY   개인키(PEM). 환경변수에는 개행을 `\n` 문자열로 넣고 여기서 되돌린다.
 *
 * 이 파일은 어떤 경우에도 키·토큰 원문을 로그나 응답에 내보내지 않는다.
 */
import { createSign } from 'node:crypto'

/**
 * 최소 권한 scope 3종. 전체 `calendar` scope는 쓰지 않는다.
 *   events          이벤트 생성·수정·삭제
 *   calendarlist    공유받은 캘린더를 서비스 계정 목록에 등록(서비스 계정은 공유를 자동 수락하지
 *                   않아 calendarList.insert가 필요하다 — 실측 확인)
 *   calendars.readonly  캘린더 이름·시간대 확인
 */
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist',
  'https://www.googleapis.com/auth/calendar.calendars.readonly',
].join(' ')

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
/** 토큰 만료 직전에 쓰다가 401을 맞지 않도록 두는 여유 */
const EXPIRY_MARGIN_MS = 60_000

export class GoogleAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GoogleAuthError'
  }
}

export function serviceAccountEmail(): string | null {
  return process.env.GOOGLE_SA_CLIENT_EMAIL?.trim() || null
}

/** 환경변수가 갖춰져 있는지 — 관리자 화면에서 "설정 필요" 안내를 띄우는 데 쓴다. */
export function isServiceAccountConfigured(): boolean {
  return !!serviceAccountEmail() && !!process.env.GOOGLE_SA_PRIVATE_KEY?.trim()
}

function privateKey(): string {
  const raw = process.env.GOOGLE_SA_PRIVATE_KEY?.trim()
  if (!raw) throw new GoogleAuthError('GOOGLE_SA_PRIVATE_KEY 환경변수가 없습니다')
  // 환경변수에 넣을 때 개행이 `\n` 문자열로 들어가므로 되돌린다. 양끝 따옴표도 벗긴다.
  return raw.replace(/^"|"$/g, '').replace(/\\n/g, '\n')
}

const base64url = (input: Buffer | string) => Buffer.from(input).toString('base64url')

function signedJwt(): string {
  const email = serviceAccountEmail()
  if (!email) throw new GoogleAuthError('GOOGLE_SA_CLIENT_EMAIL 환경변수가 없습니다')

  const now = Math.floor(Date.now() / 1000)
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = base64url(JSON.stringify({
    iss: email,
    scope: SCOPES,
    aud: TOKEN_ENDPOINT,
    iat: now,
    exp: now + 3600,
  }))
  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${claims}`)
  return `${header}.${claims}.${base64url(signer.sign(privateKey()))}`
}

// 모듈 스코프 캐시 — 같은 서버 인스턴스에서 1시간에 한 번만 토큰을 받는다.
let cached: { token: string; expiresAt: number } | null = null

export async function getAccessToken(): Promise<string> {
  if (cached && cached.expiresAt - EXPIRY_MARGIN_MS > Date.now()) return cached.token

  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: signedJwt(),
    }),
    cache: 'no-store',
  })

  const body = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number; error_description?: string; error?: string } | null
  if (!res.ok || !body?.access_token) {
    // 응답 본문에 키가 담기지는 않지만, 혹시를 대비해 error/description만 옮긴다.
    const reason = body?.error_description ?? body?.error ?? `HTTP ${res.status}`
    throw new GoogleAuthError(`Google 토큰 발급 실패: ${reason}`)
  }

  cached = {
    token: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  }
  return cached.token
}

/** 키를 교체했거나 인증이 깨졌을 때 다음 호출에서 새로 받게 한다. */
export function clearTokenCache(): void {
  cached = null
}
