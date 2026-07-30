// 월간 HWPX 하단 달력 — 순수 함수, XML을 다루지 않는다.
//
// 표현 기준은 CM본부월업무계획(7.24).hwpx 실측이다:
//   범위   기준일이 포함된 주의 일요일부터 3주(21일). 월 전체 달력이 아니다.
//          (7.24 기준일 → 7/19(일)부터 7/19~25, 7/26~8/1, 8/2~8/8)
//   날짜   "19" … 달이 바뀌는 1일만 "8/1"
//   일정   "*프로젝트명-제출" / "-면접" / "-개찰"
//          별표 + 정제된 프로젝트명 + 일반 하이픈(U+002D, 앞뒤 공백 없음) + 일정 종류
//          관리번호는 달력에서 제외한다. 도형 기호·범례는 쓰지 않는다.
//   정렬   제출 → 면접 → 개찰, 같은 종류는 입력 순서 유지
//
// 발표와 면접은 Project List에 구분 필드가 없어 "면접"으로 통일한다(확정사항).
// 서면평가·추후·날짜 미정 일정은 달력에 넣지 않는다.

import { parseIsoDate, type YmdParts } from './monthlyFormat'
import { estimateLineCount } from './monthlyRowHeight'

/** 달력에 표시하는 일정 종류. 배열 순서가 같은 날 안에서의 정렬 우선순위다. */
export const CALENDAR_KINDS = ['제출', '면접', '개찰'] as const
export type CalendarKind = (typeof CALENDAR_KINDS)[number]

/** 달력 주 수 — 기준 파일과 동일하게 3주 고정. */
export const CALENDAR_WEEK_COUNT = 3
export const DAYS_PER_WEEK = 7

/** 일정 줄 접두 문자와 구분자 — 기준 파일 실측(별표, 일반 하이픈, 공백 없음). */
export const ENTRY_PREFIX = '*'
export const ENTRY_SEPARATOR = '-'

export interface CalendarDay {
  year: number
  month: number
  day: number
  /** "YYYY-MM-DD" — 일정 매칭 키. */
  iso: string
  /** 셀에 쓸 날짜 표기. 매월 1일만 "M/D", 그 외에는 "D". */
  label: string
  /** 0=일 … 6=토 */
  weekday: number
}

export interface CalendarSchedule {
  /** 정제된 프로젝트명 — formatProjectNameForReport() 결과. 관리번호는 포함하지 않는다. */
  name: string
  submitDate?: unknown
  interviewDate?: unknown
  bidDate?: unknown
}

