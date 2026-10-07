import { compareProjectNumber } from '@/lib/projectOrder'
import { isStrictIsoDate } from '../eligibility'
import { TIME_TYPE_PRESETS } from '../time'
import { buildCalendar, eachDate, missingHolidayYears, toEpochDay, weekStartOf } from './calendar'
import { evaluateContinuity } from './continuity'
import { weeklyLoadSpread } from './distribution'
import { distributeWeekHours, maxRepresentable, preferredCompositions } from './hours'
import { createRng, deriveSeed, type Rng } from './rng'
import { validateSchedule } from './validate'
import {
  WEEKLY_CAP_HOURS,
  type AssignmentEmployeeInput,
  type AssignmentInput,
  type AssignmentIssue,
  type AssignmentIssueCode,
  type AssignmentProjectInput,
  type AssignmentResult,
  type AssignmentTaskInput,
  type CalendarDay,
  type EmployeeSummary,
  type GeneratedAssignment,
  type ProjectSummary,
} from './types'

/**
 * 연장근무 자동배정 엔진 (순수 함수 — DB·화면 없음). 규칙·근거: docs/overtime-assign-engine.md
 *
 * 직원마다 독립적으로 배정한다(한도가 전부 직원 단위라 직원 간 공유 자원이 없다). 직원 1명의 흐름:
 *   1. 차단 검사: 비활성, 월 목표 미입력, 목표 < 잠금 → 신규 0건
 *   2. 배정 목표 T = 2·3시간으로 만들 수 있는 최대값(목표 − 급여기간 잠금, 가용 날짜·주 한도로 상한)
 *   3. 배정 가능한 프로젝트를 제출일 우선순위로 정렬
 *   4. T의 2·3시간 조합 후보(혼합 → 개수 차이 최소 → 일수 적음)마다 일수를 프로젝트에 나누고 날짜를 놓아 본다:
 *      - 일수 배분: 각 프로젝트 최소 1일 → 가능하면 최소 2일(평일 2일 이상 있는 프로젝트, 우선순위 순)
 *        → 남는 일수는 우선순위 순으로 각 프로젝트의 평일까지 → 그래도 남으면 주말·공휴일
 *      - 평일 블록: 우선순위(=시간) 순서로 프로젝트마다 연속 블록 1개, 남는 공간을 블록 사이에 고르게 나눠 위치를 분산
 *      - 모자라는 일수만 그 프로젝트 안의 평일 → 주말·공휴일에서 블록 가까운 날로 채움
 *      주말·공휴일을 가장 적게 쓰는 후보를, 같으면 조합 선호 순서가 앞선 후보를 고른다. 안 되면 T를 1씩 낮춘다.
 *   5. 주별 2·3시간 배분: 2시간을 깔고 남는 1시간씩을 (잠금+배정) 합계가 가장 작은 주부터 → 합계 정확, 주간 분산
 *   6. 주말·공휴일 배정을 같은 프로젝트 기간의 평일로 옮길 수 있으면 옮김(프로젝트는 바꾸지 않음)
 *   7. 프로젝트 블록 안에서 업무를 연속 하위 블록으로 나눔(일수 < 업무 수면 우선순위 높은 업무만)
 *      1일 블록이 생기면 SINGLE_DAY_PROJECT_BLOCK(정보)으로 사유를 알린다
 *   8. validateSchedule로 모든 강제조건을 독립 재검사
 * 난수(seed)는 분산 점수까지 같은 블록 위치 고르기, 주 안의 3시간 날짜에만 쓴다. 업무는 sort_order → 입력 배열
 * 순서로 완전히 정해지므로 seed가 업무 선택·순서를 바꾸지 않는다.
 */

const EPS = 1e-9

interface EligibleProject {
  project: AssignmentProjectInput
  tasks: AssignmentTaskInput[]
  windowStart: string
  windowEnd: string
}

export interface PlannedDay {
  projectId: string
  hours: 2 | 3
}

const nullsLast = (a: string | null, b: string | null) =>
  a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1

/** 제출일 → 대상기간 종료일 → 공고일 → 공사번호 → id. 난수 없음. (lib/overtime/eligibility.ts sortForAssignment와 같은 순서) */
export function compareProjectPriority(a: AssignmentProjectInput, b: AssignmentProjectInput): number {
  return (
    nullsLast(isStrictIsoDate(a.submit_date) ? a.submit_date : null, isStrictIsoDate(b.submit_date) ? b.submit_date : null) ||
    nullsLast(a.period_end, b.period_end) ||
    nullsLast(a.announce_date, b.announce_date) ||
    compareProjectNumber(a.project_number, b.project_number) ||
    (a.project_id < b.project_id ? -1 : a.project_id > b.project_id ? 1 : 0)
  )
}

function issue(code: AssignmentIssueCode, severity: AssignmentIssue['severity'], message: string, extra: Partial<AssignmentIssue> = {}): AssignmentIssue {
  return { code, severity, message, ...extra }
}

const isWorkday = (d: CalendarDay) => !d.is_weekend && !d.is_holiday

