import { requireAdminPage } from '@/lib/auth/menuAccess'
import AdminUserManager from './AdminUserManager'

export default async function AdminPage() {
  // 관리자 = DB allowed_users.is_admin(매 요청 서버 조회). 로그인 없음 → /login, 관리자 아님 → /unauthorized
  await requireAdminPage()

  return (
    <div style={{ padding: '32px 40px', maxWidth: 700 }}>
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#111' }}>사용자 관리</div>
        <div style={{ fontSize: 13, color: '#888', marginTop: 4 }}>승인된 사용자만 서비스에 접근할 수 있습니다.</div>
      </div>
      <AdminUserManager />
    </div>
  )
}
