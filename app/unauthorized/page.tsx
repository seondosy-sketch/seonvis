'use client'

import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { useRouter } from 'next/navigation'

export default function UnauthorizedPage() {
  const router = useRouter()

  async function handleLogout() {
    const supabase = createSupabaseBrowserClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#f8f8f7',
    }}>
      <div style={{
        background: '#fff',
        borderRadius: 12,
        border: '1px solid #e8e8e6',
        padding: '40px 36px',
        width: 360,
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}>
        <div style={{ fontSize: 32 }}>🔒</div>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#111', marginBottom: 6 }}>접근 권한이 없습니다</div>
          <div style={{ fontSize: 13, color: '#888', lineHeight: 1.6 }}>
            이 서비스는 승인된 사용자만 이용할 수 있습니다.<br />
            관리자에게 접근 권한을 요청해 주세요.
          </div>
        </div>
        <button
          onClick={handleLogout}
          style={{
            padding: '10px 16px',
            border: '1px solid #e8e8e6',
            borderRadius: 8,
            background: '#fff',
            cursor: 'pointer',
            fontSize: 13,
            color: '#555',
          }}
        >
          다른 계정으로 로그인
        </button>
      </div>
    </div>
  )
}
