import { describe, it, expect } from 'vitest'
import {
  estimateMonthlyPageBudget,
  type MonthlyPageBudgetInput,
  MONTHLY_RENDER_SAFETY_RESERVE,
  MONTHLY_RENDER_SAFETY_RESERVE_CONFIRMED,
  MONTHLY_ABSOLUTE_MAX_PROJECT_COUNT,
  MONTHLY_RESERVE_CALIBRATION_SAMPLES,
} from './monthlyPageBudget'

// 실측값(lib/templates/montly.hwpx, 직접 확인) — Sprint M1 Rev.2 12번 항목과 동일
const REAL_INPUT: Omit<MonthlyPageBudgetInput, 'projectRowCount'> = {
  // A4 가로 — 실제 인쇄 기준. hp:pagePr의 width/height 속성과 뒤바뀐다.
  usableHeight: 55276,
  pageWidth: 84188,
  pageHeight: 59528,
  topMargin: 2835,
  bottomMargin: 1417,
  fixedContentHeight: 4604, // 제목 2300 + 빈 문단 1152 + 1152
  projectHeaderHeight: 2502,
  projectRowHeight: 1818,
  calendarHeight: 25014, // 1680 + 7778*3
  objectMargins: 848, // (283+283) + (141+141)
  calendarVertOffset: 474,
  renderSafetyReserve: MONTHLY_RENDER_SAFETY_RESERVE,
}

describe('estimateMonthlyPageBudget', () => {
  it('usableHeight는 입력값(A4 가로 실측 55,276)을 그대로 쓴다', () => {
    const result = estimateMonthlyPageBudget({ ...REAL_INPUT, projectRowCount: 10 })
    expect(result.usableHeight).toBe(55276)
    // 세로 높이(84,188)로 계산하던 옛 값이 되살아나지 않게 잠근다.
    expect(result.usableHeight).not.toBe(79936)
    expect(result.pageWidth).toBe(84188)
    expect(result.pageHeight).toBe(59528)
  })

  it('선언 행 높이 기준 10행은 예산 안에 든다', () => {
    const result = estimateMonthlyPageBudget({ ...REAL_INPUT, projectRowCount: 10 })
    expect(result.fits).toBe(true)
  })

  it('행 수가 0이어도 최소 1행분(빈 행) 높이는 예산에 포함된다', () => {
    const zero = estimateMonthlyPageBudget({ ...REAL_INPUT, projectRowCount: 0 })
    const one = estimateMonthlyPageBudget({ ...REAL_INPUT, projectRowCount: 1 })
    expect(zero.requiredHeight).toBe(one.requiredHeight)
    expect(zero.projectRowsHeight).toBe(one.projectRowsHeight)
  })

  it('진단값 각 항목의 합이 requiredHeight와 정확히 일치한다', () => {
    const result = estimateMonthlyPageBudget({ ...REAL_INPUT, projectRowCount: 5 })
    const sum =
      result.fixedContentHeight +
      result.projectHeight +
      result.calendarHeight +
      result.objectMargins +
      result.calendarVertOffset +
      result.renderSafetyReserve
    expect(sum).toBe(result.requiredHeight)
    expect(result.projectHeight).toBe(result.projectHeaderHeight + result.projectRowsHeight)
  })

  it('overflowHeight는 requiredHeight - usableHeight와 정확히 같다', () => {
    const result = estimateMonthlyPageBudget({ ...REAL_INPUT, projectRowCount: 30 })
    expect(result.overflowHeight).toBe(result.requiredHeight - result.usableHeight)
  })

  it('프로젝트 행 수가 늘어날수록 필요 높이가 커지고, 결국 예산을 초과한다', () => {
    const small = estimateMonthlyPageBudget({ ...REAL_INPUT, projectRowCount: 1 })
    const large = estimateMonthlyPageBudget({ ...REAL_INPUT, projectRowCount: 40 })
    expect(large.requiredHeight).toBeGreaterThan(small.requiredHeight)
    expect(large.fits).toBe(false)
  })

  it('renderSafetyReserve가 커질수록 fits 판정이 더 엄격해진다(같은 행 수에서)', () => {
    const withReserve = estimateMonthlyPageBudget({ ...REAL_INPUT, projectRowCount: 11, renderSafetyReserve: 0 })
    const withMoreReserve = estimateMonthlyPageBudget({ ...REAL_INPUT, projectRowCount: 11, renderSafetyReserve: 100000 })
    expect(withMoreReserve.requiredHeight).toBeGreaterThan(withReserve.requiredHeight)
    expect(withMoreReserve.fits).toBe(false)
  })
})

