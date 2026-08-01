import { describe, expect, it } from 'vitest'
import { formatStayPeriod, nightsBetween, previewTotalPrice } from './period'

describe('nightsBetween', () => {
  it('2026-08-20 ~ 2026-08-22 → 2박', () => {
    expect(nightsBetween('2026-08-20', '2026-08-22')).toBe(2)
  })
  it('월 경계를 걸쳐도 정확히 계산된다: 2026-01-31 ~ 2026-02-02 → 2박', () => {
    expect(nightsBetween('2026-01-31', '2026-02-02')).toBe(2)
  })
})

describe('formatStayPeriod', () => {
  it('2박이면 "2박3일"', () => {
    expect(formatStayPeriod('2026-08-20', '2026-08-22')).toBe('2박3일')
  })
  it('체크아웃이 체크인보다 빠르거나 같으면 빈 문자열', () => {
    expect(formatStayPeriod('2026-08-20', '2026-08-20')).toBe('')
  })
})

describe('previewTotalPrice', () => {
  it('단가 × 박수 × 객실수', () => {
    expect(previewTotalPrice(88000, 2, 1)).toBe(176000)
    expect(previewTotalPrice(50000, 3, 2)).toBe(300000)
  })
  it('박수 또는 객실수가 0 이하면 0', () => {
    expect(previewTotalPrice(88000, 0, 1)).toBe(0)
    expect(previewTotalPrice(88000, 2, 0)).toBe(0)
  })
})
