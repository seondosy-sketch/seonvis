import { describe, expect, it } from 'vitest'
import { runAssignment } from '../assign/engine'
import type { AssignmentInput } from '../assign/types'
import { canSavePreview, inputFingerprint, makePreview } from './fingerprint'
import type { PlanningScope } from './input'
import { canDiscardRun } from './runs'

// 급여기간 2026-11(10/21~11/20), 직원 2명, 프로젝트 2개
function input(over: Partial<AssignmentInput> = {}): AssignmentInput {
  return {
    period: { label: '2026-11', start: '2026-10-21', end: '2026-11-20' },
    as_of: '2026-10-20',
    seed: 11,
    rule_version: 'test',
    holidays: [{ date: '2026-11-03', name: '휴일' }, { date: '2026-10-09', name: '한글날' }],
    holiday_data_years: [2026],
    employees: [
      { employee_id: 'e1', active: true, target_hours: 12, projects: [{ project_id: 'p1', task_ids: null }, { project_id: 'p2', task_ids: ['t2', 't1'] }] },
      { employee_id: 'e2', active: true, target_hours: 6, projects: [{ project_id: 'p1', task_ids: null }] },
    ],
    projects: [
      { project_id: 'p1', project_number: '1', announce_date: '2026-10-01', submit_date: '2026-11-30', period_start: '2026-10-01', period_end: '2026-11-30', auto_assignable: true },
      { project_id: 'p2', project_number: '2', announce_date: '2026-10-01', submit_date: '2026-11-30', period_start: '2026-10-01', period_end: '2026-11-30', auto_assignable: true },
    ],
    tasks: [
      { task_id: 't1', employee_id: 'e1', task_name: '검토', sort_order: 10 },
      { task_id: 't2', employee_id: 'e1', task_name: '작성', sort_order: 20 },
      { task_id: 't3', employee_id: 'e2', task_name: '정리', sort_order: 10 },
    ],
    locked_records: [
      { employee_id: 'e1', project_id: 'p1', work_date: '2026-10-19', hours: 3, task_name: '검토', source: 'locked_draft' },
      { employee_id: 'e2', project_id: 'p1', work_date: '2026-10-22', hours: 2, task_name: '정리', source: 'manual' },
    ],
    ...over,
  }
}
const ALL: PlanningScope = { kind: 'all' }
const fp = (i: AssignmentInput, s: PlanningScope = ALL) => inputFingerprint(i, s)

