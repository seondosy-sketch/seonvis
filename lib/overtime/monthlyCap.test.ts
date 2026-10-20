import { describe, expect, it } from 'vitest'
import { checkMonthlyTarget, monthlyCapMessage, payPeriodOf, type MonthRecord, type MonthlyTargetRow } from './monthlyCap'
import { checkWeeklyCap } from './weeklyCap'
import { friendlyOvertimeError } from './planning/errors'

const E = 'emp-1'
const rec = (id: string, work_date: string, hours: number, employee_id = E): MonthRecord => ({ id, employee_id, work_date, hours })
const tgt = (period_label: string, target_hours: number | null, employee_id = E): MonthlyTargetRow => ({ employee_id, period_label, target_hours })
const one = (records: MonthRecord[], targets: MonthlyTargetRow[], change: { work_date: string; hours: number; replacing_id?: string | null; employee_id?: string }) =>
  checkMonthlyTarget(records, targets, [{ employee_id: E, ...change }])

describe('payPeriodOf — 전월 21일 ~ 당월 20일', () => {
  it('20일은 그 달, 21일은 다음 달 급여기간', () => {
    expect(payPeriodOf('2026-10-20')).toEqual({ label: '2026-10', start: '2026-09-21', end: '2026-10-20' })
    expect(payPeriodOf('2026-10-21')).toEqual({ label: '2026-11', start: '2026-10-21', end: '2026-11-20' })
    expect(payPeriodOf('2026-09-21').label).toBe('2026-10')
  })
  it('연도가 바뀌는 급여기간(12/21 ~ 1/20)은 다음 해 1월 라벨', () => {
    expect(payPeriodOf('2026-12-21')).toEqual({ label: '2027-01', start: '2026-12-21', end: '2027-01-20' })
    expect(payPeriodOf('2027-01-20').label).toBe('2027-01')
    expect(payPeriodOf('2026-12-20').label).toBe('2026-12')
  })
})

describe('checkMonthlyTarget — 신규 수동 입력', () => {
  it('1. 목표 행이 없으면 차단 (MISSING)', () => {
    const [r] = one([], [], { work_date: '2026-10-05', hours: 3 })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('OVERTIME_MONTHLY_TARGET_MISSING')
    expect(r).toMatchObject({ period_label: '2026-10', before: 0, after: 3, target: null })
  })
  it('1-1. 목표가 null이어도 차단', () => {
    expect(one([], [tgt('2026-10', null)], { work_date: '2026-10-05', hours: 3 })[0].code).toBe('OVERTIME_MONTHLY_TARGET_MISSING')
  })
  it('2. 목표 0이면 양수 시간은 모두 차단', () => {
    const [r] = one([], [tgt('2026-10', 0)], { work_date: '2026-10-05', hours: 1 })
    expect(r.code).toBe('OVERTIME_MONTHLY_TARGET_EXCEEDED')
  })
  it('3. 저장 후 합계가 목표와 같으면 허용', () => {
    const [r] = one([rec('a', '2026-10-01', 27)], [tgt('2026-10', 30)], { work_date: '2026-10-05', hours: 3 })
    expect(r).toMatchObject({ ok: true, before: 27, after: 30 })
  })
  it('4. 목표를 넘는 신규 입력은 차단', () => {
    const [r] = one([rec('a', '2026-10-01', 28)], [tgt('2026-10', 30)], { work_date: '2026-10-05', hours: 3 })
    expect(r).toMatchObject({ ok: false, code: 'OVERTIME_MONTHLY_TARGET_EXCEEDED', before: 28, after: 31 })
  })
  it('5. 여러 프로젝트의 수동·자동 기록을 모두 합산한다(프로젝트·출처 구분 없음)', () => {
    // MonthRecord에는 프로젝트·출처가 없다 — 같은 직원·급여기간이면 모두 더한다
    const records = [rec('m1', '2026-09-22', 3), rec('auto1', '2026-09-30', 2), rec('auto2', '2026-10-12', 3), rec('m2', '2026-10-03', 6)]
    const [r] = one(records, [tgt('2026-10', 16)], { work_date: '2026-10-14', hours: 3 })
    expect(r).toMatchObject({ before: 14, after: 17, ok: false })
  })
  it('6. 경계 — 9/20 기록은 2026-09, 9/21 기록은 2026-10 기간으로만 합산', () => {
    const records = [rec('a', '2026-09-20', 10), rec('b', '2026-09-21', 5), rec('c', '2026-10-20', 5), rec('d', '2026-10-21', 10)]
    const [r] = one(records, [tgt('2026-10', 13)], { work_date: '2026-10-01', hours: 3 })
    expect(r).toMatchObject({ before: 10, after: 13, ok: true })
  })
  it('7. 연도 변경 급여기간 — 12/21~1/20을 2027-01 목표로 본다', () => {
    const records = [rec('a', '2026-12-21', 4), rec('b', '2027-01-20', 4), rec('c', '2026-12-20', 9)]
    const [r] = one(records, [tgt('2027-01', 10), tgt('2026-12', 100)], { work_date: '2027-01-05', hours: 3 })
    expect(r).toMatchObject({ period_label: '2027-01', before: 8, after: 11, ok: false, code: 'OVERTIME_MONTHLY_TARGET_EXCEEDED' })
  })
  it('다른 직원 기록은 합산하지 않는다', () => {
    const [r] = one([rec('x', '2026-10-01', 30, 'emp-2')], [tgt('2026-10', 3)], { work_date: '2026-10-05', hours: 3 })
    expect(r).toMatchObject({ before: 0, after: 3, ok: true })
  })
  it('일괄 입력 — 같은 기간 여러 날을 한꺼번에 더해 본다', () => {
    const changes = ['2026-10-05', '2026-10-06', '2026-10-07'].map(work_date => ({ employee_id: E, work_date, hours: 3 }))
    const [r] = checkMonthlyTarget([rec('a', '2026-10-01', 4)], [tgt('2026-10', 12)], changes)
    expect(r).toMatchObject({ before: 4, after: 13, ok: false })
  })
})

