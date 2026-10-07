import { requireMenu } from '@/lib/auth/menuAccess'

// 메뉴 권한이 none이면 화면을 그리기 전에 서버에서 막는다(직접 URL 접근 포함) — lib/auth/menuAccess.ts
export default async function TripMenuLayout({ children }: { children: React.ReactNode }) {
  await requireMenu('trip')
  return children
}
