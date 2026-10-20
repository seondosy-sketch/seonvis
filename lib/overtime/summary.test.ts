import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  currentPayPeriod,
  formatHours,
  payPeriodDays,
  payPeriodRange,
  sumHoursByDate,
  sumHoursByEmployee,
  sumHoursByProject,
  summarizeByEmployeeAndDate,
  summaryKey,
} from './summary'
import type { Employee, Project, WorkRecord } from './types'

/**
 * 연장근무(제안서팀) 급여기간·집계 골든 테스트.
 * "한 달" = 전달 21일 ~ 이번달 20일(양 끝 포함), 합계 = 저장된 hours의 단순 합.
 * 자동배정 개편 전후로 이 기준은 바뀌면 안 된다 — time.test.ts와 같은 이유.
 */

describe('payPeriodDays / payPeriodRange — 전달 21일 ~ 이번달 20일', () => {
  it('7월(month=6) = 2026-06-21 ~ 2026-07-20, 30일', () => {
    const days = payPeriodDays(2026, 6)
    expect(days[0]).toEqual({ year: 2026, month: 5, day: 21, dateStr: '2026-06-21' })
    expect(days[days.length - 1]).toEqual({ year: 2026, month: 6, day: 20, dateStr: '2026-07-20' })
    expect(days).toHaveLength(30)
    expect(payPeriodRange(2026, 6)).toEqual({ start: '2026-06-21', end: '2026-07-20' })
  })

  it('1월(month=0)은 전년도 12/21부터 — 연도 경계', () => {
    expect(payPeriodRange(2026, 0)).toEqual({ start: '2025-12-21', end: '2026-01-20' })
    expect(payPeriodDays(2026, 0)).toHaveLength(31)
  })

  it('3월분은 2월 말일을 빠짐없이 포함한다 (평년 28일, 윤년 29일)', () => {
    const common = payPeriodDays(2027, 2)
    expect(common).toHaveLength(28)
    expect(common.map(d => d.dateStr)).toContain('2027-02-28')
    expect(common.map(d => d.dateStr)).not.toContain('2027-02-29')

    const leap = payPeriodDays(2028, 2)
    expect(leap).toHaveLength(29)
    expect(leap.map(d => d.dateStr)).toContain('2028-02-29')
  })

  it('날짜가 하루씩 연속이고 중복이 없다 (1년 12기간이 빈틈없이 이어진다)', () => {
    const all = Array.from({ length: 12 }, (_, m) => payPeriodDays(2026, m)).flat().map(d => d.dateStr)
    expect(new Set(all).size).toBe(all.length)
    expect(all[0]).toBe('2025-12-21')
    expect(all[all.length - 1]).toBe('2026-12-20')
    expect(all).toHaveLength(365)
  })
})

describe('currentPayPeriod — 21일부터 다음 달 라벨', () => {
  afterEach(() => { vi.useRealTimers() })
  const at = (y: number, m0: number, d: number) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(y, m0, d, 12, 0, 0))
    return currentPayPeriod()
  }

  it('20일은 이번 달 라벨', () => { expect(at(2026, 9, 20)).toEqual({ year: 2026, month: 9 }) })
  it('21일은 다음 달 라벨', () => { expect(at(2026, 9, 21)).toEqual({ year: 2026, month: 10 }) })
  it('12월 21일은 다음 해 1월 라벨', () => { expect(at(2026, 11, 21)).toEqual({ year: 2027, month: 0 }) })
  it('1일은 이번 달 라벨', () => { expect(at(2026, 0, 1)).toEqual({ year: 2026, month: 0 }) })
})

const rec = (id: string, employee_id: string, project_id: string, work_date: string, hours: number): WorkRecord => ({
  id, employee_id, project_id, work_date, hours,
  task_description: '', start_time: '18:00', end_time: '21:00', break_hours: null, note: '', created_at: '',
})

describe('summarizeByEmployeeAndDate — 직원×날짜 합계·건수', () => {
  it('같은 직원·같은 날의 여러 기록을 합산하고 건수를 센다', () => {
    const map = summarizeByEmployeeAndDate([
      rec('1', 'e1', 'p1', '2026-07-03', 2),
      rec('2', 'e1', 'p2', '2026-07-03', 1.5),
      rec('3', 'e1', 'p1', '2026-07-04', 3),
      rec('4', 'e2', 'p1', '2026-07-03', 2),
    ])
    expect(map.size).toBe(3)
    const s = map.get(summaryKey('e1', '2026-07-03'))!
    expect(s.total_hours).toBe(3.5)
    expect(s.record_count).toBe(2)
    expect(s.records.map(r => r.id)).toEqual(['1', '2'])
    expect(map.get(summaryKey('e2', '2026-07-03'))!.total_hours).toBe(2)
  })

  it('summaryKey 형식', () => { expect(summaryKey('e1', '2026-07-03')).toBe('e1__2026-07-03') })
})

describe('formatHours — 소수 둘째 자리 반올림 후, 정수면 "6h", 아니면 소수 한 자리', () => {
  it.each([
    [6, '6h'],
    [6.5, '6.5h'],
    [0, '0h'],
    [1.33, '1.3h'],
    [0.67, '0.7h'],
    [0.1 + 0.2, '0.3h'],   // 부동소수 누적 오차
    [2.999, '3h'],          // 반올림하면 정수
  ])('%s → %s', (hours, expected) => {
    expect(formatHours(hours)).toBe(expected)
  })
})

describe('sumHoursByEmployee / sumHoursByProject / sumHoursByDate — 단순 합, 큰 순 정렬', () => {
  const employees = [{ id: 'e1', name: '갑' }, { id: 'e2', name: '을' }] as Employee[]
  const projects = [{ id: 'p1', name: 'A' }] as Project[]
  const records = [
    rec('1', 'e1', 'p1', '2026-07-03', 2),
    rec('2', 'e2', 'p1', '2026-07-03', 3),
    rec('3', 'e2', 'p9', '2026-07-04', 1.5),
    rec('4', 'e9', 'p1', '2026-07-04', 2),
  ]

  it('직원별 — 시간 큰 순, 목록에 없는 직원은 "(알 수 없음)"', () => {
    expect(sumHoursByEmployee(records, employees)).toEqual([
      { id: 'e2', label: '을', hours: 4.5 },
      { id: 'e1', label: '갑', hours: 2 },
      { id: 'e9', label: '(알 수 없음)', hours: 2 },
    ])
  })

  it('프로젝트별', () => {
    expect(sumHoursByProject(records, projects)).toEqual([
      { id: 'p1', label: 'A', hours: 7 },
      { id: 'p9', label: '(알 수 없음)', hours: 1.5 },
    ])
  })

  it('날짜별 — 기록 없는 날은 맵에 없다', () => {
    const m = sumHoursByDate(records)
    expect(m.get('2026-07-03')).toBe(5)
    expect(m.get('2026-07-04')).toBe(3.5)
    expect(m.has('2026-07-05')).toBe(false)
  })

  it('세 집계의 총합은 기록 hours 합과 같다', () => {
    const total = records.reduce((s, r) => s + r.hours, 0)
    const sum = (xs: { hours: number }[]) => xs.reduce((s, x) => s + x.hours, 0)
    expect(sum(sumHoursByEmployee(records, employees))).toBe(total)
    expect(sum(sumHoursByProject(records, projects))).toBe(total)
    expect([...sumHoursByDate(records).values()].reduce((a, b) => a + b, 0)).toBe(total)
  })
})
