'use client'

import { useState } from 'react'
import { useIsMobile } from '@/lib/useIsMobile'
import Sidebar from '@/app/sidebar'

interface Props {
  isAdmin: boolean
  userEmail: string
  hiddenMenuItems?: string[]
  children: React.ReactNode
}

export default function SidebarContainer({ isAdmin, userEmail, hiddenMenuItems, children }: Props) {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* 모바일 상단 바 */}
      {isMobile && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 200,
          height: 48, background: '#fff', borderBottom: '1px solid #e8e8e6',
          display: 'flex', alignItems: 'center', padding: '0 16px', gap: 12,
        }}>
          <button
            onClick={() => setOpen(true)}
            style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 20, color: '#333', padding: '4px 6px', lineHeight: 1 }}
          >☰</button>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#111', letterSpacing: '-0.2px' }}>미래사업팀 Hub</span>
        </div>
      )}

      {/* 데스크톱 사이드바 */}
      {!isMobile && (
        <Sidebar isAdmin={isAdmin} userEmail={userEmail} hiddenMenuItems={hiddenMenuItems} />
      )}

      {/* 모바일 오버레이 + 사이드바 */}
      {isMobile && open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.4)' }}
          />
          <div style={{
            position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 400,
            width: 240, boxShadow: '4px 0 20px rgba(0,0,0,0.15)',
          }}>
            <Sidebar isAdmin={isAdmin} userEmail={userEmail} hiddenMenuItems={hiddenMenuItems} onClose={() => setOpen(false)} />
          </div>
        </>
      )}

      {/* 메인 콘텐츠 */}
      <main style={{ flex: 1, minWidth: 0, ...(isMobile ? { marginTop: 48 } : {}) }}>
        {children}
      </main>
    </div>
  )
}
