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
  /**
   * 실제 사용 가능 높이 (HWPUNIT). 월간은 A4 "가로" 문서이므로 hp:pagePr의 height 속성을
   * 그대로 쓰면 안 된다 — lib/hwpx/monthlyPageGeometry.ts의 resolveMonthlyPageGeometry()가
   * 방향을 판정해 돌려주는 값을 넘긴다(실측 55,276).
   */
  usableHeight: number
  /** 진단·보고용 실제 인쇄 용지 치수 */
  pageWidth: number
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
  /**
   * 데이터 행 전체의 "예상 렌더 높이" 합(선택). 셀 텍스트가 셀 폭을 넘어 행이 자동으로
   * 늘어나는 만큼을 반영한 값이며 lib/hwpx/monthlyRowHeight.ts가 계산한다.
   * 주면 projectRowCount × projectRowHeight 대신 이 값을 쓴다 — 선언 높이만 곱하면
   * 예산은 1페이지라고 판정하는데 실제로는 2페이지가 되는 불일치가 생긴다(한글 렌더 실측).
   * 넘기지 않으면 기존 계산(선언 높이 × 행 수)을 그대로 쓴다.
   */
  estimatedProjectRowsHeight?: number
  /** 템플릿 선언 기준 달력 표 전체 높이(요일 헤더 + 3주 선언 행 높이 합) */
  calendarHeight: number
  /**
   * 달력의 "예상 렌더 높이"(선택). 한 날짜에 일정이 많거나 좁은 열(일·토)에서 프로젝트명이
   * 접히면 한글이 그 주 행을 늘린다 — lib/hwpx/monthlyCalendar.ts의 estimateCalendarHeight()가
   * 계산한다. 주면 calendarHeight 대신 이 값을 쓴다(선언 높이보다 작아지지는 않는다).
   */
  estimatedCalendarHeight?: number
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
  pageWidth: number
  pageHeight: number
  topMargin: number
  bottomMargin: number
  usableHeight: number
  fixedContentHeight: number
  projectHeaderHeight: number
  projectRowsHeight: number
  projectHeight: number
  /** 템플릿 선언 기준 달력 높이 */
  declaredCalendarHeight: number
  /** 실제 계산에 쓴 달력 높이(줄 확장 반영) */
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
  const usableHeight = input.usableHeight
  const n = Math.max(input.projectRowCount, 1)
  const declaredRowsHeight = n * input.projectRowHeight
  // 줄바꿈 확장을 반영한 값이 있으면 그것을 쓴다. 선언 높이 합보다 작아질 수는 없다
  // (행 높이는 선언 높이가 하한이므로 — 추정이 예산을 느슨하게 만들지 않도록 방어).
  const projectRowsHeight = input.estimatedProjectRowsHeight != null
    ? Math.max(input.estimatedProjectRowsHeight, declaredRowsHeight)
    : declaredRowsHeight
  const projectHeight = input.projectHeaderHeight + projectRowsHeight

  // 달력도 일정 줄 수에 따라 늘어난다. 추정값이 있으면 쓰고, 선언 높이가 하한이다.
  const calendarHeight = input.estimatedCalendarHeight != null
    ? Math.max(input.estimatedCalendarHeight, input.calendarHeight)
    : input.calendarHeight

  const requiredHeight =
    input.fixedContentHeight +
    projectHeight +
    calendarHeight +
    input.objectMargins +
    input.calendarVertOffset +
    input.renderSafetyReserve

  return {
    pageWidth: input.pageWidth,
    pageHeight: input.pageHeight,
    topMargin: input.topMargin,
    bottomMargin: input.bottomMargin,
    usableHeight,
    fixedContentHeight: input.fixedContentHeight,
    projectHeaderHeight: input.projectHeaderHeight,
    projectRowsHeight,
    projectHeight,
    declaredCalendarHeight: input.calendarHeight,
    calendarHeight,
    objectMargins: input.objectMargins,
    calendarVertOffset: input.calendarVertOffset,
    renderSafetyReserve: input.renderSafetyReserve,
    requiredHeight,
    overflowHeight: requiredHeight - usableHeight,
    fits: requiredHeight <= usableHeight,
  }
}

/**
 * 예산 초과 시 사용자에게 보여줄 메시지 — 원인을 숫자로 알려준다.
 * 예: "월간 업무계획이 한 페이지 허용 높이를 초과합니다. 프로젝트 13건, 예상 높이 57,120,
 *      허용 높이 55,276입니다."
 */
