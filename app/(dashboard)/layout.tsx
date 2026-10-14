import { redirect } from 'next/navigation'
import { getMenuAccess } from '@/lib/auth/menuAccess'
import { permissionFor } from '@/lib/menuConfig'
import SidebarContainer from '../components/SidebarContainer'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // allowed_users 행이 있어야 접근 허용(admin client로 RLS 우회). 관리자(allowed_users.is_admin)는 전체 메뉴 쓰기,
  // 일반 사용자는 항목별 권한(menu_permissions: none/read/write — 무효값은 none으로 해석)을 읽어온다.
  // none은 사이드바에서 숨기고, read/write는 PermissionsProvider로 페이지들에 내려준다.
  // 판정·조회는 lib/auth/menuAccess.ts 한 곳 — 메뉴 폴더 layout.tsx의 requireMenu와 같은 요청 안에서 한 번만 조회한다.
  // (사이드바 숨김은 접근통제가 아니다 — 직접 URL 접근은 메뉴 폴더 layout.tsx가 막는다)
  const access = await getMenuAccess()
  if (!access) redirect('/login')
  if (!access.approved) redirect('/unauthorized')

  const menuPermissions = access.isAdmin ? {} : access.permissions
  // permissionFor로 판정 — 저장값이 무효('NONE' 등)면 none이므로 사이드바에서도 숨긴다(화면 가드와 같은 결과)
  const hiddenMenuItems = Object.keys(menuPermissions).filter(k => permissionFor(menuPermissions, k) === 'none')

  return (
    <SidebarContainer isAdmin={access.isAdmin} userEmail={access.email} hiddenMenuItems={hiddenMenuItems} menuPermissions={menuPermissions}>
      {children}
    </SidebarContainer>
  )
}
