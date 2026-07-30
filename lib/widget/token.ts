/**
 * 홈화면 위젯 토큰 발급·검증 (supabase/migration_widget_tokens.sql).
 *
 * 위젯 이미지 요청에는 쿠키 세션이 없다 — 토큰이 유일한 신원 정보다. 그래서 토큰이 유효한
 * 것만으로 끝내지 않고, 매 요청마다 그 이메일이 "지금도" 접근 권한이 있는지 다시 확인한다
 * (allowed_users 행 존재 + menu_permissions). 권한을 회수당한 사람의 위젯이 계속 살아 있으면
 * 웹에서 막은 것이 무의미해지기 때문이다.
 *
 * 권한 판정은 app/(dashboard)/layout.tsx와 같은 규칙을 쓴다:
 *   ADMIN_EMAILS(env)에 있으면 관리자 → 전부 write
 *   아니면 allowed_users 행이 있어야 하고, 없으면 미승인으로 간주해 거부
 */
import { randomBytes } from 'node:crypto'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import type { MenuPermission } from '@/lib/menuConfig'

export interface WidgetIdentity {
  email: string
  isAdmin: boolean
  menuPermissions: Record<string, MenuPermission>
}

export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim()
}

function getAdminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? '').split(',').map(e => e.trim()).filter(Boolean)
}

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

  const email = normalizeEmail(row.email)
  const isAdmin = getAdminEmails().includes(email)

  let menuPermissions: Record<string, MenuPermission> = {}
  if (!isAdmin) {
    const { data: user } = await admin
      .from('allowed_users')
      .select('email, menu_permissions')
      .eq('email', email)
      .maybeSingle()
    if (!user) return null // 승인 취소·퇴사 → 토큰이 남아 있어도 거부
    menuPermissions = (user.menu_permissions ?? {}) as Record<string, MenuPermission>
  }

  // last_used_at은 "이 위젯이 아직 쓰이는지" 파악용 부가 정보라 매 요청마다 쓸 필요가 없다.
  // 마지막 기록이 1시간 이상 지났을 때만 UPDATE해서 불필요한 DB 쓰기를 없앤다(위젯은 자동
  // 갱신 주기가 1~3시간이므로 사실상 갱신 1회당 최대 1회 쓰기). 실패해도 요청은 막지 않는다.
  if (isStale(row.last_used_at)) {
    await admin
      .from('widget_tokens')
      .update({ last_used_at: new Date().toISOString() })
      .eq('token', token)
  }

  return { email, isAdmin, menuPermissions }
}

const LAST_USED_THROTTLE_MS = 60 * 60 * 1000

export function isStale(lastUsedAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!lastUsedAt) return true
  const previous = new Date(lastUsedAt).getTime()
  if (Number.isNaN(previous)) return true
  return now.getTime() - previous >= LAST_USED_THROTTLE_MS
}
