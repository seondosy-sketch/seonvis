import { describe, expect, it } from 'vitest'
import { TIME_TYPE_PRESETS } from '../time'
import { buildCalendar, eachDate, weekStartOf } from './calendar'
import { evaluateContinuity } from './continuity'
import { compareProjectPriority, relocateWeekendsWithinProject, runAssignment } from './engine'
import { createRng } from './rng'
import {
  ASSIGNMENT_RULE_VERSION,
  type AssignmentEmployeeInput,
  type AssignmentInput,
  type AssignmentProjectInput,
  type AssignmentResult,
  type AssignmentTaskInput,
  type LockedRecordInput,
} from './types'

// 급여기간 '2026-10' = 2026-09-21(월) ~ 2026-10-20(화)
const PERIOD = { label: '2026-10', start: '2026-09-21', end: '2026-10-20' }

const emp = (id: string, target: number | null, projects: Array<string | { project_id: string; task_ids: string[] | null }>, active = true): AssignmentEmployeeInput => ({
  employee_id: id, active, target_hours: target,
  projects: projects.map(p => (typeof p === 'string' ? { project_id: p, task_ids: null } : p)),
})
const proj = (id: string, over: Partial<AssignmentProjectInput> = {}): AssignmentProjectInput => ({
  project_id: id, project_number: id, announce_date: '2026-09-01', submit_date: '2026-10-20',
  period_start: '2026-09-01', period_end: '2026-10-20', auto_assignable: true, ...over,
})
const task = (id: string, employee: string, name: string, sort = 10): AssignmentTaskInput => ({ task_id: id, employee_id: employee, task_name: name, sort_order: sort })
const lock = (employee: string, date: string, hours: number, project = 'pA'): LockedRecordInput => ({
  employee_id: employee, project_id: project, work_date: date, hours, task_name: '기존', source: 'manual',
})

function input(over: Partial<AssignmentInput> = {}): AssignmentInput {
  return {
    period: PERIOD, as_of: '2026-09-20', seed: 42, rule_version: ASSIGNMENT_RULE_VERSION,
    holidays: [], holiday_data_years: [2026],
    employees: [emp('e1', 24, ['pA'])],
    projects: [proj('pA')],
    tasks: [task('t1', 'e1', '검토', 10), task('t2', 'e1', '작성', 20)],
    locked_records: [],
    ...over,
  }
}

const of = (r: AssignmentResult, employee = 'e1') => r.assignments.filter(a => a.employee_id === employee)
const sum = (xs: { hours: number }[]) => xs.reduce((s, x) => s + x.hours, 0)
const codes = (r: AssignmentResult) => r.issues.map(i => i.code)
const isWeekendDate = (d: string) => [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())
const blocksOf = (r: AssignmentResult, employee = 'e1', locked: string[] = [], holidays: string[] = []) =>
  evaluateContinuity(
    of(r, employee).map(a => ({ date: a.work_date, project_id: a.project_id, task_id: a.task_id })),
    d => !isWeekendDate(d) && !holidays.includes(d) && !locked.includes(d),
    (a, b) => eachDate(a, b).slice(1, -1),
  )

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v) }
  return o
}

describe('기본 배정', () => {
  it('프로젝트 1개, 목표 24h → 평일만, 정확히 24h, 연속 블록 1개, 검증 통과', () => {
    const r = runAssignment(input())
    expect(r.ok).toBe(true)
    expect(r.violations).toEqual([])
    const a = of(r)
    expect(sum(a)).toBe(24)
    expect(a.every(x => x.hours === 2 || x.hours === 3)).toBe(true)
    expect(a.some(x => x.is_weekend || x.is_holiday)).toBe(false)
    expect(blocksOf(r)).toMatchObject({ blocks: 1, revisits: 0 })
    expect(r.employees[0]).toMatchObject({ target_hours: 24, locked_hours: 0, assigned_hours: 24, unassigned_hours: 0 })
  })

  it('2·3시간 프리셋 값이 기존 산출식과 같다', () => {
    for (const a of runAssignment(input()).assignments) {
      const p = TIME_TYPE_PRESETS[a.time_type]
      expect([a.start_time, a.end_time, a.break_hours, a.hours]).toEqual([p.start, p.end, p.breakH, p.hours])
      expect(a.exception_reason).toBeNull()
      expect(a.seed).toBe(42)
      expect(a.rule_version).toBe(ASSIGNMENT_RULE_VERSION)
    }
  })

  it.each([
    [2, { 3: 0, 2: 1 }], [3, { 3: 1, 2: 0 }], [4, { 3: 0, 2: 2 }], [5, { 3: 1, 2: 1 }],
    [7, { 3: 1, 2: 2 }], [10, { 3: 2, 2: 2 }],
  ])('목표 %sh → 정확히 맞추는 2·3시간 조합 %o', (target, mix) => {
    const r = runAssignment(input({ employees: [emp('e1', target, ['pA'])] }))
    const a = of(r)
    expect(sum(a)).toBe(target)
    expect({ 3: a.filter(x => x.hours === 3).length, 2: a.filter(x => x.hours === 2).length }).toEqual(mix)
    expect(r.violations).toEqual([])
  })
})

