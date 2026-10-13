import { redirect } from 'next/navigation'
import { getSessionEmail, resolveAccessByEmail } from '@/lib/access'
import SidebarContainer from '../components/SidebarContainer'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const email = await getSessionEmail()
  if (!email) redirect('/login')

  // 관리자 판정(ADMIN_EMAILS env 또는 allowed_users.is_admin)과 항목별 권한
  // (menu_permissions: none/read/write)은 lib/access.ts 한 곳에서 온다. 미승인 사용자는 여기서 걸린다.
  const access = await resolveAccessByEmail(email)
  if (!access) redirect('/unauthorized')

  // 관리자는 항상 전체 메뉴 쓰기 — 권한 맵을 내려보내지 않아 숨김(none) 대상도 생기지 않는다.
  // none은 사이드바에서 숨기고, read/write는 PermissionsProvider로 페이지들에 내려준다.
  const menuPermissions = access.isAdmin ? {} : access.menuPermissions
  const hiddenMenuItems = Object.entries(menuPermissions)
    .filter(([, v]) => v === 'none')
    .map(([k]) => k)

  return (
    <SidebarContainer isAdmin={access.isAdmin} userEmail={access.email} hiddenMenuItems={hiddenMenuItems} menuPermissions={menuPermissions}>
      {children}
    </SidebarContainer>
  )
}
