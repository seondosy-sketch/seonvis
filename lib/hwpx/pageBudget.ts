// 주간 HWPX의 "문서 높이 산술 계산" — 순수 함수, XML을 직접 다루지 않는다.
//
// ── 역할: 생성 가능 여부 게이트가 아니라 "몇 페이지가 필요한지" 진단 ──────────────
//
// 예전에는 이 계산이 예산 초과 시 생성을 차단하는 게이트였다. 지금은 그렇지 않다.
// Weekly는 입력이 많아 1페이지에 들어가지 않으면 차단하지 않고 2페이지 이상으로 자연스럽게
// 생성한다(표에 pageBreak="CELL" + repeatHeader="1"이 걸려 있어 한글이 행 경계에서 자동으로
// 나누고 다음 페이지에 헤더 행을 반복한다). 따라서 이 파일은 판정이 아니라 진단만 한다.
//
// 데이터 삭제·행 누락·말줄임·강제 절단은 어떤 경우에도 하지 않는다.
//
// estimatedPageCount는 "최소 예상 페이지 수"다 — 행이나 문단은 페이지 경계에서 쪼개지지 않고
// 다음 페이지로 통째로 밀리므로, 경계마다 한 단위(수행 행/발주예상 행/문단 하나)만큼 여백이
// 버려질 수 있다. 실제 페이지 수는 이 값보다 클 수 있고, 정확한 값은 한글로 열어봐야 한다.
//
// 입력값(페이지 사용 높이, 각 행/헤더 높이 등)은 실제 템플릿 XML에서 실측한 숫자를
// app/api/hwpx/route.ts 쪽에서 뽑아 넘겨준다 — 이 파일은 그 숫자들을 어떻게 조합할지만 책임진다.
export interface WeeklyPageBudgetInput {
  /** 한 페이지에서 본문이 쓸 수 있는 높이 = 용지 높이 − 상하 여백 (HWPUNIT). 모든 페이지 동일. */
  usableHeightPerPage: number
  /** 표 이외 고정 콘텐츠(제목·"1)/2)" 헤딩·"4) 기타" 제목 등, 교육참가자 문단 제외) 높이 합 */
  fixedContentHeight: number
  /** 교육참가자 문단 한 줄의 높이(책임 줄과 분야별 줄이 템플릿 기준 동일한 높이임을 실측 확인) */
  eduLineHeight: number
  /** 교육참가자 문단 줄 수 — 책임 1줄 + 값이 있는 분야 수(0~4) */
  eduLineCount: number
  /** 수행 프로젝트 표 헤더 행 높이 */
  perfHeaderHeight: number
  /** 개찰 섹션의 "중간" 행 높이(진행중 섹션과 맞닿지 않는, 일반 데이터 행) */
  perfGaeyalMiddleRowHeight: number
  /** 개찰 섹션의 마지막 행 높이(진행중 섹션과 맞닿는 경계 스타일 행) */
  perfGaeyalLastRowHeight: number
  /** 개찰 데이터 행 수(0건이면 1로 넘길 것 — 빈 행도 자리를 차지한다) */
  perfGaeyalRowCount: number
  /** 진행중 섹션의 행 높이(표의 마지막 섹션이라 전 행이 동일한 높이/스타일임을 실측 확인) */
  perfJinhaengRowHeight: number
  /** 진행중 데이터 행 수(0건이면 1로 넘길 것) */
  perfJinhaengRowCount: number
  /** 발주예상 표 헤더 행 높이 */
  expHeaderHeight: number
  /** 발주예상 데이터 행에 선언된 높이(cellSz height, 전 행 동일) */
  expRowHeight: number
  /**
   * 발주예상 데이터 행이 2줄이 될 때 실제로 필요한 높이 = 2×본문높이 + 1×줄간격.
   * (마지막 줄의 아래 여백은 점유하지 않는다 — 문단 레벨의 trailingParagraphSpacing과 같은 규칙)
   *
   * HWP는 cellSz height를 "최소 높이"로만 쓰고 내용이 넘치면 행을 자동으로 늘린다. 발주처명이
   * 6~8자면 발주청 열(약 5자 폭)에서 2줄이 되어 선언 높이(1,700)를 넘어 2,416으로 확장되는데,
   * 선언 높이만 세던 기존 계산은 이 확장을 전혀 보지 못했다. 그래서 예산이 통과시킨 조합이
   * 한글에서 2페이지가 됐다(11행/발주4, 10행/발주5 — UAT로 확인).
   *
   * 이번 보정은 UAT가 입증한 "2줄 확장"만 반영한다 — 3줄 이상 확장, 문자폭 추정, 줄 수 계산기는
   * 도입하지 않는다.
   */
  expectedRowTwoLineHeight: number
  /** 발주예상 데이터 행 수(0건이면 1로 넘길 것) */
  expRowCount: number

