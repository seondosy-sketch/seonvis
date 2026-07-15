'use client'

import { useEffect, useState } from 'react'
import { MenuPermission, PERMISSION_LABEL, RESTRICTABLE_MENU_ITEMS, permissionFor } from '@/lib/menuConfig'

interface AllowedUser {
  id: string
  email: string
  is_admin: boolean
  added_by_email: string | null
  created_at: string
  menu_permissions: Record<string, MenuPermission> | null
}

interface AccessRequest {
  id: string
  email: string
  name: string
  reason: string
  status: 'pending' | 'approved' | 'rejected'
  type: 'request' | 'attempt'
  created_at: string
  reviewed_at: string | null
  reviewed_by: string | null
}

export default function AdminUserManager() {
  const [tab, setTab] = useState<'users' | 'requests'>('users')
  const [users, setUsers] = useState<AllowedUser[]>([])
  const [requests, setRequests] = useState<AccessRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [reqLoading, setReqLoading] = useState(true)
  const [newEmail, setNewEmail] = useState('')
  const [newIsAdmin, setNewIsAdmin] = useState(false)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedEmail, setExpandedEmail] = useState<string | null>(null)
  const [savingPerms, setSavingPerms] = useState<string | null>(null)

  async function fetchUsers() {
    setLoading(true)
    const res = await fetch('/api/admin/users')
    if (res.ok) setUsers(await res.json())
    setLoading(false)
  }

  async function fetchRequests() {
    setReqLoading(true)
    const res = await fetch('/api/admin/access-requests')
    if (res.ok) setRequests(await res.json())
    setReqLoading(false)
  }

  useEffect(() => { fetchUsers(); fetchRequests() }, [])

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

  async function setPermission(u: AllowedUser, key: string, value: MenuPermission) {
    // write(기본)는 저장하지 않고 키를 지운다 — 새 메뉴가 추가돼도 자동으로 쓰기가 되게
    const next = { ...(u.menu_permissions ?? {}) }
    if (value === 'write') delete next[key]
    else next[key] = value
    setSavingPerms(u.email)
    const res = await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: u.email, menu_permissions: next }),
    })
    if (res.ok) await fetchUsers()
    setSavingPerms(null)
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

  async function handleReview(id: string, email: string, status: 'approved' | 'rejected') {
    const res = await fetch('/api/admin/access-requests', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, email, status }),
    })
    if (res.ok) {
      await fetchRequests()
      if (status === 'approved') await fetchUsers()
    }
  }

  async function handleDeleteRequest(id: string) {
    const res = await fetch('/api/admin/access-requests', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (res.ok) await fetchRequests()
  }

  const pendingCount = requests.filter(r => r.status === 'pending').length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* 탭 */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #e8e8e6' }}>
        {([['users', '승인된 사용자'], ['requests', '승인 요청']] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              padding: '10px 20px',
              background: 'none',
              border: 'none',
              borderBottom: tab === key ? '2px solid #111' : '2px solid transparent',
              fontSize: 13,
              fontWeight: tab === key ? 600 : 400,
              color: tab === key ? '#111' : '#888',
              cursor: 'pointer',
              position: 'relative',
            }}
          >
            {label}
            {key === 'requests' && pendingCount > 0 && (
              <span style={{
                marginLeft: 6, background: '#dc2626', color: '#fff',
                fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10,
              }}>{pendingCount}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'users' && (
        <>
          {/* 추가 폼 */}
          <div style={{ background: '#fff', border: '1px solid #e8e8e6', borderRadius: 10, padding: '20px 24px' }}>
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
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #e0e0de', borderRadius: 6, fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#555', paddingBottom: 2 }}>
                <input type="checkbox" checked={newIsAdmin} onChange={e => setNewIsAdmin(e.target.checked)} />
                관리자
              </label>
              <button
                type="submit"
                disabled={adding}
                style={{ padding: '8px 18px', background: '#111', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, cursor: adding ? 'not-allowed' : 'pointer', opacity: adding ? 0.6 : 1 }}
              >
                {adding ? '추가 중...' : '추가'}
              </button>
            </form>
            {error && <div style={{ marginTop: 10, fontSize: 12, color: '#dc2626' }}>{error}</div>}
          </div>

          {/* 사용자 목록 */}
          <div style={{ background: '#fff', border: '1px solid #e8e8e6', borderRadius: 10, overflow: 'hidden' }}>
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
                  <div key={u.id} style={{ borderBottom: i < users.length - 1 ? '1px solid #f4f4f2' : 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 24px' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 13, color: '#222', fontWeight: 500 }}>{u.email}</span>
                          {u.is_admin && (
                            <span style={{ fontSize: 10, background: '#eff6ff', color: '#2563eb', padding: '1px 7px', borderRadius: 10, fontWeight: 600 }}>관리자</span>
                          )}
                          {(() => {
                            const perms = Object.values(u.menu_permissions ?? {})
                            const hidden = perms.filter(v => v === 'none').length
                            const readOnly = perms.filter(v => v === 'read').length
                            return (
                              <>
                                {hidden > 0 && <span style={{ fontSize: 10, background: '#fef3c7', color: '#92400e', padding: '1px 7px', borderRadius: 10, fontWeight: 600 }}>숨김 {hidden}</span>}
                                {readOnly > 0 && <span style={{ fontSize: 10, background: '#e0f2fe', color: '#0369a1', padding: '1px 7px', borderRadius: 10, fontWeight: 600 }}>읽기 {readOnly}</span>}
                              </>
                            )
                          })()}
                        </div>
                        <div style={{ fontSize: 11, color: '#bbb', marginTop: 2 }}>
                          {new Date(u.created_at).toLocaleDateString('ko-KR')} 추가
                          {u.added_by_email && ` · ${u.added_by_email}`}
                        </div>
                      </div>
                      <button
                        onClick={() => setExpandedEmail(expandedEmail === u.email ? null : u.email)}
                        style={{ padding: '4px 12px', border: '1px solid #e8e8e6', borderRadius: 5, background: expandedEmail === u.email ? '#f4f4f2' : '#fff', color: '#555', fontSize: 12, cursor: 'pointer' }}
                      >
                        메뉴 권한
                      </button>
                      <button
                        onClick={() => handleDelete(u.email)}
                        style={{ padding: '4px 12px', border: '1px solid #fecaca', borderRadius: 5, background: '#fff5f5', color: '#dc2626', fontSize: 12, cursor: 'pointer' }}
                      >
                        삭제
                      </button>
                    </div>
                    {expandedEmail === u.email && (
                      <div style={{ padding: '4px 24px 14px', background: '#fafafa' }}>
                        <div style={{ fontSize: 11, color: '#888', marginBottom: 10 }}>
                          쓰기 = 전체 사용 · 읽기 = 조회만 가능(추가/수정/삭제 버튼 숨김) · 숨김 = 사이드바에서 제거
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: '8px 20px' }}>
                          {RESTRICTABLE_MENU_ITEMS.map(item => {
                            const current = permissionFor(u.menu_permissions, item.key)
                            return (
                              <div key={item.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontSize: 12, color: '#555', flex: 1, whiteSpace: 'nowrap' }}>{item.label}</span>
                                <div style={{ display: 'flex', border: '1px solid #e0e0de', borderRadius: 5, overflow: 'hidden' }}>
                                  {(['write', 'read', 'none'] as MenuPermission[]).map(v => (
                                    <button
                                      key={v}
                                      disabled={savingPerms === u.email}
                                      onClick={() => { if (current !== v) setPermission(u, item.key, v) }}
                                      style={{
                                        padding: '3px 9px', border: 'none', fontSize: 11, cursor: 'pointer',
                                        background: current === v ? (v === 'write' ? '#111' : v === 'read' ? '#0369a1' : '#92400e') : '#fff',
                                        color: current === v ? '#fff' : '#888',
                                        fontWeight: current === v ? 600 : 400,
                                        opacity: savingPerms === u.email ? 0.5 : 1,
                                      }}
                                    >
                                      {PERMISSION_LABEL[v]}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'requests' && (
        <div style={{ background: '#fff', border: '1px solid #e8e8e6', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ padding: '16px 24px', borderBottom: '1px solid #f0f0ee', fontSize: 14, fontWeight: 600, color: '#333' }}>
            접속 승인 요청 ({requests.length}건)
          </div>
          {reqLoading ? (
            <div style={{ padding: '24px', textAlign: 'center', fontSize: 13, color: '#aaa' }}>불러오는 중...</div>
          ) : requests.length === 0 ? (
            <div style={{ padding: '24px', textAlign: 'center', fontSize: 13, color: '#aaa' }}>접속 요청이 없습니다.</div>
          ) : (
            <div>
              {requests.map((r, i) => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 24px', borderBottom: i < requests.length - 1 ? '1px solid #f4f4f2' : 'none' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
                      <span style={{
                        fontSize: 10, padding: '1px 7px', borderRadius: 10, fontWeight: 600,
                        background: r.type === 'attempt' ? '#f3f4f6' : '#eff6ff',
                        color: r.type === 'attempt' ? '#6b7280' : '#2563eb',
                      }}>
                        {r.type === 'attempt' ? '접속 시도' : '승인 요청'}
                      </span>
                      {r.name && <span style={{ fontSize: 13, color: '#222', fontWeight: 500 }}>{r.name}</span>}
                      <span style={{ fontSize: 12, color: '#666' }}>{r.email}</span>
                      <span style={{
                        fontSize: 10, padding: '1px 7px', borderRadius: 10, fontWeight: 600,
                        background: r.status === 'pending' ? '#fef3c7' : r.status === 'approved' ? '#dcfce7' : '#fee2e2',
                        color: r.status === 'pending' ? '#92400e' : r.status === 'approved' ? '#166534' : '#991b1b',
                      }}>
                        {r.status === 'pending' ? '대기' : r.status === 'approved' ? '승인' : '거절'}
                      </span>
                    </div>
                    {r.reason && <div style={{ fontSize: 12, color: '#888', marginBottom: 3 }}>{r.reason}</div>}
                    <div style={{ fontSize: 11, color: '#bbb' }}>
                      {new Date(r.created_at).toLocaleDateString('ko-KR')} 요청
                      {r.reviewed_by && ` · ${r.reviewed_by} 처리`}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    {r.status === 'pending' && (
                      <>
                        <button
                          onClick={() => handleReview(r.id, r.email, 'approved')}
                          style={{ padding: '4px 12px', border: '1px solid #86efac', borderRadius: 5, background: '#f0fdf4', color: '#166534', fontSize: 12, cursor: 'pointer' }}
                        >
                          승인
                        </button>
                        <button
                          onClick={() => handleReview(r.id, r.email, 'rejected')}
                          style={{ padding: '4px 12px', border: '1px solid #fca5a5', borderRadius: 5, background: '#fff5f5', color: '#dc2626', fontSize: 12, cursor: 'pointer' }}
                        >
                          거절
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => handleDeleteRequest(r.id)}
                      style={{ padding: '4px 10px', border: '1px solid #e8e8e6', borderRadius: 5, background: '#fff', color: '#999', fontSize: 12, cursor: 'pointer' }}
                    >
                      삭제
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