describe('checkMonthlyTarget — 기존 기록 수정', () => {
  const base = [rec('r1', '2026-10-05', 3), rec('r2', '2026-10-06', 3)]
  it('8. 수정으로 총합이 목표를 넘게 늘면 차단', () => {
    const [r] = one(base, [tgt('2026-10', 7)], { work_date: '2026-10-05', hours: 5, replacing_id: 'r1' })
    expect(r).toMatchObject({ before: 6, after: 8, ok: false, code: 'OVERTIME_MONTHLY_TARGET_EXCEEDED' })
  })
  it('수정 후 총합이 목표 이하면 허용', () => {
    expect(one(base, [tgt('2026-10', 7)], { work_date: '2026-10-05', hours: 4, replacing_id: 'r1' })[0]).toMatchObject({ after: 7, ok: true })
  })
  it('9. 이미 초과 상태(목표를 기존 합계 아래로 낮춤)에서 시간을 줄이는 수정은 허용', () => {
    const [r] = one(base, [tgt('2026-10', 2)], { work_date: '2026-10-05', hours: 2, replacing_id: 'r1' })
    expect(r).toMatchObject({ before: 6, after: 5, ok: true })
  })
  it('10. 초과 상태에서 같은 값(날짜만 같은 기간 안에서 이동)이나 증가는 차단', () => {
    expect(one(base, [tgt('2026-10', 2)], { work_date: '2026-10-07', hours: 3, replacing_id: 'r1' })[0])
      .toMatchObject({ before: 6, after: 6, ok: false, code: 'OVERTIME_MONTHLY_TARGET_EXCEEDED' })
    expect(one(base, [tgt('2026-10', 2)], { work_date: '2026-10-05', hours: 4, replacing_id: 'r1' })[0].ok).toBe(false)
  })
  it('직원·날짜·시간이 그대로인 수정(업무명·비고만)은 검사하지 않는다 — 초과·목표 없음 상태여도 허용', () => {
    expect(one(base, [], { work_date: '2026-10-05', hours: 3, replacing_id: 'r1' })).toEqual([])
    expect(one(base, [tgt('2026-10', 1)], { work_date: '2026-10-05', hours: 3, replacing_id: 'r1' })).toEqual([])
  })
  it('목표가 없는 기간에서도 줄이는 수정은 허용, 같거나 늘리면 차단', () => {
    expect(one(base, [], { work_date: '2026-10-05', hours: 2, replacing_id: 'r1' })[0].ok).toBe(true)
    expect(one(base, [], { work_date: '2026-10-07', hours: 3, replacing_id: 'r1' })[0].code).toBe('OVERTIME_MONTHLY_TARGET_MISSING')
  })
  it('11. 다른 급여기간으로 옮기면 도착 기간만 검사 — 목표 없으면 차단', () => {
    const [r] = one(base, [tgt('2026-10', 100)], { work_date: '2026-10-22', hours: 3, replacing_id: 'r1' })
    expect(r).toMatchObject({ period_label: '2026-11', before: 0, after: 3, code: 'OVERTIME_MONTHLY_TARGET_MISSING' })
  })
  it('11-1. 도착 기간 목표가 있으면 도착 기간 합계로 판단(출발 기간은 줄기만 하므로 보지 않음)', () => {
    const records = [...base, rec('n1', '2026-10-25', 8)]
    expect(one(records, [tgt('2026-11', 11)], { work_date: '2026-10-22', hours: 3, replacing_id: 'r1' })[0]).toMatchObject({ period_label: '2026-11', before: 8, after: 11, ok: true })
    expect(one(records, [tgt('2026-11', 10)], { work_date: '2026-10-22', hours: 3, replacing_id: 'r1' })[0].ok).toBe(false)
  })
})

