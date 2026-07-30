/**
 * Hub 원본 ↔ Google Calendar 대조 실행 (단방향: Hub → Google).
 *
 * Hub의 프로젝트 쓰기는 전부 브라우저에서 일어나고 서버 훅이 없다. 그래서 저장 시점에 이벤트를
 * 밀어 넣는 방식이 아니라 **"있어야 하는 상태"와 "지금 연결된 상태"를 대조**해 차집합만 실행한다.
 * 덕분에 저장 경로를 하나하나 고치지 않아도 되고, 실패한 건을 나중에 다시 돌리기만 하면 복구된다.
 *
 *   desired에만 있음  → 이벤트 생성
 *   양쪽에 있고 지문 다름 → 이벤트 수정
 *   연결 표에만 있음   → 이벤트 삭제 (날짜 제거·프로젝트 삭제·취소 전환 모두 이 경로)
 *
 * Google 호출이 실패해도 Hub 원본은 이미 저장된 상태다 — 이 함수는 실패를 표에 기록만 하고
 * 예외를 밖으로 던지지 않는다(연결 자체가 없을 때만 예외).
 */
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { kstTodayKey } from '@/lib/kstDate'
import { hubKey, type CalendarAction } from './actions'
import {
  GoogleCalendarError,
  deleteEvent,
  findEventIdByHubKey,
  insertEvent,
  patchEvent,
} from './client'
import {
  buildDesiredEvents,
  type CalendarProjectRow,
  type CalendarTooltipRow,
  type DesiredEvent,
  type SkippedDate,
} from './desired'

/** 한 번의 실행에서 Google을 부를 최대 횟수 — 폭주를 막고 초과분은 다음 회차로 넘긴다. */
const DEFAULT_MAX_CALLS = 200

export interface ReconcileOptions {
  /** 특정 프로젝트만 대조 (저장·삭제 직후 트리거) */
  projectId?: string
  /** 실패 상태인 건만 다시 시도 */
  failedOnly?: boolean
  maxCalls?: number
}

export interface ReconcileResult {
  created: number
  updated: number
  deleted: number
  unchanged: number
  failed: number
  /** 호출 상한에 걸려 이번에 처리하지 못한 건수 */
  deferred: number
  /** 날짜 형식이 아니어서 건너뛴 항목 */
  skipped: SkippedDate[]
  excludedProjects: number
  callsUsed: number
  errors: { key: string; message: string }[]
}

interface EventRow {
  project_id: string
  action: CalendarAction
  calendar_id: string
  google_event_id: string | null
  fingerprint: string | null
  sync_state: 'synced' | 'failed'
  retry_count: number
}

export interface CalendarConnection {
  calendar_id: string | null
  calendar_summary: string | null
  status: string
  color_map: Partial<Record<CalendarAction, string>>
  last_ok_at: string | null
  last_synced_at: string | null
  last_error: string | null
  google_account_email: string | null
  connected_by_email: string | null
}

export class NotConnectedError extends Error {
  constructor() {
    super('Google Calendar가 연결되지 않았습니다')
    this.name = 'NotConnectedError'
  }
}

type Admin = ReturnType<typeof createSupabaseAdminClient>

export async function loadConnection(admin: Admin = createSupabaseAdminClient()): Promise<CalendarConnection | null> {
  const { data } = await admin.from('google_calendar_connection').select('*').eq('id', true).maybeSingle()
  return (data as CalendarConnection | null) ?? null
}

