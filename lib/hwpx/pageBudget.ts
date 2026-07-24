// 주간 HWPX의 "자동 문서 높이 예산" 계산 — 순수 함수, XML을 직접 다루지 않는다.
//
// 이건 "1페이지를 보장한다"는 뜻이 아니다. HWPX XML만으로는 셀 안 텍스트가 실제로 몇 줄로
// 줄바꿈될지, 한글이 최종적으로 몇 페이지로 렌더링할지 정확히 알 수 없다(한글 프로그램이
// 있어야만 확인 가능). 여기서 하는 일은 "지금 이 입력량이 템플릿의 고정 서식(행 높이·글자
// 크기를 전혀 줄이지 않은 상태) 기준으로 계산한 필요 높이가, 페이지의 사용 가능한 높이를
// 넘는지"를 산술적으로 어림하는 것뿐이다 — 문단 간격/글자 크기 자동 축소는 하지 않는다.
//
// 입력값(usableHeight, 각 행/헤더 높이 등)은 실제 템플릿 XML에서 실측한 숫자를
// app/api/hwpx/route.ts 쪽에서 뽑아 넘겨준다 — 이 파일은 그 숫자들을 어떻게 조합해 판정할지만
// 책임진다.
export interface WeeklyPageBudgetInput {
  /** 페이지 용지 높이 - 상하 여백 (HWPUNIT) */
  usableHeight: number
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
  /** 발주예상 데이터 행 높이(전 행 동일) */
  expRowHeight: number
  /** 발주예상 데이터 행 수(0건이면 1로 넘길 것) */
  expRowCount: number
}

// 판정 결과 + 진단용 세부 내역. fitsHeightBudget/requiredHeight/usableHeight 세 값만으로도
// 판정에는 충분하지만, 나머지 필드는 "어느 구성 요소가 얼마나 차지했는지"를 그대로 노출해서
// 단위 테스트·완료 보고·개발 로그·수동 검증 판단에 쓴다 — 사용자에게 보이는 API 응답에는
// 이 상세 수치를 넣지 않는다(app/api/hwpx/route.ts가 그 경계를 지킨다).
export interface WeeklyPageBudgetResult {
  usableHeight: number
  requiredHeight: number
  /** true면 "현재 서식을 전혀 줄이지 않은 상태 기준" 산술 예산 안에 든다는 뜻일 뿐,
   *  실제 한글 렌더링이 1페이지임을 보장하지 않는다. */
  fitsHeightBudget: boolean
  /** requiredHeight - usableHeight, 음수면 여유분(예산 안에 듦)을 뜻한다. */
  overflowHeight: number
  fixedContentHeight: number
  educationHeight: number
  performingHeaderHeight: number
  gaeyalRowsHeight: number
  jinhaengRowsHeight: number
  expectedHeaderHeight: number
  expectedRowsHeight: number
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

function expectedRowsHeightOnly(input: WeeklyPageBudgetInput): number {
  const n = Math.max(input.expRowCount, 1)
  return n * input.expRowHeight
}

export function estimateWeeklyPageBudget(input: WeeklyPageBudgetInput): WeeklyPageBudgetResult {
  const educationHeight = input.eduLineHeight * input.eduLineCount
  const gaeyalRowsHeight = gaeyalSectionHeight(input)
  const jinhaengRowsHeight = jinhaengSectionHeight(input)
  const expectedRowsHeight = expectedRowsHeightOnly(input)

  const requiredHeight =
    input.fixedContentHeight +
    educationHeight +
    input.perfHeaderHeight +
    gaeyalRowsHeight +
    jinhaengRowsHeight +
    input.expHeaderHeight +
    expectedRowsHeight

  return {
    usableHeight: input.usableHeight,
    requiredHeight,
    fitsHeightBudget: requiredHeight <= input.usableHeight,
    overflowHeight: requiredHeight - input.usableHeight,
    fixedContentHeight: input.fixedContentHeight,
    educationHeight,
    performingHeaderHeight: input.perfHeaderHeight,
    gaeyalRowsHeight,
    jinhaengRowsHeight,
    expectedHeaderHeight: input.expHeaderHeight,
    expectedRowsHeight,
  }
}

export const PAGE_BUDGET_EXCEEDED_MESSAGE =
  '현재 입력량은 자동 문서 높이 예산을 초과하여 안전하게 생성할 수 없습니다.'
