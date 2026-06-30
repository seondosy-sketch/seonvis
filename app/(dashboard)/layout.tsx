import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import SidebarContainer from '../components/SidebarContainer'

function getAdminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? '').split(',').map(e => e.trim()).filter(Boolean)
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user?.email) redirect('/login')

  const adminEmails = getAdminEmails()
  const isAdmin = adminEmails.includes(user.email)

  // 관리자는 항상 접근 허용, 일반 사용자는 allowed_users 테이블 확인 (admin client로 RLS 우회)
  if (!isAdmin) {
    const admin = createSupabaseAdminClient()
    const { data } = await admin
      .from('allowed_users')
      .select('email')
      .eq('email', user.email.toLowerCase().trim())
      .maybeSingle()

    if (!data) redirect('/unauthorized')
  }

  return (
    <SidebarContainer isAdmin={isAdmin} userEmail={user.email}>
      {children}
    </SidebarContainer>
  )
}
