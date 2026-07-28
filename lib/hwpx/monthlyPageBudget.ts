// 월간 HWPX의 "자동 문서 높이 예산" 계산 — 순수 함수, XML을 직접 다루지 않는다.
// renderSafetyReserve 확정 상태와 그 근거는 이 파일 하단 상수 주석에 기록되어 있다.
//
// 주간(lib/hwpx/pageBudget.ts)의 계산기를 재사용하지 않는다 — 월간은 개찰/진행중/발주예상
// 구분이 없고(라벨 병합 셀 없음), 대신 프로젝트 표 뒤에 별도의 달력 표가 있어 계산 구성
// 요소 자체가 다르다(Sprint M1 Rev.2 11번 항목: "공통화 가능"은 페이지 geometry 계산 같은
// 작은 순수 유틸 정도로 한정, Weekly 생성 흐름은 건드리지 않음).
//
// "1페이지를 보장한다"는 뜻이 아니다 — 셀 안 텍스트가 실제로 몇 줄로 줄바꿈될지는 한글
// 프로그램으로만 확인 가능하다. 이 값은 "검증된 안전 경계 이내에서만 생성을 시도한다"는
// 보수적 사전 거절 장치일 뿐이다.
export interface MonthlyPageBudgetInput {
  /** 용지 전체 높이 (HWPUNIT) */
  pageHeight: number
  topMargin: number
  bottomMargin: number
  /** 표 wrapper를 "제외"한, 표 밖 문단의 직계 lineSegArray 높이 합(실측: 제목+빈문단×2=4604) */
  fixedContentHeight: number
  /** 프로젝트 표 헤더 행 높이 */
  projectHeaderHeight: number
  /** 검증된(균일성 확인된) 프로젝트 데이터 행 높이(전 행 동일해야 함) */
  projectRowHeight: number
  /** 프로젝트 데이터 행 수(0건이면 1로 넘길 것 — 빈 행도 자리를 차지한다) */
  projectRowCount: number
  /** 검증된 달력 표 전체 높이(헤더+날짜행 3개 합, 달력은 수정하지 않으므로 고정값) */
  calendarHeight: number
  /** 두 표의 실제 세로 outMargin 합(실측: 프로젝트 283+283 + 달력 141+141 = 848) */
  objectMargins: number
  /** 달력 표의 검증된 vertOffset(실측 474) */
  calendarVertOffset: number
  /**
   * 안전 여유분 — 추측값 금지. 한글 수동 경계 검증으로 확정된 MONTHLY_RENDER_SAFETY_RESERVE
   * (이 파일 하단)를 쓴다. 확정 근거도 그 상수 주석에 기록되어 있다.
   */
  renderSafetyReserve: number
}

export interface MonthlyPageBudgetResult {
  pageHeight: number
  topMargin: number
  bottomMargin: number
  usableHeight: number
  fixedContentHeight: number
  projectHeaderHeight: number
  projectRowsHeight: number
  projectHeight: number
  calendarHeight: number
  objectMargins: number
  calendarVertOffset: number
  renderSafetyReserve: number
  requiredHeight: number
  /** requiredHeight - usableHeight. 음수면 여유(예산 안에 듦). */
  overflowHeight: number
  fits: boolean
}

export function estimateMonthlyPageBudget(input: MonthlyPageBudgetInput): MonthlyPageBudgetResult {
  const usableHeight = input.pageHeight - input.topMargin - input.bottomMargin
  const n = Math.max(input.projectRowCount, 1)
  const projectRowsHeight = n * input.projectRowHeight
  const projectHeight = input.projectHeaderHeight + projectRowsHeight

  const requiredHeight =
    input.fixedContentHeight +
    projectHeight +
    input.calendarHeight +
    input.objectMargins +
    input.calendarVertOffset +
    input.renderSafetyReserve

  return {
    pageHeight: input.pageHeight,
    topMargin: input.topMargin,
    bottomMargin: input.bottomMargin,
    usableHeight,
    fixedContentHeight: input.fixedContentHeight,
    projectHeaderHeight: input.projectHeaderHeight,
    projectRowsHeight,
    projectHeight,
    calendarHeight: input.calendarHeight,
    objectMargins: input.objectMargins,
    calendarVertOffset: input.calendarVertOffset,
    renderSafetyReserve: input.renderSafetyReserve,
    requiredHeight,
    overflowHeight: requiredHeight - usableHeight,
    fits: requiredHeight <= usableHeight,
  }
}

