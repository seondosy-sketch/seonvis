import { TIME_TYPE_PRESETS } from '../time'
import { addDays, eachDate, isWeekend, missingHolidayYears, weekStartOf } from './calendar'
import {
  WEEKEND_REASONS,
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

  // ── 직원별 배치 품질 — 최종 결과와 입력만으로 다시 계산한다(엔진의 탐색 상태를 쓰지 않음) ──
  // 왕복은 그 자체로 위반. 나머지는 "그 자리에서 바꾸면 엔진의 비교 기준상 확실히 더 좋은 배치가 나온다"일 때만
  // 위반으로 본다 — 정상 결과를 위반으로 잘못 잡지 않기 위해서다.
  const isOff = (d: string) => isWeekend(d) || holidayNames.has(d)
  const byEmployee = new Map<string, GeneratedAssignment[]>()
  for (const a of assignments) byEmployee.set(a.employee_id, [...(byEmployee.get(a.employee_id) ?? []), a])
  for (const [employee_id, mineRaw] of byEmployee) {
    if (!employees.has(employee_id)) continue
    const mine = [...mineRaw].sort((x, y) => (x.work_date < y.work_date ? -1 : x.work_date > y.work_date ? 1 : 0))
    const lockedOf = (d: string) => lockedDates.has(`${employee_id}|${d}`)
    const weekHours = (w: string) => weekTotal.get(`${employee_id}|${w}`) ?? 0
    const ownerOf = new Map(mine.map(a => [a.work_date, a]))
    const taken = (d: string) => ownerOf.has(d)
    const windowOf = (pid: string) => {
      const p = projects.get(pid)
      if (!assignable(p)) return null
      return { start: p.period_start! > period.start ? p.period_start! : period.start, end: p.period_end! < period.end ? p.period_end! : period.end }
    }
    const workdaysIn = (start: string, end: string) => (start > end ? [] : eachDate(start, end).filter(d => !isOff(d)))
    const datesOf = (pid: string) => mine.filter(a => a.project_id === pid).map(a => a.work_date).sort()
    /** lo < d < hi 인 다른 프로젝트 배정이 있는가(skip 날짜는 빼고) */
    const othersBetween = (pid: string, lo: string, hi: string, skip: string | null = null) =>
      mine.some(o => o.project_id !== pid && o.work_date !== skip && o.work_date > lo && o.work_date < hi)
    /** 블록 끊김 수 — 같은 프로젝트의 이웃한 두 날짜 사이에 쓰지 않은(잠금 아닌) 평일이 있으면 1 */
    const gapsOf = (dates: readonly string[], isTaken: (d: string) => boolean) => {
      const ds = [...dates].sort()
      let g = 0
      for (let i = 1; i < ds.length; i++) {
        if (workdaysIn(addDays(ds[i - 1], 1), addDays(ds[i], -1)).some(c => !lockedOf(c) && !isTaken(c))) g++
      }
      return g
    }
    const pids = [...new Set(mine.map(a => a.project_id))]

    // 왕복(A→B→A): 날짜순으로 이미 끝난 프로젝트가 다시 나오면 위반
    {
      const started = new Set<string>()
      let prev: string | null = null
      for (const a of mine) {
        if (a.project_id !== prev && started.has(a.project_id)) {
          out.push({ code: 'PROJECT_REVISIT', message: '끝난 프로젝트 블록이 다른 프로젝트 뒤에 다시 시작됨(A→B→A)', employee_id, project_id: a.project_id, date: a.work_date })
        }
        started.add(a.project_id)
        prev = a.project_id
      }
    }

    for (const a of mine) {
      const win = windowOf(a.project_id)
      if (!win || !isOff(a.work_date)) continue
      const rest = datesOf(a.project_id).filter(d => d !== a.work_date)
      // 평일 우선: 같은 프로젝트 기간의 빈 평일로 옮길 수 있는데(주 12시간 유지, 왕복 없음) 주말·공휴일을 씀.
      // 다른 프로젝트의 평일은 대안으로 보지 않는다(프로젝트별 시간 배분을 바꾸지 않는다).
      let other = false
      let cap = false
      let movable: string | null = null
      for (const c of workdaysIn(win.start, win.end)) {
        if (lockedOf(c)) continue
        const owner = ownerOf.get(c)
        if (owner) {
          if (owner.project_id !== a.project_id) other = true
          continue
        }
        const same = weekStartOf(c) === weekStartOf(a.work_date)
        if (weekHours(weekStartOf(c)) - (same ? a.hours : 0) + a.hours > WEEKLY_CAP_HOURS + 1e-9) { cap = true; continue }
        const after = [...rest, c].sort()
        if (othersBetween(a.project_id, after[0], after[after.length - 1], a.work_date)) { other = true; continue }
        movable ??= c
      }
      if (movable) {
        out.push({ code: 'UNNECESSARY_WEEKEND', message: '옮길 수 있는 평일이 있는데 주말·공휴일에 배정', employee_id, project_id: a.project_id, date: a.work_date, actual: movable })
        continue
      }
      // 예외사유 = 실제 원인: 다른 프로젝트 배정·왕복 → 주 12시간 → 평일 소진(종료일 = 제출일이면 제출일까지)
      const p = projects.get(a.project_id)!
      const expected = other
        ? WEEKEND_REASONS.otherProject
        : cap
          ? WEEKEND_REASONS.weeklyCap
          : p.period_end === p.submit_date ? WEEKEND_REASONS.untilSubmit : WEEKEND_REASONS.periodShort
      if (a.exception_reason && a.exception_reason !== expected) {
        out.push({ code: 'EXCEPTION_REASON_MISMATCH', message: '주말·공휴일 사유가 실제 원인과 다름', employee_id, project_id: a.project_id, date: a.work_date, actual: a.exception_reason, limit: expected })
      }
    }

    for (const pid of pids) {
      const win = windowOf(pid)
      if (!win) continue
      const ds = datesOf(pid)
      // 블록 끊김: 양 끝 날짜 하나를 블록 안 빈 평일로 옮기면(주 12시간 유지) 끊김이 줄어드는데 그대로 둠
      if (ds.length >= 2 && !othersBetween(pid, ds[0], ds[ds.length - 1])) {
        const before = gapsOf(ds, taken)
        if (before > 0) {
          const holes = workdaysIn(addDays(ds[0], 1), addDays(ds[ds.length - 1], -1)).filter(c => !lockedOf(c) && !taken(c))
          const better = [ds[0], ds[ds.length - 1]].some(edge => holes.some(h => {
            const hours = ownerOf.get(edge)!.hours
            const same = weekStartOf(h) === weekStartOf(edge)
            if (weekHours(weekStartOf(h)) - (same ? hours : 0) + hours > WEEKLY_CAP_HOURS + 1e-9) return false
            const takenAfter = (d: string) => (d === edge ? false : d === h ? true : taken(d))
            return gapsOf([...ds.filter(d => d !== edge), h], takenAfter) < before
          }))
          if (better) out.push({ code: 'PROJECT_BLOCK_SPLIT', message: '블록 안 빈 평일로 옮기면 덜 끊기는데 프로젝트 블록이 끊겨 있음', employee_id, project_id: pid, date: ds[0], actual: before })
        }
      }
      // 피할 수 있었던 1일 블록: 1일만 받은 프로젝트 옆(사이에 다른 배정 없음) 빈 평일 c에 하루를 더 줄 수 있었다 —
      //   (a) 3시간 배정 2건을 2시간으로 줄여 생긴 2시간으로, 또는 (b) 3일 이상 받은 다른 프로젝트의 양 끝 하루를 옮겨서.
      //   총 시간·주말 수·받은 프로젝트·다른 프로젝트의 2일 이상은 그대로 두고 1일 블록만 하나 준다.
      if (ds.length === 1) {
        const d0 = ds[0]
        const near = workdaysIn(win.start, win.end).filter(c => !lockedOf(c) && !taken(c) &&
          !othersBetween(pid, c < d0 ? c : d0, c < d0 ? d0 : c))
        const threes = mine.filter(o => o.hours === 3)
        const donors = pids.filter(q => q !== pid && datesOf(q).length >= 3).flatMap(q => {
          const qd = datesOf(q)
          return [ownerOf.get(qd[0])!, ownerOf.get(qd[qd.length - 1])!]
        })
        const possible = near.some(c => {
          const w = weekStartOf(c)
          if (threes.length >= 2) {
            // 줄일 3시간 2건은 c와 같은 주부터 고른다(그 주 여유가 생김)
            const freed = [...threes].sort((x, y) => Number(weekStartOf(y.work_date) === w) - Number(weekStartOf(x.work_date) === w))
              .slice(0, 2).filter(o => weekStartOf(o.work_date) === w).length
            if (weekHours(w) - freed + 2 <= WEEKLY_CAP_HOURS + 1e-9) return true
          }
          return donors.some(o => weekHours(w) - (weekStartOf(o.work_date) === w ? o.hours : 0) + o.hours <= WEEKLY_CAP_HOURS + 1e-9)
        })
        if (possible) out.push({ code: 'AVOIDABLE_SINGLE_DAY', message: '총 시간·주말 수를 바꾸지 않고 2일을 줄 수 있었는데 1일 블록', employee_id, project_id: pid, date: d0 })
      }
    }
  }
  return out
}
