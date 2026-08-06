import { redirect } from 'next/navigation'
import { getSessionEmail, requireAdminAccess } from '@/lib/access'
import CalendarConnectionManager from './CalendarConnectionManager'

/**
 * Google Calendar 연동 설정 — 관리자 전용.
 * 접근 판정은 기존 /admin 페이지와 같은 방식(lib/access.ts).
 */
export default async function CalendarAdminPage() {
  if (!(await getSessionEmail())) redirect('/login')
  if (!(await requireAdminAccess())) redirect('/unauthorized')

  return (
    <div style={{ padding: '32px 40px', maxWidth: 820 }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#111' }}>Google Calendar 연동</div>
        <div style={{ fontSize: 13, color: '#888', marginTop: 4 }}>
          프로젝트 일정을 <b>미래사업팀</b> 캘린더로 단방향 전송합니다. Hub가 원본이며, 캘린더에서 직접 고친 내용은 가져오지 않습니다.
        </div>
      </div>
      <CalendarConnectionManager />
    </div>
  )
}