describe('월 목표', () => {
  it('목표행 없음 → 차단, 다른 직원은 정상', () => {
    const r = runAssignment(input({
      employees: [emp('e1', null, ['pA']), emp('e2', 6, ['pA'])],
      tasks: [task('t1', 'e1', '검토'), task('t9', 'e2', '검토')],
    }))
    expect(of(r, 'e1')).toEqual([])
    expect(r.issues.find(i => i.employee_id === 'e1')?.code).toBe('OVERTIME_MONTHLY_TARGET_MISSING')
    expect(sum(of(r, 'e2'))).toBe(6)
    expect(r.ok).toBe(true)
  })

  it('목표 0시간 → 신규 0건, 오류 아님', () => {
    const r = runAssignment(input({ employees: [emp('e1', 0, ['pA'])] }))
    expect(r.assignments).toEqual([])
    expect(r.issues.filter(i => i.severity === 'error')).toEqual([])
  })

  it('목표 0시간인데 잠금 기록 있음 → 기존 보존, TARGET_BELOW_LOCKED_HOURS', () => {
    const r = runAssignment(input({ employees: [emp('e1', 0, ['pA'])], locked_records: [lock('e1', '2026-09-22', 2)] }))
    expect(r.assignments).toEqual([])
    expect(codes(r)).toContain('TARGET_BELOW_LOCKED_HOURS')
  })

  it('잠금 합계가 목표보다 크면 신규 0건', () => {
    const r = runAssignment(input({ employees: [emp('e1', 4, ['pA'])], locked_records: [lock('e1', '2026-09-22', 3), lock('e1', '2026-09-23', 3)] }))
    expect(r.assignments).toEqual([])
    expect(codes(r)).toContain('TARGET_BELOW_LOCKED_HOURS')
  })

  it('남은 시간 = 목표 − 급여기간 잠금 (프로젝트가 달라도)', () => {
    const r = runAssignment(input({
      employees: [emp('e1', 20, ['pA'])],
      locked_records: [lock('e1', '2026-09-22', 3, 'pOther'), lock('e1', '2026-10-06', 5, 'pOther')],
    }))
    expect(sum(of(r))).toBe(12)
    expect(r.employees[0]).toMatchObject({ locked_hours: 8, assigned_hours: 12, unassigned_hours: 0 })
  })

  it('남은 1시간 → 배정 안 함, 소수 → 가능한 최대만', () => {
    const one = runAssignment(input({ employees: [emp('e1', 1, ['pA'])] }))
    expect(one.assignments).toEqual([])
    expect(one.issues.find(i => i.code === 'UNREPRESENTABLE_REMAINING_HOURS')?.detail).toMatchObject({ leftover: 1 })
    const frac = runAssignment(input({ employees: [emp('e1', 7.5, ['pA'])] }))
    expect(sum(of(frac))).toBe(7)
    expect(frac.employees[0].unassigned_hours).toBe(0.5)
    expect(frac.issues.find(i => i.code === 'UNREPRESENTABLE_REMAINING_HOURS')?.detail).toMatchObject({ leftover: 0.5 })
  })
})

describe('주 12시간', () => {
  const oneWeek = proj('pA', { period_start: '2026-10-05', period_end: '2026-10-11', submit_date: '2026-10-11' })

  it('한 주에 12시간 정확히 허용', () => {
    const r = runAssignment(input({ employees: [emp('e1', 12, ['pA'])], projects: [oneWeek] }))
    expect(sum(of(r))).toBe(12)
    expect(r.violations).toEqual([])
  })

  it('13시간 목표 → 12시간만, 주간 한도 사유', () => {
    const r = runAssignment(input({ employees: [emp('e1', 13, ['pA'])], projects: [oneWeek] }))
    expect(sum(of(r))).toBe(12)
    expect(codes(r)).toContain('WEEKLY_CAPACITY_EXHAUSTED')
    expect(r.employees[0].unassigned_hours).toBe(1)
  })

  it('급여기간 밖이지만 같은 주(월~일)의 잠금 기록도 합산', () => {
    // 마지막 주 2026-10-19(월)~25(일): 급여기간은 10/20까지, 10/23 잠금 10h는 기간 밖
    const r = runAssignment(input({
      employees: [emp('e1', 6, ['pA'])],
      projects: [proj('pA', { period_start: '2026-10-19', period_end: '2026-10-25' })],
      locked_records: [lock('e1', '2026-10-23', 10, 'pOther')],
    }))
    expect(sum(of(r))).toBe(2)
    expect(r.employees[0].weekly.find(w => w.week_start === '2026-10-19')).toMatchObject({ locked_hours: 10, assigned_hours: 2, total_hours: 12 })
    expect(r.violations).toEqual([])
  })

  it('잠금 기록이 있는 날짜에는 신규 배정하지 않는다', () => {
    const r = runAssignment(input({
      employees: [emp('e1', 6, ['pA'])],
      projects: [proj('pA', { period_start: '2026-10-05', period_end: '2026-10-07' })],
      locked_records: [lock('e1', '2026-10-05', 2)],
    }))
    expect(of(r).map(a => a.work_date)).not.toContain('2026-10-05')
    expect(sum(of(r))).toBe(4)
  })

  it('모든 주가 12시간 이하 (잠금 포함)', () => {
    const r = runAssignment(input({ employees: [emp('e1', 40, ['pA'])], locked_records: [lock('e1', '2026-09-29', 7)] }))
    for (const w of r.employees[0].weekly) expect(w.total_hours).toBeLessThanOrEqual(12)
    expect(r.violations).toEqual([])
  })
})

