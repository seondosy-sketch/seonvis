import { describe, expect, it } from 'vitest'
import { runAssignment } from '../assign/engine'
import { checkWeeklyCap, weekQueryRange, weeklyCapMessage } from '../weeklyCap'
import { friendlyOvertimeError } from './errors'
import { buildAssignmentInput, lockedRange, supersededBy, toPeriodLabel, type PlanningRaw } from './input'

describe('weeklyCap — DB 트리거와 같은 규칙', () => {
  const recs = [
    { id: 'r1', employee_id: 'e1', work_date: '2026-10-26', hours: 3 },
    { id: 'r2', employee_id: 'e1', work_date: '2026-10-27', hours: 3 },
    { id: 'r3', employee_id: 'e1', work_date: '2026-10-28', hours: 3 },
    { id: 'r4', employee_id: 'e2', work_date: '2026-10-28', hours: 3 },
  ]
  it('정확히 12h 허용, 넘으면 거부 (다른 직원 기록은 무관)', () => {
    expect(checkWeeklyCap(recs, [{ employee_id: 'e1', work_date: '2026-10-29', hours: 3 }])[0]).toMatchObject({ ok: true, after: 12, week_start: '2026-10-26' })
    expect(checkWeeklyCap(recs, [{ employee_id: 'e1', work_date: '2026-11-01', hours: 4 }])[0]).toMatchObject({ ok: false, after: 13, before: 9 })
  })
  it('여러 건 일괄 입력은 합쳐서 본다', () => {
    const r = checkWeeklyCap(recs, [{ employee_id: 'e1', work_date: '2026-10-29', hours: 2 }, { employee_id: 'e1', work_date: '2026-10-30', hours: 2 }])
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ ok: false, after: 13 })
  })
  it('수정은 기존 시간을 빼고 계산, 과거 초과 주는 줄이거나 그대로면 허용', () => {
    const over = [...recs, { id: 'r5', employee_id: 'e1', work_date: '2026-10-29', hours: 5 }] // 이미 14h
    expect(checkWeeklyCap(over, [{ employee_id: 'e1', work_date: '2026-10-29', hours: 5, replacing_id: 'r5' }])[0]).toMatchObject({ ok: true, before: 14, after: 14 })
    expect(checkWeeklyCap(over, [{ employee_id: 'e1', work_date: '2026-10-29', hours: 6, replacing_id: 'r5' }])[0].ok).toBe(false)
    expect(checkWeeklyCap(over, [{ employee_id: 'e1', work_date: '2026-10-29', hours: 2, replacing_id: 'r5' }])[0].ok).toBe(true)
  })
  it('다른 주로 옮기면 옮겨 가는 주 기준', () => {
    expect(checkWeeklyCap(recs, [{ employee_id: 'e1', work_date: '2026-11-02', hours: 3, replacing_id: 'r1' }])[0]).toMatchObject({ ok: true, week_start: '2026-11-02', after: 3 })
  })
  it('조회 범위와 안내 문구', () => {
    expect(weekQueryRange(['2026-10-30', '2026-11-03'])).toEqual({ from: '2026-10-26', to: '2026-11-08' })
    expect(weeklyCapMessage({ employee_id: 'e1', week_start: '2026-10-26', week_end: '2026-11-01', before: 9, after: 13, ok: false }))
      .toBe('10/26(월)~11/1(일) 주 합계가 13시간이 되어 주 12시간 한도를 넘습니다')
  })
})

describe('friendlyOvertimeError — DB 원문을 그대로 보여주지 않는다', () => {
  it.each([
    ['OVERTIME_WEEKLY_CAP: 2026-10-26 주 합계 14.00시간 (한도 12시간)', '12시간'],
    ['OVERTIME_MONTHLY_TARGET_MISSING: 직원 e… 월 목표시간 미입력', '월 목표시간이 입력되지 않은'],
    ['OVERTIME_MONTHLY_TARGET: 직원 e… 목표 4 / 합계 8', '월 목표시간을 넘어'],
    ['OVERTIME_AUTO_RECORD_LOCKED', '확정 취소'],
    ['permission denied (admin only)', '관리자만'],
    ['new row violates row-level security policy', '권한이 없습니다'],
    ['OVERTIME_HOLIDAY_CHANGED: 2026-11-03 공휴일 여부가 다름', '공휴일 정보가 바뀌었습니다'],
    ['OVERTIME_HOLIDAYS_MISSING: 2027년 공휴일 데이터 없음', '공휴일 데이터가 없어'],
    ['OVERTIME_EMPLOYEE_LINK_REQUIRED: 연결 안 된 주소록 2명 / 직원 1명', '관리자가 먼저 직원을 기술인 주소록과 연결'],
  ])('%s', (raw, part) => { expect(friendlyOvertimeError(raw)).toContain(part) })
  it('새 코드도 DB 원문(날짜·숫자·직원 정보)을 내보내지 않는다', () => {
    expect(friendlyOvertimeError('OVERTIME_HOLIDAY_CHANGED: 2026-11-03 공휴일 여부가 다름')).not.toContain('2026-11-03')
    expect(friendlyOvertimeError('OVERTIME_EMPLOYEE_LINK_REQUIRED: 연결 안 된 주소록 2명 / 직원 1명')).not.toContain('2명')
  })
  it('모르는 오류는 일반 문구(원문 노출 없음)', () => {
    const msg = friendlyOvertimeError('syntax error at or near "select"')
    expect(msg).not.toContain('syntax')
  })
})

