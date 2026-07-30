/**
 * 서비스 계정이 접근할 수 있는 캘린더 목록. 관리자 전용.
 *
 * 서비스 계정은 공유를 자동 수락하지 않아 공유만 해두면 목록이 비어 있을 수 있다(실측 확인).
 * 그래서 `?add=<calendarId>`로 Calendar ID를 받아 먼저 목록에 등록한 뒤 조회한다.
 * 캘린더를 새로 만들지는 않는다.
 */
import { NextResponse } from 'next/server'
import { isServiceAccountConfigured, serviceAccountEmail } from '@/lib/googleCalendar/auth'
import { addCalendarToList, listCalendars } from '@/lib/googleCalendar/client'
import { requireAdmin } from '@/lib/googleCalendar/guard'

export async function GET(request: Request) {
  const email = await requireAdmin()
  if (!email) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!isServiceAccountConfigured()) {
    return NextResponse.json({ error: '서비스 계정 환경변수(GOOGLE_SA_*)가 설정되지 않았습니다' }, { status: 400 })
  }

  const add = new URL(request.url).searchParams.get('add')?.trim()

  try {
    let addError: string | null = null
    if (add) {
      try {
        await addCalendarToList(add)
      } catch (e) {
        // 공유가 안 돼 있으면 여기서 막힌다 — 무엇을 해야 하는지 화면에 알려준다.
        addError = e instanceof Error ? e.message : String(e)
      }
    }

    const items = await listCalendars()
    return NextResponse.json({
      serviceAccountEmail: serviceAccountEmail(),
      calendars: items.map(c => ({
        id: c.id,
        summary: c.summary,
        timeZone: c.timeZone ?? null,
        accessRole: c.accessRole ?? null,
        writable: ['writer', 'owner'].includes(c.accessRole ?? ''),
      })),
      addError,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '목록 조회 실패' }, { status: 502 })
  }
}
