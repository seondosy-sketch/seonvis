/**
 * 홈화면 위젯에 그릴 달력 데이터.
 *
 * 대시보드 홈(app/(dashboard)/page.tsx)이 브라우저에서 하는 일을 서버에서 한 번에 한다:
 *   performing_projects(주차별 스냅샷) + projects(날짜 보완) → 제출/면접/개찰 일정
 *   team_events → 팀 일정,  공휴일 API → 공휴일
 * 주차·날짜 계산은 lib/weekSchedule.ts(+ lib/widget/calendar.ts)를 그대로 재사용해 웹 화면과
 * 값이 어긋나지 않게 한다.
 *
 * ── 주 단위 데이터로 월 달력을 만드는 방법 ──
 * performing_projects는 주차별로 저장되고 buildSchedule은 "그 주에 들어가는 일정"만 고른다.
 * 그래서 월 달력은 **그리드가 걸치는 주차들을 각각 자기 주 경계로 buildSchedule** 해서 합친다.
 * 월 전용 날짜 판정을 새로 만들지 않는 것이 핵심 — 그러면 같은 날짜가 웹 화면과 위젯에서
 * 다르게 분류될 수 있다. 조회는 주차 목록 IN 한 번 + projects 한 번으로 끝낸다.
 *
 * ── 시간대 ──
 * 위젯은 서버(Vercel, UTC)에서 렌더된다. new Date()를 그냥 쓰면 KST 월요일 오전에도 UTC로는
 * 아직 일요일이라 "지난 주"가 나온다. 그래서 모든 날짜 기준을 kstToday()로 만든 KST 달력
 * 날짜에서 출발한다 (시:분 없는 로컬 자정 Date — lib/weekSchedule.ts의 날짜 규약과 동일).
 * 월 경계도 이 KST 날짜의 연·월에서 만든다.
 *
 * ── 권한 ──
 * 프로젝트 일정은 menu_permissions에서 weekly/projects가 전부 'none'인 사용자에게는 숨긴다.
 * 팀 일정·공휴일은 대시보드 홈과 마찬가지로 권한 구분이 없는 공용 정보라 그대로 보여준다.
 */
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import type { PerformingProject } from '@/lib/supabase'
import { permissionFor, type MenuPermission } from '@/lib/menuConfig'
import { buildSchedule, getWeekBounds, parseDate, type WeekSchedule } from '@/lib/weekSchedule'
// 프로젝트명 정제는 HWPX 보고서와 같은 규칙을 재사용한다 — 위젯 전용 규칙을 새로 만들면
// 같은 프로젝트가 문서와 위젯에서 다른 이름으로 보인다.
import { formatProjectNameForReport } from '@/lib/hwpx/projectName'
import {
  addDays,
  eachDate,
  mondayOf,
  monthGrid,
  sundayOf,
  weekKeysInRange,
  weekdayIndex,
} from '@/lib/widget/calendar'

/**
 * KST 날짜 계산은 lib/kstDate.ts 한 곳에 둔다 — Google Calendar 연동(lib/googleCalendar)도 같은
 * 함수를 쓰므로, 위젯과 캘린더가 서로 다른 "오늘"을 보지 않게 하려는 것이다.
 * 기존 호출부·테스트가 이 모듈에서 가져다 쓰고 있어 그대로 재수출한다.
 */
import { kstTimeLabel, kstToday, toDateKey } from '@/lib/kstDate'
export { kstTimeLabel, kstToday, toDateKey }

const DOW = ['일', '월', '화', '수', '목', '금', '토']

/** 하단 "다가오는 일정"을 몇 건까지 준비할지 (렌더 쪽에서 크기별로 잘라 쓴다) */
const UPCOMING_LIMIT = 5
/** 월 그리드 끝 이후로 더 읽어두는 기간 — 월말에 "다가오는 일정"이 비지 않게 한다 */
const UPCOMING_LOOKAHEAD_DAYS = 21

export type WidgetItemKind = 'holiday' | 'submit' | 'interview' | 'result' | 'event'

/** 날짜 칸 표시 순서 — 공휴일이 먼저 와야 "일하는 날인지"가 가장 먼저 읽힌다. */
export const KIND_ORDER: WidgetItemKind[] = ['holiday', 'submit', 'interview', 'result', 'event']

/** 하단 목록·small 위젯의 "주요 일정" 우선순위 (공휴일은 일정이 아니라 배경 정보라 제외) */
const UPCOMING_PRIORITY: WidgetItemKind[] = ['submit', 'interview', 'result', 'event']

