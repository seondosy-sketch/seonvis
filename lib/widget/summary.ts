/**
 * 홈화면 위젯에 그릴 "이번 주 요약" 데이터.
 *
 * 대시보드 홈(app/(dashboard)/page.tsx)이 브라우저에서 하는 일을 서버에서 한 번에 한다:
 *   performing_projects(이번 주차) + projects(날짜 보완) → 제출/면접/개찰 일정
 *   team_events → 팀 일정,  공휴일 API → 공휴일
 * 주차·날짜 계산은 lib/weekSchedule.ts를 그대로 재사용해 웹 화면과 값이 어긋나지 않게 한다.
 *
 * ── 시간대 ──
 * 위젯은 서버(Vercel, UTC)에서 렌더된다. new Date()를 그냥 쓰면 KST 월요일 오전에도 UTC로는
 * 아직 일요일이라 "지난 주"가 나온다. 그래서 모든 날짜 기준을 kstToday()로 만든 KST 달력
 * 날짜에서 출발한다 (시:분 없는 로컬 자정 Date — lib/weekSchedule.ts의 날짜 규약과 동일).
 *
 * ── 권한 ──
 * 프로젝트 일정은 menu_permissions에서 weekly/projects가 전부 'none'인 사용자에게는 숨긴다.
 * 팀 일정·공휴일은 대시보드 홈과 마찬가지로 권한 구분이 없는 공용 정보라 그대로 보여준다.
 */
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import type { PerformingProject } from '@/lib/supabase'
import { permissionFor, type MenuPermission } from '@/lib/menuConfig'
import {
  buildSchedule,
  fmtDate,
  getCurrentWeek,
  getWeekBounds,
  parseDate,
  type WeekSchedule,
} from '@/lib/weekSchedule'

const KST_OFFSET_MS = 9 * 60 * 60 * 1000
const DOW = ['일', '월', '화', '수', '목', '금', '토']

export type WidgetItemKind = 'submit' | 'interview' | 'result' | 'event'

export interface WidgetItem {
  kind: WidgetItemKind
  text: string
  /** 팀 일정은 사용자가 고른 색을 그대로 쓴다. 프로젝트 일정은 종류별 고정색. */
  color?: string
}

export interface WidgetDay {
  date: string          // YYYY-MM-DD
  label: string         // '7/30(목)'
  isToday: boolean
  isPast: boolean
  holidayName: string | null
  items: WidgetItem[]
}

export interface WidgetSummary {
  week: string
  rangeLabel: string    // '7/27 ~ 8/2'
  todayLabel: string    // '7/30(목)'
  updatedLabel: string  // '업데이트 14:05'
  days: WidgetDay[]
  totals: Record<WidgetItemKind, number>
  showProjects: boolean
}

/** 기준 시각(기본 now)의 KST 달력 날짜 — 시:분 없는 로컬 자정 Date. */
export function kstToday(now: Date = new Date()): Date {
  const shifted = new Date(now.getTime() + KST_OFFSET_MS)
  return new Date(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate())
}

/**
 * KST 시:분 — 위젯 좌하단 "업데이트 HH:MM"에 쓴다.
 *
 * 이 값의 의미는 **이 요약을 만든 시각(= DB를 조회하고 그 응답으로 PNG를 그린 시각)** 하나로
 * 고정한다. 라우트가 모든 응답을 `private, no-store`로 내리고 조건부 응답(304)도 쓰지 않으므로,
 * "캐시된 그림인데 현재 시각처럼 보이는" 상황이 생길 수 없다. 반대로 iOS 홈화면 썸네일이 예전
 * 그림이면 예전 시각이 그대로 찍혀 있어 얼마나 묵은 화면인지 알 수 있다.
 */