/**
 * 주말·공휴일 배정을 **같은 프로젝트** 기간 안의 평일로 옮길 수 있으면 옮긴다(평일 우선).
 * 옮길 평일 조건: 잠금·기존 배정이 없고, 그 주 합계(잠금 포함) + 시간 ≤ 12. 블록에 가까운 날을 고른다.
 * 다른 프로젝트의 평일로는 옮기지 않는다 — 프로젝트별 시간 배분을 바꾸지 않기 위해.
 */
export function relocateWeekendsWithinProject(params: {
  plan: ReadonlyMap<string, PlannedDay>
  days: readonly CalendarDay[]
  windows: ReadonlyMap<string, { start: string; end: string }>
  lockedDates: ReadonlySet<string>
  lockedWeek: ReadonlyMap<string, number>
}): Map<string, PlannedDay> {
  const plan = new Map(params.plan)
  const dayByDate = new Map(params.days.map(d => [d.date, d]))
  for (let guard = 0; guard < 10_000; guard++) {
    const weekTotal = new Map<string, number>(params.lockedWeek)
    for (const [d, p] of plan) {
      const w = dayByDate.get(d)!.week_start
      weekTotal.set(w, (weekTotal.get(w) ?? 0) + p.hours)
    }
    let moved = false
    for (const date of [...plan.keys()].sort()) {
      const src = dayByDate.get(date)!
      if (isWorkday(src)) continue
      const { projectId, hours } = plan.get(date)!
      const win = params.windows.get(projectId)
      if (!win) continue
      const others = [...plan].filter(([od, p]) => od !== date && p.projectId === projectId).map(([od]) => toEpochDay(od))
      let best: { date: string; dist: number } | null = null
      for (const d of params.days) {
        if (!isWorkday(d) || params.lockedDates.has(d.date) || plan.has(d.date)) continue
        if (d.date < win.start || d.date > win.end) continue
        const weekHours = (weekTotal.get(d.week_start) ?? 0) - (d.week_start === src.week_start ? hours : 0)
        if (weekHours + hours > WEEKLY_CAP_HOURS + EPS) continue
        const dist = others.length > 0 ? Math.min(...others.map(x => Math.abs(x - toEpochDay(d.date)))) : 0
        if (!best || dist < best.dist) best = { date: d.date, dist }
      }
      if (best) {
        plan.delete(date)
        plan.set(best.date, { projectId, hours })
        moved = true
        break
      }
    }
    if (!moved) break
  }
  return plan
}

export function runAssignment(input: AssignmentInput): AssignmentResult {
  const issues: AssignmentIssue[] = []
  const run = { period_label: input.period.label, seed: input.seed, rule_version: input.rule_version, as_of: input.as_of }
  const blocked = (): AssignmentResult => ({ ok: false, run, assignments: [], employees: [], projects: [], issues, violations: [] })

  const { start, end } = input.period
  if (!isStrictIsoDate(start) || !isStrictIsoDate(end) || start > end || !Number.isFinite(input.seed)) {
    issues.push(issue('INVALID_INPUT', 'error', '급여기간 또는 seed 형식이 올바르지 않습니다'))
    return blocked()
  }
  const missingYears = missingHolidayYears(start, end, input.holiday_data_years)
  if (missingYears.length > 0) {
    issues.push(issue('OVERTIME_HOLIDAYS_MISSING', 'error', `${missingYears.join(', ')}년 공휴일 데이터가 없어 자동배정을 할 수 없습니다`, { detail: { years: missingYears } }))
    return blocked()
  }

  const days = buildCalendar(start, end, input.holidays)
  const dayByDate = new Map(days.map(d => [d.date, d]))
  const projectsById = new Map(input.projects.map(p => [p.project_id, p]))

  // 같은 직원이 두 번 들어오면 첫 행만 쓴다
  const employees: AssignmentEmployeeInput[] = []
  const seenEmp = new Set<string>()
  for (const e of [...input.employees].sort((a, b) => (a.employee_id < b.employee_id ? -1 : 1))) {
    if (seenEmp.has(e.employee_id)) {
      issues.push(issue('INVALID_INPUT', 'warning', '같은 직원이 입력에 두 번 있어 첫 번째만 사용했습니다', { employee_id: e.employee_id }))
      continue
    }
    seenEmp.add(e.employee_id)
    employees.push(e)
  }

  const assignments: GeneratedAssignment[] = []
  const summaries: EmployeeSummary[] = []
  const blocksByProject = new Map<string, number>()
  const projectUnassigned = new Map<string, ProjectSummary['unassigned_employees']>()

  for (const emp of employees) {
    const r = planEmployee(input, emp, days, dayByDate, projectsById)
    assignments.push(...r.assignments)
    summaries.push(r.summary)
    issues.push(...r.issues)
    for (const [pid, n] of r.blocks) blocksByProject.set(pid, (blocksByProject.get(pid) ?? 0) + n)
    for (const u of r.unassignedProjects) {
      const list = projectUnassigned.get(u.project_id) ?? []
      list.push({ employee_id: emp.employee_id, code: u.code, message: u.message })
      projectUnassigned.set(u.project_id, list)
    }
  }

  assignments.sort((a, b) => (a.employee_id < b.employee_id ? -1 : a.employee_id > b.employee_id ? 1 : a.work_date < b.work_date ? -1 : 1))

  const projects: ProjectSummary[] = [...input.projects].sort(compareProjectPriority).map(p => {
    const mine = assignments.filter(a => a.project_id === p.project_id)
    const dates = mine.map(a => a.work_date).sort()
    return {
      project_id: p.project_id,
      employee_ids: [...new Set(mine.map(a => a.employee_id))].sort(),
      total_hours: mine.reduce((s, a) => s + a.hours, 0),
      first_date: dates[0] ?? null,
      last_date: dates[dates.length - 1] ?? null,
      block_count: blocksByProject.get(p.project_id) ?? 0,
      unassigned_employees: projectUnassigned.get(p.project_id) ?? [],
    }
  })

  const violations = validateSchedule(input, assignments)
  if (violations.length > 0) {
    issues.push(issue('VALIDATION_FAILED', 'error', '배정 결과가 강제조건 검증을 통과하지 못했습니다', { detail: { count: violations.length } }))
  }
  return { ok: violations.length === 0, run, assignments, employees: summaries, projects, issues, violations }
}