describe('프로젝트 배분', () => {
  const pA = proj('pA', { submit_date: '2026-10-01', period_end: '2026-10-01' })
  const pB = proj('pB', { submit_date: '2026-10-15', period_end: '2026-10-15' })
  const pC = proj('pC', { submit_date: '2026-10-20', period_end: '2026-10-20' })

  it('제출일 빠른 프로젝트부터 시간순 블록, A→B→A 없음', () => {
    const r = runAssignment(input({ employees: [emp('e1', 18, ['pB', 'pA'])], projects: [pA, pB] }))
    const a = of(r)
    expect(sum(a)).toBe(18)
    const lastA = a.filter(x => x.project_id === 'pA').map(x => x.work_date).sort().pop()!
    const firstB = a.filter(x => x.project_id === 'pB').map(x => x.work_date).sort()[0]
    expect(lastA < firstB).toBe(true)
    expect(blocksOf(r).revisits).toBe(0)
  })

  it('여력이 있으면 선택된 프로젝트마다 최소 1블록', () => {
    const r = runAssignment(input({ employees: [emp('e1', 24, ['pA', 'pB', 'pC'])], projects: [pA, pB, pC] }))
    const used = new Set(of(r).map(a => a.project_id))
    expect([...used].sort()).toEqual(['pA', 'pB', 'pC'])
    expect(blocksOf(r).revisits).toBe(0)
  })

  it('시간이 모자라면 제출일 빠른 프로젝트부터, 못 받은 프로젝트는 사유와 함께', () => {
    const r = runAssignment(input({ employees: [emp('e1', 4, ['pA', 'pB', 'pC'])], projects: [pA, pB, pC] }))
    expect([...new Set(of(r).map(a => a.project_id))].sort()).toEqual(['pA', 'pB'])
    const c = r.projects.find(p => p.project_id === 'pC')!
    expect(c.unassigned_employees).toEqual([{ employee_id: 'e1', code: 'TARGET_EXHAUSTED', message: expect.any(String) }])
  })

  it('제출일이 같으면 종료일 → 공고일 → 공사번호 순', () => {
    const x = proj('x', { submit_date: '2026-10-10', period_end: '2026-10-12', project_number: '2600' })
    const y = proj('y', { submit_date: '2026-10-10', period_end: '2026-10-11', project_number: '2700' })
    const z = proj('z', { submit_date: '2026-10-10', period_end: '2026-10-11', announce_date: '2026-08-01', project_number: '2800' })
    expect([x, y, z].sort(compareProjectPriority).map(p => p.project_id)).toEqual(['z', 'y', 'x'])
    const n1 = proj('n1', { project_number: '999' }), n2 = proj('n2', { project_number: '1000' })
    expect([n2, n1].sort(compareProjectPriority).map(p => p.project_id)).toEqual(['n1', 'n2'])
  })

  it('기간이 겹치는 두 프로젝트도 블록이 섞이지 않는다', () => {
    const r = runAssignment(input({ employees: [emp('e1', 24, ['pA', 'pB'])], projects: [proj('pA', { submit_date: '2026-10-10' }), proj('pB', { submit_date: '2026-10-12' })] }))
    expect(sum(of(r))).toBe(24)
    expect(blocksOf(r)).toMatchObject({ revisits: 0 })
    expect(r.projects.every(p => p.block_count <= 1)).toBe(true)
  })

  it('확인 필요·차단(자동배정 불가) 프로젝트 제외 → 남은 게 없으면 NO_ELIGIBLE_PROJECT', () => {
    const r = runAssignment(input({ projects: [proj('pA', { auto_assignable: false })] }))
    expect(r.assignments).toEqual([])
    expect(codes(r)).toEqual(expect.arrayContaining(['PROJECT_NOT_ASSIGNABLE', 'NO_ELIGIBLE_PROJECT']))
  })

  it('참여하지 않은 프로젝트에는 배정하지 않는다', () => {
    const r = runAssignment(input({ employees: [emp('e1', 12, ['pA'])], projects: [proj('pA'), proj('pZ', { submit_date: '2026-09-25' })] }))
    expect(of(r).every(a => a.project_id === 'pA')).toBe(true)
  })
})

describe('날짜', () => {
  it('평일만으로 충족되면 주말·공휴일을 쓰지 않는다', () => {
    const r = runAssignment(input({ employees: [emp('e1', 30, ['pA'])] }))
    expect(of(r).some(a => a.is_weekend || a.is_holiday)).toBe(false)
  })

  it('프로젝트 평일이 모자라면 주말 사용 + 사유 (종료일 = 제출일)', () => {
    // 10/09(금) ~ 10/11(일): 평일은 금요일 하루뿐
    const r = runAssignment(input({
      employees: [emp('e1', 9, ['pA'])],
      projects: [proj('pA', { period_start: '2026-10-09', period_end: '2026-10-11', submit_date: '2026-10-11' })],
    }))
    const a = of(r)
    expect(sum(a)).toBe(9)
    const weekend = a.filter(x => x.is_weekend)
    expect(weekend.length).toBe(2)
    expect(weekend.every(x => x.exception_reason === '제출일까지 평일 배정 가능시간 부족')).toBe(true)
    expect(codes(r)).toContain('WEEKEND_OR_HOLIDAY_USED')
    expect(r.employees[0].weekend_holiday_count).toBe(2)
    expect(r.violations).toEqual([])
  })

  it('공휴일 사용 — is_holiday·공휴일명·사유', () => {
    // 10/08(목) ~ 10/09(금, 한글날)
    const r = runAssignment(input({
      employees: [emp('e1', 6, ['pA'])],
      projects: [proj('pA', { period_start: '2026-10-08', period_end: '2026-10-09', submit_date: '2026-10-20' })],
      holidays: [{ date: '2026-10-09', name: '한글날' }],
    }))
    const h = of(r).find(x => x.work_date === '2026-10-09')!
    expect(h).toMatchObject({ is_holiday: true, holiday_name: '한글날', is_weekend: false, exception_reason: '프로젝트 유효기간 내 평일 부족' })
    expect(sum(of(r))).toBe(6)
  })

  it('공휴일 데이터 연도 누락 → 전체 차단, 누락 연도 포함', () => {
    const r = runAssignment(input({ period: { label: '2027-01', start: '2026-12-21', end: '2027-01-20' }, holiday_data_years: [2026] }))
    expect(r.ok).toBe(false)
    expect(r.assignments).toEqual([])
    expect(r.issues[0]).toMatchObject({ code: 'OVERTIME_HOLIDAYS_MISSING', severity: 'error', detail: { years: [2027] } })
  })

  it('금요일 → 공휴일 → 월요일도 연속 블록', () => {
    const r = runAssignment(input({
      employees: [emp('e1', 10, ['pA'])],
      projects: [proj('pA', { period_start: '2026-10-08', period_end: '2026-10-13' })],
      holidays: [{ date: '2026-10-09', name: '한글날' }],
    }))
    expect(sum(of(r))).toBe(10)
    expect(blocksOf(r, 'e1', [], ['2026-10-09']).blocks).toBe(1)
  })

  it('프로젝트 경계일·급여기간 경계일 당일 배정', () => {
    const single = runAssignment(input({ employees: [emp('e1', 3, ['pA'])], projects: [proj('pA', { period_start: '2026-10-05', period_end: '2026-10-05' })] }))
    expect(of(single).map(a => a.work_date)).toEqual(['2026-10-05'])
    const edge = runAssignment(input({ employees: [emp('e1', 3, ['pA'])], projects: [proj('pA', { period_start: '2026-10-20', period_end: '2026-10-30' })] }))
    expect(of(edge).map(a => a.work_date)).toEqual(['2026-10-20']) // 급여기간 마지막 날(화)
    const start = runAssignment(input({ employees: [emp('e1', 3, ['pA'])], projects: [proj('pA', { period_start: '2026-09-01', period_end: '2026-09-21' })] }))
    expect(of(start).map(a => a.work_date)).toEqual(['2026-09-21']) // 급여기간 첫날(월)
  })
})