describe('buildAssignmentInput — DB 행 → 엔진 입력', () => {
  const base = (over: Partial<PlanningRaw> = {}): PlanningRaw => ({
    year: 2026, month0: 10, asOf: '2026-10-25', seed: 1, scope: { kind: 'all' },
    employees: [
      { id: 'e1', name: '갑', position: '', is_active: true, sort_order: 1 },
      { id: 'e2', name: '을', position: '', is_active: true, sort_order: 2 },
    ],
    targets: [{ employee_id: 'e1', target_hours: 12 }],
    overtimeProjects: [
      { id: 'p1', name: 'P1', status: '진행중', sort_order: 1, start_date: '2026-10-01', end_date: '2026-11-30', source_project_id: 's1' },
      { id: 'p2', name: 'P2', status: '종료', sort_order: 2, start_date: '2026-10-01', end_date: null, source_project_id: null },
    ],
    sourceProjects: [{ id: 's1', project_number: '2700', submit_date: '2026-11-10' }],
    members: [
      { id: 'm1', project_id: 'p1', employee_id: 'e1' },
      { id: 'm2', project_id: 'p2', employee_id: 'e1' },
      { id: 'm3', project_id: 'p1', employee_id: 'e2' },
    ],
    memberTasks: [{ member_id: 'm3', task_id: 't3' }],
    tasks: [
      { id: 't1', employee_id: 'e1', task_name: '검토', sort_order: 10 },
      { id: 't3', employee_id: 'e2', task_name: '작성', sort_order: 10 },
      { id: 't4', employee_id: 'e2', task_name: '정리', sort_order: 20 },
    ],
    holidays: [{ holiday_date: '2026-11-03', name: '휴일' }],
    records: [{ employee_id: 'e1', project_id: 'p1', work_date: '2026-10-19', hours: 3, task_description: '검토', source: null }],
    drafts: [
      { employee_id: 'e1', project_id: 'p1', work_date: '2026-11-02', hours: 2, task_name: '검토', status: 'draft', locked: true, manually_edited: true },
      { employee_id: 'e1', project_id: 'p1', work_date: '2026-11-04', hours: 2, task_name: '검토', status: 'draft', locked: false, manually_edited: false },
    ],
    ...over,
  })

  it('급여기간·라벨, 목표 없음 = null, 업무 지정 없음 = null, 지정 있음 = 그 업무만', () => {
    const i = buildAssignmentInput(base())
    expect(i.period).toEqual({ label: '2026-11', start: '2026-10-21', end: '2026-11-20' })
    expect(i.employees.find(e => e.employee_id === 'e1')).toMatchObject({ target_hours: 12, projects: [{ project_id: 'p1', task_ids: null }, { project_id: 'p2', task_ids: null }] })
    expect(i.employees.find(e => e.employee_id === 'e2')).toMatchObject({ target_hours: null, projects: [{ project_id: 'p1', task_ids: ['t3'] }] })
    expect(i.holiday_data_years).toEqual([2026])
  })

  it('프로젝트: 진행중이고 기간이 있어야 배정 가능, 제출일·공사번호는 원본에서', () => {
    const i = buildAssignmentInput(base())
    expect(i.projects.find(p => p.project_id === 'p1')).toMatchObject({ auto_assignable: true, submit_date: '2026-11-10', project_number: '2700', period_end: '2026-11-30' })
    expect(i.projects.find(p => p.project_id === 'p2')?.auto_assignable).toBe(false)
  })

  it('잠금: 최종기록 + 잠긴 초안. 전체 재배정은 잠기지 않은 초안을 잠금에 넣지 않는다', () => {
    const i = buildAssignmentInput(base())
    expect(i.locked_records.map(l => [l.work_date, l.source])).toEqual([['2026-10-19', 'manual'], ['2026-11-02', 'locked_draft']])
  })

  it('프로젝트 범위 재배정: 범위 밖 프로젝트의 살아 있는 초안은 잠금으로 넘긴다', () => {
    const i = buildAssignmentInput(base({
      scope: { kind: 'project', project_id: 'p2' },
      drafts: [{ employee_id: 'e1', project_id: 'p1', work_date: '2026-11-04', hours: 2, task_name: '검토', status: 'draft', locked: false, manually_edited: false }],
    }))
    expect(i.employees.map(e => e.employee_id)).toEqual(['e1'])
    expect(i.employees[0].projects.map(p => p.project_id)).toEqual(['p2'])
    expect(i.locked_records.some(l => l.work_date === '2026-11-04' && l.source === 'locked_draft')).toBe(true)
  })

  it('엔진에 그대로 넣어 돌아간다(목표 없는 직원은 엔진이 차단)', () => {
    const r = runAssignment(buildAssignmentInput(base()))
    expect(r.violations).toEqual([])
    expect(r.issues.some(x => x.code === 'OVERTIME_MONTHLY_TARGET_MISSING' && x.employee_id === 'e2')).toBe(true)
    // 목표 12 − 급여기간 안 잠금 2(잠긴 초안). 10/19 기록 3h는 급여기간(10/21~) 밖이라 주 12시간에만 들어간다
    expect(r.assignments.filter(a => a.employee_id === 'e1').reduce((s, a) => s + a.hours, 0)).toBe(12 - 2)
  })

  it('같은 날짜 조건: 이번 급여기간 밖 초안은 범위·잠금과 상관없이 대체되지 않는다', () => {
    const period = { start: '2026-10-21', end: '2026-11-20' }
    const d = { employee_id: 'e1', project_id: 'p1', status: 'draft' as const, locked: false, manually_edited: false }
    expect(supersededBy({ kind: 'all' }, period, { ...d, work_date: '2026-10-21' })).toBe(true)
    expect(supersededBy({ kind: 'all' }, period, { ...d, work_date: '2026-11-20' })).toBe(true)
    expect(supersededBy({ kind: 'all' }, period, { ...d, work_date: '2026-10-20' })).toBe(false)
    expect(supersededBy({ kind: 'all' }, period, { ...d, work_date: '2026-11-21' })).toBe(false)
    expect(supersededBy({ kind: 'employee', employee_id: 'e1' }, period, { ...d, work_date: '2026-10-19' })).toBe(false)
    expect(supersededBy({ kind: 'employee', employee_id: 'e2' }, period, { ...d, work_date: '2026-10-22' })).toBe(false)
    expect(supersededBy({ kind: 'project', project_id: 'p1' }, period, { ...d, work_date: '2026-10-22' })).toBe(true)
    expect(supersededBy({ kind: 'project', project_id: 'p2' }, period, { ...d, work_date: '2026-10-22' })).toBe(false)
    expect(supersededBy({ kind: 'all' }, period, { ...d, work_date: '2026-10-22', locked: true })).toBe(false)
    expect(supersededBy({ kind: 'all' }, period, { ...d, work_date: '2026-10-22', manually_edited: true })).toBe(false)
    expect(supersededBy({ kind: 'all' }, period, { ...d, work_date: '2026-10-22', status: 'confirmed' })).toBe(false)
  })

  it('회귀: 앞 급여기간(2026-10) 실행의 10/19·10/20 초안은 2026-11 실행의 잠금 입력이고, 주 합계가 12시간을 넘지 않는다', () => {
    const raw = base({
      employees: [{ id: 'e1', name: '갑', position: '', is_active: true, sort_order: 1 }],
      targets: [{ employee_id: 'e1', target_hours: 40 }],
      members: [{ id: 'm1', project_id: 'p1', employee_id: 'e1' }],
      memberTasks: [],
      tasks: [{ id: 't1', employee_id: 'e1', task_name: '검토', sort_order: 10 }],
      records: [],
      drafts: [
        // 2026-10 급여기간(9/21~10/20) 실행의 초안 — 10/19(월)~10/25(일) 주에 걸친다
        { employee_id: 'e1', project_id: 'p1', work_date: '2026-10-19', hours: 3, task_name: '검토', status: 'draft', locked: false, manually_edited: false },
        { employee_id: 'e1', project_id: 'p1', work_date: '2026-10-20', hours: 3, task_name: '검토', status: 'draft', locked: false, manually_edited: false },
        // 이번 급여기간 안의 잠기지 않은 초안 — 저장하면 대체되므로 잠금에 넣지 않는다
        { employee_id: 'e1', project_id: 'p1', work_date: '2026-10-22', hours: 3, task_name: '검토', status: 'draft', locked: false, manually_edited: false },
      ],
    })
    const input = buildAssignmentInput(raw)
    expect(input.locked_records.map(l => [l.work_date, l.hours, l.source])).toEqual([
      ['2026-10-19', 3, 'locked_draft'],
      ['2026-10-20', 3, 'locked_draft'],
    ])

    const r = runAssignment(input)
    expect(r.violations).toEqual([])
    const weekNew = r.assignments
      .filter(a => a.employee_id === 'e1' && a.work_date >= '2026-10-19' && a.work_date <= '2026-10-25')
      .reduce((s, a) => s + a.hours, 0)
    expect(6 + weekNew).toBeLessThanOrEqual(12)
    const week = r.employees[0].weekly.find(w => w.week_start === '2026-10-19')
    expect(week?.locked_hours).toBe(6)
    expect(week?.total_hours).toBeLessThanOrEqual(12)
    // 앞 급여기간 날짜의 잠금은 이번 급여기간 월 목표 잠금시간에 들어가지 않는다
    expect(r.employees[0].locked_hours).toBe(0)
  })

  it('잠금 범위·라벨 헬퍼', () => {
    expect(lockedRange(2026, 10)).toEqual({ from: '2026-10-19', to: '2026-11-22' })
    expect(toPeriodLabel(2026, 0)).toBe('2026-01')
  })
})
