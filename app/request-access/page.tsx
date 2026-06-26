'use client'

import { useState, useEffect, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

function RequestAccessForm() {
  const searchParams = useSearchParams()
  const [form, setForm] = useState({ name: '', email: searchParams.get('email') ?? '', reason: '' })
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [msg, setMsg] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('loading')
    const res = await fetch('/api/access-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await res.json()
    if (res.ok) {
      setStatus('done')
    } else {
      setStatus('error')
      setMsg(data.error ?? '오류가 발생했습니다')
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8f8f7' }}>
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8e8e6', padding: '40px 36px', width: 400, display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 28, marginBottom: 10 }}>🔑</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#111', marginBottom: 6 }}>접속 승인 요청</div>
          <div style={{ fontSize: 13, color: '#888', lineHeight: 1.6 }}>
            미래사업팀 Hub 접속 권한을 요청합니다.<br />관리자 승인 후 이용하실 수 있습니다.
          </div>
        </div>

        {status === 'done' ? (
          <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ fontSize: 40 }}>✅</div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#111', marginBottom: 6 }}>요청이 접수됐습니다!</div>
              <div style={{ fontSize: 13, color: '#888', lineHeight: 1.6 }}>관리자 승인 후 로그인하실 수 있습니다.</div>
            </div>
            <Link href="/login" style={{ padding: '10px', background: '#f4f4f2', borderRadius: 8, fontSize: 13, color: '#555', textDecoration: 'none', textAlign: 'center' }}>
              로그인 페이지로
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <div style={{ fontSize: 12, color: '#555', fontWeight: 500, marginBottom: 5 }}>이름 *</div>
              <input
                required
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="홍길동"
                style={{ width: '100%', padding: '9px 12px', border: '1px solid #e0e0de', borderRadius: 7, fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#555', fontWeight: 500, marginBottom: 5 }}>이메일 *</div>
              <input
                required
                type="email"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="user@example.com"
                style={{ width: '100%', padding: '9px 12px', border: '1px solid #e0e0de', borderRadius: 7, fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#555', fontWeight: 500, marginBottom: 5 }}>요청 사유 <span style={{ color: '#bbb', fontWeight: 400 }}>(선택)</span></div>
              <textarea
                value={form.reason}
                onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                placeholder="소속 및 접속이 필요한 이유를 간단히 적어주세요"
                rows={3}
                style={{ width: '100%', padding: '9px 12px', border: '1px solid #e0e0de', borderRadius: 7, fontSize: 13, outline: 'none', resize: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }}
              />
            </div>

            {status === 'error' && (
              <div style={{ padding: '9px 12px', background: '#fff5f5', border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, color: '#dc2626' }}>{msg}</div>
            )}

            <button
              type="submit"
              disabled={status === 'loading'}
              style={{ padding: '11px', background: '#111', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: status === 'loading' ? 'not-allowed' : 'pointer', opacity: status === 'loading' ? 0.6 : 1 }}
            >
              {status === 'loading' ? '요청 중...' : '접속 승인 요청하기'}
            </button>

            <div style={{ textAlign: 'center' }}>
              <Link href="/login" style={{ fontSize: 12, color: '#aaa', textDecoration: 'none' }}>← 로그인 페이지로</Link>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

export default function RequestAccessPage() {
  return (
    <Suspense>
      <RequestAccessForm />
    </Suspense>
  )
}