export const MONTHLY_PAGE_BUDGET_EXCEEDED_MESSAGE =
  '현재 입력량은 자동 문서 높이 예산을 초과하여 안전하게 생성할 수 없습니다.'

// ── renderSafetyReserve: 단계 B — 수동 한글 검증으로 확정됨 ────────────────────────────
//
// Rev.2 13번 항목이 요구한 2단계 확정 절차를 완료했다. 단계 A에서는 이 값을 "미확정 보수값"
// (PENDING)으로 두고 릴리스를 막았고, 아래 근거로 단계 B에서 확정했다.
//
// 확정 근거 — 이 예산값(3000)으로 생성한 파일을 한글에서 직접 열어 확인한 결과:
//   manual-review/monthly-dynamic-0.hwpx  (프로젝트 0건,  잔여 41676) → 정상
//   manual-review/monthly-dynamic-13.hwpx (프로젝트 13건, 잔여 19860) → 정상
//   manual-review/monthly-dynamic-20.hwpx (프로젝트 20건, 잔여  7134) → 정상
//   manual-review/monthly-dynamic-23.hwpx (프로젝트 23건, 잔여  1680) → 정상  ← 산술 경계 직전
// 확인 항목(4개 파일 공통): 파일 정상 열림 / 한 페이지 유지 / 달력 전체가 같은 페이지에 유지 /
// 프로젝트 누락 없음 / 입력 순서 정상 / 표 테두리·열 너비 정상 / 제목·기준일 정상 /
// 저장 후 재오픈 정상.
//
// 특히 잔여 높이가 1680밖에 남지 않는 23건에서도 달력이 같은 페이지에 유지됐다는 것이 핵심
// 근거다 — 여유분 3000이 실제 렌더링 오차를 흡수하기에 충분함을 경계에서 직접 확인했다.
// (5건·11건 파일은 수동 확인 결과가 보고되지 않았다. 다만 0·13·20·23건이 모두 정상이라
//  그 사이 구간이며, 자동 테스트로 XML 계약은 검증되어 있다.)
//
// 여전히 "1페이지를 보장한다"는 뜻은 아니다 — 셀 안 텍스트가 길어 줄바꿈이 늘어나면 행 높이가
// 커질 수 있고, 그건 이 산술 예산이 표현하지 못하는 영역이다. 이 값은 "검증된 안전 경계
// 이내에서만 생성을 시도한다"는 보수적 사전 거절 기준이다.
export const MONTHLY_RENDER_SAFETY_RESERVE = 3000
export const MONTHLY_RENDER_SAFETY_RESERVE_CONFIRMED = true

// 위 확정값(3000)과 실측 템플릿 수치를 기준으로 산술 예산에 드는 최대 프로젝트 수.
// 23건은 한글에서 직접 확인해 정상 판정을 받았고, 24건은 requiredHeight 80074 >
// usableHeight 79936(초과 138)로 생성 자체가 차단된다.
export const MONTHLY_VERIFIED_MAX_PROJECT_COUNT = 23

// "수동 검증된 최대 건수 초과"는 "템플릿 높이 예산 초과"와 다른 사유다 — 전자는 사람이 한글로
// 확인한 범위를 넘었다는 뜻이고, 후자는 산술 예산 자체가 안 맞는다는 뜻이다. 둘을 합치면
// 나중에 템플릿이 바뀌어 예산 한계가 23건보다 낮아졌을 때 원인을 구분할 수 없다. 그래서
// 오류 코드와 메시지를 분리해 둔다.
export const MONTHLY_MAX_PROJECT_COUNT_EXCEEDED_CODE = 'MONTHLY_MAX_PROJECT_COUNT_EXCEEDED'

export function formatMonthlyMaxProjectCountExceededMessage(actualCount: number): string {
  return `수동 검증된 최대 프로젝트 수 ${MONTHLY_VERIFIED_MAX_PROJECT_COUNT}건을 초과했습니다(입력 ${actualCount}건).`
}
