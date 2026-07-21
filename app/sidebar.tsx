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
      { id: 1, label: '프로젝트 List',    key: 'projects', href: '/projects' },
      { id: 2, label: '주간/월간보고',     key: 'weekly', href: '/weekly' },
      { id: 3, label: '근태관리',          href: null, children: [
        { id: 12, label: '연장근무',       key: 'overtime', href: '/overtime' },
        { id: 13, label: '휴가관리',       key: 'leave', href: '/leave' },
        { id: 14, label: '기술인 출근부',  key: 'attendance', href: '/attendance' },
      ] },
      { id: 4, label: '기술인 주소록',     key: 'engineers', href: '/engineers' },
      { id: 5, label: '현장 현황',         key: 'sites', href: '/sites' },
    ],
  },
  {
    id: 'work',
    label: '업무 보조',
    color: '#eab308',
    items: [
      { id: 6, label: '출장지원',          key: 'trip', href: '/trip' },
      { id: 7, label: '공고/개찰',         href: null },
      { id: 8, label: 'WEB 검색',           key: 'web', href: '/web' },
      { id: 9, label: '환경영향평가',       href: null },
    ],
  },
  {
    id: 'db',
    label: 'DB Bank',
    color: '#0ea5e9',
    items: [
      { id: 10, label: '기술인 경력 DB',   href: null },
      { id: 11, label: '제안서 DB',        key: 'proposal_db', href: 'https://proposal-db-mvp.vercel.app/' },
    ],
  },
]

/**
 * 사람별로 숨겨진 메뉴(hiddenMenuItems, lib/menuConfig.ts의 key 기준)를 제외한 그룹 목록을 만든다.
 * 하위 메뉴가 전부 숨겨지면 부모(예: 근태관리)도 같이 뺀다 — 부모는 자식을 담는 껍데기일 뿐 자체
 * href가 없으니, 자식이 하나도 안 보이면 빈 헤더만 남는 게 어색하기 때문.
 */
function filterHiddenItems(items: typeof GROUPS[number]['items'], hiddenMenuItems: string[]) {
  return items
    .map(item => {
      if ('children' in item && item.children) {
        const visibleChildren = item.children.filter(c => !hiddenMenuItems.includes(c.key))
        return visibleChildren.length > 0 ? { ...item, children: visibleChildren } : null
      }
      const key = 'key' in item ? item.key : undefined
      return key && hiddenMenuItems.includes(key) ? null : item
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
}

interface SidebarProps {
  isAdmin?: boolean
  userEmail?: string
  hiddenMenuItems?: string[]
  onClose?: () => void
}

export default function Sidebar({ isAdmin, userEmail, hiddenMenuItems = [], onClose }: SidebarProps) {
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
          <Link href="/" onClick={onClose} style={{ textDecoration: 'none' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#111', letterSpacing: '-0.2px', cursor: 'pointer' }}>미래사업팀 Hub</div>
          </Link>
        </div>
        {onClose && (
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 18, color: '#aaa', padding: '2px 4px', lineHeight: 1 }}>✕</button>
        )}
        {isAdmin && (
          <Link href={pathname === '/admin' ? '/' : '/admin'} style={{ textDecoration: 'none' }}>
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
              {filterHiddenItems(group.items, hiddenMenuItems).map(item => {
                const children = 'children' in item ? item.children : undefined
                const isActive = item.href
                  ? pathname === item.href || pathname.startsWith(item.href)
                  : false
                const isReady = !!item.href

                // 하위 메뉴가 있는 항목: 부모는 클릭 불가 헤더로만 표시하고, 자식만 실제 링크로 표시한다.
                if (children?.length) {
                  return (
                    <div key={item.id}>
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '6px 10px', cursor: 'default',
                      }}>
                        <span style={{ fontSize: 13, color: '#555', flex: 1 }}>{item.label}</span>
                      </div>
                      {children.map(child => {
                        const childActive = pathname === child.href || pathname.startsWith(child.href)
                        return (
                          <Link key={child.id} href={child.href} onClick={onClose} style={{ textDecoration: 'none' }}>
                            <div style={{
                              display: 'flex', alignItems: 'center', gap: 8,
                              padding: '6px 10px 6px 22px', cursor: 'pointer',
                              background: childActive ? '#fef9f0' : 'transparent',
                              borderRight: childActive ? `2px solid ${group.color}` : '2px solid transparent',
                            }}>
                              <span style={{
                                fontSize: 13, flex: 1,
                                color: childActive ? '#111' : '#444',
                                fontWeight: childActive ? 600 : 400,
                              }}>{child.label}</span>
                            </div>
                          </Link>
                        )
                      })}
                    </div>
                  )
                }

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

                const isExternal = item.href!.startsWith('http')
                const inner = (
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
                )
                return isExternal ? (
                  <a key={item.id} href={item.href!} target="_blank" rel="noopener noreferrer" onClick={onClose} style={{ textDecoration: 'none' }}>{inner}</a>
                ) : (
                  <Link key={item.id} href={item.href!} onClick={onClose} style={{ textDecoration: 'none' }}>{inner}</Link>
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