// ════════════════════════════════════════════════════════════════════════════
// 직원 1명
// ════════════════════════════════════════════════════════════════════════════

interface EmployeePlan {
  assignments: GeneratedAssignment[]
  summary: EmployeeSummary
  issues: AssignmentIssue[]
  blocks: Map<string, number>
  unassignedProjects: Array<{ project_id: string; code: AssignmentIssueCode; message: string }>
}

function planEmployee(
  input: AssignmentInput,
  emp: AssignmentEmployeeInput,
  days: CalendarDay[],
  dayByDate: Map<string, CalendarDay>,
  projectsById: Map<string, AssignmentProjectInput>,
): EmployeePlan {
  const eid = emp.employee_id
  const { start, end } = input.period
  const issues: AssignmentIssue[] = []
  const unassignedProjects: EmployeePlan['unassignedProjects'] = []

  const locked = input.locked_records.filter(r => r.employee_id === eid)
  const lockedDates = new Set(locked.map(r => r.work_date))
  const lockedWeek = new Map<string, number>()
  for (const r of locked) {
    const w = weekStartOf(r.work_date)
    lockedWeek.set(w, (lockedWeek.get(w) ?? 0) + r.hours)
  }
  const lockedInPeriod = locked.filter(r => r.work_date >= start && r.work_date <= end).reduce((s, r) => s + r.hours, 0)

  const capH = (week: string) => Math.max(0, Math.floor(WEEKLY_CAP_HOURS - (lockedWeek.get(week) ?? 0) + EPS))
  /** 그 주에 놓을 수 있는 최대 일수 — 하루 최소 2시간이므로 ⌊한도/2⌋ */
  const dayLimit = (week: string) => Math.floor(capH(week) / 2)
  const weekOfDate = (date: string) => dayByDate.get(date)!.week_start

  let eligible: EligibleProject[] = []
  let unusedTasks = new Map<string, string[]>()

  const summary: EmployeeSummary = {
    employee_id: eid,
    target_hours: emp.target_hours,
    locked_hours: lockedInPeriod,
    assigned_hours: 0,
    unassigned_hours: 0,
    weekly: [],
    weekly_stdev: 0,
    by_project: [],
    weekend_holiday_count: 0,
  }
  const finish = (plan: Map<string, PlannedDay>, tasks: Map<string, AssignmentTaskInput>, reasons: Map<string, string>): EmployeePlan => {
    const assignments: GeneratedAssignment[] = [...plan.keys()].sort().map(date => {
      const p = plan.get(date)!
      const day = dayByDate.get(date)!
      const preset = TIME_TYPE_PRESETS[p.hours === 2 ? '2h' : '3h']
      const task = tasks.get(date)!
      return {
        employee_id: eid,
        project_id: p.projectId,
        task_id: task.task_id,
        task_name: task.task_name,
        work_date: date,
        hours: p.hours,
        time_type: p.hours === 2 ? '2h' : '3h',
        start_time: preset.start,
        end_time: preset.end,
        break_hours: preset.breakH,
        is_weekend: day.is_weekend,
        is_holiday: day.is_holiday,
        holiday_name: day.holiday_name,
        exception_reason: isWorkday(day) ? null : reasons.get(date)!,
        seed: input.seed,
        rule_version: input.rule_version,
      }
    })
    summary.assigned_hours = assignments.reduce((s, a) => s + a.hours, 0)
    summary.unassigned_hours = emp.target_hours === null ? 0 : Math.max(0, emp.target_hours - lockedInPeriod - summary.assigned_hours)
    summary.weekend_holiday_count = assignments.filter(a => a.is_weekend || a.is_holiday).length
    const weeks = [...new Set(days.map(d => d.week_start))]
    summary.weekly = weeks.map(w => {
      const assigned = assignments.filter(a => weekOfDate(a.work_date) === w).reduce((s, a) => s + a.hours, 0)
      const lockedH = lockedWeek.get(w) ?? 0
      return { week_start: w, locked_hours: lockedH, assigned_hours: assigned, total_hours: lockedH + assigned }
    })
    // 분산 평가는 이 직원이 배정받을 수 있었던 주(프로젝트 기간 안 평일이 있는 주)만으로
    const availableWeeks = new Set(days.filter(d => isWorkday(d) && !lockedDates.has(d.date) &&
      eligible.some(ep => d.date >= ep.windowStart && d.date <= ep.windowEnd)).map(d => d.week_start))
    summary.weekly_stdev = weeklyLoadSpread(summary.weekly.filter(w => availableWeeks.has(w.week_start)).map(w => w.assigned_hours)).stdev
    const byProject = new Map<string, { hours: number; days: number }>()
    for (const a of assignments) {
      const cur = byProject.get(a.project_id) ?? { hours: 0, days: 0 }
      byProject.set(a.project_id, { hours: cur.hours + a.hours, days: cur.days + 1 })
    }
    summary.by_project = [...byProject].map(([project_id, v]) => ({ project_id, ...v, unused_task_ids: unusedTasks.get(project_id) ?? [] }))
    const continuity = evaluateContinuity(
      assignments.map(a => ({ date: a.work_date, project_id: a.project_id, task_id: a.task_id })),
      d => { const day = dayByDate.get(d); return !!day && isWorkday(day) && !lockedDates.has(d) },
      (from, to) => (toEpochDay(to) - toEpochDay(from) > 1 ? eachDate(from, to).slice(1, -1) : []),
    )
    if (summary.weekend_holiday_count > 0) {
      issues.push(issue('WEEKEND_OR_HOLIDAY_USED', 'info', `주말·공휴일 ${summary.weekend_holiday_count}건 배정`, {
        employee_id: eid,
        detail: { dates: assignments.filter(a => a.exception_reason).map(a => ({ date: a.work_date, reason: a.exception_reason })) },
      }))
    }
    return { assignments, summary, issues, blocks: continuity.blocksByProject, unassignedProjects }
  }
  const empty = () => finish(new Map(), new Map(), new Map())

  // ── 1. 차단 ──
  if (!emp.active) {
    issues.push(issue('EMPLOYEE_INACTIVE', 'info', '재직(활성) 직원이 아니어서 배정하지 않았습니다', { employee_id: eid }))
    return empty()
  }
  if (emp.target_hours === null) {
    issues.push(issue('OVERTIME_MONTHLY_TARGET_MISSING', 'error', '월 목표시간이 입력되지 않아 자동배정을 할 수 없습니다', { employee_id: eid }))
    return empty()
  }
  const remaining = emp.target_hours - lockedInPeriod
  if (remaining < -EPS || (emp.target_hours === 0 && lockedInPeriod > 0)) {
    issues.push(issue('TARGET_BELOW_LOCKED_HOURS', 'warning', '이미 입력된 시간이 월 목표시간 이상이라 신규 배정하지 않았습니다', {
      employee_id: eid, detail: { target: emp.target_hours, locked: lockedInPeriod },
    }))
    return empty()
  }

  // ── 2. 배정 목표 ──
  const usable = maxRepresentable(remaining)
  const leftover = Math.round((remaining - usable) * 100) / 100
  if (leftover > EPS) {
    issues.push(issue('UNREPRESENTABLE_REMAINING_HOURS', 'warning', `2시간·3시간 조합으로 만들 수 없는 ${leftover}시간은 배정하지 않았습니다`, {
      employee_id: eid, detail: { remaining, usable, leftover },
    }))
  }

  // ── 3. 배정 가능한 프로젝트 ──
  // 업무 우선순위: sort_order 오름차순(없거나 null이면 있는 업무 뒤) → 같으면 입력 배열 순서.
  // 입력 배열 순서는 항상 서로 달라 이 순서가 완전히 정해진다 — seed가 끼어들 여지가 없다.
  const ownTasks = input.tasks
    .map((t, index) => ({ t, index }))
    .filter(x => x.t.employee_id === eid)
    .sort((a, b) => {
      const sa = a.t.sort_order ?? null
      const sb = b.t.sort_order ?? null
      if (sa !== sb) {
        if (sa === null) return 1
        if (sb === null) return -1
        return sa - sb
      }
      return a.index - b.index
    })
    .map(x => x.t)
  const seenProject = new Set<string>()
  for (const m of emp.projects) {
    if (seenProject.has(m.project_id)) continue
    seenProject.add(m.project_id)
    const project = projectsById.get(m.project_id)
    const skip = (code: AssignmentIssueCode, message: string) => {
      unassignedProjects.push({ project_id: m.project_id, code, message })
      issues.push(issue(code, 'warning', message, { employee_id: eid, project_id: m.project_id }))
    }
    if (!project) { skip('UNKNOWN_PROJECT', '프로젝트 정보가 없습니다'); continue }
    if (!project.auto_assignable || !isStrictIsoDate(project.period_start) || !isStrictIsoDate(project.period_end)) {
      skip('PROJECT_NOT_ASSIGNABLE', '자동배정 대상 프로젝트가 아닙니다(확인 필요·차단·종료)')
      continue
    }
    const tasks = m.task_ids === null ? ownTasks : ownTasks.filter(t => m.task_ids!.includes(t.task_id))
    if (tasks.length === 0) { skip('NO_ALLOWED_TASK', '이 프로젝트에 쓸 수 있는 업무가 없습니다'); continue }
    const windowStart = project.period_start! > start ? project.period_start! : start
    const windowEnd = project.period_end! < end ? project.period_end! : end
    if (windowStart > windowEnd) { skip('NO_VALID_DATE', '프로젝트 대상기간이 급여기간과 겹치지 않습니다'); continue }
    eligible.push({ project, tasks, windowStart, windowEnd })
  }
  eligible = eligible.sort((a, b) => compareProjectPriority(a.project, b.project))

  if (eligible.length === 0) {
    issues.push(issue('NO_ELIGIBLE_PROJECT', 'warning', '배정할 수 있는 참여 프로젝트가 없습니다', { employee_id: eid, detail: { unassigned_hours: usable } }))
    return empty()
  }
  if (usable === 0) return empty()

  const inWindow = (ep: EligibleProject, date: string) => date >= ep.windowStart && date <= ep.windowEnd
  const pidOf = (ep: EligibleProject) => ep.project.project_id

  // 이 직원이 쓸 수 있는 날짜: 급여기간 안, 잠금 아님, 어떤 배정 가능 프로젝트의 기간 안
  const available = days.filter(d => !lockedDates.has(d.date) && eligible.some(ep => inWindow(ep, d.date)))
  const weekdayList = available.filter(isWorkday).map(d => d.date)          // 연속성은 이 목록의 인덱스로 판단
  const weekendList = available.filter(d => !isWorkday(d)).map(d => d.date)
  const capWd = new Map(eligible.map(ep => [pidOf(ep), weekdayList.filter(d => inWindow(ep, d)).length]))
  const capWe = new Map(eligible.map(ep => [pidOf(ep), weekendList.filter(d => inWindow(ep, d)).length]))

  /** 고른 날짜들로 만들 수 있는 최대 시간 = Σ주 min(3 × 일수, 주 한도) */
  const capacityOf = (dates: Iterable<string>) => {
    const n = new Map<string, number>()
    for (const d of dates) n.set(weekOfDate(d), (n.get(weekOfDate(d)) ?? 0) + 1)
    let u = 0
    for (const [w, k] of n) u += Math.min(3 * k, capH(w))
    return u
  }
  // 상한: 주마다 ⌊한도/2⌋일까지 쓴다고 했을 때 만들 수 있는 최대 시간
  const upperBound = (() => {
    const n = new Map<string, number>()
    for (const d of available) n.set(d.week_start, Math.min(dayLimit(d.week_start), (n.get(d.week_start) ?? 0) + 1))
    let u = 0
    for (const [w, k] of n) u += Math.min(3 * k, capH(w))
    return u
  })()

  /**
   * 일수 D를 프로젝트에 배분 (우선순위 순):
   *   1) 각 프로젝트 최소 1일 — 일수가 프로젝트 수보다 적으면 제출일 빠른 프로젝트부터
   *   2) 가능하면 최소 2일 — 프로젝트 기간에 평일이 2일 이상 있을 때만(2일째를 위해 주말·공휴일을 쓰지 않는다)
   *   3) 남는 일수는 평일 여유까지, 4) 그래도 남으면 주말·공휴일 여유까지
   * 일수 D 자체는 목표시간의 2·3시간 조합으로 정해지므로, 최소 2일을 위해 목표·주 한도를 넘기는 일은 없다.
   */
  const allocate = (total: number): Map<string, number> | null => {
    const alloc = new Map<string, number>()
    let left = total
    for (const ep of eligible) {
      const pid = pidOf(ep)
      if (left > 0 && capWd.get(pid)! + capWe.get(pid)! > 0) { alloc.set(pid, 1); left-- }
    }
    for (const ep of eligible) {
      const pid = pidOf(ep)
      if (left > 0 && alloc.get(pid) === 1 && capWd.get(pid)! >= 2) { alloc.set(pid, 2); left-- }
    }
    for (const ep of eligible) {
      const pid = pidOf(ep)
      const add = Math.min(left, Math.max(0, capWd.get(pid)! - (alloc.get(pid) ?? 0)))
      if (add > 0) { alloc.set(pid, (alloc.get(pid) ?? 0) + add); left -= add }
    }
    for (const ep of eligible) {
      const pid = pidOf(ep)
      const add = Math.min(left, capWd.get(pid)! + capWe.get(pid)! - (alloc.get(pid) ?? 0))
      if (add > 0) { alloc.set(pid, (alloc.get(pid) ?? 0) + add); left -= add }
    }
    return left === 0 ? alloc : null
  }

  /**
   * 배분된 일수대로 날짜를 놓는다. 실패하면 null.
   *  1) 평일 블록: 우선순위 순으로 프로젝트마다 연속 블록 1개를 시간순으로. 각 블록이 설 수 있는 가장 이른 위치(E)와
   *     뒤 블록이 들어갈 자리를 남기는 가장 늦은 위치(R) 사이에서, 남는 공간을 (남은 블록 수 + 1)등분한 만큼 띄운다
   *     → 블록 1개면 가운데, 여러 개면 기간 전체에 고르게. 그 목표 ±2일 안에서 주간 분산이 가장 작은 시작점을
   *     고른다(같으면 목표에 가까운 쪽, 그래도 같으면 seed).
   *  2) 모자라는 일수: 그 프로젝트 기간의 평일 → 주말·공휴일 순으로 블록에 가까운 날
   *  3) 그래도 남으면 다른 프로젝트에서(우선순위 순) — 겹치는 기간 때문에 자리가 없을 때만
   */
  // 분산 평가에 쓰는 주: 이 직원이 평일에 배정받을 수 있는 주
  const availableWeeks = [...new Set(available.filter(isWorkday).map(d => d.week_start))]

  const placeDays = (alloc: Map<string, number>, avgHours: number, rng: Rng): Map<string, string> | null => {
    const chosen = new Map<string, string>()
    const weekCount = new Map<string, number>()
    const canUse = (d: string) => !chosen.has(d) && (weekCount.get(weekOfDate(d)) ?? 0) < dayLimit(weekOfDate(d))
    const assignDay = (d: string, pid: string) => {
      chosen.set(d, pid)
      weekCount.set(weekOfDate(d), (weekCount.get(weekOfDate(d)) ?? 0) + 1)
    }

    // 1) 평일 블록
    const blocks = eligible
      .map(ep => {
        const a = weekdayList.findIndex(d => d >= ep.windowStart)
        let b = -1
        for (let i = weekdayList.length - 1; i >= 0; i--) if (weekdayList[i] <= ep.windowEnd) { b = i; break }
        const span = a >= 0 && b >= a ? b - a + 1 : 0
        return { ep, a, b, n: Math.min(alloc.get(pidOf(ep)) ?? 0, capWd.get(pidOf(ep))!, span) }
      })
      .filter(x => x.n > 0)
    const k = blocks.length
    const E: number[] = []
    const R: number[] = []
    let ordered = true
    let cursor = -1
    for (const bl of blocks) {
      const e = Math.max(bl.a, cursor + 1)
      if (e + bl.n - 1 > bl.b) { ordered = false; break }
      E.push(e)
      cursor = e + bl.n - 1
    }
    if (ordered) {
      let limit = weekdayList.length
      for (let i = k - 1; i >= 0; i--) {
        const r = Math.min(blocks[i].b, limit - 1) - blocks[i].n + 1
        if (r < blocks[i].a || r < E[i]) { ordered = false; break }
        R[i] = r
        limit = r
      }
    }
    if (ordered) {
      let prevEnd = -1
      for (let i = 0; i < k; i++) {
        const { ep, n } = blocks[i]
        const lo = Math.max(E[i], prevEnd + 1)
        const hi = R[i]
        const target = Math.min(hi, Math.max(lo, lo + Math.round((hi - lo) / (k - i + 1))))
        // 블록 안의 같은 주 날짜들도 세면서 주당 일수 한도를 확인한다
        const fits = (s: number) => {
          const extra = new Map<string, number>()
          for (let x = s; x < s + n; x++) {
            const d = weekdayList[x]
            const w = weekOfDate(d)
            if (chosen.has(d) || (weekCount.get(w) ?? 0) + (extra.get(w) ?? 0) + 1 > dayLimit(w)) return false
            extra.set(w, (extra.get(w) ?? 0) + 1)
          }
          return true
        }
        // 고른 간격 위치 ±2일 안에서 주간 분산(주별 예상 시간의 표준편차)이 가장 작은 시작점 → 같으면 목표에 가까운 쪽 → seed
        const spreadIf = (st: number) => {
          const add = new Map<string, number>()
          for (let x = st; x < st + n; x++) add.set(weekOfDate(weekdayList[x]), (add.get(weekOfDate(weekdayList[x])) ?? 0) + 1)
          return weeklyLoadSpread(availableWeeks.map(w => ((weekCount.get(w) ?? 0) + (add.get(w) ?? 0)) * avgHours)).stdev
        }
        const near: number[] = []
        for (let x = Math.max(lo, target - 2); x <= Math.min(hi, target + 2); x++) if (fits(x)) near.push(x)
        let s = -1
        if (near.length > 0) {
          const scored = near.map(x => ({ x, spread: spreadIf(x), dist: Math.abs(x - target) }))
          const bestSpread = Math.min(...scored.map(c => c.spread))
          const tied = scored.filter(c => c.spread <= bestSpread + 1e-6)
          const bestDist = Math.min(...tied.map(c => c.dist))
          const finalists = tied.filter(c => c.dist === bestDist)
          s = finalists[rng.int(finalists.length)].x
        } else {
          for (let dist = 0; dist <= hi - lo && s < 0; dist++) {
            if (target - dist >= lo && fits(target - dist)) s = target - dist
            else if (target + dist <= hi && fits(target + dist)) s = target + dist
          }
        }
        if (s < 0) continue // 주 한도로 연속 블록을 못 놓으면 2)에서 날짜 단위로 채운다
        for (let x = s; x < s + n; x++) assignDay(weekdayList[x], pidOf(ep))
        prevEnd = s + n - 1
      }
    } else {
      // 기간이 겹쳐 시간순으로 줄 세울 수 없으면: 우선순위 순으로 각 프로젝트 기간의 가장 긴 빈 구간에 연속으로
      for (const { ep, n } of blocks) {
        let need = n
        while (need > 0) {
          const runs: Array<[number, number]> = []
          for (let i = 0; i < weekdayList.length; i++) {
            if (!inWindow(ep, weekdayList[i]) || !canUse(weekdayList[i])) continue
            const last = runs[runs.length - 1]
            if (last && last[1] === i - 1) last[1] = i
            else runs.push([i, i])
          }
          if (runs.length === 0) break
          const best = runs.sort((x, y) => (y[1] - y[0]) - (x[1] - x[0]) || x[0] - y[0])[0]
          const take = Math.min(need, best[1] - best[0] + 1)
          const s = best[0] + Math.floor((best[1] - best[0] + 1 - take) / 2)
          let added = 0
          for (let x = s; x < s + take; x++) {
            if (!canUse(weekdayList[x])) break // 같은 주 일수 한도에 걸리면 멈추고 다음 구간에서
            assignDay(weekdayList[x], pidOf(ep))
            added++
          }
          if (added === 0) break
          need -= added
        }
      }
    }

    // 2) 모자라는 일수 — 같은 프로젝트 안에서 평일 → 주말·공휴일, 블록에 가까운 날
    const nearest = (ep: EligibleProject, pool: readonly string[]): string | null => {
      const mine = [...chosen].filter(([, p]) => p === pidOf(ep)).map(([d]) => toEpochDay(d))
      let best: { d: string; dist: number } | null = null
      for (const d of pool) {
        if (!inWindow(ep, d) || !canUse(d)) continue
        const dist = mine.length > 0 ? Math.min(...mine.map(x => Math.abs(x - toEpochDay(d)))) : 0
        if (!best || dist < best.dist) best = { d, dist }
      }
      return best?.d ?? null
    }
    let shortfall = 0
    for (const ep of eligible) {
      const pid = pidOf(ep)
      let need = (alloc.get(pid) ?? 0) - [...chosen.values()].filter(p => p === pid).length
      while (need > 0) {
        const d = nearest(ep, weekdayList) ?? nearest(ep, weekendList)
        if (!d) break
        assignDay(d, pid)
        need--
      }
      shortfall += need
    }
    // 3) 그래도 남으면 다른 프로젝트에서(우선순위 순)
    while (shortfall > 0) {
      let placed = false
      for (const ep of eligible) {
        const d = nearest(ep, weekdayList) ?? nearest(ep, weekendList)
        if (d) { assignDay(d, pidOf(ep)); placed = true; break }
      }
      if (!placed) return null
      shortfall--
    }
    return chosen
  }

  // ── 4. 조합 후보 → 날짜 배치 ──
  let best: { chosen: Map<string, string>; total: number } | null = null
  for (let total = maxRepresentable(Math.min(usable, upperBound)); total >= 2 && !best; total = total - 1 === 1 ? 0 : total - 1) {
    // 주말·공휴일을 가장 적게 쓰는 후보, 같으면 조합 선호 순서(혼합 → 개수 차이 → 일수)가 앞선 후보
    let pick: { chosen: Map<string, string>; weekend: number } | null = null
    for (const comp of preferredCompositions(total)) {
      const alloc = allocate(comp.days)
      if (!alloc) continue
      const placed = placeDays(alloc, total / comp.days, createRng(deriveSeed(input.seed, eid, 'place', String(comp.days))))
      if (!placed || capacityOf(placed.keys()) < total) continue
      const weekend = [...placed.keys()].filter(d => !isWorkday(dayByDate.get(d)!)).length
      if (!pick || weekend < pick.weekend) pick = { chosen: placed, weekend }
    }
    if (pick) best = { chosen: pick.chosen, total }
  }
  const chosen = best?.chosen ?? new Map<string, string>()
  const total = best?.total ?? 0

  // ── 5. 주별 시간 배분 (주간 분산) → 주 안에서 3시간 날짜는 seed로 ──
  let plan = new Map<string, PlannedDay>()
  {
    const byWeek = new Map<string, string[]>()
    for (const d of [...chosen.keys()].sort()) byWeek.set(weekOfDate(d), [...(byWeek.get(weekOfDate(d)) ?? []), d])
    const weeks = [...byWeek.keys()].sort()
    const dist = distributeWeekHours(weeks.map(w => ({ key: w, days: byWeek.get(w)!.length, cap: capH(w), load: lockedWeek.get(w) ?? 0 })), total)
    if (!dist && chosen.size > 0) throw new Error('overtime assign: 주별 시간 배분 실패 (내부 오류)')
    const rng = createRng(deriveSeed(input.seed, eid, 'hours'))
    for (const w of weeks) {
      const ds = byWeek.get(w)!
      const threes = new Set(rng.shuffle(ds).slice(0, dist!.get(w)! - 2 * ds.length))
      for (const d of ds) plan.set(d, { projectId: chosen.get(d)!, hours: threes.has(d) ? 3 : 2 })
    }
  }

  // ── 6. 주말·공휴일 → 같은 프로젝트 평일 ──
  plan = relocateWeekendsWithinProject({
    plan,
    days,
    windows: new Map(eligible.map(ep => [pidOf(ep), { start: ep.windowStart, end: ep.windowEnd }])),
    lockedDates,
    lockedWeek,
  })
  const reasons = new Map<string, string>()
  for (const [date, p] of plan) {
    if (isWorkday(dayByDate.get(date)!)) continue
    const ep = eligible.find(e => pidOf(e) === p.projectId)!
    const weekdayLeft = weekdayList.some(d => !plan.has(d) && inWindow(ep, d))
    reasons.set(date, weekdayLeft
      ? '주간 12시간 제한으로 평일 배정 불가'
      : ep.project.period_end === ep.project.submit_date ? '제출일까지 평일 배정 가능시간 부족' : '프로젝트 유효기간 내 평일 부족')
  }

  // ── 7. 업무: 프로젝트 블록 안에서 연속 하위 블록 ──
  const taskByDate = new Map<string, AssignmentTaskInput>()
  unusedTasks = new Map()
  for (const ep of eligible) {
    const pid = pidOf(ep)
    const dates = [...plan].filter(([, p]) => p.projectId === pid).map(([d]) => d).sort()
    if (dates.length === 0) continue
    // ep.tasks는 ownTasks 순서(sort_order → 입력 배열 순서)를 그대로 따른다.
    // 일수가 충분하면 전부, 모자라면 우선순위가 높은 업무부터 일수만큼 — 하위 블록도 이 순서로 놓는다.
    const ordered = ep.tasks.slice(0, Math.min(ep.tasks.length, dates.length))
    if (ordered.length < ep.tasks.length) {
      const used = new Set(ordered.map(t => t.task_id))
      unusedTasks.set(pid, ep.tasks.filter(t => !used.has(t.task_id)).map(t => t.task_id))
      issues.push(issue('TASKS_PARTIALLY_USED', 'info', `배정일이 업무 수보다 적어 업무 ${ep.tasks.length - ordered.length}개는 쓰지 않았습니다`, {
        employee_id: eid, project_id: pid, detail: { unused_task_ids: unusedTasks.get(pid) },
      }))
    }
    const base = Math.floor(dates.length / ordered.length)
    const rem = dates.length % ordered.length
    let idx = 0
    for (let i = 0; i < ordered.length; i++) {
      const size = base + (i < rem ? 1 : 0)
      for (let j = 0; j < size; j++) taskByDate.set(dates[idx++], ordered[i])
    }
  }

  // ── 1일 블록 (허용 결과 — 정보로 사유만 알린다) ──
  {
    const daysByProject = new Map<string, number>()
    for (const p of plan.values()) daysByProject.set(p.projectId, (daysByProject.get(p.projectId) ?? 0) + 1)
    const projectsWithDays = daysByProject.size
    for (const ep of eligible) {
      const pid = pidOf(ep)
      if (daysByProject.get(pid) !== 1) continue
      const [reason, why]: [string, string] =
        capWd.get(pid)! < 2
          ? ['PERIOD_TOO_SHORT', '프로젝트 기간 안에 연속 2일(평일)을 확보할 수 없어']
          : total <= 3
            ? ['TARGET_TOO_SMALL', '남은 월 목표시간이 하루(2·3시간)로 충분해']
            : plan.size < 2 * projectsWithDays
              ? ['NOT_ENOUGH_DAYS', '참여 프로젝트 수에 비해 배정할 일수가 부족해']
              : ['CAPACITY_OR_CONFLICT', '주 12시간 제한·잠금일·앞선 프로젝트 블록 때문에']
      issues.push(issue('SINGLE_DAY_PROJECT_BLOCK', 'info', `${why} 이 프로젝트에는 1일만 배정했습니다`, {
        employee_id: eid, project_id: pid, detail: { assigned_days: 1, reason },
      }))
    }
  }

  // ── 미배정 사유 ──
  const assignedHours = [...plan.values()].reduce((s, p) => s + p.hours, 0)
  if (assignedHours < usable) {
    const freeLeft = available.some(d => !plan.has(d.date))
    issues.push(freeLeft
      ? issue('WEEKLY_CAPACITY_EXHAUSTED', 'warning', `주간 12시간 제한으로 ${usable - assignedHours}시간을 배정하지 못했습니다`, { employee_id: eid, detail: { unassigned: usable - assignedHours } })
      : issue('NO_VALID_DATE', 'warning', `배정할 수 있는 날짜가 없어 ${usable - assignedHours}시간을 배정하지 못했습니다`, { employee_id: eid, detail: { unassigned: usable - assignedHours } }))
  }
  for (const ep of eligible) {
    const pid = pidOf(ep)
    if ([...plan.values()].some(p => p.projectId === pid)) continue
    const hasDate = capWd.get(pid)! + capWe.get(pid)! > 0
    const [code, message]: [AssignmentIssueCode, string] = !hasDate
      ? ['NO_VALID_DATE', '프로젝트 기간 안에 배정할 수 있는 날짜가 없습니다']
      : assignedHours >= usable
        ? ['TARGET_EXHAUSTED', '월 목표시간을 앞선(제출일이 빠른) 프로젝트에 모두 배정했습니다']
        : ['WEEKLY_CAPACITY_EXHAUSTED', '주간 12시간 제한으로 배정하지 못했습니다']
    unassignedProjects.push({ project_id: pid, code, message })
    issues.push(issue('PROJECT_UNASSIGNED', 'info', message, { employee_id: eid, project_id: pid, detail: { reason: code } }))
  }

  return finish(plan, taskByDate, reasons)
}