export function formatMonthlyPageBudgetExceededMessage(input: {
  projectCount: number
  requiredHeight: number
  usableHeight: number
}): string {
  const n = (v: number) => v.toLocaleString('en-US')
  return `월간 업무계획이 한 페이지 허용 높이를 초과합니다. `
    + `프로젝트 ${input.projectCount}건, 예상 높이 ${n(input.requiredHeight)}, `
    + `허용 높이 ${n(input.usableHeight)}입니다.`
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
// 안전여유 — 한글 실제 렌더 실측으로 재산정한 값이다(추측값 아님).
//
// 재산정 배경: 이전 값 3000은 usableHeight를 세로 용지 높이(84,188 기준 79,936)로 잘못 계산한
// 상태에서 정한 것이라 근거가 무효였다. A4 가로 실제 사용 가능 높이(55,276)로 바로잡고
// 0/5/10/11/12/13/20/23건 표본을 한글 COM으로 생성·렌더해 다시 측정했다.
//
// 측정 결과 — "reserve 0 계산값" vs "PDF에서 실측한 실제 점유 높이"(상여백 제외):
//   0건  계산 35,260 / 실제 34,775 → 오차 +485,  PageCount 1
//   5건  계산 42,532 / 실제 42,045 → 오차 +487,  PageCount 1
//   10건 계산 53,614 / 실제 53,115 → 오차 +499,  PageCount 1
//   11건 계산 55,432 / 실제 54,935 → 오차 +497,  PageCount 1
//   12건 계산 57,250 → PageCount 2 (실제로 넘친다)
//   13/20/23건 → 전부 PageCount 2
//
// 계산값은 모든 표본에서 실제보다 크다(과다 계상, 안전한 방향). 편차는 14뿐이라 모델이
// 매우 안정적이며, 모델이 실제보다 작게 나오는(위험한) 경우는 관측되지 않았다.
// 따라서 안전여유는 "관측된 최대 오차 크기 499를 덮는 최소 보수값" = 500으로 정한다.
//
// 이 값에서의 판정 경계: 고정 요소 합 33,442를 뺀 데이터 행 예산 = 55,276 − 33,442 − 500
//   = 21,334. 10건(행 합 20,172)은 통과하고, 12건 이상(23,808+)은 차단된다.
//   11건(21,990)은 실제로는 1페이지지만(여유 341) 모델의 과다 계상 때문에 차단된다 —
//   reserve를 0으로 낮춰도 마찬가지이므로(21,834 < 21,990) reserve 선택과 무관한 보수적 한계다.
export const MONTHLY_RENDER_SAFETY_RESERVE = 500
export const MONTHLY_RENDER_SAFETY_RESERVE_CONFIRMED = true

/** 안전여유 재산정에 쓴 실측 표본 — 테스트가 이 값으로 계산 모델을 고정한다. */
export const MONTHLY_RESERVE_CALIBRATION_SAMPLES: ReadonlyArray<{
  projectCount: number
  /** renderSafetyReserve를 0으로 둔 계산값 */
  computedWithoutReserve: number
  /** PDF 실측 실제 점유 높이(상여백 제외). 2페이지 표본은 측정 불가라 null. */
  actualOccupied: number | null
  pageCount: number
}> = [
  { projectCount: 0, computedWithoutReserve: 35260, actualOccupied: 34775, pageCount: 1 },
  { projectCount: 5, computedWithoutReserve: 42532, actualOccupied: 42045, pageCount: 1 },
  { projectCount: 10, computedWithoutReserve: 53614, actualOccupied: 53115, pageCount: 1 },
  { projectCount: 11, computedWithoutReserve: 55432, actualOccupied: 54935, pageCount: 1 },
  { projectCount: 12, computedWithoutReserve: 57250, actualOccupied: null, pageCount: 2 },
  { projectCount: 13, computedWithoutReserve: 59068, actualOccupied: null, pageCount: 2 },
  { projectCount: 20, computedWithoutReserve: 71794, actualOccupied: null, pageCount: 2 },
  { projectCount: 23, computedWithoutReserve: 77248, actualOccupied: null, pageCount: 2 },
]

// 프로젝트 수 절대 상한 — 실질 판단은 예상 높이가 한다(위 경계에서 11건 이상은 이미 차단된다).
// 이 상한은 비정상 입력·성능 보호용이다: XML 행 복제와 사후 검증이 입력 수에 비례하므로
// 터무니없는 건수로 서버 시간을 쓰지 않게 막는다. 어떤 정상 입력도 여기 닿지 않는다.
//
// 이전 값 23은 잘못된 usableHeight(79,936)를 전제로 "한글 수동 검증한 최대 건수"로 정한 것이라
// 근거가 무효다(실제로 23건은 2페이지 — 위 표본 확인). 그래서 "검증된 최대 건수" 개념을 버리고
// 절대 상한으로 성격을 바꿨다.
export const MONTHLY_ABSOLUTE_MAX_PROJECT_COUNT = 100

// "절대 상한 초과"는 "높이 예산 초과"와 다른 사유다 — 전자는 입력 자체가 비정상이라는 뜻이고
// 후자는 이 서식에 그만큼이 안 들어간다는 뜻이다. 원인을 구분할 수 있게 코드·메시지를 분리한다.
export const MONTHLY_MAX_PROJECT_COUNT_EXCEEDED_CODE = 'MONTHLY_MAX_PROJECT_COUNT_EXCEEDED'

export function formatMonthlyMaxProjectCountExceededMessage(actualCount: number): string {
  return `한 번에 처리할 수 있는 최대 프로젝트 수 ${MONTHLY_ABSOLUTE_MAX_PROJECT_COUNT}건을 초과했습니다(입력 ${actualCount}건).`
}
