/**
 * 접근 권한 판정 — "누가 관리자인가", "이 사람의 메뉴 권한은 무엇인가"를 여기서만 결정한다.
 * (서버 전용 — 세션 쿠키와 service role 클라이언트를 쓴다. 클라이언트 컴포넌트는
 *  app/components/PermissionsProvider.tsx + lib/menuConfig.ts를 쓴다.)
 *
 * 왜 한 곳으로 모았나: 같은 판정이 layout·관리자 페이지·admin API·위젯·캘린더 guard·출력 API에
 * 8군데 복사돼 있었고, 복사본마다 규칙이 미묘하게 달랐다.
 *   · 관리자 정의가 갈렸다 — ADMIN_EMAILS(env)만 보는 곳과 allowed_users.is_admin(DB)만 보는
 *     곳이 섞여 있었다. 출력 API(출근부·숙박)는 후자만 봤기 때문에 env에만 등록된 관리자는
 *     화면에서는 전권인데 출력만 403을 받았다.
 *   · 이메일 정규화가 갈렸다 — 소문자로 맞춰 비교하는 곳과 세션 원문 그대로 비교하는 곳이
 *     섞여 있어서, 대문자가 섞인 Google 계정은 같은 사람인데도 일부 기능에서 거부됐다.
 *   · 행이 없을 때 .single()로 조회해 "미승인"이 조회 에러로 나오는 곳이 있었다.
 *
 * 규칙(유일한 정의):
 *   1. 이메일은 env 목록·세션·DB 조회 모두 normalizeEmail()을 거친 값으로 비교한다.
 *   2. 관리자 = ADMIN_EMAILS(env)에 있거나 allowed_users.is_admin이 true. 관리자는 전 메뉴 write.
 *   3. 관리자가 아니면 allowed_users 행이 있어야 하고(없으면 미승인 → null), 권한은
 *      menu_permissions와 permissionFor()의 기본값(키가 없으면 write) 규칙을 따른다.
 *   4. env 관리자는 allowed_users.is_admin도 true로 맞춰 둔다 — 이유는 syncEnvAdminFlag() 주석.
 */
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { MenuPermission, permissionFor } from '@/lib/menuConfig'

export interface AccessIdentity {
  /** 정규화된 이메일 — 저장·비교는 항상 이 값을 쓴다. */
  email: string
  isAdmin: boolean
  /** 관리자는 이 값과 무관하게 전 메뉴 write다 — 판정은 menuPermissionOf()로. */
  menuPermissions: Record<string, MenuPermission>
}

export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim()
}

/** ADMIN_EMAILS(콤마 구분) 파싱 — 정규화·중복 제거까지 여기서 끝낸다. */
export function parseAdminEmails(raw: string | null | undefined): string[] {
  const emails = (raw ?? '').split(',').map(normalizeEmail).filter(Boolean)
  return [...new Set(emails)]
}

export function isEnvAdminEmail(email: string, raw: string | null | undefined = process.env.ADMIN_EMAILS): boolean {
  return parseAdminEmails(raw).includes(normalizeEmail(email))
}

/** 로그인한 사용자의 이메일(정규화). 세션이 없으면 null. */
export async function getSessionEmail(): Promise<string | null> {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user?.email ? normalizeEmail(user.email) : null
}

/**
 * env 관리자를 allowed_users.is_admin에도 반영한다.
 *
 * RLS 정책이 참조하는 private.menu_permission()(supabase/migration_menu_permission_function.sql)은
 * Postgres 안에서 도므로 env를 볼 수 없고 is_admin 컬럼만 본다. 그래서 ADMIN_EMAILS에만 있고
 * allowed_users 행이 없거나 is_admin=false인 관리자는 화면에서는 전권으로 보이지만, 브라우저가
 * Supabase를 직접 부르는 읽기/쓰기는 RLS가 'none'으로 판정해 조용히 막았다. 판정 지점을 하나로
 * 모으는 것만으로는 이 DB 단 불일치가 안 풀리므로, 관리자를 확인하는 순간 두 정의를 맞춘다.
 *
 * 실패해도 요청을 막지 않는다 — 앱 단 판정은 이미 끝났고, 다음 요청에서 다시 시도된다.
 * (is_admin이 이미 true면 호출하지 않으므로 평소에는 쓰기가 발생하지 않는다.)
 */
async function syncEnvAdminFlag(email: string): Promise<void> {
  const admin = createSupabaseAdminClient()
  const { error } = await admin
    .from('allowed_users')
    .upsert({ email, is_admin: true }, { onConflict: 'email' })
  if (error) console.error('[access] env 관리자 is_admin 동기화 실패', email, error.message)
}

/**
 * 이메일 하나를 신원으로 바꾼다. 미승인(관리자도 아니고 allowed_users 행도 없음)이면 null.
 * 세션이 아닌 경로(위젯 토큰 등)에서도 같은 규칙을 쓰기 위해 이메일을 인자로 받는다.
 */
export async function resolveAccessByEmail(rawEmail: string | null | undefined): Promise<AccessIdentity | null> {
  if (!rawEmail) return null
  const email = normalizeEmail(rawEmail)
  if (!email) return null

  const envAdmin = isEnvAdminEmail(email)

  const admin = createSupabaseAdminClient()
  const { data: row } = await admin
    .from('allowed_users')
    .select('email, is_admin, menu_permissions')
    .eq('email', email)
    .maybeSingle()

  // 관리자도 아니고 승인 행도 없으면 접근 불가(승인 취소·퇴사 포함).
  if (!row && !envAdmin) return null

  if (envAdmin && !row?.is_admin) await syncEnvAdminFlag(email)

  return {
    email,
    isAdmin: envAdmin || !!row?.is_admin,
    menuPermissions: (row?.menu_permissions ?? {}) as Record<string, MenuPermission>,
  }
}

/** 로그인 + 승인된 사용자의 신원. 세션이 없거나 미승인이면 null. */
export async function resolveSessionAccess(): Promise<AccessIdentity | null> {
  return resolveAccessByEmail(await getSessionEmail())
}

/** 관리자 세션이면 신원, 아니면 null. */
export async function requireAdminAccess(): Promise<AccessIdentity | null> {
  const access = await resolveSessionAccess()
  return access?.isAdmin ? access : null
}

/**
 * 메뉴 항목별 최종 권한. 신원이 없으면 'none'.
 * 관리자는 항상 write — app/components/PermissionsProvider.tsx의 클라이언트 규칙과 같다.
 */
export function menuPermissionOf(identity: AccessIdentity | null, key: string): MenuPermission {
  if (!identity) return 'none'
  if (identity.isAdmin) return 'write'
  return permissionFor(identity.menuPermissions, key)
}

/** 화면·출력처럼 데이터를 바꾸지 않는 접근 허용 여부(read 이상). */
export function canReadMenu(identity: AccessIdentity | null, key: string): boolean {
  return menuPermissionOf(identity, key) !== 'none'
}

/** 추가·수정·삭제 허용 여부(write). */
export function canWriteMenu(identity: AccessIdentity | null, key: string): boolean {
  return menuPermissionOf(identity, key) === 'write'
}
