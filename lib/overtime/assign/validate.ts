import { TIME_TYPE_PRESETS } from '../time'
import { eachDate, isWeekend, missingHolidayYears, weekStartOf } from './calendar'
import {
  WEEKLY_CAP_HOURS,
  type AssignmentEmployeeInput,
  type AssignmentInput,
  type AssignmentProjectInput,
  type GeneratedAssignment,
  type ScheduleViolation,
} from './types'

/**
 * 배정 결과를 입력만 보고 다시 검사한다. 엔진(engine.ts)의 내부 상태·함수를 쓰지 않는다 —
 * 엔진에 버그가 있어도 여기서 잡히도록 같은 규칙을 독립적으로 다시 구현했다.
 * 결과는 boolean이 아니라 위반 목록(코드·직원·프로젝트·날짜·실제값·제한값)이다. 빈 배열이면 통과.
 */
export function validateSchedule(input: AssignmentInput, assignments: readonly GeneratedAssignment[]): ScheduleViolation[] {
  const out: ScheduleViolation[] = []
  const { period } = input

  const missingYears = missingHolidayYears(period.start, period.end, input.holiday_data_years)
  if (missingYears.length > 0 && assignments.length > 0) {
    out.push({ code: 'HOLIDAYS_MISSING', message: '공휴일 데이터가 없는 연도가 있는데 배정이 생성됐다', actual: missingYears.join(',') })
  }

  const holidayNames = new Map(input.holidays.map(h => [h.date, h.name]))
  const employees = new Map(input.employees.map(e => [e.employee_id, e]))
  const projects = new Map(input.projects.map(p => [p.project_id, p]))
  const tasks = new Map(input.tasks.map(t => [t.task_id, t]))
  const lockedDates = new Set(input.locked_records.map(r => `${r.employee_id}|${r.work_date}`))

  const allowedTaskIds = (emp: AssignmentEmployeeInput, projectId: string): Set<string> => {
    const membership = emp.projects.find(p => p.project_id === projectId)
    if (!membership) return new Set()
    const own = input.tasks.filter(t => t.employee_id === emp.employee_id)
    const ids = membership.task_ids === null ? own.map(t => t.task_id) : own.map(t => t.task_id).filter(id => membership.task_ids!.includes(id))
    return new Set(ids)
  }
  const assignable = (p: AssignmentProjectInput | undefined): p is AssignmentProjectInput =>
    !!p && p.auto_assignable && !!p.period_start && !!p.period_end

  // ── 배정 1건 단위 ──
  const seen = new Set<string>()
  for (const a of assignments) {
    const at = { employee_id: a.employee_id, project_id: a.project_id, date: a.work_date }
    const emp = employees.get(a.employee_id)
    if (!emp) { out.push({ ...at, code: 'UNKNOWN_EMPLOYEE', message: '입력에 없는 직원' }); continue }
    if (!emp.active) out.push({ ...at, code: 'EMPLOYEE_INACTIVE', message: '재직(활성) 직원이 아님' })
    if (emp.target_hours === null) out.push({ ...at, code: 'TARGET_MISSING', message: '월 목표시간 미입력 직원' })

    if (!emp.projects.some(p => p.project_id === a.project_id)) {
      out.push({ ...at, code: 'NOT_A_MEMBER', message: '직원이 참여하지 않는 프로젝트' })
    }
    const project = projects.get(a.project_id)
    if (!assignable(project)) {
      out.push({ ...at, code: 'PROJECT_NOT_ASSIGNABLE', message: '자동배정 대상이 아닌 프로젝트' })
    } else if (a.work_date < project.period_start! || a.work_date > project.period_end!) {
      out.push({ ...at, code: 'OUTSIDE_PROJECT_PERIOD', message: '프로젝트 대상기간 밖', actual: a.work_date, limit: `${project.period_start}~${project.period_end}` })
    }
    if (a.work_date < period.start || a.work_date > period.end) {
      out.push({ ...at, code: 'OUTSIDE_PAY_PERIOD', message: '급여기간 밖', actual: a.work_date, limit: `${period.start}~${period.end}` })
    }
    const task = tasks.get(a.task_id)
    if (!allowedTaskIds(emp, a.project_id).has(a.task_id) || !task || task.task_name !== a.task_name) {
      out.push({ ...at, code: 'TASK_NOT_ALLOWED', message: '직원×프로젝트에 허용되지 않은 업무', actual: a.task_id })
    }

    const dayKey = `${a.employee_id}|${a.work_date}`
    if (seen.has(dayKey)) out.push({ ...at, code: 'DUPLICATE_DAY', message: '같은 직원·날짜에 배정이 둘 이상' })
    seen.add(dayKey)
    if (lockedDates.has(dayKey)) out.push({ ...at, code: 'LOCKED_DAY_CONFLICT', message: '잠금 기록이 있는 날짜에 신규 배정' })

    if (a.hours !== 2 && a.hours !== 3) {
      out.push({ ...at, code: 'INVALID_HOURS', message: '자동배정은 2시간 또는 3시간만', actual: a.hours })
    } else {
      const preset = TIME_TYPE_PRESETS[a.hours === 2 ? '2h' : '3h']
      if (a.time_type !== (a.hours === 2 ? '2h' : '3h') || a.start_time !== preset.start || a.end_time !== preset.end || a.break_hours !== preset.breakH) {
        out.push({ ...at, code: 'PRESET_MISMATCH', message: '기존 2시간/3시간 프리셋과 다름' })
      }
    }

    const weekend = isWeekend(a.work_date)
    const holidayName = holidayNames.get(a.work_date) ?? null
    if (a.is_weekend !== weekend || a.is_holiday !== (holidayName !== null) || a.holiday_name !== holidayName) {
      out.push({ ...at, code: 'CALENDAR_FLAG_MISMATCH', message: '주말·공휴일 표시가 달력과 다름' })
    }
    if ((weekend || holidayName !== null) && !a.exception_reason) {
      out.push({ ...at, code: 'EXCEPTION_REASON_MISSING', message: '주말·공휴일 배정에 사유 없음' })
    }
    if (!weekend && holidayName === null && a.exception_reason) {
      out.push({ ...at, code: 'EXCEPTION_REASON_UNEXPECTED', message: '평일 배정에 예외사유가 있음' })
    }
  }

  // ── 직원 단위: 주 12시간 · 월 목표 ──
  const weekTotal = new Map<string, number>()         // emp|week → 잠금 + 배정
  const weekAssigned = new Map<string, number>()      // emp|week → 배정
  for (const r of input.locked_records) {
    const k = `${r.employee_id}|${weekStartOf(r.work_date)}`
    weekTotal.set(k, (weekTotal.get(k) ?? 0) + r.hours)
  }
  for (const a of assignments) {
    const k = `${a.employee_id}|${weekStartOf(a.work_date)}`
    weekTotal.set(k, (weekTotal.get(k) ?? 0) + a.hours)
    weekAssigned.set(k, (weekAssigned.get(k) ?? 0) + a.hours)
  }
  for (const [k, assigned] of weekAssigned) {
    const total = weekTotal.get(k) ?? 0
    if (assigned > 0 && total > WEEKLY_CAP_HOURS + 1e-9) {
      const [employee_id, week] = k.split('|')
      out.push({ code: 'WEEKLY_CAP_EXCEEDED', message: '주간(월~일) 합계가 12시간 초과', employee_id, date: week, actual: total, limit: WEEKLY_CAP_HOURS })
    }
  }

  for (const emp of input.employees) {
    const mine = assignments.filter(a => a.employee_id === emp.employee_id)
    if (mine.length === 0 || emp.target_hours === null) continue
    const locked = input.locked_records
      .filter(r => r.employee_id === emp.employee_id && r.work_date >= period.start && r.work_date <= period.end)
      .reduce((s, r) => s + r.hours, 0)
    const total = locked + mine.reduce((s, a) => s + a.hours, 0)
    if (total > emp.target_hours + 1e-9) {
      out.push({ code: 'MONTHLY_TARGET_EXCEEDED', message: '급여기간 합계가 월 목표시간 초과', employee_id: emp.employee_id, actual: total, limit: emp.target_hours })
    }
  }

  // ── 평일 우선: 같은 프로젝트 기간 안에 옮길 수 있는 평일이 있었는데 주말·공휴일을 썼는가 ──
  // 다른 프로젝트의 평일은 대안으로 보지 않는다(프로젝트별 시간 배분을 바꾸지 않는다).
  const assignedDates = new Set(assignments.map(a => `${a.employee_id}|${a.work_date}`))
  for (const a of assignments) {
    if (!isWeekend(a.work_date) && !holidayNames.has(a.work_date)) continue
    const project = projects.get(a.project_id)
    if (!employees.has(a.employee_id) || !assignable(project)) continue
    for (const c of eachDate(period.start, period.end)) {
      if (isWeekend(c) || holidayNames.has(c)) continue
      const key = `${a.employee_id}|${c}`
      if (lockedDates.has(key) || assignedDates.has(key)) continue
      if (c < project.period_start! || c > project.period_end!) continue
      const sameWeek = weekStartOf(c) === weekStartOf(a.work_date)
      const total = (weekTotal.get(`${a.employee_id}|${weekStartOf(c)}`) ?? 0) - (sameWeek ? a.hours : 0)
      if (total + a.hours <= WEEKLY_CAP_HOURS + 1e-9) {
        out.push({
          code: 'UNNECESSARY_WEEKEND', message: '옮길 수 있는 평일이 있는데 주말·공휴일에 배정',
          employee_id: a.employee_id, project_id: a.project_id, date: a.work_date, actual: c,
        })
        break
      }
    }
  }
  return out
}
