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

  // 관리자는 항상 접근 허용 + 전체 메뉴 쓰기. 일반 사용자는 allowed_users 테이블 확인
  // (admin client로 RLS 우회) 겸 항목별 권한(menu_permissions: none/read/write)을 읽어온다.
  // none은 사이드바에서 숨기고, read/write는 PermissionsProvider로 페이지들에 내려준다.
  let menuPermissions: Record<string, 'none' | 'read' | 'write'> = {}
  if (!isAdmin) {
    const admin = createSupabaseAdminClient()
    const { data } = await admin
      .from('allowed_users')
      .select('email, menu_permissions')
      .eq('email', user.email.toLowerCase().trim())
      .maybeSingle()

    if (!data) redirect('/unauthorized')
    menuPermissions = data.menu_permissions ?? {}
  }
  const hiddenMenuItems = Object.entries(menuPermissions)
    .filter(([, v]) => v === 'none')
    .map(([k]) => k)

  return (
    <SidebarContainer isAdmin={isAdmin} userEmail={user.email} hiddenMenuItems={hiddenMenuItems} menuPermissions={menuPermissions}>
      {children}
    </SidebarContainer>
  )
}
