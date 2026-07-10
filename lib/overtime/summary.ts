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

/** 선택한 연/월의 [1일, 말일] 문자열 범위. work_date 조회의 gte/lte 경계로 쓴다. */
export function monthRange(year: number, month: number): { start: string; end: string } {
  const pad = (n: number) => String(n).padStart(2, '0')
  const lastDay = new Date(year, month + 1, 0).getDate()
  return {
    start: `${year}-${pad(month + 1)}-01`,
    end: `${year}-${pad(month + 1)}-${pad(lastDay)}`,
  }
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