export interface WidgetItem {
  kind: WidgetItemKind
  /** 원본 이름 (팀 일정 제목, 공휴일명, 프로젝트 용역명) */
  text: string
  /**
   * 좁은 날짜 칸에 넣을 짧은 이름. 프로젝트는 HWPX 보고서와 같은 정제 규칙
   * (`formatProjectNameForReport` — 건설사업관리용역·신축공사·감독권한대행 등 제거)을 재사용해
   * 앞부분에 식별 정보가 오게 만든다. 실제 글자 수 자르기(말줄임)는 크기별 폭을 아는 렌더 쪽에서 한다.
   */
  short: string
}

/** 달력 한 칸 */
export interface WidgetCell {
  date: string          // YYYY-MM-DD
  day: number           // 1~31
  /** 월간 달력에서 이번 달 날짜인지 (false면 흐리게 그린다) */
  inMonth: boolean
  isToday: boolean
  isPast: boolean
  /** 월=0 … 일=6 */
  weekday: number
  items: WidgetItem[]
}

export interface WidgetUpcoming {
  date: string
  /** '7/31(금)' */
  label: string
  kind: WidgetItemKind
  text: string
  short: string
}

export interface WidgetSummary {
  updatedLabel: string      // '업데이트 14:05'
  monthLabel: string        // '2026년 7월'
  weekRangeLabel: string    // '7/27 ~ 8/2'
  today: {
    date: string
    day: number             // 30
    weekday: string         // '목'
    label: string           // '7/30(목)'
    holidayName: string | null
    items: WidgetItem[]
  }
  /** 이번 주 월~일 7칸 (medium) */
  weekCells: WidgetCell[]
  /** 이번 달 그리드 4~6행 × 7칸 (large) */
  monthWeeks: WidgetCell[][]
  /** 오늘 이후 가까운 주요 일정 */
  upcoming: WidgetUpcoming[]
  showProjects: boolean
}

/**
 * 위젯 "업데이트 HH:MM"은 **이 요약을 만든 시각(= DB를 조회하고 그 응답으로 PNG를 그린 시각)** 이다.
 * 라우트가 모든 응답을 `private, no-store`로 내리고 조건부 응답(304)도 쓰지 않으므로 "캐시된
 * 그림인데 현재 시각처럼 보이는" 상황이 생길 수 없다. 반대로 iOS 홈화면 썸네일이 예전 그림이면
 * 예전 시각이 그대로 찍혀 있어 얼마나 묵은 화면인지 알 수 있다.
 * (kstToday/kstTimeLabel/toDateKey 구현은 lib/kstDate.ts — 위에서 재수출한다.)
 */
