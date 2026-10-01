import { describe, it, expect } from 'vitest'
import { calculateFieldHours, monthWeeks, normalizeEndTime, sumByEmployeeMonth, sumByEmployeeWeek } from './calc'
import { FieldOvertimeRecord } from './types'

const rec = (employee_id: string, work_date: string, hours: number): FieldOvertimeRecord =>
  ({ id: `${employee_id}-${work_date}`, employee_id, work_date, end_time: '', hours, note: '' })

describe('calculateFieldHours', () => {
  it('18:00 시작 · 휴게 1시간 · 1시간 절삭', () => {
    expect(calculateFieldHours('21:00')).toMatchObject({ ok: true, recognized: 2 })
    expect(calculateFieldHours('22:30')).toMatchObject({ ok: true, raw: 3.5, recognized: 3 })
    expect(calculateFieldHours('25:00')).toMatchObject({ ok: true, recognized: 6 })
  })

  it('인정 1시간 미만이면 실패', () => {
    expect(calculateFieldHours('19:30').ok).toBe(false)
    expect(calculateFieldHours('20:00')).toMatchObject({ ok: true, recognized: 1 })
  })

  it('형식 오류', () => {
    expect(calculateFieldHours('abc').ok).toBe(false)
  })
})

describe('normalizeEndTime', () => {
  it('빠른 입력을 HH:mm으로', () => {
    expect(normalizeEndTime('2130')).toBe('21:30')
    expect(normalizeEndTime('21')).toBe('21:00')
    expect(normalizeEndTime('930')).toBe('09:30')
    expect(normalizeEndTime('9:30')).toBe('09:30')
    expect(normalizeEndTime('2190')).toBe('2190')
  })
})

describe('monthWeeks', () => {
  it('2026년 10월 — 1일(목)이 1주차, 월요일 시작', () => {
    const weeks = monthWeeks(2026, 9)
    expect(weeks).toHaveLength(5)
    expect(weeks[0].cells).toEqual([null, null, null, '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'])
    expect(weeks[0].label).toBe('10/1~10/4')
    expect(weeks[4].dates).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31'])
  })

  it('1일이 월요일이면 앞쪽 빈칸 없음 (2026년 6월)', () => {
    expect(monthWeeks(2026, 5)[0].cells[0]).toBe('2026-06-01')
  })
})

describe('집계', () => {
  it('직원별 주차 합계 — 다른 달 기록은 무시', () => {
    const weeks = monthWeeks(2026, 9)
    const map = sumByEmployeeWeek([
      rec('a', '2026-10-01', 2), rec('a', '2026-10-02', 3), rec('a', '2026-10-05', 1),
      rec('b', '2026-10-31', 4), rec('a', '2026-09-30', 9),
    ], weeks)
    expect(map.get('a')).toEqual([5, 1, 0, 0, 0])
    expect(map.get('b')).toEqual([0, 0, 0, 0, 4])
  })

  it('직원별 월 합계 — numeric 문자열도 숫자로', () => {
    const map = sumByEmployeeMonth([rec('a', '2026-01-05', 2), { ...rec('a', '2026-01-06', 0), hours: '3' as unknown as number }, rec('a', '2026-12-01', 1)])
    expect(map.get('a')![0]).toBe(5)
    expect(map.get('a')![11]).toBe(1)
  })
})
