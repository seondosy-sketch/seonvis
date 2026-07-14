/**
 * 휴가관리 — 일수 계산·집계·검증 순수 함수 (docs/leave-management/04-calculation-rules.md)
 *
 * 날짜는 YYYY-MM-DD 문자열로 다루고, 요일이 필요할 때만 로컬 생성자로 만든다 —
 * new Date("YYYY-MM-DD") 파싱은 UTC 버그가 있어 금지 (docs/conventions.md).
 */

import { DayUnit, LeaveRecordDate } from './types'

function toLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function toDateStr(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

export function isWeekend(dateStr: string): boolean {
  const day = toLocalDate(dateStr).getDay()
  return day === 0 || day === 6
}

/** 시작~종료의 모든 날짜 문자열 (양끝 포함) */
export function eachDate(start: string, end: string): string[] {
  const out: string[] = []
  const d = toLocalDate(start)
  const last = toLocalDate(end)
  while (d <= last) {
    out.push(toDateStr(d))
    d.setDate(d.getDate() + 1)
  }
  return out
}

/** 전체 기간 일수 = 종료 - 시작 + 1 (달력 기준, 주말·공휴일 포함) */
export function totalCalendarDays(start: string, end: string): number {
  return eachDate(start, end).length
}

/** "N박 M일" — 같은 날짜면 0박 1일 */
export function formatNightsDays(calendarDays: number): string {
  return `${calendarDays - 1}박 ${calendarDays}일`
}

/** 차감일수 표시 — JS 숫자 표기 그대로 "2" / "0.5" / "2.5" */
export function formatDays(n: number): string {
  return String(n)
}

function unitDeduction(unit: DayUnit): number {
  return unit === 'full' ? 1 : 0.5
}

export type ExpandedDate = Omit<LeaveRecordDate, 'id' | 'leave_record_id'>

/**
 * 휴가 1건을 날짜별로 전개한다 — 저장 시 leave_record_dates에 그대로 들어가는 값.
 *
 * 날짜마다: 주말 → 차감 0 / 공휴일·회사휴무 → 차감 0 / 평일 → 단위별 차감
 * (시작일은 시작 단위, 종료일은 종료 단위, 중간일은 전일 1. 같은 날이면 단위 하나).
 * 유형이 연차 미차감이면 차감은 전부 0으로 두되 날짜 행은 남긴다(날짜 점유 → 중복 검증용).
 */
export function expandLeaveDates(
  start: string,
  end: string,
  startUnit: DayUnit,
  endUnit: DayUnit,
  deductsAnnualLeave: boolean,
  holidayNames: Map<string, string>, // holiday_date → name
): ExpandedDate[] {
  const dates = eachDate(start, end)
  return dates.map((dateStr, i) => {
    const unit: DayUnit =
      dates.length === 1 ? startUnit
      : i === 0 ? startUnit
      : i === dates.length - 1 ? endUnit
      : 'full'
    const weekend = isWeekend(dateStr)
    const holidayName = holidayNames.get(dateStr) ?? null
    const deducted =
      weekend || holidayName !== null || !deductsAnnualLeave ? 0 : unitDeduction(unit)
    return {
      leave_date: dateStr,
      day_unit: unit,
      deducted_days: deducted,
      is_weekend: weekend,
      is_holiday: holidayName !== null,
      holiday_name: holidayName,
    }
  })
}

export function sumDeducted(dates: Pick<ExpandedDate, 'deducted_days'>[]): number {
  // 0.5 단위 합산의 부동소수점 오차 방지 (0.1+0.2 문제) — 0.5 배수라 *2 후 정수 합산
  return dates.reduce((s, d) => s + Math.round(d.deducted_days * 2), 0) / 2
}

/**
 * 월별 집계 — 직원별 [1월..12월] 차감 합.
 * 날짜가 속한 달 기준이므로 월을 걸치는 휴가는 자동으로 나뉜다.
 * dates에는 해당 연도의 날짜만 넘길 것 (연도 걸침 휴가의 타 연도 날짜 제외).
 */
export function monthlySums(
  dates: Array<{ employee_id: string; leave_date: string; deducted_days: number }>,
): Map<string, number[]> {
  const map = new Map<string, number[]>()
  for (const d of dates) {
    const month = parseInt(d.leave_date.slice(5, 7), 10) // 1~12
    let arr = map.get(d.employee_id)
    if (!arr) { arr = Array(12).fill(0); map.set(d.employee_id, arr) }
    arr[month - 1] += Math.round(d.deducted_days * 2)
  }
  for (const arr of map.values()) for (let i = 0; i < 12; i++) arr[i] /= 2
  return map
}

/**
 * 같은 직원의 기존 날짜 점유와 새 전개의 겹침 판정.
 * full vs 무엇이든 → 겹침 / am vs am, pm vs pm → 겹침 / am vs pm → 허용.
 * 반환: 겹치는 날짜 문자열 목록 (비어 있으면 통과).
 */
export function findOverlaps(
  newDates: Pick<ExpandedDate, 'leave_date' | 'day_unit'>[],
  existingDates: Array<{ leave_date: string; day_unit: DayUnit }>,
): string[] {
  const existing = new Map<string, DayUnit[]>()
  for (const e of existingDates) {
    const arr = existing.get(e.leave_date) ?? []
    arr.push(e.day_unit)
    existing.set(e.leave_date, arr)
  }
  const conflicts: string[] = []
  for (const n of newDates) {
    const units = existing.get(n.leave_date)
    if (!units) continue
    const conflict = units.some(u => u === 'full' || n.day_unit === 'full' || u === n.day_unit)
    if (conflict) conflicts.push(n.leave_date)
  }
  return conflicts
}

export interface ValidationIssue {
  level: 'block' | 'warn' // warn은 confirm 후 저장 허용 — 추후 설정으로 block 전환 가능한 구조
  message: string
}

/** 저장 전 검증 — 겹침 검사는 호출부가 findOverlaps로 별도 수행 (기존 데이터 조회 필요) */
export function validateLeaveInput(input: {
  employeeId: string
  leaveTypeId: string
  start: string
  end: string
  hireDate: string | null
  resignDate: string | null
  deductedDays: number   // 이번 휴가의 차감 합
  remainingDays: number | null // 저장 전 잔여 (부여 없으면 null → 초과 검사 생략)
  deductsAnnualLeave: boolean
}): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (!input.employeeId) issues.push({ level: 'block', message: '직원을 선택하세요.' })
  if (!input.leaveTypeId) issues.push({ level: 'block', message: '휴가 유형을 선택하세요.' })
  if (!input.start || !input.end) issues.push({ level: 'block', message: '시작일과 종료일을 입력하세요.' })
  if (input.start && input.end && input.end < input.start)
    issues.push({ level: 'block', message: '종료일이 시작일보다 빠릅니다.' })
  if (input.hireDate && input.start && input.start < input.hireDate)
    issues.push({ level: 'block', message: `입사일(${input.hireDate}) 이전의 휴가입니다.` })
  if (input.resignDate && input.end && input.end > input.resignDate)
    issues.push({ level: 'block', message: `퇴사일(${input.resignDate}) 이후의 휴가입니다.` })
  if (
    input.deductsAnnualLeave &&
    input.remainingDays !== null &&
    input.deductedDays > input.remainingDays
  )
    issues.push({
      level: 'warn',
      message: `잔여 연차(${input.remainingDays}일)를 초과합니다 (차감 ${input.deductedDays}일). 그래도 저장하시겠습니까?`,
    })
  return issues
}
