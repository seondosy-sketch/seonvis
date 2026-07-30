/**
 * 위젯 달력 그리드의 순수 날짜 계산.
 *
 * 주차·주 경계 계산은 새로 만들지 않고 lib/weekSchedule.ts를 경유한다 —
 * 대시보드·주간보고·위젯이 서로 다른 "이 주의 월요일"을 갖게 되면 같은 날짜가 다른 주에
 * 들어가 버린다. mondayOf/sundayOf가 getCurrentWeek+getWeekBounds를 그대로 쓰는 이유다.
 * (연말·연초에 주차 문자열이 `2027-W00`처럼 나오더라도 경계 자체는 정확하다 — 그 계산을
 * 여기서 다시 구현하지 않는 것이 핵심이다.)
 *
 * 모든 Date는 lib/weekSchedule.ts와 같은 규약 — 시:분 없는 로컬 자정의 "달력 날짜"다.
 * KST 보정은 호출부(lib/widget/summary.ts의 kstToday)에서 이미 끝난 상태로 들어온다.
 */
import { getCurrentWeek, getWeekBounds } from '@/lib/weekSchedule'

/** 달력은 월요일 시작 */
export const WEEKDAY_LABELS = ['월', '화', '수', '목', '금', '토', '일'] as const

export function addDays(d: Date, n: number): Date {
  const next = new Date(d)
  next.setDate(d.getDate() + n)
  return next
}

/** 날짜가 속한 주의 월요일 */
export function mondayOf(d: Date): Date {
  return getWeekBounds(getCurrentWeek(d)).start
}

/** 날짜가 속한 주의 일요일 */
export function sundayOf(d: Date): Date {
  return getWeekBounds(getCurrentWeek(d)).end
}

/** 월요일 시작 기준 열 번호 (월=0 … 일=6) */
export function weekdayIndex(d: Date): number {
  return (d.getDay() + 6) % 7
}

export function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86400000)
}

export function eachDate(from: Date, to: Date): Date[] {
  const out: Date[] = []
  for (let i = 0; i <= daysBetween(from, to); i++) out.push(addDays(from, i))
  return out
}

export interface MonthGrid {
  /** 그 달 1일 */
  monthStart: Date
  /** 그 달 말일 */
  monthEnd: Date
  /** 그리드 첫 칸 = 1일이 속한 주의 월요일 (이전 달 날짜일 수 있음) */
  gridStart: Date
  /** 그리드 마지막 칸 = 말일이 속한 주의 일요일 (다음 달 날짜일 수 있음) */
  gridEnd: Date
  /** 주 행 수 — 4(2월이 월요일 시작인 평년) ~ 6 */
  weeks: number
  /** '2026년 7월' */
  monthLabel: string
}

/**
 * 기준 날짜가 속한 달의 달력 그리드.
 * 행 수가 4~6으로 달라지므로 렌더 쪽은 행 높이를 flex로 늘려 어떤 달에도 깨지지 않게 한다.
 */
export function monthGrid(base: Date): MonthGrid {
  const year = base.getFullYear()
  const month = base.getMonth()
  const monthStart = new Date(year, month, 1)
  const monthEnd = new Date(year, month + 1, 0)
  const gridStart = mondayOf(monthStart)
  const gridEnd = sundayOf(monthEnd)
  return {
    monthStart,
    monthEnd,
    gridStart,
    gridEnd,
    weeks: (daysBetween(gridStart, gridEnd) + 1) / 7,
    monthLabel: `${year}년 ${month + 1}월`,
  }
}

/**
 * 범위와 겹치는 모든 주의 주차 키 — `performing_projects.week` 조회용.
 * 주간보고가 주차별로 스냅샷을 저장하므로, 월 달력을 그리려면 그 달을 덮는 주차들을 모두
 * 읽어 각 주차의 경계로 buildSchedule을 돌려야 웹 화면과 같은 값이 나온다.
 */
export function weekKeysInRange(from: Date, to: Date): string[] {
  const keys: string[] = []
  let cursor = mondayOf(from)
  const last = mondayOf(to)
  while (cursor <= last) {
    keys.push(getCurrentWeek(cursor))
    cursor = addDays(cursor, 7)
  }
  return keys
}
