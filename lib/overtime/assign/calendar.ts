import type { CalendarDay, HolidayInput } from './types'

/**
 * 날짜 계산 — 'YYYY-MM-DD' 문자열과 UTC 기준 일련번호(epoch day)만 쓴다.
 * 로컬 타임존의 Date 파싱을 쓰지 않으므로 실행 환경 타임존과 무관하다(docs/conventions.md의 UTC 파싱 버그 회피).
 */

const MS_PER_DAY = 86_400_000
const pad = (n: number) => String(n).padStart(2, '0')

export function toEpochDay(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / MS_PER_DAY)
}

export function fromEpochDay(day: number): string {
  const dt = new Date(day * MS_PER_DAY)
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}

export function addDays(date: string, days: number): string {
  return fromEpochDay(toEpochDay(date) + days)
}

/** 0=일 … 6=토 (1970-01-01은 목요일) */
export function weekdayOf(date: string): number {
  return (((toEpochDay(date) + 4) % 7) + 7) % 7
}

/** 그 주 월요일 — 주간 기준은 월요일~일요일 */
export function weekStartOf(date: string): string {
  return addDays(date, -((weekdayOf(date) + 6) % 7))
}

export function isWeekend(date: string): boolean {
  const w = weekdayOf(date)
  return w === 0 || w === 6
}

/** start ~ end (양 끝 포함) */
export function eachDate(start: string, end: string): string[] {
  const out: string[] = []
  for (let d = toEpochDay(start), e = toEpochDay(end); d <= e; d++) out.push(fromEpochDay(d))
  return out
}

/** 기간이 걸친 연도 */
export function yearsInRange(start: string, end: string): number[] {
  const out: number[] = []
  for (let y = Number(start.slice(0, 4)); y <= Number(end.slice(0, 4)); y++) out.push(y)
  return out
}

/** 공휴일 데이터가 없는 연도 — 급여기간이 두 연도에 걸치면 두 연도 모두 있어야 한다 */
export function missingHolidayYears(start: string, end: string, providedYears: readonly number[]): number[] {
  const have = new Set(providedYears)
  return yearsInRange(start, end).filter(y => !have.has(y))
}

export function buildCalendar(start: string, end: string, holidays: readonly HolidayInput[]): CalendarDay[] {
  const names = new Map(holidays.map(h => [h.date, h.name]))
  return eachDate(start, end).map(date => {
    const holidayName = names.get(date) ?? null
    return {
      date,
      weekday: weekdayOf(date),
      week_start: weekStartOf(date),
      is_weekend: isWeekend(date),
      is_holiday: holidayName !== null,
      holiday_name: holidayName,
    }
  })
}
