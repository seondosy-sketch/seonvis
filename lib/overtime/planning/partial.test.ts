import { describe, expect, it } from 'vitest'
import { runAssignment } from '../assign/engine'
import type { AssignmentInput } from '../assign/types'
import { splitPartialPlan } from './partial'

// 급여기간 2026-10(9/21~10/20), 프로젝트 1개, 직원 3명. 공휴일 데이터는 2026년 등록됨(빈 목록이어도 연도는 있음)
function input(targets: Array<number | null>, locked: number[] = []): AssignmentInput {
  const ids = targets.map((_, i) => `e${i + 1}`)
  return {
    period: { label: '2026-10', start: '2026-09-21', end: '2026-10-20' },
    as_of: '2026-09-21',
    seed: 7,
    rule_version: 'test',
    holidays: [],
    holiday_data_years: [2026],
    employees: ids.map((id, i) => ({ employee_id: id, active: true, target_hours: targets[i], projects: [{ project_id: 'p1', task_ids: null }] })),
    projects: [{ project_id: 'p1', project_number: 'T-1', announce_date: '2026-09-01', submit_date: '2026-10-30', period_start: '2026-09-01', period_end: '2026-10-30', auto_assignable: true }],
    tasks: ids.map(id => ({ task_id: `t-${id}`, employee_id: id, task_name: '검토', sort_order: 1 })),
    locked_records: locked.flatMap((h, i) => (h > 0 ? [{ employee_id: ids[i], project_id: 'p1', work_date: '2026-09-22', hours: h, task_name: '검토', source: 'manual' as const }] : [])),
  }
}

describe('splitPartialPlan — 부분 자동배정', () => {
  it('14. 목표 없는 직원만 제외하고 나머지는 저장 가능, 제외 직원의 초안은 만들지 않는다', () => {
    const result = runAssignment(input([12, null, 6]))
    const plan = splitPartialPlan(result)
    expect(result.ok).toBe(true)
    expect(plan.included).toEqual(['e1', 'e3'])
    expect(plan.excluded).toEqual([expect.objectContaining({ employee_id: 'e2', code: 'OVERTIME_MONTHLY_TARGET_MISSING' })])
    expect(plan.canSave).toBe(true)
    expect(plan.drafts.length).toBeGreaterThan(0)
    expect(plan.drafts.every(a => a.employee_id !== 'e2')).toBe(true)
  })
  it('목표 초과 상태(기존 기록 > 목표) 직원도 제외 사유로 보인다', () => {
    const plan = splitPartialPlan(runAssignment(input([12, 3], [0, 6])))
    expect(plan.excluded.map(x => [x.employee_id, x.code])).toEqual([['e2', 'TARGET_BELOW_LOCKED_HOURS']])
    expect(plan.included).toEqual(['e1'])
  })
  it('목표 0인 직원은 정상(0시간 배정)으로 남는다', () => {
    const plan = splitPartialPlan(runAssignment(input([0, 6])))
    expect(plan.included).toEqual(['e1', 'e2'])
    expect(plan.drafts.every(a => a.employee_id === 'e2')).toBe(true)
  })
  it('15. 모든 직원이 차단되면 저장할 수 없다', () => {
    const plan = splitPartialPlan(runAssignment(input([null, null])))
    expect(plan.included).toEqual([])
    expect(plan.excluded).toHaveLength(2)
    expect(plan.canSave).toBe(false)
    expect(plan.drafts).toEqual([])
  })
  it('엔진 전체 오류(공휴일 데이터 없음)면 정상 직원이 있어도 저장할 수 없다', () => {
    const i = input([12])
    i.holiday_data_years = []
    expect(splitPartialPlan(runAssignment(i)).canSave).toBe(false)
  })
})