export async function reconcileCalendar(options: ReconcileOptions = {}): Promise<ReconcileResult> {
  const admin = createSupabaseAdminClient()
  const connection = await loadConnection(admin)
  if (!connection?.calendar_id || connection.status === 'disconnected') throw new NotConnectedError()

  const calendarId = connection.calendar_id
  const maxCalls = options.maxCalls ?? DEFAULT_MAX_CALLS
  const result: ReconcileResult = {
    created: 0, updated: 0, deleted: 0, unchanged: 0, failed: 0, deferred: 0,
    skipped: [], excludedProjects: 0, callsUsed: 0, errors: [],
  }

  // ── 원본과 연결 상태 읽기 ────────────────────────────────────────────
  const projectQuery = admin
    .from('projects')
    .select('id, project_number, name, announce_date, submit_date, interview_date, bid_date, status_override, participants, evaluation')
  if (options.projectId) projectQuery.eq('id', options.projectId)

  const rowQuery = admin
    .from('project_calendar_events')
    .select('project_id, action, calendar_id, google_event_id, fingerprint, sync_state, retry_count')
  if (options.projectId) rowQuery.eq('project_id', options.projectId)
  if (options.failedOnly) rowQuery.eq('sync_state', 'failed')

  const [{ data: projects }, { data: tooltips }, { data: rows }] = await Promise.all([
    projectQuery,
    admin.from('project_tooltips').select('project_number, pq_date, soq_date, notify_date'),
    rowQuery,
  ])

  const existing = new Map<string, EventRow>()
  for (const r of (rows ?? []) as EventRow[]) existing.set(`${r.project_id}:${r.action}`, r)

  const desired = buildDesiredEvents(
    (projects ?? []) as CalendarProjectRow[],
    (tooltips ?? []) as CalendarTooltipRow[],
    kstTodayKey(),
    connection.color_map ?? {},
    new Set(existing.keys()),
  )
  result.skipped = desired.skipped
  result.excludedProjects = desired.excludedProjects

  const desiredByKey = new Map<string, DesiredEvent>()
  for (const e of desired.events) desiredByKey.set(`${e.projectId}:${e.action}`, e)

  const budget = () => result.callsUsed < maxCalls

  // ── 1) 생성·수정 ────────────────────────────────────────────────────
  for (const [key, want] of desiredByKey) {
    const row = existing.get(key)

    // 실패 건만 다시 돌리는 모드에서는 이미 정상인 건을 건드리지 않는다.
    if (options.failedOnly && (!row || row.sync_state !== 'failed')) continue

    if (row && row.google_event_id && row.fingerprint === want.fingerprint && row.sync_state === 'synced') {
      result.unchanged++
      continue
    }
    if (!budget()) { result.deferred++; continue }

    try {
      let eventId = row?.google_event_id ?? null

      // 연결 표에 이벤트 ID가 없으면, 먼저 hub_key로 이미 만든 이벤트가 있는지 확인한다
      // (표 유실·재연결 시 같은 일정을 두 번 만들지 않기 위한 안전장치).
      if (!eventId) {
        result.callsUsed++
        eventId = await findEventIdByHubKey(calendarId, hubKey(want.projectId, want.action))
      }

      if (eventId) {
        result.callsUsed++
        try {
          await patchEvent(calendarId, eventId, {
            title: want.title, date: want.date, colorId: want.colorId,
            hubKey: hubKey(want.projectId, want.action),
          })
        } catch (e) {
          // 캘린더에서 사람이 지운 경우 — 다시 만든다.
          if (e instanceof GoogleCalendarError && e.gone) {
            result.callsUsed++
            eventId = await insertEvent(calendarId, {
              title: want.title, date: want.date, colorId: want.colorId,
              hubKey: hubKey(want.projectId, want.action),
            })
          } else throw e
        }
      } else {
        result.callsUsed++
        eventId = await insertEvent(calendarId, {
          title: want.title, date: want.date, colorId: want.colorId,
          hubKey: hubKey(want.projectId, want.action),
        })
      }

      await admin.from('project_calendar_events').upsert({
        project_id: want.projectId,
        action: want.action,
        calendar_id: calendarId,
        google_event_id: eventId,
        event_date: want.date,
        title: want.title,
        fingerprint: want.fingerprint,
        sync_state: 'synced',
        retry_count: 0,
        last_synced_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'project_id,action' })

      if (row) result.updated++
      else result.created++
    } catch (e) {
      result.failed++
      const message = e instanceof Error ? e.message : String(e)
      result.errors.push({ key, message })
      await admin.from('project_calendar_events').upsert({
        project_id: want.projectId,
        action: want.action,
        calendar_id: calendarId,
        google_event_id: row?.google_event_id ?? null,
        event_date: want.date,
        title: want.title,
        fingerprint: null, // 지문을 비워 다음 회차에 다시 시도하게 한다
        sync_state: 'failed',
        retry_count: (row?.retry_count ?? 0) + 1,
        last_error: message.slice(0, 500),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'project_id,action' })
    }
  }

  // ── 2) 삭제 (날짜 제거·프로젝트 삭제·취소 전환·고아 행) ─────────────
  if (!options.failedOnly) {
    for (const [key, row] of existing) {
      if (desiredByKey.has(key)) continue
      if (!budget()) { result.deferred++; continue }

      try {
        if (row.google_event_id) {
          result.callsUsed++
          await deleteEvent(row.calendar_id, row.google_event_id)
        }
        await admin.from('project_calendar_events')
          .delete()
          .eq('project_id', row.project_id)
          .eq('action', row.action)
        result.deleted++
      } catch (e) {
        result.failed++
        const message = e instanceof Error ? e.message : String(e)
        result.errors.push({ key, message })
        await admin.from('project_calendar_events').update({
          sync_state: 'failed',
          retry_count: row.retry_count + 1,
          last_error: message.slice(0, 500),
          updated_at: new Date().toISOString(),
        }).eq('project_id', row.project_id).eq('action', row.action)
      }
    }
  }

  // ── 3) 연결 상태 갱신 ───────────────────────────────────────────────
  const ok = result.failed === 0
  await admin.from('google_calendar_connection').update({
    status: ok ? 'connected' : 'error',
    last_synced_at: new Date().toISOString(),
    ...(ok ? { last_ok_at: new Date().toISOString(), last_error: null } : { last_error: result.errors[0]?.message.slice(0, 500) ?? null }),
    updated_at: new Date().toISOString(),
  }).eq('id', true)

  return result
}

/** 실패 건수 등 관리자 화면에 보여줄 요약 */
export async function syncStats(admin: Admin = createSupabaseAdminClient()) {
  const [{ count: total }, { count: failed }] = await Promise.all([
    admin.from('project_calendar_events').select('*', { count: 'exact', head: true }),
    admin.from('project_calendar_events').select('*', { count: 'exact', head: true }).eq('sync_state', 'failed'),
  ])
  return { total: total ?? 0, failed: failed ?? 0 }
}
