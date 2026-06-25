import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import AdminUserManager from './AdminUserManager'

function getAdminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? '').split(',').map(e => e.trim()).filter(Boolean)
}

export default async function AdminPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user?.email) redirect('/login')
  if (!getAdminEmails().includes(user.email)) redirect('/unauthorized')

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
