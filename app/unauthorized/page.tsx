'use client'

import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useEffect, useState } from 'react'

export default function UnauthorizedPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    supabase.auth.getUser().then(({ data }) => {
      const userEmail = data.user?.email
      if (!userEmail) return
      setEmail(userEmail)
      // 접속 시도 자동 기록
      fetch('/api/access-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: userEmail, type: 'attempt' }),
      }).catch(() => {})
    })
  }, [])

  async function handleLogout() {
    const supabase = createSupabaseBrowserClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8f8f7' }}>
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8e8e6', padding: '40px 36px', width: 380, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ fontSize: 32 }}>🔒</div>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#111', marginBottom: 6 }}>접근 권한이 없습니다</div>
          <div style={{ fontSize: 13, color: '#888', lineHeight: 1.6 }}>
            이 서비스는 승인된 사용자만 이용할 수 있습니다.
            {email && <><br /><span style={{ color: '#555', fontWeight: 500 }}>{email}</span> 계정으로 로그인됨</>}
          </div>
        </div>

        <Link
          href={`/request-access${email ? `?email=${encodeURIComponent(email)}` : ''}`}
          style={{ padding: '11px 16px', background: '#111', color: '#fff', borderRadius: 8, fontSize: 13, fontWeight: 500, textDecoration: 'none', display: 'block' }}
        >
          🔑 접속 승인 요청하기
        </Link>

        <button
          onClick={handleLogout}
          style={{ padding: '10px 16px', border: '1px solid #e8e8e6', borderRadius: 8, background: '#fff', cursor: 'pointer', fontSize: 13, color: '#555' }}
        >
          다른 계정으로 로그인
        </button>
      </div>
    </div>
  )
}