  // ── 표 wrapper 오버헤드 ──────────────────────────────────────────────────────
  //
  // 표가 실제로 차지하는 세로 공간은 표 자신의 hp:sz(행 높이 합)보다 크다. 실측으로 확인한
  // 분해는 다음과 같다(weekly.hwpx):
  //   wrapper 문단 lineseg.vertsize = 표 hp:sz + outMargin(top+bottom)   ← 정확히 일치
  //   wrapper 문단 실제 점유        = vertsize + lineseg.spacing
  // 즉 hp:sz만 세면 "outMargin + wrapper 줄간격"이 빠진다. 수행표 1,002 + 발주예상표 1,286 =
  // 2,288이 누락되어, 예산이 통과 판정한 조합이 한글에서 2페이지가 되는 사고가 실제로 있었다
  // (4/6/4 + 교육 3줄 — 수동 검증으로 2페이지 확인).
  //
  // vertsize를 그대로 더하면 표 hp:sz와 outMargin이 중복 계상되므로 절대 더하지 않는다.
  // 아래 네 항목만 각각 정확히 한 번씩 더한다. inMargin은 셀 내부 여백이라 행 높이에 이미
  // 포함되어 있으므로 더하지 않는다(실측: 두 표 모두 inMargin=0).

  /** 수행 프로젝트 표의 직계 hp:outMargin top + bottom */
  performingOutMargins: number
  /** 발주예상 표의 직계 hp:outMargin top + bottom */
  expectedOutMargins: number
  /** 수행 프로젝트 표를 직접 담은 wrapper 문단의 lineseg.spacing */
  performingWrapperSpacing: number
  /** 발주예상 표를 직접 담은 wrapper 문단의 lineseg.spacing */
  expectedWrapperSpacing: number

  // ── 마지막 문단의 줄 아래 여백 ────────────────────────────────────────────────
  //
  // lineseg.spacing은 "그 줄 아래쪽 여백"이다. 실측(weekly.hwpx의 linesegarray)으로 확인한 대로
  // 인접 문단 사이에서는 `다음 문단 vertpos = 이전 문단 vertsize + spacing`이 정확히 성립하므로
  // 중간 문단의 spacing은 반드시 누적된다. 그러나 문서 마지막 문단의 spacing은 밀어낼 다음 문단이
  // 없어 페이지에 들어갈 필요가 없다 — 실제 문서 하단은 `vertpos + vertsize`까지다.
  //
  // 이 값을 빼지 않으면 마지막 문단 여백만큼(현재 템플릿 720) 과대 계상되어, 실제로는 1페이지인
  // 조합을 차단한다(6/6/2 + 교육 1줄이 그 사례 — 예측 534 초과였지만 한글에서 1페이지 확인).
  /** 표 밖 마지막 문단의 마지막 lineseg.spacing */
  trailingParagraphSpacing: number
}

// 전부 진단용 수치다 — 생성 가능 여부를 가르는 값은 하나도 없다. 사용자에게 보이는 API 응답에는
// 이 수치를 넣지 않고(app/api/hwpx/route.ts가 그 경계를 지킨다) 서버 로그·테스트·완료 보고에만 쓴다.
export interface WeeklyPageBudgetResult {
  /** 한 페이지에서 본문이 쓸 수 있는 높이 (모든 페이지 동일) */
  usableHeightPerPage: number
  /** 모든 구성 요소의 "점유 높이" 합(마지막 문단의 줄 아래 여백까지 포함) */
  requiredHeight: number
  /** 실제 문서 하단 = requiredHeight - trailingParagraphSpacing. 페이지 수 산정 기준값. */
  contentBottom: number
  /** 표 밖 마지막 문단의 줄 아래 여백(문서 하단 계산에서 제외한 값) */
  trailingParagraphSpacing: number
  /**
   * 최소 예상 페이지 수 = max(1, ceil(contentBottom / usableHeightPerPage)).
   *
   * "최소"인 이유: 행과 문단은 페이지 경계에서 쪼개지지 않고 다음 페이지로 통째로 밀리므로,
   * 경계마다 한 단위만큼 여백이 버려질 수 있다. 실제 페이지 수는 이 값보다 클 수 있으며
   * 정확한 값은 한글 프로그램으로 열어야만 확인된다. 이 값으로 생성을 막지 않는다.
   */
  estimatedPageCount: number
  /** estimatedPageCount === 1 인지. 1페이지 최적화 목표 달성 여부를 진단하는 용도다. */
  fitsSinglePage: boolean
  /** contentBottom - usableHeightPerPage. 음수면 1페이지 안에 여유가 있다는 뜻. */
  overflowBeyondSinglePage: number
  fixedContentHeight: number
  educationHeight: number
  performingHeaderHeight: number
  gaeyalRowsHeight: number
  jinhaengRowsHeight: number
  expectedHeaderHeight: number
  expectedRowsHeight: number
  /** 발주예상 데이터 행에 선언된 높이 — 진단용 */
  declaredExpectedRowHeight: number
  /** 발주예상 데이터 행의 2줄 필요 높이 — 진단용 */
  expectedRowTwoLineHeight: number
  /** 실제 예산에 쓴 발주예상 행 높이 = max(선언, 2줄) — 진단용 */
  effectiveExpectedRowHeight: number
  /** 두 표의 outMargin(top+bottom) 합 — 진단용 */
  tableOutMarginsHeight: number
  /** 두 표 wrapper 문단의 lineseg.spacing 합 — 진단용 */
  tableWrapperSpacingHeight: number
}

