import { describe, expect, it } from 'vitest'
import { toPayPeriodLabel } from './planningTypes'
import { payPeriodRange } from './summary'

/**
 * DB(private.overtime_pay_period)는 라벨 'YYYY-MM'을 "전월 21일 ~ 당월 20일"로 바꾼다.
 * 그 SQL과 같은 산식을 여기 옮겨 기존 급여기간(payPeriodRange)과 4년치가 일치하는지 확인한다 —
 * 두 규칙이 갈라지면 월 목표·확정 검증이 화면과 다른 기간을 보게 된다.
 */
function sqlPayPeriod(label: string): { start: string; end: string } {
  // SQL: m := make_date(y, mo, 1); start := (m - interval '1 month')::date + 20; end := m + 19
  const [y, mo] = label.split('-').map(Number)
  const prev = new Date(y, mo - 2, 1)
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return { start: fmt(new Date(prev.getFullYear(), prev.getMonth(), 1 + 20)), end: fmt(new Date(y, mo - 1, 1 + 19)) }
}

describe('toPayPeriodLabel', () => {
  it('payPeriodDays 인자(month0) → YYYY-MM', () => {
    expect(toPayPeriodLabel(2026, 9)).toBe('2026-10')
    expect(toPayPeriodLabel(2026, 0)).toBe('2026-01')
    expect(toPayPeriodLabel(2026, 11)).toBe('2026-12')
  })
})

describe('DB 급여기간 산식 = 기존 payPeriodRange', () => {
  it('2025~2028 48개월 전부 일치', () => {
    for (let year = 2025; year <= 2028; year++) {
      for (let m0 = 0; m0 < 12; m0++) {
        expect(sqlPayPeriod(toPayPeriodLabel(year, m0))).toEqual(payPeriodRange(year, m0))
      }
    }
  })
  it('예: 2026-10 = 2026-09-21 ~ 2026-10-20, 2026-01 = 2025-12-21 ~ 2026-01-20', () => {
    expect(sqlPayPeriod('2026-10')).toEqual({ start: '2026-09-21', end: '2026-10-20' })
    expect(sqlPayPeriod('2026-01')).toEqual({ start: '2025-12-21', end: '2026-01-20' })
  })
})