describe('직원·업무', () => {
  it('비활성 직원 → 배정 없음', () => {
    const r = runAssignment(input({ employees: [emp('e1', 24, ['pA'], false)] }))
    expect(r.assignments).toEqual([])
    expect(codes(r)).toContain('EMPLOYEE_INACTIVE')
  })

  it('참여 프로젝트 없음 → NO_ELIGIBLE_PROJECT', () => {
    const r = runAssignment(input({ employees: [emp('e1', 24, [])] }))
    expect(codes(r)).toContain('NO_ELIGIBLE_PROJECT')
  })

  it('허용 업무 없음 → 그 프로젝트 차단', () => {
    const r = runAssignment(input({ employees: [emp('e1', 24, [{ project_id: 'pA', task_ids: [] }])] }))
    expect(r.assignments).toEqual([])
    expect(codes(r)).toContain('NO_ALLOWED_TASK')
  })

  it('업무 지정 없음(null) → 직원 기본업무 전체를 연속 하위 블록으로', () => {
    const r = runAssignment(input())
    const a = of(r)
    expect(new Set(a.map(x => x.task_id))).toEqual(new Set(['t1', 't2']))
    const report = blocksOf(r)
    expect(report.taskSwitches).toBe(1) // 업무 2개 → 하위 블록 2개 → 전환 1번
  })

  it('직원×프로젝트 업무 제한 — 지정한 업무만, 다른 직원 업무 id는 무시', () => {
    const r = runAssignment(input({
      employees: [emp('e1', 12, [{ project_id: 'pA', task_ids: ['t2', 'tOther'] }])],
      tasks: [task('t1', 'e1', '검토'), task('t2', 'e1', '작성'), task('tOther', 'e2', '작성')],
    }))
    expect(of(r).every(a => a.task_id === 't2' && a.task_name === '작성')).toBe(true)
  })

  it('이름이 아니라 id로 처리 — 같은 업무명의 다른 직원 업무를 쓰지 않는다', () => {
    const r = runAssignment(input({
      employees: [emp('e1', 6, ['pA']), emp('e2', 6, ['pA'])],
      tasks: [task('t1', 'e1', '검토'), task('t9', 'e2', '검토')],
    }))
    expect(of(r, 'e1').every(a => a.task_id === 't1')).toBe(true)
    expect(of(r, 'e2').every(a => a.task_id === 't9')).toBe(true)
  })
})

describe('결정성·불변성', () => {
  it('같은 입력 + 같은 seed → 같은 결과', () => {
    const i = input({ employees: [emp('e1', 24, ['pA', 'pB']), emp('e2', 17, ['pB'])], projects: [proj('pA', { submit_date: '2026-10-05' }), proj('pB')], tasks: [task('t1', 'e1', '검토'), task('t2', 'e2', '작성')] })
    expect(runAssignment(i)).toEqual(runAssignment(structuredClone(i)))
  })

  it('다른 seed → 강제조건·합계는 같고 허용된 분산(날짜·3시간 위치)만 달라질 수 있다', () => {
    const results = [1, 2, 3, 4, 5, 6].map(seed => runAssignment(input({ seed, employees: [emp('e1', 17, ['pA'])] })))
    for (const r of results) {
      expect(r.violations).toEqual([])
      expect(sum(of(r))).toBe(17)
      expect(of(r).some(a => a.is_weekend)).toBe(false)
    }
    const shapes = new Set(results.map(r => JSON.stringify(of(r).map(a => [a.work_date, a.hours]))))
    expect(shapes.size).toBeGreaterThan(1)
  })

  it('입력 객체·배열·잠금 기록을 바꾸지 않는다', () => {
    const i = input({ locked_records: [lock('e1', '2026-09-22', 3)] })
    const snapshot = structuredClone(i)
    expect(() => runAssignment(deepFreeze(i))).not.toThrow()
    expect(i).toEqual(snapshot)
  })
})

