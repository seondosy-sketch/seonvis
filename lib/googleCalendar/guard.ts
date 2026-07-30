/**
 * 캘린더 연동 API의 접근 제어.
 *
 * 연결·해제·전체 재동기화는 **관리자만** (요구사항). 반면 프로젝트를 저장·삭제한 직후 자동으로
 * 도는 단건 동기화는 그 프로젝트를 저장할 수 있었던 사용자면 되므로 승인 사용자까지 허용한다.
 * 판정 기준은 app/(dashboard)/layout.tsx·app/api/admin/*과 같다.
 */
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { createSupabaseServerClient } from '@/lib/supabase-server'

function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? '').split(',').map(e => e.trim()).filter(Boolean)
}

async function sessionEmail(): Promise<string | null> {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user?.email ?? null
}

/** 관리자 이메일이면 반환, 아니면 null */
export async function requireAdmin(): Promise<string | null> {
  const email = await sessionEmail()
  if (!email) return null
  return adminEmails().includes(email) ? email : null
}

/** 관리자이거나 allowed_users에 있는 사용자면 반환, 아니면 null */
export async function requireAllowedUser(): Promise<string | null> {
  const email = await sessionEmail()
  if (!email) return null
  if (adminEmails().includes(email)) return email

  const admin = createSupabaseAdminClient()
  const { data } = await admin
    .from('allowed_users')
    .select('email')
    .eq('email', email.toLowerCase().trim())
    .maybeSingle()
  return data ? email : null
}
