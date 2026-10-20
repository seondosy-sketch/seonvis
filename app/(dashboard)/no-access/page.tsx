import Link from 'next/link'
import { RESTRICTABLE_MENU_ITEMS } from '@/lib/menuConfig'

/**
 * 메뉴 권한이 none인 승인 사용자가 그 메뉴 주소로 직접 들어왔을 때 보내는 화면(lib/auth/menuAccess.ts requireMenu).
 * 미승인 사용자용 /unauthorized(접근 신청·시도 기록)와 다르다 — 승인된 사용자이므로 사이드바는 그대로 둔다.
 */
export default async function NoAccessPage({ searchParams }: { searchParams: Promise<{ menu?: string }> }) {
  const { menu } = await searchParams
  const label = RESTRICTABLE_MENU_ITEMS.find(m => m.key === menu)?.label
  return (
    <div style={{ minHeight: '100vh', background: '#f8f8f7', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: '#fff', border: '1px solid #e8e8e6', borderRadius: 10, padding: '28px 32px', maxWidth: 420, textAlign: 'center' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#111', marginBottom: 8 }}>
          {label ? `'${label}' 메뉴를 볼 권한이 없습니다` : '이 메뉴를 볼 권한이 없습니다'}
        </div>
        <div style={{ fontSize: 13, color: '#666', lineHeight: 1.6, marginBottom: 18 }}>
          필요하면 관리자에게 메뉴 권한을 요청하세요.
        </div>
        <Link href="/" style={{ display: 'inline-block', padding: '8px 16px', borderRadius: 6, background: '#111', color: '#fff', fontSize: 13, textDecoration: 'none' }}>
          홈으로
        </Link>
      </div>
    </div>
  )
}