describe('무작위 시나리오 — 어떤 입력에서도 강제조건 위반이 없다', () => {
  it('300개 시나리오에서 violations 0, 목표 초과 없음, 미배정이면 사유 있음', () => {
    const rng = createRng(20261003)
    const dates = eachDate(PERIOD.start, PERIOD.end)
    for (let n = 0; n < 300; n++) {
      const projectCount = 1 + rng.int(4)
      const projects = Array.from({ length: projectCount }, (_, k) => {
        const s = dates[rng.int(dates.length)]
        const e = dates[Math.min(dates.length - 1, dates.indexOf(s) + rng.int(20))]
        return proj(`p${k}`, { period_start: s, period_end: e, submit_date: rng.int(2) ? e : null, auto_assignable: rng.int(10) > 0, project_number: String(2600 + rng.int(50)) })
      })
      const employees = Array.from({ length: 1 + rng.int(3) }, (_, k) =>
        emp(`e${k}`, rng.int(8) === 0 ? null : rng.int(45) + (rng.int(4) === 0 ? 0.5 : 0),
          projects.filter(() => rng.int(3) > 0).map(p => p.project_id), rng.int(12) > 0))
      const tasks = employees.flatMap(e => Array.from({ length: rng.int(3) }, (_, t) => task(`${e.employee_id}-t${t}`, e.employee_id, `업무${t}`, rng.int(2))))
      const locked = employees.flatMap(e => Array.from({ length: rng.int(4) }, () => lock(e.employee_id, dates[rng.int(dates.length)], 1 + rng.int(4))))
        .filter((l, i, all) => all.findIndex(x => x.employee_id === l.employee_id && x.work_date === l.work_date) === i)
      const holidays = dates.filter(() => rng.int(15) === 0).map(d => ({ date: d, name: '휴일' }))
      const i = input({ seed: n, employees, projects, tasks, locked_records: locked, holidays })

      const r = runAssignment(i)
      expect(r.violations).toEqual([])
      // 1일 블록 issue ⇔ 직원×프로젝트 배정일이 정확히 1일 (정보성, 위반 아님)
      const dayCount = new Map<string, number>()
      for (const a of r.assignments) dayCount.set(`${a.employee_id}|${a.project_id}`, (dayCount.get(`${a.employee_id}|${a.project_id}`) ?? 0) + 1)
      const singleKeys = [...dayCount].filter(([, n]) => n === 1).map(([k]) => k).sort()
      const issueKeys = r.issues.filter(x => x.code === 'SINGLE_DAY_PROJECT_BLOCK').map(x => `${x.employee_id}|${x.project_id}`).sort()
      expect(issueKeys).toEqual(singleKeys)
      for (const x of r.issues.filter(y => y.code === 'SINGLE_DAY_PROJECT_BLOCK')) {
        expect(x.severity).toBe('info')
        expect(['PERIOD_TOO_SHORT', 'TARGET_TOO_SMALL', 'NOT_ENOUGH_DAYS', 'CAPACITY_OR_CONFLICT']).toContain(x.detail?.reason)
      }
      for (const s of r.employees) {
        const e = employees.find(x => x.employee_id === s.employee_id)!
        if (e.target_hours !== null) expect(s.locked_hours + s.assigned_hours).toBeLessThanOrEqual(Math.max(e.target_hours, s.locked_hours) + 1e-9)
        for (const w of s.weekly) if (w.assigned_hours > 0) expect(w.total_hours).toBeLessThanOrEqual(12)
      }
      // 같은 직원·날짜 1건
      const keys = r.assignments.map(a => `${a.employee_id}|${a.work_date}`)
      expect(new Set(keys).size).toBe(keys.length)
      // 주 시작일 계산이 calendar와 같다
      for (const a of r.assignments) expect(r.employees.find(s => s.employee_id === a.employee_id)!.weekly.some(w => w.week_start === weekStartOf(a.work_date))).toBe(true)
    }
  })
})

describe('분산 (Phase 4A 보정)', () => {
  // 4주 가용기간: 2026-09-21(월) ~ 10-18(일)
  const fourWeeks = proj('pA', { period_end: '2026-10-18', submit_date: '2026-10-18' })

  it('24시간을 4주에 배정하면 첫 2주에만 몰리지 않고 3주 이상에 걸친다 (블록은 1개)', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const r = runAssignment(input({ seed, employees: [emp('e1', 24, ['pA'])], projects: [fourWeeks] }))
      const a = of(r)
      expect(sum(a)).toBe(24)
      expect(a.every(x => x.work_date <= '2026-10-04')).toBe(false)
      expect(new Set(a.map(x => weekStartOf(x.work_date))).size).toBeGreaterThanOrEqual(3)
      expect(r.projects.find(p => p.project_id === 'pA')!.block_count).toBe(1)
      // 두 주를 12h씩 채우는 방식(주별 12,12,0,0 → 표준편차 6)보다 고르다
      expect(r.employees[0].weekly_stdev).toBeLessThan(6)
    }
  })

  it('제출일이 임박한 프로젝트는 제출일 안에서 먼저, 뒤 프로젝트보다 늦게 가지 않는다', () => {
    const urgent = proj('pU', { submit_date: '2026-10-02', period_end: '2026-10-02' })
    const later = proj('pL', { submit_date: '2026-10-20', period_end: '2026-10-20' })
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const r = runAssignment(input({ seed, employees: [emp('e1', 24, ['pL', 'pU'])], projects: [later, urgent] }))
      const a = of(r)
      const u = a.filter(x => x.project_id === 'pU').map(x => x.work_date).sort()
      const l = a.filter(x => x.project_id === 'pL').map(x => x.work_date).sort()
      expect(u.length).toBeGreaterThan(0)
      expect(u[u.length - 1] <= '2026-10-02').toBe(true)
      expect(u[u.length - 1] < l[0]).toBe(true)
      expect(sum(a)).toBe(24)
      expect(r.violations).toEqual([])
    }
  })

  it('분산 때문에 프로젝트 블록이 늘지 않는다 (프로젝트마다 1블록, 왕복 0)', () => {
    const r = runAssignment(input({
      employees: [emp('e1', 30, ['pA', 'pB', 'pC'])],
      projects: [proj('pA', { submit_date: '2026-10-01', period_end: '2026-10-01' }), proj('pB', { submit_date: '2026-10-12', period_end: '2026-10-12' }), proj('pC')],
    }))
    expect(r.projects.map(p => p.block_count)).toEqual([1, 1, 1])
    expect(blocksOf(r).revisits).toBe(0)
  })
})

