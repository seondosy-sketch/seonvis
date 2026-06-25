'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'

const GROUPS = [
  {
    id: 'admin',
    label: '사무 보조',
    color: '#f59e0b',
    items: [
      { id: 1, label: '프로젝트 List',    href: null },
      { id: 2, label: '주간/월간보고',     href: '/weekly' },
      { id: 3, label: '근태관리',          href: null },
      { id: 4, label: '기술인 주소록',     href: null },
      { id: 5, label: '현장 현황',         href: null },
    ],
  },
  {
    id: 'work',
    label: '업무 보조',
    color: '#eab308',
    items: [
      { id: 6, label: 'Calendar',         href: null },
      { id: 7, label: '공고/개찰',         href: null },
      { id: 8, label: 'Maps',             href: null },
      { id: 9, label: '환경영향평가',       href: null },
    ],
  },
  {
    id: 'db',
    label: 'DB Bank',
    color: '#0ea5e9',
    items: [
      { id: 10, label: '기술인 경력 DB',   href: null },
      { id: 11, label: '제안서 DB',        href: null },
    ],
  },
]

interface SidebarProps {
  isAdmin?: boolean
  userEmail?: string
}

export default function Sidebar({ isAdmin, userEmail }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()

  async function handleLogout() {
    const supabase = createSupabaseBrowserClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <aside style={{
      width: 220,
      minHeight: '100vh',
      background: '#fff',
      borderRight: '1px solid #e8e8e6',
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,
    }}>
      {/* Logo */}
      <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid #f0f0ee', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#111', letterSpacing: '-0.2px' }}>미래사업팀 Hub</div>
        </div>
        {isAdmin && (
          <Link href={pathname === '/admin' ? '/weekly' : '/admin'} style={{ textDecoration: 'none' }}>
            <div style={{
              fontSize: 11, fontWeight: 600,
              color: pathname === '/admin' ? '#2563eb' : '#888',
              background: pathname === '/admin' ? '#eff6ff' : '#f4f4f2',
              border: `1px solid ${pathname === '/admin' ? '#bfdbfe' : '#e8e8e6'}`,
              borderRadius: 5,
              padding: '3px 8px',
              whiteSpace: 'nowrap',
              cursor: 'pointer',
            }}>
              {pathname === '/admin' ? '← 뒤로' : '⚙ 관리자'}
            </div>
          </Link>
        )}
      </div>

      {/* Nav groups */}
      <nav style={{ padding: '12px 12px', flex: 1, display: 'flex', flexDirection: 'column', gap: 18 }}>
        {GROUPS.map(group => (
          <div key={group.id}>
            <div style={{
              fontSize: 13, fontWeight: 700, color: '#444',
              background: '#f0f0ee',
              padding: '5px 10px', borderRadius: 4, marginBottom: 4,
            }}>
              {group.label}
            </div>

            <div style={{ padding: '0' }}>
              {group.items.map(item => {
                const isActive = item.href
                  ? pathname === item.href || pathname.startsWith(item.href)
                  : false
                const isReady = !!item.href

                if (!isReady) {
                  return (
                    <div key={item.id} style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '6px 10px', opacity: 0.45, cursor: 'default',
                    }}>
                      <span style={{ fontSize: 13, color: '#555', flex: 1 }}>{item.label}</span>
                      <span style={{
                        fontSize: 9, color: '#bbb', background: '#f4f4f2',
                        padding: '1px 5px', borderRadius: 3, whiteSpace: 'nowrap',
                      }}>준비중</span>
                    </div>
                  )
                }

                return (
                  <Link key={item.id} href={item.href!} style={{ textDecoration: 'none' }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '6px 10px', cursor: 'pointer',
                      background: isActive ? '#fef9f0' : 'transparent',
                      borderRight: isActive ? `2px solid ${group.color}` : '2px solid transparent',
                    }}>
                      <span style={{
                        fontSize: 13, flex: 1,
                        color: isActive ? '#111' : '#444',
                        fontWeight: isActive ? 600 : 400,
                      }}>{item.label}</span>
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>
        ))}

        {/* 관리자 메뉴 */}
        {isAdmin && (
          <div>
            <div style={{
              fontSize: 13, fontWeight: 700, color: '#444',
              background: '#f0f0ee',
              padding: '5px 10px', borderRadius: 4, marginBottom: 4,
            }}>
              관리자
            </div>
            <Link href="/admin" style={{ textDecoration: 'none' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 10px', cursor: 'pointer',
                background: pathname === '/admin' ? '#f0f7ff' : 'transparent',
                borderRight: pathname === '/admin' ? '2px solid #0ea5e9' : '2px solid transparent',
              }}>
                <span style={{
                  fontSize: 13, flex: 1,
                  color: pathname === '/admin' ? '#111' : '#444',
                  fontWeight: pathname === '/admin' ? 600 : 400,
                }}>사용자 관리</span>
              </div>
            </Link>
          </div>
        )}
      </nav>

      {/* Footer */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid #f0f0ee', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {userEmail && (
          <div style={{ fontSize: 11, color: '#999', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {userEmail}
          </div>
        )}
        <div style={{ fontSize: 11, color: '#ccc' }}>미래사업팀 · {new Date().getFullYear()}</div>
        <button
          onClick={handleLogout}
          style={{
            width: '100%',
            padding: '6px 10px',
            border: '1px solid #e8e8e6',
            borderRadius: 6,
            background: '#fff',
            cursor: 'pointer',
            fontSize: 12,
            color: '#666',
            textAlign: 'left',
          }}
        >
          로그아웃
        </button>
      </div>
    </aside>
  )
}
