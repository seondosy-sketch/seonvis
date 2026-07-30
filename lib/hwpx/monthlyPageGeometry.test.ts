import { describe, it, expect } from 'vitest'
import {
  resolveMonthlyPageGeometry, MonthlyPageGeometryError,
  MONTHLY_EXPECTED_PAGE_WIDTH, MONTHLY_EXPECTED_PAGE_HEIGHT, MONTHLY_EXPECTED_USABLE_HEIGHT,
} from './monthlyPageGeometry'

// montly.hwpx 실측: pagePr width=59528 height=84188 landscape="NARROWLY",
// margin top 2835 / bottom 1417 / left 2835 / right 2835 / header 0 / footer 0
const REAL = {
  widthAttr: 59528,
  heightAttr: 84188,
  landscape: 'NARROWLY',
  topMargin: 2835,
  bottomMargin: 1417,
  leftMargin: 2835,
  rightMargin: 2835,
  headerMargin: 0,
  footerMargin: 0,
}

describe('resolveMonthlyPageGeometry — A4 가로 계약', () => {
  it('가로 방향이므로 width/height 속성이 인쇄 기준과 뒤바뀐다', () => {
    const g = resolveMonthlyPageGeometry(REAL)
    expect(g.pageWidth).toBe(84188)
    expect(g.pageHeight).toBe(59528)
    expect(g.pageWidth).toBe(MONTHLY_EXPECTED_PAGE_WIDTH)
    expect(g.pageHeight).toBe(MONTHLY_EXPECTED_PAGE_HEIGHT)
  })

  it('usableHeight = 55,276 (세로 높이로 계산한 79,936이 아니다)', () => {
    const g = resolveMonthlyPageGeometry(REAL)
    expect(g.usableHeight).toBe(59528 - 2835 - 1417)
    expect(g.usableHeight).toBe(55276)
    expect(g.usableHeight).toBe(MONTHLY_EXPECTED_USABLE_HEIGHT)
    // 옛 오류값이 되살아나지 않게 잠근다.
    expect(g.usableHeight).not.toBe(79936)
  })

  it('usableWidth는 표 폭 78,248을 담을 수 있다', () => {
    const g = resolveMonthlyPageGeometry(REAL)
    expect(g.usableWidth).toBe(84188 - 2835 - 2835)
    expect(g.usableWidth).toBe(78518)
    expect(g.usableWidth).toBeGreaterThanOrEqual(78248)
  })

  it('가로 방향이 아니면 계약 실패', () => {
    for (const landscape of [null, '', 'PORTRAIT', 'NARROW']) {
      expect(() => resolveMonthlyPageGeometry({ ...REAL, landscape }))
        .toThrowError(MonthlyPageGeometryError)
      try {
        resolveMonthlyPageGeometry({ ...REAL, landscape })
      } catch (e) {
        expect((e as MonthlyPageGeometryError).code).toBe('NOT_LANDSCAPE')
      }
    }
  })

  it('WIDELY도 가로 방향으로 받아들인다', () => {
    expect(resolveMonthlyPageGeometry({ ...REAL, landscape: 'WIDELY' }).usableHeight).toBe(55276)
  })

  it('용지 크기가 A4가 아니면 계약 실패', () => {
    try {
      resolveMonthlyPageGeometry({ ...REAL, widthAttr: 50000 })
      expect.unreachable()
    } catch (e) {
      expect((e as MonthlyPageGeometryError).code).toBe('UNEXPECTED_PAGE_SIZE')
    }
  })

  it('여백이 바뀌어 usableHeight가 달라지면 계약 실패', () => {
    try {
      resolveMonthlyPageGeometry({ ...REAL, topMargin: 2000 })
      expect.unreachable()
    } catch (e) {
      expect((e as MonthlyPageGeometryError).code).toBe('UNEXPECTED_USABLE_HEIGHT')
    }
  })

  it('머리말·꼬리말 여백도 usableHeight에서 빠진다', () => {
    try {
      resolveMonthlyPageGeometry({ ...REAL, headerMargin: 500 })
      expect.unreachable()
    } catch (e) {
      expect((e as MonthlyPageGeometryError).code).toBe('UNEXPECTED_USABLE_HEIGHT')
    }
  })

  it('치수가 정수가 아니거나 음수면 계약 실패', () => {
    for (const patch of [{ widthAttr: -1 }, { heightAttr: 1.5 }, { topMargin: -10 }]) {
      expect(() => resolveMonthlyPageGeometry({ ...REAL, ...patch }))
        .toThrowError(MonthlyPageGeometryError)
    }
  })
})
