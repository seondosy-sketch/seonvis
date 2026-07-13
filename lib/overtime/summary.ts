import { Employee, Project, WorkRecord, DailySummary } from './types'

/**
 * employee_id + work_date 조합 키.
 * 그리드 셀 조회와 집계 생성 양쪽에서 항상 이 함수로만 키를 만들어 규칙이 어긋나지 않게 한다.
 */
export function summaryKey(employeeId: string, workDate: string): string {
  return `${employeeId}__${workDate}`
}

/**
 * overtime_work_records 조회 결과(특정 기간)를 직원×날짜별로 묶어 DailySummary 맵으로 만든다.
 * 총 연장시간·건수는 DB 컬럼으로 저장하지 않고 항상 이 함수로 계산한다 — 1단계에서 정한
 * "직원 1명 + 날짜 1개 + 프로젝트 1개 + 업무 1개 = Record 1개" 원칙을 그대로 반영한 것.
 */
export function summarizeByEmployeeAndDate(records: WorkRecord[]): Map<string, DailySummary> {
  const map = new Map<string, DailySummary>()
  for (const record of records) {
    const key = summaryKey(record.employee_id, record.work_date)
    const existing = map.get(key)
    if (existing) {
      existing.records.push(record)
      existing.total_hours += record.hours
      existing.record_count += 1
    } else {
      map.set(key, {
        employee_id: record.employee_id,
        work_date: record.work_date,
        total_hours: record.hours,
        record_count: 1,
        records: [record],
      })
    }
  }
  return map
}

/** 그리드 셀 표시용 — 6 → "6h", 6.5 → "6.5h" */
export function formatHours(hours: number): string {
  const rounded = Math.round(hours * 100) / 100
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}h`
}

/**
 * 이 팀의 "한 달" 기준: 전달 21일 ~ 이번달 20일 (급여 마감 기준, 달력 월과 다름).
 * `month`은 그 기간의 마지막 날(20일)이 속한 달을 가리킨다 — 예를 들어
 * `payPeriodDays(2026, 6)`(2026년 7월)은 2026-06-21 ~ 2026-07-20을 반환한다.
 * 기간이 두 달에 걸치므로 각 날짜의 실제 연/월/일을 함께 담아 그리드·차트가
 * 달력 월이 바뀌는 지점을 표시할 수 있게 한다.
 */
export interface PayPeriodDay {
  year: number
  month: number // 0-indexed, 이 날짜가 실제로 속한 달력 월 (기간의 라벨 월과 다를 수 있음)
  day: number
  dateStr: string
}

export function payPeriodDays(year: number, month: number): PayPeriodDay[] {
  const start = new Date(year, month - 1, 21)
  const end = new Date(year, month, 20)
  const days: PayPeriodDay[] = []
  const cur = new Date(start)
  while (cur.getTime() <= end.getTime()) {
    days.push({ year: cur.getFullYear(), month: cur.getMonth(), day: cur.getDate(), dateStr: toDateStr(cur.getFullYear(), cur.getMonth(), cur.getDate()) })
    cur.setDate(cur.getDate() + 1)
  }
  return days
}

/** work_date 조회의 gte/lte 경계로 쓰는 [시작일, 종료일] 문자열. */
export function payPeriodRange(year: number, month: number): { start: string; end: string } {
  const days = payPeriodDays(year, month)
  return { start: days[0].dateStr, end: days[days.length - 1].dateStr }
}

/** 오늘이 속한 급여 기준 기간의 라벨(year, month) — 21일 이후면 다음 달 기간으로 넘어간다. */
export function currentPayPeriod(): { year: number; month: number } {
  const now = new Date()
  let year = now.getFullYear()
  let month = now.getMonth()
  if (now.getDate() >= 21) {
    month += 1
    if (month > 11) { month = 0; year += 1 }
  }
  return { year, month }
}

function toDateStr(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export interface LabeledTotal {
  id: string
  label: string
  hours: number
}

/**
 * 아래 두 집계 함수는 대시보드(7단계)와 월말 출력(8단계 — "직원별 연장근무 내역",
 * "프로젝트별 투입내역")이 똑같은 계산을 다시 하지 않도록 여기 하나로 모아둔다.
 * 시간이 큰 순으로 정렬한다 — 두 화면 모두 "누가/어느 프로젝트가 많이 썼는지"가 관심사라서.
 */
export function sumHoursByEmployee(records: WorkRecord[], employees: Employee[]): LabeledTotal[] {
  const nameById = new Map(employees.map(e => [e.id, e.name]))
  const totals = new Map<string, number>()
  for (const r of records) totals.set(r.employee_id, (totals.get(r.employee_id) ?? 0) + r.hours)
  return [...totals.entries()]
    .map(([id, hours]) => ({ id, label: nameById.get(id) ?? '(알 수 없음)', hours }))
    .sort((a, b) => b.hours - a.hours)
}

export function sumHoursByProject(records: WorkRecord[], projects: Project[]): LabeledTotal[] {
  const nameById = new Map(projects.map(p => [p.id, p.name]))
  const totals = new Map<string, number>()
  for (const r of records) totals.set(r.project_id, (totals.get(r.project_id) ?? 0) + r.hours)
  return [...totals.entries()]
    .map(([id, hours]) => ({ id, label: nameById.get(id) ?? '(알 수 없음)', hours }))
    .sort((a, b) => b.hours - a.hours)
}

/** work_date(YYYY-MM-DD)별 합계. 날짜가 없는 날은 맵에 없다 — 호출부가 0으로 채워 넣는다. */
export function sumHoursByDate(records: WorkRecord[]): Map<string, number> {
  const totals = new Map<string, number>()
  for (const r of records) totals.set(r.work_date, (totals.get(r.work_date) ?? 0) + r.hours)
  return totals
}