function gaeyalSectionHeight(input: WeeklyPageBudgetInput): number {
  const n = Math.max(input.perfGaeyalRowCount, 1)
  if (n === 1) return input.perfGaeyalLastRowHeight
  return (n - 1) * input.perfGaeyalMiddleRowHeight + input.perfGaeyalLastRowHeight
}

function jinhaengSectionHeight(input: WeeklyPageBudgetInput): number {
  const n = Math.max(input.perfJinhaengRowCount, 1)
  return n * input.perfJinhaengRowHeight
}

// 발주예상 데이터 행의 예산상 실효 높이. 선언 높이가 2줄 콘텐츠를 담지 못하면 HWP가 행을
// 자동으로 늘리므로, 둘 중 큰 값을 써야 예산이 실제 렌더 높이를 과소 계상하지 않는다.
export function effectiveExpectedRowHeight(input: WeeklyPageBudgetInput): number {
  return Math.max(input.expRowHeight, input.expectedRowTwoLineHeight)
}

function expectedRowsHeightOnly(input: WeeklyPageBudgetInput): number {
  const n = Math.max(input.expRowCount, 1)
  return n * effectiveExpectedRowHeight(input)
}

export function estimateWeeklyPageBudget(input: WeeklyPageBudgetInput): WeeklyPageBudgetResult {
  const educationHeight = input.eduLineHeight * input.eduLineCount
  const gaeyalRowsHeight = gaeyalSectionHeight(input)
  const jinhaengRowsHeight = jinhaengSectionHeight(input)
  const expectedRowsHeight = expectedRowsHeightOnly(input)

  // 표 wrapper 오버헤드 — outMargin과 wrapper 줄간격을 각각 정확히 한 번만 더한다.
  // (wrapper lineseg.vertsize는 표 hp:sz + outMargin과 같으므로 절대 더하지 않는다.)
  const tableOutMarginsHeight = input.performingOutMargins + input.expectedOutMargins
  const tableWrapperSpacingHeight = input.performingWrapperSpacing + input.expectedWrapperSpacing

  const requiredHeight =
    input.fixedContentHeight +
    educationHeight +
    input.perfHeaderHeight +
    gaeyalRowsHeight +
    jinhaengRowsHeight +
    input.expHeaderHeight +
    expectedRowsHeight +
    tableOutMarginsHeight +
    tableWrapperSpacingHeight

  // 실제 문서 하단 — 마지막 문단의 줄 아래 여백은 밀어낼 대상이 없어 페이지에 들어갈 필요가 없다.
  const contentBottom = requiredHeight - input.trailingParagraphSpacing

  // 최소 예상 페이지 수. 행·문단이 페이지 경계에서 통째로 밀리는 손실은 계산하지 않으므로
  // 실제 페이지 수는 이 값 이상이다. 이 값으로 생성을 막지 않는다.
  const estimatedPageCount = Math.max(1, Math.ceil(contentBottom / input.usableHeightPerPage))

  return {
    usableHeightPerPage: input.usableHeightPerPage,
    requiredHeight,
    contentBottom,
    trailingParagraphSpacing: input.trailingParagraphSpacing,
    estimatedPageCount,
    fitsSinglePage: estimatedPageCount === 1,
    overflowBeyondSinglePage: contentBottom - input.usableHeightPerPage,
    fixedContentHeight: input.fixedContentHeight,
    educationHeight,
    performingHeaderHeight: input.perfHeaderHeight,
    gaeyalRowsHeight,
    jinhaengRowsHeight,
    expectedHeaderHeight: input.expHeaderHeight,
    expectedRowsHeight,
    declaredExpectedRowHeight: input.expRowHeight,
    expectedRowTwoLineHeight: input.expectedRowTwoLineHeight,
    effectiveExpectedRowHeight: effectiveExpectedRowHeight(input),
    tableOutMarginsHeight,
    tableWrapperSpacingHeight,
  }
}

// PAGE_BUDGET_EXCEEDED_MESSAGE는 제거했다 — Weekly는 더 이상 예산 초과로 생성을 차단하지 않는다.
// (Monthly는 별도 상수 MONTHLY_PAGE_BUDGET_EXCEEDED_MESSAGE로 차단 정책을 그대로 유지한다.)
