import { describe, expect, it } from 'vitest'
import {
  annualMonthLabels,
  annualPeriodRange,
  getPayPeriodForLabel,
  getPayPeriodRangeForLabel,
  labelMonthToFnParam,
} from './period'

describe('labelMonthToFnParam', () => {
  it('converts 1~12 라벨을 payPeriodDays가 요구하는 0-indexed 값으로 변환', () => {
    expect(labelMonthToFnParam(1)).toBe(0)
    expect(labelMonthToFnParam(8)).toBe(7)
    expect(labelMonthToFnParam(12)).toBe(11)
  })
})

describe('getPayPeriodRangeForLabel — 전월 21일~당월 20일', () => {
  it('2026년 8월분 = 2026-07-21~2026-08-20', () => {
    expect(getPayPeriodRangeForLabel(2026, 8)).toEqual({ start: '2026-07-21', end: '2026-08-20' })
  })

  it('2026년 1월분 = 2025-12-21~2026-01-20 (연도 경계)', () => {
    expect(getPayPeriodRangeForLabel(2026, 1)).toEqual({ start: '2025-12-21', end: '2026-01-20' })
  })

  it('2026년 12월분 = 2026-11-21~2026-12-20', () => {
    expect(getPayPeriodRangeForLabel(2026, 12)).toEqual({ start: '2026-11-21', end: '2026-12-20' })
  })

  it('2월분은 말일이 28일이든 29일이든 정확히 20일에서 끝난다(윤년과 무관)', () => {
    // 2028년은 윤년(2월 29일까지 있음)이지만 회계월 경계는 매월 20일 고정이라 영향이 없어야 한다.
    expect(getPayPeriodRangeForLabel(2028, 2)).toEqual({ start: '2028-01-21', end: '2028-02-20' })
    expect(getPayPeriodRangeForLabel(2027, 2)).toEqual({ start: '2027-01-21', end: '2027-02-20' })
  })
})

describe('getPayPeriodForLabel — 윤년 포함 날짜 누락 없음', () => {
  it('2028년 3월분(2028-02-21~2028-03-20)은 2월 29일을 포함해 날짜 누락이 없다', () => {
    const days = getPayPeriodForLabel(2028, 3)
    const dateStrs = days.map(d => d.dateStr)
    expect(dateStrs).toContain('2028-02-29')
    expect(dateStrs[0]).toBe('2028-02-21')
    expect(dateStrs[dateStrs.length - 1]).toBe('2028-03-20')
    // 2/21~2/29(9일) + 3/1~3/20(20일) = 29일
    expect(days).toHaveLength(29)
  })

  it('월말 31일 달(1월)에서 12/21~1/20 구간 일수가 정확히 31일', () => {
    const days = getPayPeriodForLabel(2026, 1)
    expect(days).toHaveLength(31)
  })

  it('월말 30일 달(4월)에서 3/21~4/20 구간 일수가 정확히 31일(3월 21~31=11일 + 4월 1~20=20일)', () => {
    const days = getPayPeriodForLabel(2026, 4)
    expect(days).toHaveLength(31)
  })
})

describe('annualPeriodRange — 연간 통합 기간(사용자 확정: 12/31까지 확장하지 않음)', () => {
  it('2026년 연간기간 = 2025-12-21~2026-12-20', () => {
    expect(annualPeriodRange(2026)).toEqual({ start: '2025-12-21', end: '2026-12-20' })
  })

  it('연도가 바뀌어도 항상 전년도 12/21에서 시작한다', () => {
    expect(annualPeriodRange(2027).start).toBe('2026-12-21')
    expect(annualPeriodRange(2030).start).toBe('2029-12-21')
  })
})

describe('annualMonthLabels', () => {
  it('해당 연도의 12개 회계월 라벨(1~12)을 순서대로 반환한다', () => {
    const labels = annualMonthLabels(2026)
    expect(labels).toHaveLength(12)
    expect(labels[0]).toEqual({ year: 2026, periodMonth: 1 })
    expect(labels[11]).toEqual({ year: 2026, periodMonth: 12 })
  })

  it('12개 라벨의 기간을 이어붙이면 annualPeriodRange와 정확히 일치한다', () => {
    const labels = annualMonthLabels(2026)
    const first = getPayPeriodRangeForLabel(labels[0].year, labels[0].periodMonth)
    const last = getPayPeriodRangeForLabel(labels[11].year, labels[11].periodMonth)
    const annual = annualPeriodRange(2026)
    expect(first.start).toBe(annual.start)
    expect(last.end).toBe(annual.end)
  })
})