export function kstTimeLabel(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + KST_OFFSET_MS)
  const hh = String(shifted.getUTCHours()).padStart(2, '0')
  const mm = String(shifted.getUTCMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

export function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function dayLabel(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}(${DOW[d.getDay()]})`
}

interface TeamEventRow { title: string; date: string; color: string | null }
interface HolidayRow { date: string; localName: string }
interface ProjectRow {
  name: string
  submit_date: string | null
  interview_date: string | null
  bid_date: string | null
  participants: string | null
  status_override: string | null
  evaluation: string | null
}

/** YYYY-MM-DD 문자열 비교로 주 범위 안의 행만 남긴다(문자열 사전순 = 날짜순). */
export function inWeek<T extends { date: string }>(rows: T[], start: Date, end: Date): T[] {
  const from = toDateKey(start)
  const to = toDateKey(end)
  return rows.filter(r => r.date >= from && r.date <= to)
}

/**
 * 이번 주 프로젝트 일정을 요일별로 나눈다.
 * buildSchedule()이 고른 항목을 그대로 받아 날짜만 되돌려 파싱한다 — 포함 여부 판단을
 * 두 번 구현하지 않으려는 것. 되돌려 파싱이 실패하는 값은 버리지 않고 주 첫날에 붙인다.
 */
function scheduleByDay(schedule: WeekSchedule, start: Date): Map<string, WidgetItem[]> {
  const refYear = start.getFullYear()
  const map = new Map<string, WidgetItem[]>()
  const push = (key: string, item: WidgetItem) => {
    const list = map.get(key) ?? []
    list.push(item)
    map.set(key, list)
  }
  const kinds: { kind: WidgetItemKind; items: { name: string; date: string }[] }[] = [
    { kind: 'submit', items: schedule.submit },
    { kind: 'interview', items: schedule.interview },
    { kind: 'result', items: schedule.result },
  ]
  for (const { kind, items } of kinds) {
    for (const item of items) {
      const d = parseDate(item.date, refYear)
      push(toDateKey(d ?? start), { kind, text: item.name })
    }
  }
  return map
}

export async function loadWidgetSummary(
  menuPermissions: Record<string, MenuPermission>,
  isAdmin: boolean,
  now: Date = new Date(),
): Promise<WidgetSummary> {
  const today = kstToday(now)
  const week = getCurrentWeek(today)
  const { start, end } = getWeekBounds(week)

  const showProjects =
    isAdmin ||
    permissionFor(menuPermissions, 'weekly') !== 'none' ||
    permissionFor(menuPermissions, 'projects') !== 'none'

  const admin = createSupabaseAdminClient()
  const [performing, events, holidays] = await Promise.all([
    showProjects ? loadPerforming(admin, week) : Promise.resolve([] as PerformingProject[]),
    loadTeamEvents(admin, start, end),
    loadHolidays(start, end),
  ])

  const schedule = buildSchedule(performing, start, end)
  const byDay = scheduleByDay(schedule, start)
  const holidayByDate = new Map(holidays.map(h => [h.date, h.localName]))
  const eventsByDate = new Map<string, WidgetItem[]>()
  for (const e of events) {
    const list = eventsByDate.get(e.date) ?? []
    list.push({ kind: 'event', text: e.title, color: e.color ?? '#7c3aed' })
    eventsByDate.set(e.date, list)
  }

  const todayKey = toDateKey(today)
  const days: WidgetDay[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    const key = toDateKey(d)
    days.push({
      date: key,
      label: dayLabel(d),
      isToday: key === todayKey,
      isPast: key < todayKey,
      holidayName: holidayByDate.get(key) ?? null,
      items: [...(byDay.get(key) ?? []), ...(eventsByDate.get(key) ?? [])],
    })
  }

  const totals: Record<WidgetItemKind, number> = {
    submit: schedule.submit.length,
    interview: schedule.interview.length,
    result: schedule.result.length,
    event: events.length,
  }

  return {
    week,
    rangeLabel: `${start.getMonth() + 1}/${start.getDate()} ~ ${end.getMonth() + 1}/${end.getDate()}`,
    todayLabel: dayLabel(today),
    updatedLabel: `업데이트 ${kstTimeLabel(now)}`,
    days,
    totals,
    showProjects,
  }
}

type AdminClient = ReturnType<typeof createSupabaseAdminClient>

/**
 * 대시보드 홈의 loadPerforming과 같은 규칙:
 * 이번 주차 performing_projects가 있으면 그것을 쓰고 빈 날짜는 projects로 보완한다.
 * 아직 이번 주차 데이터를 만들지 않았으면 projects에서 직접 만든다(취소·드랍·자사평가 제외).
 */
async function loadPerforming(admin: AdminClient, week: string): Promise<PerformingProject[]> {
  const [{ data: perf }, { data: projs }] = await Promise.all([
    admin.from('performing_projects').select('*').eq('week', week).order('sort_order'),
    admin
      .from('projects')
      .select('name, submit_date, interview_date, bid_date, participants, status_override, evaluation')
      .order('project_number', { ascending: false }),
  ])

  const projByName = new Map<string, ProjectRow>()
  for (const p of (projs ?? []) as ProjectRow[]) projByName.set(p.name, p)

  if (perf && perf.length > 0) {
    return (perf as PerformingProject[]).map(p => {
      const src = projByName.get(p.name)
      return {
        ...p,
        result_date: p.result_date?.trim() ? p.result_date : fmtDate(src?.bid_date ?? null),
        submit_date: p.submit_date?.trim() ? p.submit_date : fmtDate(src?.submit_date ?? null),
        interview_date: p.interview_date?.trim() ? p.interview_date : fmtDate(src?.interview_date ?? null),
      }
    })
  }

  return ((projs ?? []) as ProjectRow[])
    .filter(p => {
      if (p.status_override === '취소') return false
      if (p.participants?.includes('드랍') || p.participants?.includes('드롭')) return false
      if (p.evaluation === '선') return false
      return true
    })
    .map((p, i) => ({
      status: '진행중' as const,
      name: p.name,
      director: '',
      submit_date: fmtDate(p.submit_date),
      interview_date: fmtDate(p.interview_date),
      result_date: fmtDate(p.bid_date),
      fee: null,
      note: '',
      sort_order: i,
      week,
    }))
}

async function loadTeamEvents(admin: AdminClient, start: Date, end: Date): Promise<TeamEventRow[]> {
  const { data } = await admin
    .from('team_events')
    .select('title, date, color')
    .gte('date', toDateKey(start))
    .lte('date', toDateKey(end))
    .order('date')
  return (data ?? []) as TeamEventRow[]
}

/**
 * 공휴일 — app/api/holidays/route.ts와 같은 외부 API를 서버에서 직접 부른다.
 * 주가 연말·연초에 걸치면 두 해를 받아야 한다. 실패는 조용히 무시(공휴일 없이 그린다).
 */
async function loadHolidays(start: Date, end: Date): Promise<HolidayRow[]> {
  const years = Array.from(new Set([start.getFullYear(), end.getFullYear()]))
  const lists = await Promise.all(
    years.map(async year => {
      try {
        const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/KR`, {
          next: { revalidate: 86400 },
        })
        if (!res.ok) return [] as HolidayRow[]
        return (await res.json()) as HolidayRow[]
      } catch {
        return [] as HolidayRow[]
      }
    }),
  )
  return inWeek(lists.flat(), start, end)
}
