import { describe, expect, it } from 'vitest'
import { runAssignment } from './engine'
import { validateSchedule } from './validate'
import { ASSIGNMENT_RULE_VERSION, type AssignmentInput, type GeneratedAssignment } from './types'

/**
 * validateSchedule이 엔진과 독립적으로 위반을 잡는지 — 정상 결과를 일부러 변조해 확인한다.
 */
const base: AssignmentInput = {
  period: { label: '2026-10', start: '2026-09-21', end: '2026-10-20' },
  as_of: '2026-09-20',
  seed: 7,
  rule_version: ASSIGNMENT_RULE_VERSION,
  holidays: [{ date: '2026-10-09', name: '한글날' }],
  holiday_data_years: [2026],
  employees: [
    { employee_id: 'e1', active: true, target_hours: 12, projects: [{ project_id: 'pA', task_ids: null }] },
    { employee_id: 'e2', active: true, target_hours: 6, projects: [{ project_id: 'pA', task_ids: ['t9'] }] },
  ],
  projects: [
    { project_id: 'pA', project_number: '2700', announce_date: '2026-09-01', submit_date: '2026-10-16', period_start: '2026-10-05', period_end: '2026-10-16', auto_assignable: true },
    { project_id: 'pX', project_number: '2701', announce_date: '2026-09-01', submit_date: '2026-10-16', period_start: '2026-09-01', period_end: '2026-10-16', auto_assignable: true },
  ],
  tasks: [
    { task_id: 't1', employee_id: 'e1', task_name: '검토', sort_order: 1 },
    { task_id: 't9', employee_id: 'e2', task_name: '작성', sort_order: 1 },
    { task_id: 't8', employee_id: 'e2', task_name: '기타', sort_order: 2 },
  ],
  locked_records: [{ employee_id: 'e1', project_id: 'pA', work_date: '2026-10-14', hours: 2, task_name: '기존', source: 'manual' }],
}

const result = runAssignment(base)
const e1 = result.assignments.filter(a => a.employee_id === 'e1')
const codesOf = (as: GeneratedAssignment[], i: AssignmentInput = base) => validateSchedule(i, as).map(v => v.code)
const replace = (target: GeneratedAssignment, patch: Partial<GeneratedAssignment>) =>
  result.assignments.map(a => (a === target ? { ...a, ...patch } : a))

describe('validateSchedule — 정상 결과는 통과', () => {
  it('엔진 결과에 위반 없음', () => {
    expect(result.ok).toBe(true)
    expect(validateSchedule(base, result.assignments)).toEqual([])
    expect(e1.length).toBeGreaterThan(0)
  })
})