describe('inputFingerprint — 미리보기 입력 지문', () => {
  it('순서만 다른 같은 입력은 같은 지문(직원·프로젝트·업무 지정·잠금·공휴일)', () => {
    const a = input()
    const b = input({
      employees: [
        { employee_id: 'e2', active: true, target_hours: 6, projects: [{ project_id: 'p1', task_ids: null }] },
        { employee_id: 'e1', active: true, target_hours: 12, projects: [{ project_id: 'p2', task_ids: ['t1', 't2'] }, { project_id: 'p1', task_ids: null }] },
      ],
      projects: [...a.projects].reverse(),
      // 우선순위(sort_order)가 같으면 순서는 그대로이므로, 다른 직원 업무 사이 순서만 섞는다
      tasks: [a.tasks[2], a.tasks[0], a.tasks[1]],
      locked_records: [...a.locked_records].reverse(),
      holidays: [...a.holidays].reverse(),
      holiday_data_years: [2026, 2026],
    })
    expect(fp(b)).toBe(fp(a))
  })

  it('as_of(배정 기준일)는 지문에 넣지 않는다 — 자정을 넘겨도 미리보기는 유효', () => {
    expect(fp(input({ as_of: '2026-10-21' }))).toBe(fp(input()))
  })

  it('seed·범위가 다르면 다른 지문', () => {
    expect(fp(input({ seed: 12 }))).not.toBe(fp(input()))
    expect(fp(input(), { kind: 'employee', employee_id: 'e1' })).not.toBe(fp(input()))
    expect(fp(input(), { kind: 'project', project_id: 'p1' })).not.toBe(fp(input(), { kind: 'project', project_id: 'p2' }))
  })

  it('월 목표가 바뀌면 다른 지문(미입력 null ↔ 0 구분)', () => {
    const base = input()
    const changed = input({ employees: base.employees.map(e => (e.employee_id === 'e2' ? { ...e, target_hours: 9 } : e)) })
    const zero = input({ employees: base.employees.map(e => (e.employee_id === 'e2' ? { ...e, target_hours: 0 } : e)) })
    const missing = input({ employees: base.employees.map(e => (e.employee_id === 'e2' ? { ...e, target_hours: null } : e)) })
    expect(fp(changed)).not.toBe(fp(base))
    expect(fp(zero)).not.toBe(fp(missing))
  })

  it('참여 프로젝트 추가·삭제면 다른 지문', () => {
    const base = input()
    const added = input({ employees: base.employees.map(e => (e.employee_id === 'e2' ? { ...e, projects: [...e.projects, { project_id: 'p2', task_ids: null }] } : e)) })
    const removed = input({ employees: base.employees.map(e => (e.employee_id === 'e1' ? { ...e, projects: e.projects.slice(0, 1) } : e)) })
    expect(fp(added)).not.toBe(fp(base))
    expect(fp(removed)).not.toBe(fp(base))
  })

  it('업무 지정 추가·삭제, 업무 추가·삭제, 우선순위 변경이면 다른 지문', () => {
    const base = input()
    const pickOne = input({ employees: base.employees.map(e => (e.employee_id === 'e1' ? { ...e, projects: [e.projects[0], { project_id: 'p2', task_ids: ['t1'] }] } : e)) })
    const taskAdded = input({ tasks: [...base.tasks, { task_id: 't4', employee_id: 'e2', task_name: '보완', sort_order: 30 }] })
    const taskRemoved = input({ tasks: base.tasks.filter(t => t.task_id !== 't2') })
    const reordered = input({ tasks: base.tasks.map(t => (t.task_id === 't1' ? { ...t, sort_order: 30 } : t)) })
    // sort_order가 같거나 없으면 입력 순서가 우선순위 — 순서를 바꾸면 우선순위가 바뀐 것
    const tiedA = input({ tasks: base.tasks.map(t => ({ ...t, sort_order: null })) })
    const tiedB = input({ tasks: [base.tasks[1], base.tasks[0], base.tasks[2]].map(t => ({ ...t, sort_order: null })) })
    for (const changed of [pickOne, taskAdded, taskRemoved, reordered]) expect(fp(changed)).not.toBe(fp(base))
    expect(fp(tiedA)).not.toBe(fp(tiedB))
  })

  it('잠금 기록·공휴일·프로젝트 기간이 바뀌면(서버에서 다시 읽은 경우) 다른 지문', () => {
    const base = input()
    const newRecord = input({ locked_records: [...base.locked_records, { employee_id: 'e1', project_id: 'p1', work_date: '2026-10-27', hours: 2, task_name: '검토', source: 'manual' }] })
    const hoursChanged = input({ locked_records: base.locked_records.map((r, i) => (i === 1 ? { ...r, hours: 3 } : r)) })
    const holidayAdded = input({ holidays: [...base.holidays, { date: '2026-11-09', name: '임시공휴일' }] })
    const periodChanged = input({ projects: base.projects.map(p => (p.project_id === 'p2' ? { ...p, period_end: '2026-11-10' } : p)) })
    for (const changed of [newRecord, hoursChanged, holidayAdded, periodChanged]) expect(fp(changed)).not.toBe(fp(base))
  })
})

describe('canSavePreview — 미리보기 뒤 입력이 바뀌면 저장 차단', () => {
  it('같은 입력이면 저장 가능, 설정이 바뀌면 불가, 다시 실행하면 다시 가능', () => {
    const first = input()
    const preview = makePreview(first, ALL, runAssignment(first))
    expect(preview.input).toBe(first)
    expect(canSavePreview(preview, input(), ALL)).toBe(true)

    // 목표를 바꾼 뒤(서버 재조회) — 같은 seed로 다시 만든 입력의 지문이 다르다
    const changed = input({ employees: first.employees.map(e => (e.employee_id === 'e1' ? { ...e, target_hours: 6 } : e)) })
    expect(canSavePreview(preview, changed, ALL)).toBe(false)
    // 범위만 바꿔도 불가
    expect(canSavePreview(preview, input(), { kind: 'employee', employee_id: 'e1' })).toBe(false)

    // 다시 실행하면 새 미리보기는 저장 가능
    const rerun = makePreview(changed, ALL, runAssignment(changed))
    expect(canSavePreview(rerun, changed, ALL)).toBe(true)
  })

  it('미리보기가 없으면 저장할 수 없다', () => {
    expect(canSavePreview(null, input(), ALL)).toBe(false)
  })
})

describe('canDiscardRun — 실행 폐기 버튼', () => {
  it.each([
    ['draft', true],
    ['partially_confirmed', true],
    ['confirmed', false],
    ['superseded', false],
    ['discarded', false],
  ] as const)('%s → %s (남은 초안 수와 무관)', (status, ok) => {
    expect(canDiscardRun({ status })).toBe(ok)
  })
})
