import { calculateRecognizedHours, isValidTimeText } from '@/lib/overtime/time'
import { FieldOvertimeRecord } from './types'

/**
 * 실무자 연장근무 인정시간 규칙 — 종료시간만 입력받고 나머지는 고정한다.
 *   인정시간 = 종료시간 - 18:00 - 휴게 1시간, 1시간 단위 절삭(내림)
 *   예) 21:00 → 2시간, 22:30 → 3시간(3.5 절삭), 19:30 → 인정 없음
 * 계산식 자체는 제안서팀 팝오버 "기타" 유형과 같은 calculateRecognizedHours를 그대로 쓴다 —
 * 규칙이 두 군데서 따로 놀지 않게.
 */
export const FIELD_START_TIME = '18:00'
export const FIELD_BREAK_HOURS = 1

/** "2130", "21", "21:3" 같은 빠른 입력을 "21:30" 형태로 정리한다. 해석 불가면 원문 그대로. */
export function normalizeEndTime(input: string): string {
  const v = input.trim()
  if (isValidTimeText(v)) {
    const [h, m] = v.split(':')
    return `${h.padStart(2, '0')}:${m}`
  }
  const digits = v.replace(/\D/g, '')
  if (v === digits) {
    if (digits.length <= 2) return `${digits.padStart(2, '0')}:00`
    if (digits.length === 3 || digits.length === 4) {
      const h = digits.slice(0, digits.length - 2)
      const m = digits.slice(-2)
      if (parseInt(m, 10) < 60) return `${h.padStart(2, '0')}:${m}`
    }
  }
  return v
}

export type FieldHoursResult =
  | { ok: true; raw: number; recognized: number }
  | { ok: false; reason: string }

/**
 * startTime을 주면(휴일 근무) 18:00 대신 그 시각부터 계산한다 — 휴게 1시간·1시간 절삭은 같다.
 *   예) 휴일 09:00~18:00 → 9 − 1 = 8시간
 */
export function calculateFieldHours(endTime: string, startTime?: string | null): FieldHoursResult {
  const end = normalizeEndTime(endTime)
  if (!isValidTimeText(end)) return { ok: false, reason: '종료시간 형식이 올바르지 않습니다 (예: 21:30, 자정 이후는 25:00)' }
  const start = startTime ? normalizeEndTime(startTime) : FIELD_START_TIME
  if (!isValidTimeText(start)) return { ok: false, reason: '시작시간 형식이 올바르지 않습니다 (예: 09:00)' }
  const result = calculateRecognizedHours(start, end, FIELD_BREAK_HOURS)
  if (!result || result.recognized < 1) {
    return {
      ok: false,
      reason: startTime
        ? `인정시간이 1시간 미만입니다 (${start} 시작 · 휴게 ${FIELD_BREAK_HOURS}시간 차감)`
        : `인정시간이 1시간 미만입니다 (18:00 시작 · 휴게 ${FIELD_BREAK_HOURS}시간 → 20:00 이후 종료부터 인정)`,
    }
  }
  return { ok: true, ...result }
}

// ── 휴일 ─────────────────────────────────────────────────────

/** 휴일 근무의 시작시간 기본값 */
export const HOLIDAY_DEFAULT_START = '09:00'

/**
 * 휴일(주말 + 휴가관리의 법정공휴일·회사휴무)이면 그 이름, 평일이면 null.
 * 휴일 근무는 정규 근무가 없으니 18:00 고정 시작이 맞지 않아 시작시간도 입력받는다.
 * holidays는 휴가관리 holidays 테이블의 holiday_date → name 맵 — 공휴일 목록을 여기서 따로 두지 않는다.
 */
export function restDayName(dateStr: string, holidays: Map<string, string>): string | null {
  const named = holidays.get(dateStr)
  if (named) return named
  const [y, m, d] = dateStr.split('-').map(Number)
  const dow = new Date(y, m - 1, d).getDay()
  if (dow === 0) return '일요일'
  if (dow === 6) return '토요일'
  return null
}

// ── 날짜 / 주차 ──────────────────────────────────────────────

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function toDateStr(year: number, month0: number, day: number): string {
  return `${year}-${pad2(month0 + 1)}-${pad2(day)}`
}

export function monthRange(year: number, month0: number): { start: string; end: string } {
  const last = new Date(year, month0 + 1, 0).getDate()
  return { start: toDateStr(year, month0, 1), end: toDateStr(year, month0, last) }
}

export interface MonthWeek {
  index: number               // 1주차부터
  cells: (string | null)[]    // 월~일 7칸. 이 달이 아닌 날은 null
  dates: string[]             // 이 달에 속한 날짜만
  label: string               // "10/1~10/5"
}

/**
 * 달력 월(1일~말일)을 월요일 시작 주로 나눈다. 달력 화면의 한 줄 = 한 주차라서
 * 달력과 주차별 집계가 이 함수 하나를 같이 쓴다. 월 경계에 걸친 주는 이 달 날짜만 담는다
 * (그 주의 나머지 날은 이전/다음 달 집계에 들어간다).
 */
export function monthWeeks(year: number, month0: number): MonthWeek[] {
  const daysInMonth = new Date(year, month0 + 1, 0).getDate()
  const leading = (new Date(year, month0, 1).getDay() + 6) % 7 // 월=0 … 일=6
  const flat: (string | null)[] = []
  for (let i = 0; i < leading; i++) flat.push(null)
  for (let d = 1; d <= daysInMonth; d++) flat.push(toDateStr(year, month0, d))
  while (flat.length % 7 !== 0) flat.push(null)

  const weeks: MonthWeek[] = []
  for (let i = 0; i < flat.length; i += 7) {
    const cells = flat.slice(i, i + 7)
    const dates = cells.filter((c): c is string => c !== null)
    const short = (s: string) => `${parseInt(s.slice(5, 7), 10)}/${parseInt(s.slice(8), 10)}`
    weeks.push({ index: weeks.length + 1, cells, dates, label: `${short(dates[0])}~${short(dates[dates.length - 1])}` })
  }
  return weeks
}

// ── 집계 ─────────────────────────────────────────────────────

/** 직원별 주차 합계: employee_id → [1주차, 2주차, …] */
export function sumByEmployeeWeek(records: FieldOvertimeRecord[], weeks: MonthWeek[]): Map<string, number[]> {
  const weekOf = new Map<string, number>()
  weeks.forEach((w, i) => w.dates.forEach(d => weekOf.set(d, i)))
  const result = new Map<string, number[]>()
  for (const r of records) {
    const wi = weekOf.get(r.work_date)
    if (wi === undefined) continue
    const row = result.get(r.employee_id) ?? weeks.map(() => 0)
    row[wi] += Number(r.hours)
    result.set(r.employee_id, row)
  }
  return result
}

/** 직원별 월 합계(한 해): employee_id → [1월, …, 12월] */
export function sumByEmployeeMonth(records: FieldOvertimeRecord[]): Map<string, number[]> {
  const result = new Map<string, number[]>()
  for (const r of records) {
    const m0 = parseInt(r.work_date.slice(5, 7), 10) - 1
    const row = result.get(r.employee_id) ?? Array(12).fill(0)
    row[m0] += Number(r.hours)
    result.set(r.employee_id, row)
  }
  return result
}
