import { redirect } from 'next/navigation'
import { getSessionEmail, requireAdminAccess } from '@/lib/access'
import AdminUserManager from './AdminUserManager'

export default async function AdminPage() {
  if (!(await getSessionEmail())) redirect('/login')
  // 관리자 판정은 lib/access.ts 한 곳 — ADMIN_EMAILS(env) 또는 allowed_users.is_admin.
  if (!(await requireAdminAccess())) redirect('/unauthorized')

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