describe('validateSchedule — 변조 탐지 (코드·직원·날짜·실제값·제한값)', () => {
  it('2·3시간 외 시간 / 프리셋 불일치', () => {
    expect(codesOf(replace(e1[0], { hours: 4 as 3 }))).toContain('INVALID_HOURS')
    expect(codesOf(replace(e1[0], { end_time: '23:00' }))).toContain('PRESET_MISMATCH')
  })

  it('같은 직원·날짜 2건 / 잠금일 충돌', () => {
    expect(codesOf([...result.assignments, { ...e1[0], project_id: 'pA' }])).toContain('DUPLICATE_DAY')
    expect(codesOf(replace(e1[0], { work_date: '2026-10-14' }))).toContain('LOCKED_DAY_CONFLICT')
  })

  it('프로젝트·급여기간 밖', () => {
    expect(codesOf(replace(e1[0], { work_date: '2026-09-30' }))).toContain('OUTSIDE_PROJECT_PERIOD')
    const v = validateSchedule(base, replace(e1[0], { work_date: '2026-10-21' }))
    expect(v.find(x => x.code === 'OUTSIDE_PAY_PERIOD')).toMatchObject({ employee_id: 'e1', actual: '2026-10-21', limit: '2026-09-21~2026-10-20' })
  })

  it('참여하지 않은 프로젝트 / 허용되지 않은 업무 / 다른 직원 업무', () => {
    expect(codesOf(replace(e1[0], { project_id: 'pX' }))).toContain('NOT_A_MEMBER')
    const e2 = result.assignments.find(a => a.employee_id === 'e2')!
    expect(codesOf(replace(e2, { task_id: 't8', task_name: '기타' }))).toContain('TASK_NOT_ALLOWED') // e2의 업무지만 pA에 지정 안 됨
    expect(codesOf(replace(e1[0], { task_id: 't9', task_name: '작성' }))).toContain('TASK_NOT_ALLOWED')  // 다른 직원 업무
  })

  it('비활성 직원 / 목표 미입력 / 자동배정 불가 프로젝트', () => {
    const inactive = { ...base, employees: base.employees.map(e => (e.employee_id === 'e1' ? { ...e, active: false } : e)) }
    expect(codesOf(result.assignments, inactive)).toContain('EMPLOYEE_INACTIVE')
    const noTarget = { ...base, employees: base.employees.map(e => (e.employee_id === 'e1' ? { ...e, target_hours: null } : e)) }
    expect(codesOf(result.assignments, noTarget)).toContain('TARGET_MISSING')
    const closed = { ...base, projects: base.projects.map(p => (p.project_id === 'pA' ? { ...p, auto_assignable: false } : p)) }
    expect(codesOf(result.assignments, closed)).toContain('PROJECT_NOT_ASSIGNABLE')
  })

  it('주 12시간 초과 — 실제값·제한값', () => {
    // 10/12(월)~10/18(일) 주의 빈 날 전부에 3시간을 더한다 → 잠금 2h + 6일 이상 → 12h 초과
    const week = ['2026-10-12', '2026-10-13', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']
    const extra: GeneratedAssignment[] = week
      .filter(d => !e1.some(a => a.work_date === d))
      .map(d => ({ ...e1[0], work_date: d, hours: 3, time_type: '3h', end_time: '22:00' }))
    const bigTarget = { ...base, employees: base.employees.map(e => (e.employee_id === 'e1' ? { ...e, target_hours: 99 } : e)) }
    const v = validateSchedule(bigTarget, [...result.assignments, ...extra])
    const weekly = v.find(x => x.code === 'WEEKLY_CAP_EXCEEDED')
    expect(weekly).toMatchObject({ employee_id: 'e1', date: '2026-10-12', limit: 12 })
    expect(Number(weekly!.actual)).toBeGreaterThan(12)
  })

  it('월 목표 초과', () => {
    const v = validateSchedule({ ...base, employees: base.employees.map(e => (e.employee_id === 'e1' ? { ...e, target_hours: 4 } : e)) }, result.assignments)
    expect(v.find(x => x.code === 'MONTHLY_TARGET_EXCEEDED')).toMatchObject({ employee_id: 'e1', limit: 4 })
  })

  it('주말·공휴일 표시·사유', () => {
    expect(codesOf(replace(e1[0], { is_weekend: true }))).toContain('CALENDAR_FLAG_MISMATCH')
    expect(codesOf(replace(e1[0], { exception_reason: '임의 사유' }))).toContain('EXCEPTION_REASON_UNEXPECTED')
    const sat = replace(e1[0], { work_date: '2026-10-10', is_weekend: true, exception_reason: null })
    expect(codesOf(sat)).toContain('EXCEPTION_REASON_MISSING')
  })

  it('옮길 수 있는 평일이 있는데 주말을 쓰면 UNNECESSARY_WEEKEND', () => {
    // e1 배정 하나를 토요일로 옮긴다 — 같은 주에 빈 평일이 있고 한도도 남는다
    const moved = replace(e1[0], { work_date: '2026-10-10', is_weekend: true, exception_reason: '평일 부족' })
    const v = validateSchedule(base, moved)
    expect(v.find(x => x.code === 'UNNECESSARY_WEEKEND')).toMatchObject({ employee_id: 'e1', date: '2026-10-10' })
  })

  it('UNNECESSARY_WEEKEND는 다른 프로젝트의 빈 평일을 대안으로 보지 않는다', () => {
    const withWeekendProject: AssignmentInput = {
      ...base,
      employees: base.employees.map(e => (e.employee_id === 'e1' ? { ...e, target_hours: 40, projects: [...e.projects, { project_id: 'pW', task_ids: null }] } : e)),
      projects: [...base.projects, { project_id: 'pW', project_number: '2702', announce_date: '2026-09-01', submit_date: '2026-10-11', period_start: '2026-10-10', period_end: '2026-10-11', auto_assignable: true }],
    }
    const sat: GeneratedAssignment = { ...e1[0], project_id: 'pW', work_date: '2026-10-10', is_weekend: true, exception_reason: '제출일까지 평일 배정 가능시간 부족' }
    // pA 기간에는 빈 평일이 있지만 pW 기간에는 평일이 없다 → 위반 아님
    expect(validateSchedule(withWeekendProject, [...result.assignments, sat]).map(v => v.code)).not.toContain('UNNECESSARY_WEEKEND')
  })

  it('공휴일 데이터 누락 연도인데 배정이 있으면', () => {
    expect(codesOf(result.assignments, { ...base, holiday_data_years: [] })).toContain('HOLIDAYS_MISSING')
  })

  it('입력에 없는 직원', () => {
    expect(codesOf([...result.assignments, { ...e1[0], employee_id: 'ghost' }])).toContain('UNKNOWN_EMPLOYEE')
  })
})