describe('기준일 이전 날짜', () => {
  it('as_of 이전이라도 급여기간·프로젝트 기간 안이면 배정한다', () => {
    const r = runAssignment(input({ as_of: '2026-10-19', employees: [emp('e1', 12, ['pA'])] }))
    expect(sum(of(r))).toBe(12)
    expect(of(r).every(a => a.work_date < '2026-10-19')).toBe(true)
  })

  it('과거 날짜의 잠금 기록과 겹치지 않는다', () => {
    const locks = ['2026-09-29', '2026-09-30', '2026-10-01'].map(d => lock('e1', d, 2))
    const r = runAssignment(input({ as_of: '2026-10-19', employees: [emp('e1', 18, ['pA'])], locked_records: locks }))
    const dates = of(r).map(a => a.work_date)
    for (const l of locks) expect(dates).not.toContain(l.work_date)
    expect(r.violations).toEqual([])
  })

  it('as_of는 엔진 배정 결과를 바꾸지 않는다(대상 판정은 eligibility에서 이미 끝남)', () => {
    const a = runAssignment(input({ as_of: '2026-09-20' }))
    const b = runAssignment(input({ as_of: '2026-10-19' }))
    expect(b.assignments).toEqual(a.assignments)
    expect(b.run.as_of).toBe('2026-10-19')
  })
})

describe('2시간·3시간 혼합', () => {
  it.each([5, 7, 8, 9, 10, 11, 12])('%sh — 2시간과 3시간을 섞고 합계는 정확히', target => {
    const a = of(runAssignment(input({ employees: [emp('e1', target, ['pA'])] })))
    expect(sum(a)).toBe(target)
    expect(a.some(x => x.hours === 2) && a.some(x => x.hours === 3)).toBe(true)
  })

  it('12h는 3+3+3+3이 아니라 2+2+2+3+3', () => {
    const a = of(runAssignment(input({ employees: [emp('e1', 12, ['pA'])] })))
    expect(a.map(x => x.hours).sort()).toEqual([2, 2, 2, 3, 3])
  })

  it.each([[2, [2]], [3, [3]], [4, [2, 2]]])('혼합이 불가능한 %sh → %o', (target, hours) => {
    expect(of(runAssignment(input({ employees: [emp('e1', target as number, ['pA'])] }))).map(x => x.hours).sort()).toEqual(hours)
  })

  it('6h는 seed와 무관하게 3+3 (다음 후보 2+2+2)', () => {
    for (const seed of [1, 2, 3, 4]) {
      expect(of(runAssignment(input({ seed, employees: [emp('e1', 6, ['pA'])] }))).map(x => x.hours)).toEqual([3, 3])
    }
  })

  it('가용 평일이 모자라면 혼합보다 배정 가능성 우선 — 월~목 4일, 12h → 3시간 4일(주말 안 씀)', () => {
    const a = of(runAssignment(input({ employees: [emp('e1', 12, ['pA'])], projects: [proj('pA', { period_start: '2026-10-05', period_end: '2026-10-08' })] })))
    expect(a.map(x => x.hours)).toEqual([3, 3, 3, 3])
    expect(a.some(x => x.is_weekend)).toBe(false)
  })

  it('같은 seed → 같은 시간 패턴, 다른 seed → 2·3시간 위치가 달라질 수 있다', () => {
    const pattern = (seed: number) => of(runAssignment(input({ seed, employees: [emp('e1', 17, ['pA'])] }))).map(x => `${x.work_date}:${x.hours}`).join(',')
    expect(pattern(9)).toBe(pattern(9))
    expect(new Set([1, 2, 3, 4, 5, 6].map(pattern)).size).toBeGreaterThan(1)
  })
})

describe('복수 업무', () => {
  const three = [task('t1', 'e1', '검토', 10), task('t2', 'e1', '작성', 20), task('t3', 'e1', '정리', 30)]

  it('일수가 업무 수보다 많으면 선택 업무를 모두, 업무별 연속 하위 블록으로', () => {
    const r = runAssignment(input({ employees: [emp('e1', 24, ['pA'])], tasks: three }))
    const seq = of(r).map(a => a.task_id)
    expect(new Set(seq)).toEqual(new Set(['t1', 't2', 't3']))
    // 날짜마다 번갈아 바뀌지 않는다: 전환은 업무 수 − 1번
    expect(seq.filter((t, i) => i > 0 && t !== seq[i - 1]).length).toBe(2)
    expect(blocksOf(r).taskSwitches).toBe(2)
  })

  it('일수가 업무 수보다 적으면 일부만(seed로), 미사용 업무는 요약·정보로', () => {
    const run = (seed: number) => runAssignment(input({ seed, employees: [emp('e1', 4, ['pA'])], tasks: three }))
    const r = run(3)
    const used = new Set(of(r).map(a => a.task_id))
    expect(used.size).toBe(2)
    expect(r.employees[0].by_project[0].unused_task_ids).toHaveLength(1)
    expect(used.has(r.employees[0].by_project[0].unused_task_ids[0])).toBe(false)
    expect(r.issues.find(i => i.code === 'TASKS_PARTIALLY_USED')?.severity).toBe('info')
    expect(run(3).assignments).toEqual(r.assignments)
  })
})