describe('삭제·목표 변경', () => {
  it('12. 삭제는 검사 대상이 아니다(변경 없음 → 결과 없음). 자동확정 삭제 금지는 DB a_protect 트리거 몫', () => {
    expect(checkMonthlyTarget([rec('r1', '2026-10-05', 3)], [], [])).toEqual([])
  })
  it('13. 목표를 기존 합계 아래로 낮춰도 기존 기록은 바꾸지 않는다 — 이후 증가만 막는다', () => {
    const records = [rec('r1', '2026-10-05', 3), rec('r2', '2026-10-06', 3)]
    const snapshot = JSON.stringify(records)
    expect(one(records, [tgt('2026-10', 4)], { work_date: '2026-10-07', hours: 2 })[0].ok).toBe(false)
    expect(JSON.stringify(records)).toBe(snapshot)
    // 목표를 다시 합계 이상으로 올리면 정상
    expect(one(records, [tgt('2026-10', 8)], { work_date: '2026-10-07', hours: 2 })[0].ok).toBe(true)
  })
})

describe('18. 주 12시간과 월 목표가 동시에 걸리는 경우', () => {
  // 주(10/5~10/11)에 이미 10h, 월 합계 10h. 3h 추가 → 주 13h(초과), 월 13h
  const records = [rec('a', '2026-10-05', 5), rec('b', '2026-10-06', 5)]
  const change = { employee_id: E, work_date: '2026-10-07', hours: 3 }
  it('월 목표가 먼저 막는다(검사 순서: 월 목표 → 주 12시간)', () => {
    const month = checkMonthlyTarget(records, [tgt('2026-10', 12)], [change])
    expect(month[0].code).toBe('OVERTIME_MONTHLY_TARGET_EXCEEDED')
    expect(checkWeeklyCap(records, [change])[0].ok).toBe(false)
  })
  it('월 목표는 여유 있어도 주 12시간이 막는다', () => {
    expect(checkMonthlyTarget(records, [tgt('2026-10', 40)], [change])[0].ok).toBe(true)
    expect(checkWeeklyCap(records, [change])[0].ok).toBe(false)
  })
})

describe('문구 — 급여기간·목표·현재·입력 후·초과시간', () => {
  it('초과 문구', () => {
    const [r] = one([rec('a', '2026-10-01', 28)], [tgt('2026-10', 30)], { work_date: '2026-10-05', hours: 3 })
    expect(monthlyCapMessage(r)).toBe('2026-10 급여기간(9/21~10/20) 월 목표 30시간을 넘어 저장할 수 없습니다 — 현재 합계 28시간, 입력 후 31시간 (1시간 초과)')
  })
  it('목표 없음 문구', () => {
    const [r] = one([rec('a', '2026-10-01', 2)], [], { work_date: '2026-10-05', hours: 3 })
    expect(monthlyCapMessage(r)).toContain('2026-10 급여기간(9/21~10/20)의 월 목표시간이 없어')
    expect(monthlyCapMessage(r)).toContain('현재 합계 2시간, 입력 후 5시간')
  })
  it('DB 오류 원문(트리거 형식) → 같은 정보의 한국어 문구, 직원 id 등은 내보내지 않음', () => {
    expect(friendlyOvertimeError('OVERTIME_MONTHLY_TARGET_EXCEEDED: 2026-10 급여기간 목표 30.0시간 / 현재 28.0시간 → 31.0시간 (1.0시간 초과)'))
      .toBe('2026-10 급여기간 월 목표 30시간을 넘어 저장하거나 확정할 수 없습니다 — 현재 합계 28시간, 입력 후 31시간 (1시간 초과)')
    expect(friendlyOvertimeError('OVERTIME_MONTHLY_TARGET_MISSING: 2026-11 급여기간 목표 없음 (현재 0시간 → 3시간)'))
      .toContain('2026-11 급여기간의 월 목표시간이 없어')
    // 확정 RPC 형식(직원 id 포함)은 일반 문구로 — id를 내보내지 않는다
    const rpc = friendlyOvertimeError('OVERTIME_MONTHLY_TARGET_MISSING: 직원 f1000000-0000 월 목표시간 미입력')
    expect(rpc).not.toContain('f1000000')
    expect(friendlyOvertimeError('OVERTIME_MONTHLY_TARGET_EXCEEDED: 형식이 다른 메시지')).toBe('급여기간 월 목표시간을 넘어 저장하거나 확정할 수 없습니다.')
  })
})