// ── 한글 실측으로 재보정한 값 고정 ──────────────────────────────────────────────
//
// 이전 값(reserve 3000 / 최대 23건)은 usableHeight를 세로 용지 높이(79,936)로 잘못 계산한
// 상태에서 정한 것이라 근거가 무효였다. A4 가로 실제 사용 가능 높이(55,276)로 바로잡고
// 0/5/10/11/12/13/20/23건을 한글 COM으로 생성·렌더해 재측정한 결과로 다시 정했다.
// MONTHLY_RESERVE_CALIBRATION_SAMPLES에 그 실측 표본이 그대로 들어 있다.
describe('재보정된 renderSafetyReserve / 프로젝트 수 정책', () => {
  it('renderSafetyReserve는 500으로 재확정되었고 확정 플래그가 true다', () => {
    expect(MONTHLY_RENDER_SAFETY_RESERVE).toBe(500)
    expect(MONTHLY_RENDER_SAFETY_RESERVE_CONFIRMED).toBe(true)
    // 잘못된 usableHeight 전제로 정했던 옛 값이 되살아나지 않게 잠근다.
    expect(MONTHLY_RENDER_SAFETY_RESERVE).not.toBe(3000)
  })

  it('안전여유는 실측 최대 오차(499)를 덮는 최소 보수값이다', () => {
    const errors = MONTHLY_RESERVE_CALIBRATION_SAMPLES
      .filter((s) => s.actualOccupied != null)
      .map((s) => s.computedWithoutReserve - (s.actualOccupied as number))
    // 계산값은 항상 실제보다 크다(안전한 방향) — 음수 오차가 있으면 모델이 위험하다.
    expect(Math.min(...errors)).toBeGreaterThan(0)
    expect(Math.max(...errors)).toBe(499)
    expect(MONTHLY_RENDER_SAFETY_RESERVE).toBeGreaterThanOrEqual(Math.max(...errors))
    // 500 미만으로 낮추면 실측 오차를 못 덮고, 크게 올리면 10건을 차단한다.
    expect(MONTHLY_RENDER_SAFETY_RESERVE).toBeLessThan(1662)
  })

  it('실측 표본의 계산값이 현재 모델과 일치한다(모델이 바뀌면 실패)', () => {
    const FIXED = 4604 + 2502 + 25014 + 848 + 474 // 제목·기준일·빈문단 + 표 헤더 + 달력 + 여백 + 오프셋
    for (const s of MONTHLY_RESERVE_CALIBRATION_SAMPLES) {
      const rowsHeight = s.computedWithoutReserve - FIXED
      const result = estimateMonthlyPageBudget({
        ...REAL_INPUT, projectRowCount: Math.max(s.projectCount, 1),
        estimatedProjectRowsHeight: rowsHeight, renderSafetyReserve: 0,
      })
      expect(result.requiredHeight, `${s.projectCount}건`).toBe(s.computedWithoutReserve)
    }
  })

  it('10건은 통과하고 12건 이상은 차단된다(실측 PageCount와 일치)', () => {
    const FIXED = 4604 + 2502 + 25014 + 848 + 474
    for (const s of MONTHLY_RESERVE_CALIBRATION_SAMPLES) {
      const result = estimateMonthlyPageBudget({
        ...REAL_INPUT, projectRowCount: Math.max(s.projectCount, 1),
        estimatedProjectRowsHeight: s.computedWithoutReserve - FIXED,
      })
      if (s.pageCount === 1 && s.projectCount <= 10) {
        expect(result.fits, `${s.projectCount}건은 통과해야 한다`).toBe(true)
      }
      if (s.pageCount >= 2) {
        expect(result.fits, `${s.projectCount}건은 차단해야 한다`).toBe(false)
      }
    }
  })

  it('안전여유 경계 ±1 — 10건 기준 통과/차단이 정확히 갈린다', () => {
    const FIXED = 4604 + 2502 + 25014 + 848 + 474
    const rowsAt10 = 53614 - FIXED // 20,172
    const limit = 55276 - FIXED - rowsAt10 // 10건에서 허용되는 최대 reserve = 1,662
    const at = (reserve: number) => estimateMonthlyPageBudget({
      ...REAL_INPUT, projectRowCount: 10,
      estimatedProjectRowsHeight: rowsAt10, renderSafetyReserve: reserve,
    })
    expect(limit).toBe(1662)
    expect(at(limit).fits).toBe(true)
    expect(at(limit).overflowHeight).toBe(0)
    expect(at(limit + 1).fits).toBe(false)
    expect(at(limit + 1).overflowHeight).toBe(1)
    expect(at(MONTHLY_RENDER_SAFETY_RESERVE).fits).toBe(true)
  })

  it('프로젝트 수 상한은 성능 보호용 절대 상한이며 예산이 1차 판단이다', () => {
    expect(MONTHLY_ABSOLUTE_MAX_PROJECT_COUNT).toBe(100)
    // 옛 "검증된 최대 건수" 23이 되살아나지 않게 잠근다.
    expect(MONTHLY_ABSOLUTE_MAX_PROJECT_COUNT).not.toBe(23)
    // 절대 상한에 닿기 전에 예산이 먼저 차단한다.
    const atAbsolute = estimateMonthlyPageBudget({
      ...REAL_INPUT, projectRowCount: MONTHLY_ABSOLUTE_MAX_PROJECT_COUNT,
    })
    expect(atAbsolute.fits).toBe(false)
  })

  it('달력 예상 높이를 주면 선언 높이보다 큰 값이 쓰이고, 작은 값은 무시된다', () => {
    const bigger = estimateMonthlyPageBudget({
      ...REAL_INPUT, projectRowCount: 5, estimatedCalendarHeight: 27148,
    })
    expect(bigger.calendarHeight).toBe(27148)
    expect(bigger.declaredCalendarHeight).toBe(25014)

    const smaller = estimateMonthlyPageBudget({
      ...REAL_INPUT, projectRowCount: 5, estimatedCalendarHeight: 100,
    })
    expect(smaller.calendarHeight).toBe(25014)
  })
})