export function dayLabel(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}(${DOW[d.getDay()]})`
}

interface TeamEventRow { title: string; date: string; color: string | null }
interface HolidayRow { date: string; localName: string }
interface PerformingRow extends PerformingProject { week: string }
interface ProjectRow {
  name: string
  submit_date: string | null
  interview_date: string | null
  bid_date: string | null
  participants: string | null
  status_override: string | null
  evaluation: string | null
}

/** YYYY-MM-DD 문자열 비교로 범위 안의 행만 남긴다(문자열 사전순 = 날짜순). */
export function inWeek<T extends { date: string }>(rows: T[], start: Date, end: Date): T[] {
  const from = toDateKey(start)
  const to = toDateKey(end)
  return rows.filter(r => r.date >= from && r.date <= to)
}

/** 종류별로 묶어 개수를 센다 — 날짜 칸의 칩(`제2`)을 만들 때 쓴다. */
export function groupByKind(items: WidgetItem[]): { kind: WidgetItemKind; count: number }[] {
  return KIND_ORDER.map(kind => ({ kind, count: items.filter(i => i.kind === kind).length })).filter(g => g.count > 0)
}

/**
 * 한 주의 프로젝트 일정을 날짜별로 나눠 map에 쌓는다.
 * buildSchedule()이 고른 항목을 그대로 받아 날짜만 되돌려 파싱한다 — 포함 여부 판단을
 * 두 번 구현하지 않으려는 것. 되돌려 파싱이 실패하는 값은 버리지 않고 주 첫날에 붙인다.
 */
function pushSchedule(map: Map<string, WidgetItem[]>, schedule: WeekSchedule, start: Date): void {
  const refYear = start.getFullYear()
  const kinds: { kind: WidgetItemKind; items: { name: string; date: string }[] }[] = [
    { kind: 'submit', items: schedule.submit },
    { kind: 'interview', items: schedule.interview },
    { kind: 'result', items: schedule.result },
  ]
  for (const { kind, items } of kinds) {
    for (const item of items) {
      const d = parseDate(item.date, refYear)
      const key = toDateKey(d ?? start)
      const list = map.get(key) ?? []
      list.push({ kind, text: item.name, short: formatProjectNameForReport(item.name) })
      map.set(key, list)
    }
  }
}

export async function loadWidgetSummary(
  menuPermissions: Record<string, MenuPermission>,
  isAdmin: boolean,
  now: Date = new Date(),
): Promise<WidgetSummary> {
  const today = kstToday(now)
  const todayKey = toDateKey(today)
  const grid = monthGrid(today)
  const weekStart = mondayOf(today)
  const weekEnd = sundayOf(today)

  // 읽는 범위: 월 그리드 전체 + 그 뒤 3주(월말에 "다가오는 일정"이 비지 않게).
  // 이번 주는 항상 월 그리드 안에 있으므로 따로 넓히지 않아도 된다.
  const rangeStart = grid.gridStart
  const rangeEnd = addDays(grid.gridEnd, UPCOMING_LOOKAHEAD_DAYS)
  const weekKeys = weekKeysInRange(rangeStart, rangeEnd)

  const showProjects =
    isAdmin ||
    permissionFor(menuPermissions, 'weekly') !== 'none' ||
    permissionFor(menuPermissions, 'projects') !== 'none'

  const admin = createSupabaseAdminClient()
  const [performingByWeek, events, holidays] = await Promise.all([
    showProjects ? loadPerformingByWeek(admin, weekKeys) : Promise.resolve(new Map<string, PerformingProject[]>()),
    loadTeamEvents(admin, rangeStart, rangeEnd),
    loadHolidays(rangeStart, rangeEnd),
  ])

  // 날짜 → 항목 맵 (공휴일 → 프로젝트 → 팀 일정 순으로 쌓고, 칸 표시에서 KIND_ORDER로 정렬)
  const byDate = new Map<string, WidgetItem[]>()
  const holidayByDate = new Map<string, string>()
  for (const h of holidays) {
    holidayByDate.set(h.date, h.localName)
    const list = byDate.get(h.date) ?? []
    list.push({ kind: 'holiday', text: h.localName, short: h.localName })
    byDate.set(h.date, list)
  }
  for (const weekKey of weekKeys) {
    const bounds = getWeekBounds(weekKey)
    const rows = performingByWeek.get(weekKey) ?? []
    pushSchedule(byDate, buildSchedule(rows, bounds.start, bounds.end), bounds.start)
  }
  for (const e of events) {
    const list = byDate.get(e.date) ?? []
    list.push({ kind: 'event', text: e.title, short: e.title })
    byDate.set(e.date, list)
  }

  const cellOf = (d: Date): WidgetCell => {
    const key = toDateKey(d)
    const items = byDate.get(key) ?? []
    return {
      date: key,
      day: d.getDate(),
      inMonth: d.getMonth() === grid.monthStart.getMonth() && d.getFullYear() === grid.monthStart.getFullYear(),
      isToday: key === todayKey,
      isPast: key < todayKey,
      weekday: weekdayIndex(d),
      items: KIND_ORDER.flatMap(kind => items.filter(i => i.kind === kind)),
    }
  }

  const weekCells = eachDate(weekStart, weekEnd).map(cellOf)
  const gridCells = eachDate(grid.gridStart, grid.gridEnd).map(cellOf)
  const monthWeeks: WidgetCell[][] = []
  for (let i = 0; i < gridCells.length; i += 7) monthWeeks.push(gridCells.slice(i, i + 7))

  // 다가오는 일정 — 오늘부터 범위 끝까지, 날짜 순 → 종류 우선순위 순
  const upcoming: WidgetUpcoming[] = []
  for (const d of eachDate(today, rangeEnd)) {
    const key = toDateKey(d)
    const items = (byDate.get(key) ?? []).filter(i => i.kind !== 'holiday')
    items.sort((a, b) => UPCOMING_PRIORITY.indexOf(a.kind) - UPCOMING_PRIORITY.indexOf(b.kind))
    for (const item of items) {
      if (upcoming.length >= UPCOMING_LIMIT) break
      upcoming.push({ date: key, label: dayLabel(d), kind: item.kind, text: item.text, short: item.short })
    }
    if (upcoming.length >= UPCOMING_LIMIT) break
  }

  const todayItems = byDate.get(todayKey) ?? []

  return {
    updatedLabel: `업데이트 ${kstTimeLabel(now)}`,
    monthLabel: grid.monthLabel,
    weekRangeLabel: `${weekStart.getMonth() + 1}/${weekStart.getDate()} ~ ${weekEnd.getMonth() + 1}/${weekEnd.getDate()}`,
    today: {
      date: todayKey,
      day: today.getDate(),
      weekday: DOW[today.getDay()],
      label: dayLabel(today),
      holidayName: holidayByDate.get(todayKey) ?? null,
      items: KIND_ORDER.flatMap(kind => todayItems.filter(i => i.kind === kind)),
    },
    weekCells,
    monthWeeks,
    upcoming,
    showProjects,
  }
}

type AdminClient = ReturnType<typeof createSupabaseAdminClient>

/**
 * 날짜는 연도가 살아 있는 ISO(YYYY-MM-DD)로 그대로 넘긴다.
 * fmtDate로 "M/D"까지 줄이면 연도가 사라지고, buildSchedule/parseDate가 기준 주의 연도를
 * 다시 붙여 2025년 일정이 2026년 같은 월·일에 찍힌다. 표시용 "M/D"는 렌더 단계에서 만든다.
 * 웹 대시보드(app/(dashboard)/page.tsx)도 같은 규칙 — 두 화면이 어긋나면 안 된다.
 */
const keepYear = (raw: string | null | undefined): string => (raw?.trim() ? raw : '추후')

/**
 * 주차별 수행 프로젝트 — 대시보드 홈의 loadPerforming과 같은 규칙을 주차 여러 개로 확장한다.
 * 해당 주차 performing_projects가 있으면 그것을 쓰고 빈 날짜는 projects로 보완한다.
 * 아직 그 주차 데이터를 만들지 않았으면 projects에서 직접 만든다(취소·드랍·자사평가 제외).
 * projects는 주차마다 다시 읽지 않고 한 번만 읽어 재사용한다.
 */
async function loadPerformingByWeek(
  admin: AdminClient,
  weekKeys: string[],
): Promise<Map<string, PerformingProject[]>> {
  const [{ data: perf }, { data: projs }] = await Promise.all([
    admin.from('performing_projects').select('*').in('week', weekKeys).order('sort_order'),
    admin
      .from('projects')
      .select('name, submit_date, interview_date, bid_date, participants, status_override, evaluation')
      .order('project_number', { ascending: true }),
  ])

  const projectRows = (projs ?? []) as ProjectRow[]
  const projByName = new Map<string, ProjectRow>()
  for (const p of projectRows) projByName.set(p.name, p)

  const perfByWeek = new Map<string, PerformingRow[]>()
  for (const row of (perf ?? []) as PerformingRow[]) {
    const list = perfByWeek.get(row.week) ?? []
    list.push(row)
    perfByWeek.set(row.week, list)
  }

  // 저장된 주차 데이터가 없을 때 쓰는 projects 기반 행 (주차마다 week 값만 바꿔 재사용)
  const fallbackBase = projectRows.filter(p => {
    if (p.status_override === '취소') return false
    if (p.participants?.includes('드랍') || p.participants?.includes('드롭')) return false
    if (p.evaluation === '선') return false
    return true
  })

  const out = new Map<string, PerformingProject[]>()
  for (const week of weekKeys) {
    const stored = perfByWeek.get(week)
    if (stored && stored.length > 0) {
      out.set(
        week,
        stored.map(p => {
          const src = projByName.get(p.name)
          return {
            ...p,
            submit_date: keepYear(src?.submit_date ?? p.submit_date),
            interview_date: keepYear(src?.interview_date ?? p.interview_date),
            result_date: keepYear(src?.bid_date ?? p.result_date),
          }
        }),
      )
      continue
    }
    out.set(
      week,
      fallbackBase.map((p, i) => ({
        status: '진행중' as const,
        name: p.name,
        director: '',
        submit_date: keepYear(p.submit_date),
        interview_date: keepYear(p.interview_date),
        result_date: keepYear(p.bid_date),
        fee: null,
        note: '',
        sort_order: i,
        week,
      })),
    )
  }
  return out
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
 * 범위가 연말·연초에 걸치면 두 해를 받아야 한다. 실패는 조용히 무시(공휴일 없이 그린다).
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
