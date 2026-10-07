import { addDays, weekStartOf } from '../assign/calendar'
import type { AssignmentInput, AssignmentProjectInput, LockedRecordInput } from '../assign/types'
import { ASSIGNMENT_RULE_VERSION } from '../assign/types'
import type { AssignmentDraft, MemberTask } from '../planningTypes'
import { payPeriodRange } from '../summary'
import type { Employee, EmployeeTask, Project, ProjectMember, WorkRecord } from '../types'

/**
 * DB에서 읽은 행들 → 자동배정 엔진 입력(lib/overtime/assign). 순수 함수.
 *
 * 계약(docs/overtime-planning-db.md, docs/overtime-assign-engine.md):
 * - 직원×프로젝트 업무: overtime_member_tasks 행이 0건이면 task_ids = null(그 직원 기본업무 전체)
 * - 프로젝트 대상기간 = overtime_projects.start_date~end_date(동기화가 eligibility 결과로 채움), 상태 '진행중'만 배정 가능
 * - 잠금 기록 = 기존 최종기록(수동·자동확정) 전부 + 이번 실행이 대체하지 않는 살아 있는 초안
 *   (잠기거나 수동 수정된 초안, 그리고 범위를 좁힌 재배정이면 범위 밖 초안) — 같은 날짜 중복을 엔진이 피하게
 * - 주 12시간은 급여기간 밖 같은 주 기록까지 봐야 하므로 records는 lockedRange() 범위로 읽어 넘긴다
 */

export type PlanningScope =
  | { kind: 'all' }
  | { kind: 'employee'; employee_id: string }
  | { kind: 'project'; project_id: string }

export interface SourceProjectRow {
  id: string
  project_number: string | null
  submit_date: string | null
}

export interface PlanningRaw {
  year: number
  month0: number          // payPeriodDays(year, month0)와 같은 인자
  asOf: string
  seed: number
  scope: PlanningScope
  employees: Employee[]
  targets: Array<{ employee_id: string; target_hours: number }>
  overtimeProjects: Project[]
  sourceProjects: SourceProjectRow[]
  members: ProjectMember[]
  memberTasks: Pick<MemberTask, 'member_id' | 'task_id'>[]
  tasks: EmployeeTask[]   // sort_order, 생성 순으로 읽어 넘긴다(같은 sort_order는 이 순서)
  holidays: Array<{ holiday_date: string; name: string }>
  records: Array<Pick<WorkRecord, 'employee_id' | 'project_id' | 'work_date' | 'hours' | 'task_description'> & { source?: string | null }>
  drafts: Array<Pick<AssignmentDraft, 'employee_id' | 'project_id' | 'work_date' | 'hours' | 'task_name' | 'status' | 'locked' | 'manually_edited'>>
}

/** 잠금 기록을 읽을 날짜 범위 — 급여기간 첫 주 월요일 ~ 마지막 주 일요일 */
export function lockedRange(year: number, month0: number): { from: string; to: string } {
  const { start, end } = payPeriodRange(year, month0)
  return { from: weekStartOf(start), to: addDays(weekStartOf(end), 6) }
}

export function toPeriodLabel(year: number, month0: number): string {
  return `${year}-${String(month0 + 1).padStart(2, '0')}`
}

/** 이번 실행이 이 초안을 대체(superseded)하는가 — DB의 overtime_save_assignment_run과 같은 조건 */
function supersededBy(scope: PlanningScope, d: PlanningRaw['drafts'][number]): boolean {
  if (d.status !== 'draft' || d.locked || d.manually_edited) return false
  if (scope.kind === 'all') return true
  if (scope.kind === 'employee') return d.employee_id === scope.employee_id
  return d.project_id === scope.project_id
}

export function buildAssignmentInput(raw: PlanningRaw): AssignmentInput {
  const { start, end } = payPeriodRange(raw.year, raw.month0)
  const label = toPeriodLabel(raw.year, raw.month0)
  const scope = raw.scope

  const sourceById = new Map(raw.sourceProjects.map(p => [p.id, p]))
  const targetByEmp = new Map(raw.targets.map(t => [t.employee_id, Number(t.target_hours)]))
  const tasksByMember = new Map<string, string[]>()
  for (const mt of raw.memberTasks) tasksByMember.set(mt.member_id, [...(tasksByMember.get(mt.member_id) ?? []), mt.task_id])

  const memberRows = raw.members.filter(m => scope.kind !== 'project' || m.project_id === scope.project_id)
  const employees = raw.employees
    .filter(e => scope.kind !== 'employee' || e.id === scope.employee_id)
    .filter(e => scope.kind !== 'project' || memberRows.some(m => m.employee_id === e.id))
    .map(e => ({
      employee_id: e.id,
      active: e.is_active,
      target_hours: targetByEmp.has(e.id) ? targetByEmp.get(e.id)! : null,
      projects: memberRows
        .filter(m => m.employee_id === e.id)
        .map(m => ({ project_id: m.project_id, task_ids: tasksByMember.get(m.id) ?? null })),
    }))
  const empIds = new Set(employees.map(e => e.employee_id))
  const usedProjectIds = new Set(employees.flatMap(e => e.projects.map(p => p.project_id)))

  const projects: AssignmentProjectInput[] = raw.overtimeProjects
    .filter(p => usedProjectIds.has(p.id))
    .map(p => {
      const src = p.source_project_id ? sourceById.get(p.source_project_id) : undefined
      return {
        project_id: p.id,
        project_number: src?.project_number ?? null,
        announce_date: p.start_date,
        submit_date: src?.submit_date ?? null,
        period_start: p.start_date,
        period_end: p.end_date,
        auto_assignable: p.status === '진행중' && !!p.start_date && !!p.end_date,
      }
    })

  const locked: LockedRecordInput[] = [
    ...raw.records
      .filter(r => empIds.has(r.employee_id))
      .map(r => ({
        employee_id: r.employee_id, project_id: r.project_id, work_date: r.work_date, hours: Number(r.hours),
        task_name: r.task_description, source: (r.source === 'auto' ? 'auto' : 'manual') as LockedRecordInput['source'],
      })),
    ...raw.drafts
      .filter(d => empIds.has(d.employee_id) && d.status === 'draft' && !supersededBy(scope, d))
      .map(d => ({
        employee_id: d.employee_id, project_id: d.project_id, work_date: d.work_date, hours: Number(d.hours),
        task_name: d.task_name, source: 'locked_draft' as const,
      })),
  ]

  return {
    period: { label, start, end },
    as_of: raw.asOf,
    seed: raw.seed,
    rule_version: ASSIGNMENT_RULE_VERSION,
    holidays: raw.holidays.map(h => ({ date: h.holiday_date, name: h.name })),
    holiday_data_years: [...new Set(raw.holidays.map(h => Number(h.holiday_date.slice(0, 4))))].sort(),
    employees,
    projects,
    tasks: raw.tasks
      .filter(t => empIds.has(t.employee_id))
      .map(t => ({ task_id: t.id, employee_id: t.employee_id, task_name: t.task_name, sort_order: t.sort_order })),
    locked_records: locked,
  }
}
