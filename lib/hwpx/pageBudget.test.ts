import { describe, it, expect } from 'vitest'
import { estimateWeeklyPageBudget, type WeeklyPageBudgetInput } from './pageBudget'

const baseInput: WeeklyPageBudgetInput = {
  usableHeightPerPage: 74268,
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
  // 이 기본 입력은 공식 산술을 검증하기 위한 것이라, 2줄 필요 높이를 선언 높이와 같게 두어
  // effectiveExpectedRowHeight = 선언 높이가 되게 한다(자동 확장 없는 상태).
  expectedRowTwoLineHeight: 1992,
  expRowCount: 1,
  // 표 wrapper 오버헤드 실측값(weekly.hwpx) — 수행표 282+720, 발주예상표 566+720
  performingOutMargins: 282,
  expectedOutMargins: 566,
  performingWrapperSpacing: 720,
  expectedWrapperSpacing: 720,
  // 표 밖 마지막 문단("4) 기 타")의 줄 아래 여백 — 페이지 적합 판정에서 제외되는 값
  trailingParagraphSpacing: 720,
}

describe('estimateWeeklyPageBudget', () => {
  it('입력이 적을 때는 1페이지에 든다', () => {
    const result = estimateWeeklyPageBudget(baseInput)
    expect(result.fitsSinglePage).toBe(true)
    expect(result.requiredHeight).toBeLessThanOrEqual(result.usableHeightPerPage)
  })

  it('경계값 — contentBottom이 페이지 높이와 정확히 같으면 1페이지다(포함 경계)', () => {
    const probe = estimateWeeklyPageBudget(baseInput)
    const result = estimateWeeklyPageBudget({ ...baseInput, usableHeightPerPage: probe.contentBottom })
    expect(result.contentBottom).toBe(result.usableHeightPerPage)
    expect(result.fitsSinglePage).toBe(true)
  })

  it('경계값 — contentBottom이 페이지 높이를 1이라도 넘으면 2페이지로 판정한다', () => {
    const probe = estimateWeeklyPageBudget(baseInput)
    const result = estimateWeeklyPageBudget({ ...baseInput, usableHeightPerPage: probe.contentBottom - 1 })
    expect(result.fitsSinglePage).toBe(false)
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

  it('충분히 큰 입력은 1페이지를 넘어간다', () => {
    const result = estimateWeeklyPageBudget({
      ...baseInput,
      perfGaeyalRowCount: 30,
      perfJinhaengRowCount: 30,
      expRowCount: 30,
    })
    expect(result.fitsSinglePage).toBe(false)
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
      result.expectedRowsHeight +
      result.tableOutMarginsHeight +
      result.tableWrapperSpacingHeight
    expect(sum).toBe(result.requiredHeight)
  })

  it('overflowHeight는 contentBottom - usableHeight와 정확히 같다(초과 시 양수, 여유 시 음수)', () => {
    const over = estimateWeeklyPageBudget({ ...baseInput, perfGaeyalRowCount: 30, perfJinhaengRowCount: 30, expRowCount: 30 })
    expect(over.overflowBeyondSinglePage).toBe(over.contentBottom - over.usableHeightPerPage)
    expect(over.overflowBeyondSinglePage).toBeGreaterThan(0)

    const under = estimateWeeklyPageBudget(baseInput)
    expect(under.overflowBeyondSinglePage).toBe(under.contentBottom - under.usableHeightPerPage)
    expect(under.overflowBeyondSinglePage).toBeLessThanOrEqual(0)
  })
})

// ── 표 wrapper 오버헤드 보정 ──────────────────────────────────────────────────
//
// 배경: hp:sz(행 높이 합)만 세면 표의 outMargin과 wrapper 문단 줄간격이 빠진다. 실측 결과
// 수행표 1,002(282+720) + 발주예상표 1,286(566+720) = 2,288이 누락되어, 예산이 "통과"로
// 1페이지로 판정한 4/6/4 + 교육 3줄이 한글에서 실제 2페이지가 되는 것을 수동 검증으로 확인했다.
describe('표 wrapper 오버헤드가 예산에 정확히 한 번씩 반영된다', () => {
  it('현재 템플릿 실측값 기준 wrapper overhead 합계는 2,288이다', () => {
    const r = estimateWeeklyPageBudget(baseInput)
    expect(r.tableOutMarginsHeight).toBe(282 + 566)
    expect(r.tableWrapperSpacingHeight).toBe(720 + 720)
    expect(r.tableOutMarginsHeight + r.tableWrapperSpacingHeight).toBe(2288)
  })

  it('수행표 overhead = 1,002 / 발주예상표 overhead = 1,286', () => {
    expect(baseInput.performingOutMargins + baseInput.performingWrapperSpacing).toBe(1002)
    expect(baseInput.expectedOutMargins + baseInput.expectedWrapperSpacing).toBe(1286)
  })

  it('outMargin을 +100 하면 requiredHeight가 정확히 +100 된다', () => {
    const base = estimateWeeklyPageBudget(baseInput)
    const perf = estimateWeeklyPageBudget({ ...baseInput, performingOutMargins: baseInput.performingOutMargins + 100 })
    expect(perf.requiredHeight - base.requiredHeight).toBe(100)
    const exp = estimateWeeklyPageBudget({ ...baseInput, expectedOutMargins: baseInput.expectedOutMargins + 100 })
    expect(exp.requiredHeight - base.requiredHeight).toBe(100)
  })

  it('wrapper spacing을 +100 하면 requiredHeight가 정확히 +100 된다', () => {
    const base = estimateWeeklyPageBudget(baseInput)
    const perf = estimateWeeklyPageBudget({ ...baseInput, performingWrapperSpacing: baseInput.performingWrapperSpacing + 100 })
    expect(perf.requiredHeight - base.requiredHeight).toBe(100)
    const exp = estimateWeeklyPageBudget({ ...baseInput, expectedWrapperSpacing: baseInput.expectedWrapperSpacing + 100 })
    expect(exp.requiredHeight - base.requiredHeight).toBe(100)
  })

  it('네 항목을 모두 0으로 두면 보정 이전 공식과 정확히 같아진다(중복 가산 없음)', () => {
    const withOverhead = estimateWeeklyPageBudget(baseInput)
    const without = estimateWeeklyPageBudget({
      ...baseInput,
      performingOutMargins: 0, expectedOutMargins: 0,
      performingWrapperSpacing: 0, expectedWrapperSpacing: 0,
    })
    expect(withOverhead.requiredHeight - without.requiredHeight).toBe(2288)
  })

  it('wrapper vertsize 전체(표 hp:sz + outMargin)를 중복 가산하지 않는다', () => {
    // 목표 조합(4/6/4 + 교육 4줄) 기준. 표 높이는 헤더+행 합으로만 계상되어야 하고,
    // wrapper vertsize(=36,536 / 7,648)가 추가로 들어가면 아래 합과 어긋난다.
    const r = estimateWeeklyPageBudget({
      ...baseInput, fixedContentHeight: 21060, eduLineCount: 4,
      perfGaeyalRowCount: 4, perfJinhaengRowCount: 6, expRowCount: 4,
    })
    const perfTableHeight = r.performingHeaderHeight + r.gaeyalRowsHeight + r.jinhaengRowsHeight
    const expTableHeight = r.expectedHeaderHeight + r.expectedRowsHeight
    expect(perfTableHeight).toBe(36254) // 표 hp:sz와 동일 — outMargin이 섞이지 않았다
    expect(expTableHeight).toBe(11066)
    expect(r.requiredHeight).toBe(21060 + 6400 + 36254 + 11066 + 848 + 1440)
    expect(r.requiredHeight).toBe(77068)
  })

  it('실제로 2페이지였던 조합들이 2페이지로 판정된다', () => {
    // 4/6/4 + 교육 3줄 — 보정 전 73,180(1페이지 오판) → 보정 후 75,468(2페이지)
    const t3 = estimateWeeklyPageBudget({
      ...baseInput, fixedContentHeight: 21060, eduLineCount: 3,
      perfGaeyalRowCount: 4, perfJinhaengRowCount: 6, expRowCount: 4,
    })
    expect(t3.requiredHeight).toBe(75468)
    expect(t3.contentBottom).toBe(74748) // 75,468 - 마지막 문단 여백 720
    expect(t3.fitsSinglePage).toBe(false)
    expect(t3.overflowBeyondSinglePage).toBe(480)

    // 4/6/3 + 교육 4줄 — 보정 전 72,788(1페이지 오판) → 보정 후 75,076(2페이지)
    const e3 = estimateWeeklyPageBudget({
      ...baseInput, fixedContentHeight: 21060, eduLineCount: 4,
      perfGaeyalRowCount: 4, perfJinhaengRowCount: 6, expRowCount: 3,
    })
    expect(e3.requiredHeight).toBe(75076)
    expect(e3.contentBottom).toBe(74356)
    expect(e3.fitsSinglePage).toBe(false)

    // 보정 항목을 빼면 둘 다 통과로 잘못 판정된다는 사실도 함께 고정한다.
    for (const input of [
      { eduLineCount: 3, expRowCount: 4 },
      { eduLineCount: 4, expRowCount: 3 },
    ]) {
      const wrong = estimateWeeklyPageBudget({
        ...baseInput, fixedContentHeight: 21060,
        perfGaeyalRowCount: 4, perfJinhaengRowCount: 6, ...input,
        performingOutMargins: 0, expectedOutMargins: 0,
        performingWrapperSpacing: 0, expectedWrapperSpacing: 0,
      })
      expect(wrong.fitsSinglePage).toBe(true) // ← 보정 전 공식의 오판(1페이지로 잘못 판정)
    }
  })
})

// ── 마지막 문단 여백(trailingParagraphSpacing) 보정 ────────────────────────────
//
// 배경: lineseg.spacing은 "줄 아래 여백"이라 중간 문단에서는 다음 문단을 밀어내지만, 문서
// 마지막 문단의 여백은 밀어낼 대상이 없어 페이지에 들어갈 필요가 없다. 실측(weekly.hwpx
// linesegarray)에서 마지막 문단 "4) 기 타"의 vertpos+vertsize = 70,764이고 전체 점유 합은
// 71,484로, 차이가 정확히 그 문단의 spacing(720)이었다.
//
// 이 값을 빼지 않으면 실제로는 1페이지인 조합을 2페이지로 오판한다 — 6/6/2 + 교육 1줄이 그 사례
// (2,288 보정만으로는 534 초과 예측이었으나 한글에서 1페이지 확인, 교육 2줄은 2페이지 확인).
describe('마지막 문단 여백은 contentBottom에서 제외된다', () => {
  const at = (g: number, j: number, e: number, edu: number) => estimateWeeklyPageBudget({
    ...baseInput, fixedContentHeight: 21060, eduLineCount: edu,
    perfGaeyalRowCount: g, perfJinhaengRowCount: j, expRowCount: e,
  })

  it('현재 템플릿 실측 trailingParagraphSpacing은 720이다', () => {
    expect(baseInput.trailingParagraphSpacing).toBe(720)
    expect(estimateWeeklyPageBudget(baseInput).trailingParagraphSpacing).toBe(720)
  })

  it('contentBottom = requiredHeight - trailingParagraphSpacing', () => {
    const r = at(4, 6, 4, 4)
    expect(r.contentBottom).toBe(r.requiredHeight - r.trailingParagraphSpacing)
    expect(r.requiredHeight).toBe(77068)
    expect(r.contentBottom).toBe(76348)
  })

  it('trailingParagraphSpacing을 +100 하면 contentBottom이 정확히 -100 된다', () => {
    const base = estimateWeeklyPageBudget(baseInput)
    const more = estimateWeeklyPageBudget({ ...baseInput, trailingParagraphSpacing: baseInput.trailingParagraphSpacing + 100 })
    expect(more.contentBottom - base.contentBottom).toBe(-100)
    expect(more.requiredHeight).toBe(base.requiredHeight) // 점유 합 자체는 그대로
  })

  it('trailingParagraphSpacing이 0이면 contentBottom = requiredHeight', () => {
    const r = estimateWeeklyPageBudget({ ...baseInput, trailingParagraphSpacing: 0 })
    expect(r.contentBottom).toBe(r.requiredHeight)
  })

  // 한글 수동 검증으로 확인된 8개 관찰과 모델이 모두 일치해야 한다.
  it('실측 관찰과 판정이 전부 일치한다', () => {
    const cases: Array<[string, ReturnType<typeof at>, boolean]> = [
      ['템플릿 원본 5/5/2 교육3 (1페이지)', at(5, 5, 2, 3), true],
      ['6/6/2 교육1 (1페이지)', at(6, 6, 2, 1), true],
      ['6/6/2 교육2 (2페이지)', at(6, 6, 2, 2), false],
      ['4/6/4 교육3 training3 (2페이지)', at(4, 6, 4, 3), false],
      ['4/6/4 교육4 training4 (2페이지)', at(4, 6, 4, 4), false],
      ['4/6/4 교육5 training5 (2페이지)', at(4, 6, 4, 5), false],
    ]
    for (const [label, r, expected] of cases) {
      expect(r.fitsSinglePage, label).toBe(expected)
    }
    // 경계 수치 고정
    expect(at(6, 6, 2, 1).contentBottom).toBe(74082) // 여유 186
    expect(at(6, 6, 2, 2).contentBottom).toBe(75682) // 초과 1,414
    expect(at(5, 5, 2, 3).contentBottom).toBe(70764) // 템플릿 실측 하단과 일치
  })

  it('2,288 overhead 보정과 마지막 문단 보정은 서로 독립이다', () => {
    const full = at(6, 6, 2, 1)
    const noOverhead = estimateWeeklyPageBudget({
      ...baseInput, fixedContentHeight: 21060, eduLineCount: 1,
      perfGaeyalRowCount: 6, perfJinhaengRowCount: 6, expRowCount: 2,
      performingOutMargins: 0, expectedOutMargins: 0,
      performingWrapperSpacing: 0, expectedWrapperSpacing: 0,
    })
    expect(full.contentBottom - noOverhead.contentBottom).toBe(2288)
  })
})

// ── 발주예상 데이터 행의 2줄 자동 확장 반영 ────────────────────────────────────
//
// HWP는 cellSz height를 최소 높이로만 쓰고 내용이 넘치면 행을 자동으로 늘린다. 발주처명이
// 6~8자면 발주청 열(약 5자 폭)에서 2줄이 되어 선언 높이 1,700을 넘어 2,416으로 확장된다.
// 선언 높이만 세던 기존 계산은 이 확장을 보지 못해, 예산이 통과시킨 조합이 한글에서 2페이지가
// 됐다(11행/발주4, 10행/발주5 — UAT 확인). 아래는 그 보정을 고정한다.
// (현재 정책에서는 2페이지가 되어도 차단하지 않고 그대로 생성한다 — 페이지 수 진단만 한다.)
//
// B안 템플릿 실측값: fixedContentHeight 19,460 / eduLineHeight 1,400 / 수행 헤더 3,664 /
// 수행 데이터행 3,259 / 발주예상 헤더 3,098 / 발주예상 선언 1,700 / 2줄 필요 2,416 /
// outMargin·wrapper spacing 0 / trailingParagraphSpacing 720
const B_PLAN: Omit<WeeklyPageBudgetInput, 'eduLineCount' | 'perfGaeyalRowCount' | 'perfJinhaengRowCount' | 'expRowCount'> = {
  usableHeightPerPage: 74268,
  fixedContentHeight: 19460,
  eduLineHeight: 1400,
  perfHeaderHeight: 3664,
  perfGaeyalMiddleRowHeight: 3259,
  perfGaeyalLastRowHeight: 3259,
  perfJinhaengRowHeight: 3259,
  expHeaderHeight: 3098,
  expRowHeight: 1700,
  expectedRowTwoLineHeight: 2416,
  performingOutMargins: 0,
  expectedOutMargins: 0,
  performingWrapperSpacing: 0,
  expectedWrapperSpacing: 0,
  trailingParagraphSpacing: 720,
}
const atB = (gaeyal: number, jinhaeng: number, exp: number, edu: number) =>
  estimateWeeklyPageBudget({
    ...B_PLAN, eduLineCount: edu,
    perfGaeyalRowCount: gaeyal, perfJinhaengRowCount: jinhaeng, expRowCount: exp,
  })

describe('발주예상 데이터 행의 2줄 자동 확장이 예산에 반영된다', () => {
  it('2줄 필요 높이가 선언 높이보다 크면 실효 높이로 2줄 높이를 쓴다', () => {
    const r = atB(4, 6, 4, 4)
    expect(r.declaredExpectedRowHeight).toBe(1700)
    expect(r.expectedRowTwoLineHeight).toBe(2416)
    expect(r.effectiveExpectedRowHeight).toBe(2416)
  })

  it('선언 높이가 2줄 높이보다 크면 선언 높이를 쓴다', () => {
    const r = estimateWeeklyPageBudget({
      ...B_PLAN, expRowHeight: 3000, eduLineCount: 4,
      perfGaeyalRowCount: 4, perfJinhaengRowCount: 6, expRowCount: 4,
    })
    expect(r.effectiveExpectedRowHeight).toBe(3000)
  })

  it('두 값이 같으면 그 값을 쓴다(경계)', () => {
    const r = estimateWeeklyPageBudget({
      ...B_PLAN, expRowHeight: 2416, eduLineCount: 4,
      perfGaeyalRowCount: 4, perfJinhaengRowCount: 6, expRowCount: 4,
    })
    expect(r.effectiveExpectedRowHeight).toBe(2416)
  })

  it('2줄 필요 높이에 마지막 줄 spacing은 포함되지 않는다 (2×1,050 + 1×316 = 2,416)', () => {
    // 모든 spacing을 더하면 2,732가 되어 실측(UAT로 역산한 2,116~2,644)을 벗어난다.
    expect(2 * 1050 + 1 * 316).toBe(2416)
    expect(2 * 1050 + 2 * 316).toBe(2732)
    expect(atB(4, 6, 4, 4).expectedRowTwoLineHeight).toBe(2416)
  })

  it('발주예상 행 수만큼 확장량이 누적된다 (행당 716)', () => {
    const growthPerRow = 2416 - 1700
    expect(growthPerRow).toBe(716)
    for (const n of [1, 2, 3, 4, 5]) {
      const withExpansion = atB(4, 6, n, 4)
      const withoutExpansion = estimateWeeklyPageBudget({
        ...B_PLAN, expectedRowTwoLineHeight: 0, eduLineCount: 4,
        perfGaeyalRowCount: 4, perfJinhaengRowCount: 6, expRowCount: n,
      })
      expect(withExpansion.requiredHeight - withoutExpansion.requiredHeight).toBe(growthPerRow * n)
    }
  })

  it('행 수가 0이어도 최소 1행분 실효 높이가 반영된다', () => {
    expect(atB(4, 6, 0, 4).expectedRowsHeight).toBe(atB(4, 6, 1, 4).expectedRowsHeight)
    expect(atB(4, 6, 0, 4).expectedRowsHeight).toBe(2416)
  })

  // UAT 실측 3건 — 이 보정이 세 결과를 모두 설명해야 한다.
  it('UAT 3건과 판정이 일치한다', () => {
    const target = atB(4, 6, 4, 4)   // 수행 10행 / 발주 4 / 교육 4 → 1페이지
    expect(target.requiredHeight).toBe(74076)
    expect(target.contentBottom).toBe(73356)
    expect(target.fitsSinglePage).toBe(true)
    expect(target.usableHeightPerPage - target.contentBottom).toBe(912)

    const eleven = atB(5, 6, 4, 4)   // 수행 11행 / 발주 4 / 교육 4 → 2페이지
    expect(eleven.requiredHeight).toBe(77335)
    expect(eleven.contentBottom).toBe(76615)
    expect(eleven.fitsSinglePage).toBe(false)
    expect(eleven.overflowBeyondSinglePage).toBe(2347)

    const fiveExp = atB(4, 6, 5, 4)  // 수행 10행 / 발주 5 / 교육 4 → 2페이지
    expect(fiveExp.requiredHeight).toBe(76492)
    expect(fiveExp.contentBottom).toBe(75772)
    expect(fiveExp.fitsSinglePage).toBe(false)
    expect(fiveExp.overflowBeyondSinglePage).toBe(1504)
  })

  it('보정 없이는 세 조합이 모두 1페이지로 오판된다(보정이 필요했다는 증거)', () => {
    for (const [g, j, e] of [[4, 6, 4], [5, 6, 4], [4, 6, 5]] as const) {
      const wrong = estimateWeeklyPageBudget({
        ...B_PLAN, expectedRowTwoLineHeight: 0, eduLineCount: 4,
        perfGaeyalRowCount: g, perfJinhaengRowCount: j, expRowCount: e,
      })
      expect(wrong.fitsSinglePage, `${g}/${j}/${e}`).toBe(true)
    }
  })

  it('진단 세부 내역의 합이 requiredHeight와 일치한다(실효 높이 반영 후에도)', () => {
    const r = atB(4, 6, 4, 4)
    const sum =
      r.fixedContentHeight + r.educationHeight +
      r.performingHeaderHeight + r.gaeyalRowsHeight + r.jinhaengRowsHeight +
      r.expectedHeaderHeight + r.expectedRowsHeight +
      r.tableOutMarginsHeight + r.tableWrapperSpacingHeight
    expect(sum).toBe(r.requiredHeight)
    expect(r.expectedRowsHeight).toBe(4 * r.effectiveExpectedRowHeight)
  })
})

// ── 페이지 수 추정 (생성 차단이 아니라 진단) ────────────────────────────────────
//
// Weekly는 1페이지에 들어가지 않아도 차단하지 않고 2페이지 이상으로 생성한다. 이 계산기는
// "몇 페이지가 필요한지"만 알려준다. estimatedPageCount는 행·문단이 페이지 경계에서 통째로
// 밀리는 손실을 계산하지 않으므로 최소 예상값이며, 실제 페이지 수는 이보다 클 수 있다.
describe('estimatedPageCount — 최소 예상 페이지 수', () => {
  // 페이지 높이만 바꿔 원하는 페이지 수를 만드는 헬퍼(다른 입력은 고정).
  const withUsable = (usableHeightPerPage: number) =>
    estimateWeeklyPageBudget({ ...baseInput, usableHeightPerPage })

  it('1페이지 — contentBottom이 페이지 높이 이하', () => {
    const probe = estimateWeeklyPageBudget(baseInput)
    const r = withUsable(probe.contentBottom + 1000)
    expect(r.estimatedPageCount).toBe(1)
    expect(r.fitsSinglePage).toBe(true)
    expect(r.overflowBeyondSinglePage).toBeLessThan(0)
  })

  it('경계값 — contentBottom과 페이지 높이가 정확히 같으면 1페이지', () => {
    const probe = estimateWeeklyPageBudget(baseInput)
    const r = withUsable(probe.contentBottom)
    expect(r.contentBottom).toBe(r.usableHeightPerPage)
    expect(r.estimatedPageCount).toBe(1)
    expect(r.fitsSinglePage).toBe(true)
    expect(r.overflowBeyondSinglePage).toBe(0)
  })

  it('경계값 바로 초과 — 1만 넘어도 2페이지', () => {
    const probe = estimateWeeklyPageBudget(baseInput)
    const r = withUsable(probe.contentBottom - 1)
    expect(r.estimatedPageCount).toBe(2)
    expect(r.fitsSinglePage).toBe(false)
    expect(r.overflowBeyondSinglePage).toBe(1)
  })

  it('2페이지 — 페이지 높이의 1배 초과 ~ 2배 이하', () => {
    const probe = estimateWeeklyPageBudget(baseInput)
    const cb = probe.contentBottom
    expect(withUsable(Math.ceil(cb / 2)).estimatedPageCount).toBe(2)      // 정확히 2배 경계
    expect(withUsable(Math.ceil(cb / 2) + 100).estimatedPageCount).toBe(2)
  })

  it('3페이지 이상 — 페이지 높이의 2배 초과', () => {
    const probe = estimateWeeklyPageBudget(baseInput)
    const cb = probe.contentBottom
    expect(withUsable(Math.ceil(cb / 2) - 1).estimatedPageCount).toBeGreaterThanOrEqual(3)
    expect(withUsable(Math.ceil(cb / 3)).estimatedPageCount).toBe(3)
    expect(withUsable(Math.ceil(cb / 5)).estimatedPageCount).toBe(5)
  })

  it('fitsSinglePage는 estimatedPageCount === 1과 항상 일치한다', () => {
    const probe = estimateWeeklyPageBudget(baseInput)
    for (const u of [probe.contentBottom * 2, probe.contentBottom + 1, probe.contentBottom,
      probe.contentBottom - 1, Math.ceil(probe.contentBottom / 3), 1000]) {
      const r = withUsable(u)
      expect(r.fitsSinglePage, `usable=${u}`).toBe(r.estimatedPageCount === 1)
    }
  })

  it('페이지 수는 최소 1이다(입력이 아무리 작아도 0페이지는 없다)', () => {
    const r = estimateWeeklyPageBudget({
      ...baseInput, usableHeightPerPage: 10_000_000,
      perfGaeyalRowCount: 0, perfJinhaengRowCount: 0, expRowCount: 0, eduLineCount: 1,
    })
    expect(r.estimatedPageCount).toBe(1)
  })

  it('행 수가 늘어날수록 예상 페이지 수는 단조 증가한다', () => {
    let prev = 0
    for (const n of [1, 10, 20, 40, 80, 160]) {
      const r = estimateWeeklyPageBudget({ ...baseInput, perfJinhaengRowCount: n })
      expect(r.estimatedPageCount).toBeGreaterThanOrEqual(prev)
      prev = r.estimatedPageCount
    }
    expect(prev).toBeGreaterThanOrEqual(3)
  })

  it('estimatedPageCount = max(1, ceil(contentBottom / usableHeightPerPage)) 공식과 정확히 일치', () => {
    for (const n of [1, 5, 13, 30, 60]) {
      for (const u of [74268, 40000, 20000]) {
        const r = estimateWeeklyPageBudget({ ...baseInput, perfJinhaengRowCount: n, usableHeightPerPage: u })
        expect(r.estimatedPageCount).toBe(Math.max(1, Math.ceil(r.contentBottom / u)))
      }
    }
  })
})
