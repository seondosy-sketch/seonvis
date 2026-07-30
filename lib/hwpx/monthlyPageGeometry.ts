// 월간 HWPX 용지 계약 — 순수 함수, XML을 다루지 않는다.
//
// 문제: montly.hwpx는 A4 "가로" 문서인데 hp:pagePr의 width/height 속성은 세로 기준으로
// 적혀 있다(width=59528, height=84188, landscape="NARROWLY"). 기존 page budget은
// height 속성(84,188)을 그대로 usableHeight 계산에 써서 실제보다 24,660만큼 느슨했다.
// 그 결과 실제로 2페이지가 되는 문서를 1페이지 가능으로 통과시켰다(한글 렌더로 확인).
//
// 실측 근거(생성물 PDF): 렌더 용지 84,100 × 59,500 (≈ 84,188 × 59,528) — 가로 방향.
//   좌우 여백 2,835+2,835 → 인쇄 폭 78,518, 표 폭 78,248이 여기 들어간다.
//   상하 여백 2,835+1,417 → 인쇄 높이 55,276.

export class MonthlyPageGeometryError extends Error {
  code: string
  constructor(message: string, code: string) {
    super(message)
    this.code = code
  }
}

/** 가로 방향에서 실제 인쇄되는 폭(= pagePr height 속성). */
export const MONTHLY_EXPECTED_PAGE_WIDTH = 84188
/** 가로 방향에서 실제 인쇄되는 높이(= pagePr width 속성). */
export const MONTHLY_EXPECTED_PAGE_HEIGHT = 59528
/** 상하 여백을 뺀 실제 사용 가능 높이. */
export const MONTHLY_EXPECTED_USABLE_HEIGHT = 55276

/** hp:pagePr의 landscape 속성이 가로 방향을 뜻하는 값들(한글이 쓰는 표기). */
const LANDSCAPE_VALUES = new Set(['NARROWLY', 'WIDELY'])

export interface MonthlyPageGeometryInput {
  /** pagePr width 속성 원값 */
  widthAttr: number
  /** pagePr height 속성 원값 */
  heightAttr: number
  /** pagePr landscape 속성 원값 */
  landscape: string | null
  topMargin: number
  bottomMargin: number
  leftMargin: number
  rightMargin: number
  headerMargin: number
  footerMargin: number
}

export interface MonthlyPageGeometry {
  /** 실제 인쇄 폭 */
  pageWidth: number
  /** 실제 인쇄 높이 */
  pageHeight: number
  usableWidth: number
  usableHeight: number
  landscape: string
}

/**
 * 용지 계약을 검증하고 "실제 인쇄 기준" 치수를 돌려준다.
 * 템플릿이 세로로 바뀌거나 용지가 달라지면 조용히 잘못 계산하지 않고 던진다.
 */
export function resolveMonthlyPageGeometry(input: MonthlyPageGeometryInput): MonthlyPageGeometry {
  const { widthAttr, heightAttr, landscape } = input

  if (landscape == null || !LANDSCAPE_VALUES.has(landscape)) {
    throw new MonthlyPageGeometryError(
      `montly.hwpx 용지 계약 위반: 월간은 A4 가로 문서여야 합니다(landscape=${JSON.stringify(landscape)}).`,
      'NOT_LANDSCAPE'
    )
  }
  for (const [label, value] of [['widthAttr', widthAttr], ['heightAttr', heightAttr],
    ['topMargin', input.topMargin], ['bottomMargin', input.bottomMargin],
    ['leftMargin', input.leftMargin], ['rightMargin', input.rightMargin]] as const) {
    if (!Number.isInteger(value) || value < 0) {
      throw new MonthlyPageGeometryError(
        `montly.hwpx 용지 계약 위반: ${label} 값(${value})이 0 이상 정수가 아닙니다.`,
        'INVALID_PAGE_GEOMETRY'
      )
    }
  }

  // 가로 방향이므로 속성의 width/height가 인쇄 기준과 뒤바뀐다.
  const pageWidth = heightAttr
  const pageHeight = widthAttr

  if (pageWidth !== MONTHLY_EXPECTED_PAGE_WIDTH || pageHeight !== MONTHLY_EXPECTED_PAGE_HEIGHT) {
    throw new MonthlyPageGeometryError(
      `montly.hwpx 용지 계약 위반: 인쇄 기준 용지가 ${MONTHLY_EXPECTED_PAGE_WIDTH}×${MONTHLY_EXPECTED_PAGE_HEIGHT}(A4 가로)이어야 하는데 ${pageWidth}×${pageHeight}입니다.`,
      'UNEXPECTED_PAGE_SIZE'
    )
  }

  const usableHeight = pageHeight - input.topMargin - input.bottomMargin
    - input.headerMargin - input.footerMargin
  const usableWidth = pageWidth - input.leftMargin - input.rightMargin

  if (usableHeight !== MONTHLY_EXPECTED_USABLE_HEIGHT) {
    throw new MonthlyPageGeometryError(
      `montly.hwpx 용지 계약 위반: 사용 가능 높이가 ${MONTHLY_EXPECTED_USABLE_HEIGHT}이어야 하는데 ${usableHeight}입니다(여백 상 ${input.topMargin} 하 ${input.bottomMargin}).`,
      'UNEXPECTED_USABLE_HEIGHT'
    )
  }

  return { pageWidth, pageHeight, usableWidth, usableHeight, landscape }
}
