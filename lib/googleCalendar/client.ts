/**
 * Google Calendar API 호출 계층 — 서버 전용.
 *
 * 필요한 호출만 얇게 감싼다(googleapis 패키지를 쓰지 않는 이유: 의존성 없이 fetch로 충분하고,
 * 서버리스 번들도 가볍게 유지된다).
 *
 * ── 재시도 분류 ──
 *   429 / 5xx / 403 rateLimitExceeded  → 일시적. 지수 백오프로 재시도한다.
 *   404 / 410                          → 대상이 이미 없다. 삭제는 성공으로 보고, 수정은 재생성 신호.
 *   그 밖의 4xx                        → 권한·요청 오류. 재시도하지 않고 실패로 기록한다.
 */
import { getAccessToken } from './auth'
import type { EventColorPalette } from './colors'
import { exclusiveEndDate } from './desired'

const API_BASE = 'https://www.googleapis.com/calendar/v3'
const MAX_ATTEMPTS = 3

export class GoogleCalendarError extends Error {
  readonly status: number
  readonly reason: string | null
  readonly retryable: boolean
  /** 대상이 이미 없음(404/410) — 삭제는 성공, 수정은 재생성으로 처리한다 */
  readonly gone: boolean

  constructor(message: string, status: number, reason: string | null) {
    super(message)
    this.name = 'GoogleCalendarError'
    this.status = status
    this.reason = reason
    this.gone = status === 404 || status === 410
    this.retryable =
      status === 429 ||
      status >= 500 ||
      (status === 403 && !!reason && ['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded'].includes(reason))
  }
}

interface GoogleErrorBody {
  error?: { message?: string; errors?: { reason?: string }[]; status?: string }
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function call<T>(path: string, init: RequestInit = {}, attempt = 1): Promise<T | null> {
  const token = await getAccessToken()
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    cache: 'no-store',
  })

  if (res.status === 204) return null
  const body = (await res.json().catch(() => null)) as (T & GoogleErrorBody) | null

  if (!res.ok) {
    const err = (body as GoogleErrorBody | null)?.error
    const reason = err?.errors?.[0]?.reason ?? err?.status ?? null
    const error = new GoogleCalendarError(err?.message ?? `HTTP ${res.status}`, res.status, reason)
    if (error.retryable && attempt < MAX_ATTEMPTS) {
      await sleep(2 ** attempt * 500) // 1s, 2s
      return call<T>(path, init, attempt + 1)
    }
    throw error
  }
  return body as T
}

// ── 캘린더 ────────────────────────────────────────────────────────────────

export interface CalendarInfo {
  id: string
  summary: string
  timeZone?: string
  accessRole?: string
  primary?: boolean
}

/** 이벤트 색상 팔레트 — 색상 ID를 하드코딩하지 않기 위해 연결 시점에 조회한다. */
export async function getEventColorPalette(): Promise<EventColorPalette> {
  const body = await call<{ event: EventColorPalette }>('/colors')
  return body?.event ?? {}
}

export async function getCalendar(calendarId: string): Promise<CalendarInfo | null> {
  return await call<CalendarInfo>(`/calendars/${encodeURIComponent(calendarId)}`)
}

/** 서비스 계정의 캘린더 목록. 공유만 해두면 비어 있을 수 있어(자동 수락 안 함) insert가 필요하다. */
export async function listCalendars(): Promise<CalendarInfo[]> {
  const body = await call<{ items?: CalendarInfo[] }>('/users/me/calendarList')
  return body?.items ?? []
}

/** 공유받은 캘린더를 서비스 계정 목록에 등록한다. 이미 있으면 그대로 성공한다. */
export async function addCalendarToList(calendarId: string): Promise<CalendarInfo | null> {
  return await call<CalendarInfo>('/users/me/calendarList', {
    method: 'POST',
    body: JSON.stringify({ id: calendarId }),
  })
}

// ── 이벤트 ────────────────────────────────────────────────────────────────

export interface EventPayload {
  title: string
  /** YYYY-MM-DD (종일 일정) */
  date: string
  colorId: string | null
  /** `<projectId>:<action>` — 연결 표가 유실돼도 이 값으로 기존 이벤트를 되찾는다 */
  hubKey: string
}

const HUB_KEY_PROP = 'hub_key'

function eventBody(payload: EventPayload) {
  return {
    summary: payload.title,
    start: { date: payload.date },
    // Google은 종일 일정의 end를 배타적으로 다룬다 — 하루를 더해야 그 날 하루짜리가 된다.
    end: { date: exclusiveEndDate(payload.date) },
    ...(payload.colorId ? { colorId: payload.colorId } : {}),
    // 팀원 각자의 캘린더 알림과 충돌하지 않도록 이 이벤트는 알림을 쓰지 않는다.
    reminders: { useDefault: false },
    extendedProperties: { private: { [HUB_KEY_PROP]: payload.hubKey } },
  }
}

export async function insertEvent(calendarId: string, payload: EventPayload): Promise<string> {
  const body = await call<{ id: string }>(`/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    body: JSON.stringify(eventBody(payload)),
  })
  if (!body?.id) throw new GoogleCalendarError('이벤트 생성 응답에 id가 없습니다', 500, null)
  return body.id
}

/** colorId를 비우려면 null이 아니라 빈 문자열을 보내야 하므로 patch 본문을 그대로 재사용한다. */
export async function patchEvent(calendarId: string, eventId: string, payload: EventPayload): Promise<void> {
  await call(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ ...eventBody(payload), colorId: payload.colorId ?? '' }),
  })
}

/** 이미 없는 이벤트(404/410)는 성공으로 본다 — 지우려던 목적은 달성됐다. */
export async function deleteEvent(calendarId: string, eventId: string): Promise<void> {
  try {
    await call(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
      method: 'DELETE',
    })
  } catch (e) {
    if (e instanceof GoogleCalendarError && e.gone) return
    throw e
  }
}

/**
 * hub_key로 기존 이벤트를 찾는다 — 연결 표가 유실됐거나 다른 환경에서 이미 만든 이벤트를
 * 중복 생성하지 않기 위한 안전장치. 취소된 이벤트는 제외한다.
 */
export async function findEventIdByHubKey(calendarId: string, hubKey: string): Promise<string | null> {
  const params = new URLSearchParams({
    privateExtendedProperty: `${HUB_KEY_PROP}=${hubKey}`,
    showDeleted: 'false',
    maxResults: '2',
  })
  const body = await call<{ items?: { id: string; status?: string }[] }>(
    `/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
  )
  const found = (body?.items ?? []).find(e => e.status !== 'cancelled')
  return found?.id ?? null
}