describe('주말 이동은 같은 프로젝트 안에서만', () => {
  const days = buildCalendar('2026-10-05', '2026-10-11', [])

  it('A의 주말 배정은 A 기간의 평일로 옮긴다', () => {
    const moved = relocateWeekendsWithinProject({
      plan: new Map([['2026-10-10', { projectId: 'A', hours: 3 as const }], ['2026-10-05', { projectId: 'A', hours: 2 as const }]]),
      days,
      windows: new Map([['A', { start: '2026-10-05', end: '2026-10-11' }]]),
      lockedDates: new Set(),
      lockedWeek: new Map(),
    })
    expect(moved.has('2026-10-10')).toBe(false)
    expect(moved.get('2026-10-06')).toEqual({ projectId: 'A', hours: 3 }) // 기존 A 배정에 가장 가까운 평일
  })

  it('A 기간에 평일이 없으면 B 평일이 비어 있어도 A 주말 배정을 유지한다', () => {
    const moved = relocateWeekendsWithinProject({
      plan: new Map([['2026-10-10', { projectId: 'A', hours: 3 as const }]]),
      days,
      windows: new Map([['A', { start: '2026-10-10', end: '2026-10-11' }], ['B', { start: '2026-10-05', end: '2026-10-09' }]]),
      lockedDates: new Set(),
      lockedWeek: new Map(),
    })
    expect([...moved]).toEqual([['2026-10-10', { projectId: 'A', hours: 3 }]])
  })

  it('엔진: 주말만 있는 A(제출 임박)는 주말 배정 + 사유, B 평일로 바꾸지 않고 검증도 통과', () => {
    const r = runAssignment(input({
      employees: [emp('e1', 12, ['pA', 'pB'])],
      projects: [proj('pA', { period_start: '2026-10-10', period_end: '2026-10-11', submit_date: '2026-10-11' }), proj('pB')],
    }))
    const a = of(r).filter(x => x.project_id === 'pA')
    expect(a.length).toBeGreaterThan(0)
    expect(a.every(x => x.is_weekend && x.exception_reason === '제출일까지 평일 배정 가능시간 부족')).toBe(true)
    expect(r.violations).toEqual([])
    expect(sum(of(r))).toBe(12)
  })
})

describe('프로젝트별 최소 2일 (마지막 보정)', () => {
  const pA = proj('pA', { submit_date: '2026-10-01', period_end: '2026-10-01' })
  const pB = proj('pB', { submit_date: '2026-10-12' })
  const pC = proj('pC')
  const daysOf = (r: AssignmentResult, pid: string) => of(r).filter(a => a.project_id === pid).length
  const singles = (r: AssignmentResult) => r.issues.filter(i => i.code === 'SINGLE_DAY_PROJECT_BLOCK')

  it('시간과 날짜가 충분하면 각 프로젝트가 최소 2일, 1일 블록 issue 없음', () => {
    for (const seed of [1, 2, 3]) {
      const r = runAssignment(input({ seed, employees: [emp('e1', 30, ['pA', 'pB', 'pC'])], projects: [pA, pB, pC] }))
      for (const pid of ['pA', 'pB', 'pC']) expect(daysOf(r, pid)).toBeGreaterThanOrEqual(2)
      expect(singles(r)).toEqual([])
      expect(r.projects.map(p => p.block_count)).toEqual([1, 1, 1])
    }
  })

  it('일수가 모자라면 우선순위 높은 프로젝트가 2일, 나머지는 1일 블록 + 정확한 정보성 issue', () => {
    // 10h → 2+2+3+3 = 4일, 프로젝트 3개 → pA 2일, pB·pC 1일
    const r = runAssignment(input({ employees: [emp('e1', 10, ['pA', 'pB', 'pC'])], projects: [pA, pB, pC] }))
    expect([daysOf(r, 'pA'), daysOf(r, 'pB'), daysOf(r, 'pC')]).toEqual([2, 1, 1])
    expect(singles(r)).toEqual([
      { code: 'SINGLE_DAY_PROJECT_BLOCK', severity: 'info', message: expect.stringContaining('1일만'), employee_id: 'e1', project_id: 'pB', detail: { assigned_days: 1, reason: 'NOT_ENOUGH_DAYS' } },
      { code: 'SINGLE_DAY_PROJECT_BLOCK', severity: 'info', message: expect.stringContaining('1일만'), employee_id: 'e1', project_id: 'pC', detail: { assigned_days: 1, reason: 'NOT_ENOUGH_DAYS' } },
    ])
    expect(r.ok).toBe(true)
    expect(r.violations).toEqual([]) // 1일 블록은 위반이 아니다
  })

  it('1일 블록을 피하려고 월 목표·주 12시간·프로젝트 기간을 어기지 않는다 (주 한도로 2일 불가)', () => {
    // pB 기간 10/05~10/09, 그 주에 다른 기록 10h → 그 주에 더 쓸 수 있는 건 하루(2h)뿐
    const r = runAssignment(input({
      employees: [emp('e1', 22, ['pB', 'pA'])],
      projects: [proj('pA'), proj('pB', { period_start: '2026-10-05', period_end: '2026-10-09', submit_date: '2026-10-09' })],
      locked_records: [lock('e1', '2026-10-05', 10, 'pOther')],
    }))
    expect(daysOf(r, 'pB')).toBe(1)
    expect(singles(r).find(i => i.project_id === 'pB')?.detail).toEqual({ assigned_days: 1, reason: 'CAPACITY_OR_CONFLICT' })
    expect(sum(of(r))).toBe(22 - 10) // 목표 22 − 급여기간 잠금 10 = 12, 정확히
    expect(r.employees[0].weekly.find(w => w.week_start === '2026-10-05')!.total_hours).toBeLessThanOrEqual(12)
    expect(of(r).every(a => a.project_id !== 'pB' || (a.work_date >= '2026-10-05' && a.work_date <= '2026-10-09'))).toBe(true)
    expect(r.violations).toEqual([])
  })

  it('1일 블록을 피하려고 주말을 쓰지 않는다 — 평일 1일 + 주말뿐인 기간', () => {
    // pB 기간 10/09(금)~10/11(일): 평일은 하루. 2일째를 주말로 채우지 않고 1일 블록 + PERIOD_TOO_SHORT
    const r = runAssignment(input({
      employees: [emp('e1', 12, ['pB', 'pA'])],
      projects: [proj('pA'), proj('pB', { period_start: '2026-10-09', period_end: '2026-10-11', submit_date: '2026-10-11' })],
    }))
    expect(of(r).filter(a => a.project_id === 'pB').map(a => a.work_date)).toEqual(['2026-10-09'])
    expect(of(r).some(a => a.is_weekend)).toBe(false)
    expect(singles(r).find(i => i.project_id === 'pB')?.detail).toEqual({ assigned_days: 1, reason: 'PERIOD_TOO_SHORT' })
    expect(sum(of(r))).toBe(12)
  })

  it('프로젝트 기간이 하루뿐이면 1일 배정 + 정보성 issue', () => {
    const r = runAssignment(input({ employees: [emp('e1', 6, ['pA'])], projects: [proj('pA', { period_start: '2026-10-05', period_end: '2026-10-05' })] }))
    expect(of(r).map(a => a.work_date)).toEqual(['2026-10-05'])
    expect(singles(r)).toEqual([expect.objectContaining({ project_id: 'pA', severity: 'info', detail: { assigned_days: 1, reason: 'PERIOD_TOO_SHORT' } })])
  })

  it('처음부터 하루면 충분한 목표(2·3시간)도 정보성 issue', () => {
    const r = runAssignment(input({ employees: [emp('e1', 3, ['pA'])] }))
    expect(of(r)).toHaveLength(1)
    expect(singles(r)[0]?.detail).toEqual({ assigned_days: 1, reason: 'TARGET_TOO_SMALL' })
  })
})

