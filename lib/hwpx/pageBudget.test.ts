import { describe, it, expect } from 'vitest'
import { estimateWeeklyPageBudget, type WeeklyPageBudgetInput } from './pageBudget'

const baseInput: WeeklyPageBudgetInput = {
  usableHeight: 74268,
  fixedContentHeight: 21460, // 교육참가자 줄 제외한 나머지 고정 콘텐츠
  eduLineHeight: 1600,
  eduLineCount: 1, // 책임 줄만
  perfHeaderHeight: 3664,
  perfGaeyalMiddleRowHeight: 3259,
  perfGaeyalLastRowHeight: 3259,
  perfGaeyalRowCount: 1,
  perfJinhaengRowHeight: 3259,
  perfJinhaengRowCount: 1,
  expHeaderHeight: 3098,
  expRowHeight: 1992,
  expRowCount: 1,
}

describe('estimateWeeklyPageBudget', () => {
  it('입력이 적을 때는 예산 안에 든다', () => {
    const result = estimateWeeklyPageBudget(baseInput)
    expect(result.fitsHeightBudget).toBe(true)
    expect(result.requiredHeight).toBeLessThanOrEqual(result.usableHeight)
  })

  it('경계값 — requiredHeight가 usableHeight와 정확히 같으면 예산 안에 든다(포함 경계)', () => {
    const probe = estimateWeeklyPageBudget(baseInput)
    const input: WeeklyPageBudgetInput = {
      ...baseInput,
      usableHeight: probe.requiredHeight, // 정확히 같게 맞춤
    }
    const result = estimateWeeklyPageBudget(input)
    expect(result.requiredHeight).toBe(result.usableHeight)
    expect(result.fitsHeightBudget).toBe(true)
  })

  it('경계값 — requiredHeight가 usableHeight를 1이라도 넘으면 초과로 판정한다', () => {
    const probe = estimateWeeklyPageBudget(baseInput)
    const input: WeeklyPageBudgetInput = {
      ...baseInput,
      usableHeight: probe.requiredHeight - 1,
    }
    const result = estimateWeeklyPageBudget(input)
    expect(result.fitsHeightBudget).toBe(false)
  })

  it('개찰·진행중·발주예상 행 수가 늘어날수록 필요 높이가 커진다', () => {
    const small = estimateWeeklyPageBudget(baseInput)
    const large = estimateWeeklyPageBudget({
      ...baseInput,
      perfGaeyalRowCount: 4,
      perfJinhaengRowCount: 6,
      expRowCount: 4,
      eduLineCount: 4, // 책임 + 분야별 3개
    })
    expect(large.requiredHeight).toBeGreaterThan(small.requiredHeight)
  })

  it('행 수가 0이어도 최소 1행분(빈 행) 높이는 예산에 포함된다', () => {
    const zero = estimateWeeklyPageBudget({ ...baseInput, perfGaeyalRowCount: 0 })
    const one = estimateWeeklyPageBudget({ ...baseInput, perfGaeyalRowCount: 1 })
    expect(zero.requiredHeight).toBe(one.requiredHeight)
  })

  it('충분히 큰 입력은 예산을 초과한다', () => {
    const result = estimateWeeklyPageBudget({
      ...baseInput,
      perfGaeyalRowCount: 30,
      perfJinhaengRowCount: 30,
      expRowCount: 30,
    })
    expect(result.fitsHeightBudget).toBe(false)
  })

  it('진단용 세부 내역(각 구성 요소별 높이)이 requiredHeight와 정확히 합산 일치한다', () => {
    const result = estimateWeeklyPageBudget({
      ...baseInput,
      perfGaeyalRowCount: 3,
      perfJinhaengRowCount: 4,
      expRowCount: 2,
      eduLineCount: 3,
    })
    const sum =
      result.fixedContentHeight +
      result.educationHeight +
      result.performingHeaderHeight +
      result.gaeyalRowsHeight +
      result.jinhaengRowsHeight +
      result.expectedHeaderHeight +
      result.expectedRowsHeight
    expect(sum).toBe(result.requiredHeight)
  })

  it('overflowHeight는 requiredHeight - usableHeight와 정확히 같다(초과 시 양수, 여유 시 음수)', () => {
    const over = estimateWeeklyPageBudget({ ...baseInput, perfGaeyalRowCount: 30, perfJinhaengRowCount: 30, expRowCount: 30 })
    expect(over.overflowHeight).toBe(over.requiredHeight - over.usableHeight)
    expect(over.overflowHeight).toBeGreaterThan(0)

    const under = estimateWeeklyPageBudget(baseInput)
    expect(under.overflowHeight).toBe(under.requiredHeight - under.usableHeight)
    expect(under.overflowHeight).toBeLessThanOrEqual(0)
  })
})