export interface CalendarEntry {
  iso: string
  kind: CalendarKind
  /** "*프로젝트명-제출" */
  text: string
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function toIso(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`
}

/**
 * 기준일이 포함된 주의 일요일부터 3주(21일)를 만든다.
 * 서버 로컬 시각을 쓰지 않는다 — 호출부가 넘긴 y/m/d만 쓴다.
 */
export function buildCalendarDays(asOf: YmdParts): CalendarDay[] {
  // Date를 날짜 산술에만 쓴다(타임존 무관: 로컬 자정 기준으로만 더하고 뺀다).
  const base = new Date(asOf.year, asOf.month - 1, asOf.day)
  const sunday = new Date(base.getFullYear(), base.getMonth(), base.getDate() - base.getDay())

  const days: CalendarDay[] = []
  for (let i = 0; i < CALENDAR_WEEK_COUNT * DAYS_PER_WEEK; i++) {
    const d = new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate() + i)
    const year = d.getFullYear(), month = d.getMonth() + 1, day = d.getDate()
    days.push({
      year, month, day,
      iso: toIso(year, month, day),
      label: day === 1 ? `${month}/${day}` : String(day),
      weekday: d.getDay(),
    })
  }
  return days
}

/** 일정 한 줄의 문구. "*정제명-제출" */
export function formatCalendarEntryText(name: string, kind: CalendarKind): string {
  return `${ENTRY_PREFIX}${name}${ENTRY_SEPARATOR}${kind}`
}

/**
 * 프로젝트 목록에서 달력에 넣을 일정을 모은다.
 * - 실제 날짜(YYYY-MM-DD)만 대상 — "서면평가"/"추후"/빈 값은 제외한다.
 * - 달력 범위(days)에 없는 날짜는 제외한다.
 * - 정렬: 날짜 → 종류(제출·면접·개찰) → 입력 순서.
 */
export function collectCalendarEntries(
  schedules: readonly CalendarSchedule[],
  days: readonly CalendarDay[]
): CalendarEntry[] {
  const inRange = new Set(days.map((d) => d.iso))
  const rows: Array<CalendarEntry & { kindOrder: number; inputOrder: number }> = []

  schedules.forEach((s, inputOrder) => {
    const name = (s.name ?? '').trim()
    if (name === '') return
    const pairs: Array<[CalendarKind, unknown]> = [
      ['제출', s.submitDate],
      ['면접', s.interviewDate],
      ['개찰', s.bidDate],
    ]
    for (const [kind, value] of pairs) {
      const d = parseIsoDate(value)
      if (!d) continue
      const iso = toIso(d.year, d.month, d.day)
      if (!inRange.has(iso)) continue
      rows.push({
        iso, kind, text: formatCalendarEntryText(name, kind),
        kindOrder: CALENDAR_KINDS.indexOf(kind), inputOrder,
      })
    }
  })

  rows.sort((a, b) =>
    a.iso < b.iso ? -1 : a.iso > b.iso ? 1
      : a.kindOrder !== b.kindOrder ? a.kindOrder - b.kindOrder
        : a.inputOrder - b.inputOrder
  )
  return rows.map(({ iso, kind, text }) => ({ iso, kind, text }))
}

/** 날짜별로 묶은 일정 — 셀에 쓸 때 쓴다. 키는 iso. */
export function groupCalendarEntries(
  entries: readonly CalendarEntry[]
): Map<string, CalendarEntry[]> {
  const map = new Map<string, CalendarEntry[]>()
  for (const e of entries) {
    const list = map.get(e.iso)
    if (list) list.push(e)
    else map.set(e.iso, [e])
  }
  return map
}

// ── 달력 예상 높이 ───────────────────────────────────────────────────────────
//
// 일정이 많거나 좁은 열(일·토)에서 프로젝트명이 접히면 한글이 그 주 행 전체를 늘린다.
// 달력을 고정 높이로 계산하면 상단표는 맞는데 달력 때문에 2페이지가 되는 것을 놓친다.
//
// 실측 모델(한글 렌더로 확정, montly.hwpx 기준):
//   문단 하나 = 줄 수 × 820 + 문단 위 여백 250      (글자 900 × 줄간격 90% ≈ 810, 보수적으로 820)
//   셀 높이   = Σ 문단 + 셀 상하 여백 282
//   주 행 높이 = max(선언 주 행 높이, 7개 셀 중 최대)
//   텍스트 폭 = 셀 폭 − cellMargin 141×2 − paraPr 좌우 여백 200×2 = 셀 폭 − 682
//
// 실측 대조(수요일=넓은 열 / 토요일=좁은 열, 일정 k건 + 날짜 1문단):
//   k=6 → 계산 7,772 ≤ 선언 7,778 → 선언 유지 (실측 7,770)
//   k=7 → 8,842 (실측 8,840)   k=8 → 9,912 (실측 9,880)
//   토 k=4(각 2줄) → 8,912 (실측 8,890)   토 k=5 → 10,802 (실측 10,760)
// 모든 표본에서 계산값 ≥ 실측(최대 오차 +42)이라 예산을 느슨하게 만들지 않는다.

/** 달력 셀 글자 높이(9pt). */
export const CALENDAR_CHAR_HEIGHT = 900
/** 한 줄이 차지하는 높이 — 실측 보수값. */
export const CALENDAR_LINE_HEIGHT = 820
/** 문단 위 여백(paraPr 20 margin prev). */
export const CALENDAR_PARAGRAPH_MARGIN = 250
/** 셀 상하 여백 합(cellMargin top+bottom). */
export const CALENDAR_CELL_VERTICAL_MARGIN = 282
/** 셀 폭에서 텍스트 폭을 얻을 때 빼는 값(cellMargin 141×2 + paraPr 좌우 200×2). */
export const CALENDAR_TEXT_WIDTH_INSET = 682

/** 요일별 셀 폭 — montly.hwpx 실측(일·토가 좁다). */
export const CALENDAR_COLUMN_WIDTHS: readonly number[] = [6368, 13249, 13249, 13249, 13249, 13249, 5804]

/** 요일 인덱스(0=일 … 6=토)의 텍스트 폭. */
export function calendarTextWidth(weekdayIndex: number): number {
  const w = CALENDAR_COLUMN_WIDTHS[weekdayIndex] ?? CALENDAR_COLUMN_WIDTHS[1]
  return w - CALENDAR_TEXT_WIDTH_INSET
}

/** 문단 하나가 차지하는 높이. */
function paragraphHeight(text: string, textWidth: number): number {
  const lines = estimateLineCount(text, textWidth, CALENDAR_CHAR_HEIGHT)
  return lines * CALENDAR_LINE_HEIGHT + CALENDAR_PARAGRAPH_MARGIN
}

/** 한 달력 셀(날짜 문단 1개 + 일정 문단 N개)의 예상 높이. */
export function estimateCalendarCellHeight(
  day: CalendarDay, entries: readonly CalendarEntry[]
): number {
  const textWidth = calendarTextWidth(day.weekday)
  let total = paragraphHeight(day.label, textWidth)
  for (const e of entries) total += paragraphHeight(e.text, textWidth)
  return total + CALENDAR_CELL_VERTICAL_MARGIN
}

export interface CalendarWeekEstimate {
  /** 0-based 주 index */
  week: number
  height: number
  /** 그 주에서 가장 높은 셀의 날짜(iso) — 진단용 */
  tallestIso: string
  /** 그 주 일정 수 */
  entryCount: number
}

/** 주별 예상 행 높이. 선언 주 행 높이가 하한이다. */
export function estimateCalendarWeekHeights(
  days: readonly CalendarDay[],
  entries: readonly CalendarEntry[],
  declaredWeekHeight: number
): CalendarWeekEstimate[] {
  const byDate = groupCalendarEntries(entries)
  const out: CalendarWeekEstimate[] = []
  for (let w = 0; w < CALENDAR_WEEK_COUNT; w++) {
    let height = declaredWeekHeight
    let tallestIso = ''
    let entryCount = 0
    for (let d = 0; d < DAYS_PER_WEEK; d++) {
      const day = days[w * DAYS_PER_WEEK + d]
      if (!day) continue
      const cellEntries = byDate.get(day.iso) ?? []
      entryCount += cellEntries.length
      const h = estimateCalendarCellHeight(day, cellEntries)
      if (h > height) { height = h; tallestIso = day.iso }
    }
    out.push({ week: w, height, tallestIso, entryCount })
  }
  return out
}

/** 달력 표 전체 예상 높이(요일 헤더 + 3주). */
export function estimateCalendarHeight(
  days: readonly CalendarDay[],
  entries: readonly CalendarEntry[],
  headerHeight: number,
  declaredWeekHeight: number
): number {
  return headerHeight + estimateCalendarWeekHeights(days, entries, declaredWeekHeight)
    .reduce((sum, w) => sum + w.height, 0)
}