describe('업무 일부 선택 — 우선순위 (마지막 보정)', () => {
  const twoDays = (tasks: AssignmentTaskInput[], seed = 42) =>
    runAssignment(input({ seed, employees: [emp('e1', 4, ['pA'])], tasks }))   // 4h → 2일
  const used = (r: AssignmentResult) => of(r).map(a => a.task_id)

  it('업무 수 > 배정일이면 sort_order가 낮은 업무부터, 그 순서로 하위 블록', () => {
    const r = twoDays([task('tA', 'e1', '가', 30), task('tB', 'e1', '나', 10), task('tC', 'e1', '다', 20)])
    expect(used(r)).toEqual(['tB', 'tC'])
    expect(r.employees[0].by_project[0].unused_task_ids).toEqual(['tA'])
    expect(r.issues.find(i => i.code === 'TASKS_PARTIALLY_USED')?.detail).toEqual({ unused_task_ids: ['tA'] })
  })

  it('sort_order가 없으면 입력 배열 순서', () => {
    const noOrder: AssignmentTaskInput[] = ['tX', 'tY', 'tZ'].map(id => ({ task_id: id, employee_id: 'e1', task_name: id }))
    expect(used(twoDays(noOrder))).toEqual(['tX', 'tY'])
    // null도 같은 취급, sort_order가 있는 업무가 없는 업무보다 먼저
    const mixed: AssignmentTaskInput[] = [
      { task_id: 'tN', employee_id: 'e1', task_name: 'n', sort_order: null },
      { task_id: 'tS', employee_id: 'e1', task_name: 's', sort_order: 50 },
      { task_id: 'tM', employee_id: 'e1', task_name: 'm' },
    ]
    expect(used(twoDays(mixed))).toEqual(['tS', 'tN'])
  })

  it('같은 sort_order끼리는 입력 배열 순서 — seed가 바꾸지 않고 같은 seed면 재현', () => {
    const same = [task('tP', 'e1', 'p', 10), task('tQ', 'e1', 'q', 10), task('tR', 'e1', 'r', 10)]
    for (const seed of [1, 2, 3, 4, 5]) expect(used(twoDays(same, seed))).toEqual(['tP', 'tQ'])
    expect(twoDays(same, 7).assignments).toEqual(twoDays(same, 7).assignments)
  })

  it('seed가 달라도 우선순위 높은 업무가 탈락하지 않는다', () => {
    const tasks = [task('t3', 'e1', 'c', 3), task('t1', 'e1', 'a', 1), task('t4', 'e1', 'd', 4), task('t2', 'e1', 'b', 2)]
    for (let seed = 1; seed <= 10; seed++) {
      const u = new Set(used(twoDays(tasks, seed)))
      expect(u).toEqual(new Set(['t1', 't2']))
    }
  })
})

describe('분산·위치 규칙 유지 (마지막 보정)', () => {
  const fourWeeks = proj('pA', { period_end: '2026-10-18', submit_date: '2026-10-18' })

  it('24시간: 단일 블록, 3주 이상, 주간 표준편차 4 이하 유지', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const r = runAssignment(input({ seed, employees: [emp('e1', 24, ['pA'])], projects: [fourWeeks] }))
      expect(r.projects[0].block_count).toBe(1)
      expect(new Set(of(r).map(a => weekStartOf(a.work_date))).size).toBeGreaterThanOrEqual(3)
      expect(r.employees[0].weekly_stdev).toBeLessThanOrEqual(4)
      expect(Math.max(...r.employees[0].weekly.map(w => w.assigned_hours))).toBeLessThanOrEqual(10)
    }
  })

  it('블록 시작은 고른 간격 목표 위치의 ±2 평일 안 (탐색 범위를 넓히지 않음)', () => {
    // 평일 20일(9/21~10/16), 24h → 10일 블록 → 남는 공간 10, 블록 1개 → 목표 = 10/2 = 5번째 평일
    const weekdays = eachDate('2026-09-21', '2026-10-18').filter(d => !isWeekendDate(d))
    for (let seed = 1; seed <= 8; seed++) {
      const r = runAssignment(input({ seed, employees: [emp('e1', 24, ['pA'])], projects: [fourWeeks] }))
      const start = weekdays.indexOf(of(r)[0].work_date)
      expect(of(r)).toHaveLength(10)
      expect(Math.abs(start - 5)).toBeLessThanOrEqual(2)
    }
  })
})
