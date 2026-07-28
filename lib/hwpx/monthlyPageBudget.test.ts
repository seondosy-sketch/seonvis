import { describe, it, expect } from 'vitest'
import {
  estimateMonthlyPageBudget,
  type MonthlyPageBudgetInput,
  MONTHLY_RENDER_SAFETY_RESERVE,
  MONTHLY_RENDER_SAFETY_RESERVE_CONFIRMED,
  MONTHLY_VERIFIED_MAX_PROJECT_COUNT,
} from './monthlyPageBudget'

// 실측값(lib/templates/montly.hwpx, 직접 확인) — Sprint M1 Rev.2 12번 항목과 동일
const REAL_INPUT: Omit<MonthlyPageBudgetInput, 'projectRowCount'> = {
  pageHeight: 84188,
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
  it('usableHeight는 pageHeight - topMargin - bottomMargin이다(실측: 79936)', () => {
    const result = estimateMonthlyPageBudget({ ...REAL_INPUT, projectRowCount: 11 })
    expect(result.usableHeight).toBe(84188 - 2835 - 1417)
    expect(result.usableHeight).toBe(79936)
  })

  it('현재 템플릿 원래 용량(11행)은 예산 안에 든다', () => {
    const result = estimateMonthlyPageBudget({ ...REAL_INPUT, projectRowCount: 11 })
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

// ── 수동 한글 검증으로 확정된 값 고정 ────────────────────────────────────────────────
//
// 근거: renderSafetyReserve=3000으로 생성한 manual-review/monthly-dynamic-{0,13,20,23}.hwpx를
// 한글에서 직접 열어 "정상 열림 / 한 페이지 유지 / 달력 전체가 같은 페이지에 유지 / 프로젝트
// 누락 없음 / 입력 순서 정상 / 표 테두리·열 너비 정상 / 제목·기준일 정상 / 저장 후 재오픈 정상"
// 을 모두 확인했다. 특히 잔여 높이가 1680뿐인 23건에서도 달력이 같은 페이지에 유지됐다.
// 이 테스트는 그 확정 결과가 실수로 되돌아가는 것을 막는 잠금 장치다.
describe('확정된 renderSafetyReserve / 최대 프로젝트 수', () => {
  it('renderSafetyReserve는 3000으로 확정되었고 확정 플래그가 true다', () => {
    expect(MONTHLY_RENDER_SAFETY_RESERVE).toBe(3000)
    expect(MONTHLY_RENDER_SAFETY_RESERVE_CONFIRMED).toBe(true)
  })

  it('검증된 최대 프로젝트 수는 23건이다', () => {
    expect(MONTHLY_VERIFIED_MAX_PROJECT_COUNT).toBe(23)
  })

  it('확정값 기준으로 23건은 예산에 들고(잔여 1680), 24건은 초과한다(초과 138)', () => {
    const at23 = estimateMonthlyPageBudget({ ...REAL_INPUT, projectRowCount: MONTHLY_VERIFIED_MAX_PROJECT_COUNT })
    expect(at23.fits).toBe(true)
    expect(at23.requiredHeight).toBe(78256)
    expect(at23.usableHeight).toBe(79936)
    expect(at23.overflowHeight).toBe(-1680)

    const at24 = estimateMonthlyPageBudget({ ...REAL_INPUT, projectRowCount: MONTHLY_VERIFIED_MAX_PROJECT_COUNT + 1 })
    expect(at24.fits).toBe(false)
    expect(at24.requiredHeight).toBe(80074)
    expect(at24.overflowHeight).toBe(138)
  })

  it('수동으로 정상 확인한 0/13/20/23건은 모두 예산에 든다', () => {
    for (const n of [0, 13, 20, 23]) {
      expect(estimateMonthlyPageBudget({ ...REAL_INPUT, projectRowCount: n }).fits).toBe(true)
    }
  })
})
