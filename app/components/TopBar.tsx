'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

interface TopBarProps {
  isAdmin: boolean
}

export default function TopBar({ isAdmin }: TopBarProps) {
  const pathname = usePathname()
  const isAdminPage = pathname === '/admin'

  if (!isAdmin) return null

  return (
    <div style={{
      position: 'fixed',
      top: 16,
      right: 24,
      zIndex: 100,
    }}>
      <Link href={isAdminPage ? '/weekly' : '/admin'} style={{ textDecoration: 'none' }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '7px 14px',
          background: isAdminPage ? '#f0f7ff' : '#111',
          border: isAdminPage ? '1px solid #bfdbfe' : '1px solid #111',
          borderRadius: 8,
          fontSize: 13,
          fontWeight: 500,
          color: isAdminPage ? '#2563eb' : '#fff',
          cursor: 'pointer',
          boxShadow: '0 1px 4px rgba(0,0,0,0.10)',
          transition: 'opacity 0.15s',
        }}>
          {isAdminPage ? (
            <>← 대시보드로</>
          ) : (
            <>⚙ 관리자</>
          )}
        </div>
      </Link>
    </div>
  )
}
