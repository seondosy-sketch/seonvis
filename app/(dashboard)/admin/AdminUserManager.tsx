'use client'

import { useEffect, useState } from 'react'

interface AllowedUser {
  id: string
  email: string
  is_admin: boolean
  added_by_email: string | null
  created_at: string
}

export default function AdminUserManager() {
  const [users, setUsers] = useState<AllowedUser[]>([])
  const [loading, setLoading] = useState(true)
  const [newEmail, setNewEmail] = useState('')
  const [newIsAdmin, setNewIsAdmin] = useState(false)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function fetchUsers() {
    setLoading(true)
    const res = await fetch('/api/admin/users')
    if (res.ok) setUsers(await res.json())
    setLoading(false)
  }

  useEffect(() => { fetchUsers() }, [])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!newEmail.trim()) return
    setAdding(true)
    setError(null)
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: newEmail.trim(), is_admin: newIsAdmin }),
    })
    if (res.ok) {
      setNewEmail('')
      setNewIsAdmin(false)
      await fetchUsers()
    } else {
      const d = await res.json()
      setError(d.error ?? '오류가 발생했습니다')
    }
    setAdding(false)
  }

  async function handleDelete(email: string) {
    if (!confirm(`${email} 사용자를 삭제하시겠습니까?`)) return
    const res = await fetch('/api/admin/users', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    if (res.ok) await fetchUsers()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* 추가 폼 */}
      <div style={{
        background: '#fff', border: '1px solid #e8e8e6', borderRadius: 10, padding: '20px 24px',
      }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#333', marginBottom: 14 }}>사용자 추가</div>
        <form onSubmit={handleAdd} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>이메일</div>
            <input
              type="email"
              value={newEmail}
              onChange={e => setNewEmail(e.target.value)}
              placeholder="user@example.com"
              required
              style={{
                width: '100%', padding: '8px 12px', border: '1px solid #e0e0de',
                borderRadius: 6, fontSize: 13, outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#555', paddingBottom: 2 }}>
            <input
              type="checkbox"
              checked={newIsAdmin}
              onChange={e => setNewIsAdmin(e.target.checked)}
            />
            관리자
          </label>
          <button
            type="submit"
            disabled={adding}
            style={{
              padding: '8px 18px', background: '#111', color: '#fff',
              border: 'none', borderRadius: 6, fontSize: 13, cursor: adding ? 'not-allowed' : 'pointer',
              opacity: adding ? 0.6 : 1,
            }}
          >
            {adding ? '추가 중...' : '추가'}
          </button>
        </form>
        {error && (
          <div style={{ marginTop: 10, fontSize: 12, color: '#dc2626' }}>{error}</div>
        )}
      </div>

      {/* 사용자 목록 */}
      <div style={{
        background: '#fff', border: '1px solid #e8e8e6', borderRadius: 10, overflow: 'hidden',
      }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid #f0f0ee', fontSize: 14, fontWeight: 600, color: '#333' }}>
          승인된 사용자 ({users.length}명)
        </div>
        {loading ? (
          <div style={{ padding: '24px', textAlign: 'center', fontSize: 13, color: '#aaa' }}>불러오는 중...</div>
        ) : users.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', fontSize: 13, color: '#aaa' }}>승인된 사용자가 없습니다.</div>
        ) : (
          <div>
            {users.map((u, i) => (
              <div key={u.id} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 24px',
                borderBottom: i < users.length - 1 ? '1px solid #f4f4f2' : 'none',
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13, color: '#222', fontWeight: 500 }}>{u.email}</span>
                    {u.is_admin && (
                      <span style={{
                        fontSize: 10, background: '#eff6ff', color: '#2563eb',
                        padding: '1px 7px', borderRadius: 10, fontWeight: 600,
                      }}>관리자</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: '#bbb', marginTop: 2 }}>
                    {new Date(u.created_at).toLocaleDateString('ko-KR')} 추가
                    {u.added_by_email && ` · ${u.added_by_email}`}
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(u.email)}
                  style={{
                    padding: '4px 12px', border: '1px solid #fecaca',
                    borderRadius: 5, background: '#fff5f5',
                    color: '#dc2626', fontSize: 12, cursor: 'pointer',
                  }}
                >
                  삭제
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
