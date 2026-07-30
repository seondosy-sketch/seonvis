/**
 * Google Calendar 연결 정보 — 조회 / 연결(캘린더 선택) / 해제. 관리자 전용.
 *
 * 응답에는 비밀 값이 없다 — 서비스 계정 방식이라 애초에 토큰을 저장하지 않고, 개인키는
 * 환경변수에만 있으며 서버 밖으로 나가지 않는다.
 */
import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { isServiceAccountConfigured, serviceAccountEmail } from '@/lib/googleCalendar/auth'
import { addCalendarToList, deleteEvent, getCalendar, getEventColorPalette } from '@/lib/googleCalendar/client'
import { resolveColorMap } from '@/lib/googleCalendar/colors'
import { requireAdmin } from '@/lib/googleCalendar/guard'
import { loadConnection, syncStats } from '@/lib/googleCalendar/reconcile'
import { ACTION_LABEL, ALL_ACTIONS } from '@/lib/googleCalendar/actions'

export async function GET() {
  const email = await requireAdmin()
  if (!email) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const [connection, stats] = await Promise.all([loadConnection(), syncStats()])
  return NextResponse.json({
    configured: isServiceAccountConfigured(),
    serviceAccountEmail: serviceAccountEmail(),
    connection,
    stats,
    // 화면에서 색 견본을 그릴 때 쓰는 라벨 표
    actionLabels: Object.fromEntries(ALL_ACTIONS.map(a => [a, ACTION_LABEL[a]])),
  })
}

/**
 * 캘린더 선택 저장. 새 캘린더를 만들지 않고, 관리자가 고른 기존 캘린더의 ID를 그대로 쓴다.
 * 저장 전에 실제 접근 가능한지(getCalendar) 확인하고, colors.get으로 색 매핑을 해석해 남긴다.
 */
export async function POST(request: Request) {
  const email = await requireAdmin()
  if (!email) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!isServiceAccountConfigured()) {
    return NextResponse.json({ error: '서비스 계정 환경변수(GOOGLE_SA_*)가 설정되지 않았습니다' }, { status: 400 })
  }

  const { calendarId } = (await request.json().catch(() => ({}))) as { calendarId?: string }
  if (!calendarId?.trim()) return NextResponse.json({ error: 'calendarId가 필요합니다' }, { status: 400 })

  try {
    // 서비스 계정은 공유를 자동 수락하지 않으므로 목록에 등록해 둔다(이미 있으면 그대로 성공).
    await addCalendarToList(calendarId.trim())
    const info = await getCalendar(calendarId.trim())
    if (!info) return NextResponse.json({ error: '캘린더를 찾을 수 없습니다' }, { status: 404 })

    const colorMap = resolveColorMap(await getEventColorPalette())

    const admin = createSupabaseAdminClient()
    const { error } = await admin.from('google_calendar_connection').upsert({
      id: true,
      auth_mode: 'service_account',
      google_account_email: serviceAccountEmail(),
      calendar_id: info.id,
      calendar_summary: info.summary,
      calendar_time_zone: info.timeZone ?? null,
      color_map: colorMap,
      status: 'connected',
      last_ok_at: new Date().toISOString(),
      last_error: null,
      connected_by_email: email,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' })
    if (error) throw new Error(error.message)

    return NextResponse.json({ ok: true, calendar: info, colorMap })
  } catch (e) {
    const message = e instanceof Error ? e.message : '연결 실패'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

/**
 * 연결 해제. 기본은 Google 이벤트를 그대로 두고 연결만 끊는다(다시 연결하면 hub_key로 기존
 * 이벤트를 되찾아 이어서 관리한다). `?purge=1`이면 동기화했던 이벤트까지 지운다.
 */
export async function DELETE(request: Request) {
  const email = await requireAdmin()
  if (!email) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const purge = new URL(request.url).searchParams.get('purge') === '1'
  const admin = createSupabaseAdminClient()
  let purged = 0
  const errors: string[] = []

  if (purge) {
    const { data: rows } = await admin
      .from('project_calendar_events')
      .select('project_id, action, calendar_id, google_event_id')
    for (const row of rows ?? []) {
      if (!row.google_event_id) continue
      try {
        await deleteEvent(row.calendar_id, row.google_event_id)
        purged++
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e))
      }
    }
    await admin.from('project_calendar_events').delete().neq('project_id', '00000000-0000-0000-0000-000000000000')
  }

  await admin.from('google_calendar_connection').update({
    status: 'disconnected',
    last_error: null,
    updated_at: new Date().toISOString(),
  }).eq('id', true)

  return NextResponse.json({ ok: true, purged, errors: errors.slice(0, 5) })
}
