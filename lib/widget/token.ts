/**
 * 홈화면 위젯 토큰 발급·검증 (supabase/migration_widget_tokens.sql).
 *
 * 위젯 이미지 요청에는 쿠키 세션이 없다 — 토큰이 유일한 신원 정보다. 그래서 토큰이 유효한
 * 것만으로 끝내지 않고, 매 요청마다 그 이메일이 "지금도" 접근 권한이 있는지 다시 확인한다
 * (allowed_users 행 존재 + menu_permissions). 권한을 회수당한 사람의 위젯이 계속 살아 있으면
 * 웹에서 막은 것이 무의미해지기 때문이다.
 *
 * 권한 판정은 화면(app/(dashboard)/layout.tsx)과 같은 규칙을 쓴다 — 판정 코드도 같은 것을
 * 쓴다(lib/access.ts의 resolveAccessByEmail): 관리자(ADMIN_EMAILS env 또는
 * allowed_users.is_admin)는 전부 write, 아니면 allowed_users 행이 있어야 하고 없으면 거부.
 */
import { randomBytes } from 'node:crypto'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { normalizeEmail, resolveAccessByEmail, type AccessIdentity } from '@/lib/access'

/** 위젯 요청의 신원 — 화면 쪽 신원과 같은 모양이다(lib/access.ts). */
export type WidgetIdentity = AccessIdentity

function generateToken(): string {
  return `wgt_${randomBytes(16).toString('hex')}`
}

/** 현재 살아 있는 토큰 (없으면 null). 설정 페이지에서 기존 위젯 URL을 다시 보여줄 때 쓴다. */
export async function getActiveWidgetToken(email: string): Promise<string | null> {
  const admin = createSupabaseAdminClient()
  const { data } = await admin
    .from('widget_tokens')
    .select('token')
    .eq('email', normalizeEmail(email))
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.token ?? null
}

/** 새 토큰 발급 — 같은 사용자의 기존 토큰은 전부 즉시 무효화한다(유출 대응을 단순하게 유지). */
export async function issueWidgetToken(email: string): Promise<string> {
  const admin = createSupabaseAdminClient()
  const normalized = normalizeEmail(email)

  await revokeWidgetTokens(normalized)

  const token = generateToken()
  const { error } = await admin.from('widget_tokens').insert({ token, email: normalized })
  if (error) throw new Error(`위젯 토큰 발급 실패: ${error.message}`)
  return token
}

export async function revokeWidgetTokens(email: string): Promise<void> {
  const admin = createSupabaseAdminClient()
  await admin
    .from('widget_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('email', normalizeEmail(email))
    .is('revoked_at', null)
}

/**
 * 위젯 이미지 요청의 토큰을 신원으로 바꾼다. 무효 토큰·회수된 권한이면 null.
 * last_used_at은 부가 정보라 실패해도 요청을 막지 않는다.
 */
export async function resolveWidgetToken(token: string | null): Promise<WidgetIdentity | null> {
  if (!token || !token.startsWith('wgt_')) return null

  const admin = createSupabaseAdminClient()
  const { data: row } = await admin
    .from('widget_tokens')
    .select('email, revoked_at, last_used_at')
    .eq('token', token)
    .is('revoked_at', null)
    .maybeSingle()
  if (!row?.email) return null

  // 승인 취소·퇴사면 토큰이 남아 있어도 거부된다(resolveAccessByEmail이 null).
  const identity = await resolveAccessByEmail(row.email)
  if (!identity) return null

  // last_used_at은 "이 위젯이 아직 쓰이는지" 파악용 부가 정보라 매 요청마다 쓸 필요가 없다.
  // 마지막 기록이 1시간 이상 지났을 때만 UPDATE해서 불필요한 DB 쓰기를 없앤다(위젯은 자동
  // 갱신 주기가 1~3시간이므로 사실상 갱신 1회당 최대 1회 쓰기). 실패해도 요청은 막지 않는다.
  if (isStale(row.last_used_at)) {
    await admin
      .from('widget_tokens')
      .update({ last_used_at: new Date().toISOString() })
      .eq('token', token)
  }

  return identity
}

const LAST_USED_THROTTLE_MS = 60 * 60 * 1000

export function isStale(lastUsedAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!lastUsedAt) return true
  const previous = new Date(lastUsedAt).getTime()
  if (Number.isNaN(previous)) return true
  return now.getTime() - previous >= LAST_USED_THROTTLE_MS
}
