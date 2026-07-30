// 월간 HWPX 상단표 데이터 행의 "실제 렌더 높이" 추정 — 순수 함수, XML을 다루지 않는다.
//
// 배경: 기존 월간 page budget은 템플릿의 선언 행 높이(1,818)만 곱했다. 그런데 셀 안 텍스트가
// 셀 폭을 넘으면 한글이 행을 자동으로 늘리므로, 예산은 1페이지라고 판정하는데 실제로는
// 2페이지가 되는 불일치가 생긴다(한글 렌더 실측으로 확인).
//
// 아래 계산식은 추측이 아니라 실측으로 검증한 것이다. montly.hwpx 실측 열 제원:
//   용역명 텍스트폭 22,720 / 글자 1,100 / 줄간격 130%(lineseg spacing 332)
//   발주처 텍스트폭  4,276 / 글자   800 / 줄간격 100%(lineseg spacing   0)
//   쪽수   텍스트폭  5,880 / 글자   800 / 줄간격 100%
//   비고   텍스트폭  6,972 / 글자   800 / 줄간격 100%
//   cellMargin 상하 141+141 = 282, 선언 행 높이 1,818
//
// 행 높이 = max(선언 높이, 네 열 중 최대 [n×글자높이 + (n-1)×줄간격 + 282])
// 한글 렌더 실측과 대조(발주처 기준):
//   2줄 → 2×800+0+282 = 1,882   (실측 1,880)
//   3줄 → 2,682                 (실측 2,690)
//   4줄 → 3,482                 (실측 3,480)
//   6줄 → 5,082                 (실측 5,080)
// 용역명 2줄 → 2×1,100+332+282 = 2,814 (실측 2,810~2,820)

/** 셀 상하 여백 합(cellMargin top+bottom) — montly.hwpx 실측. */
export const MONTHLY_CELL_VERTICAL_MARGIN = 282

export interface MonthlyColumnMetric {
  /** lineseg.horzsize — cellSz.width에서 좌우 cellMargin을 뺀 실제 텍스트 폭. */
  textWidth: number
  /** charPr.height (HWPUNIT). 한글 한 글자 폭도 이 값으로 본다(장평 100%). */
  charHeight: number
  /** lineseg.spacing — 줄 사이 추가 간격. */
  lineSpacing: number
}

/** montly.hwpx 실측 열 제원. 줄 수를 세는 네 열만 둔다. */
export const MONTHLY_WRAP_COLUMNS = {
  name: { textWidth: 22720, charHeight: 1100, lineSpacing: 332 },
  client: { textWidth: 4276, charHeight: 800, lineSpacing: 0 },
  pages: { textWidth: 5880, charHeight: 800, lineSpacing: 0 },
  note: { textWidth: 6972, charHeight: 800, lineSpacing: 0 },
} as const satisfies Record<string, MonthlyColumnMetric>

export type MonthlyWrapColumn = keyof typeof MONTHLY_WRAP_COLUMNS

/**
 * 글자 하나의 폭. 한글·전각은 글자 높이와 같고, ASCII(숫자·영문·기호·공백)는 절반으로 본다.
 * 실측 대조: "한국전력공사 경인건설본부 경기건설지사"가 발주처 열에서 6줄(아래 wrap 규칙과 일치).
 */
export function charWidth(ch: string, charHeight: number): number {
  const code = ch.codePointAt(0) ?? 0
  return code < 0x1100 ? charHeight / 2 : charHeight
}

function wordWidth(word: string, charHeight: number): number {
  let w = 0
  for (const ch of word) w += charWidth(ch, charHeight)
  return w
}

/**
 * 한 줄에 들어가는 글자 수를 넘으면 다음 줄로 넘기는 방식(greedy word wrap)으로 줄 수를 센다.
 * 공백에서 우선 끊고, 한 단어가 줄보다 길면 그 단어 안에서 끊는다(한글은 어절 중간에서도 끊긴다).
 * 여러 문단(개행)이면 문단별로 세서 합한다.
 */
export function estimateLineCount(text: string, textWidth: number, charHeight: number): number {
  if (textWidth <= 0) return 1
  let total = 0
  for (const paragraph of String(text ?? '').split('\n')) {
    total += countParagraphLines(paragraph, textWidth, charHeight)
  }
  return Math.max(1, total)
}

function countParagraphLines(paragraph: string, textWidth: number, charHeight: number): number {
  const trimmed = paragraph.trim()
  if (trimmed === '') return 1

  const space = charWidth(' ', charHeight)
  let lines = 1
  let used = 0

  const pushWord = (word: string) => {
    const w = wordWidth(word, charHeight)
    if (w <= textWidth) {
      // 줄에 붙일 수 있으면 붙이고, 아니면 새 줄에서 시작한다.
      const withSpace = used === 0 ? w : used + space + w
      if (withSpace <= textWidth) used = withSpace
      else { lines++; used = w }
      return
    }
    // 한 단어가 줄보다 길다 — 한글은 그 단어를 먼저 새 줄로 넘긴 뒤 단어 안에서 끊는다.
    // (실측: 발주처 열에서 "한국전력공사 중부건설본부" 4줄, "…경인건설본부 경기건설지사" 6줄)
    if (used > 0) { lines++; used = 0 }
    for (const ch of word) {
      const cw = charWidth(ch, charHeight)
      const next = used + cw
      if (next <= textWidth) used = next
      else { lines++; used = cw }
    }
  }

  for (const word of trimmed.split(/\s+/)) pushWord(word)
  return lines
}

/** 줄 수 n이 차지하는 셀 높이. n×글자높이 + (n-1)×줄간격 + 상하 여백. */
export function cellHeightForLines(lines: number, metric: MonthlyColumnMetric): number {
  const n = Math.max(1, lines)
  return n * metric.charHeight + (n - 1) * metric.lineSpacing + MONTHLY_CELL_VERTICAL_MARGIN
}

export interface MonthlyRowTexts {
  name: string
  client: string
  pages: string
  note: string
}

/** 한 데이터 행의 예상 렌더 높이. 네 열 중 가장 높은 값을 쓰고, 선언 높이보다 작아지지 않는다. */
export function estimateMonthlyRowHeight(row: MonthlyRowTexts, declaredRowHeight: number): number {
  let max = declaredRowHeight
  for (const key of Object.keys(MONTHLY_WRAP_COLUMNS) as MonthlyWrapColumn[]) {
    const metric = MONTHLY_WRAP_COLUMNS[key]
    const lines = estimateLineCount(row[key], metric.textWidth, metric.charHeight)
    const height = cellHeightForLines(lines, metric)
    if (height > max) max = height
  }
  return max
}

/** 데이터 행 전체의 예상 높이 합. 0건이면 빈 행 하나가 선언 높이만큼 자리를 차지한다. */
export function estimateMonthlyRowsHeight(
  rows: readonly MonthlyRowTexts[], declaredRowHeight: number
): number {
  if (rows.length === 0) return declaredRowHeight
  return rows.reduce((sum, row) => sum + estimateMonthlyRowHeight(row, declaredRowHeight), 0)
}

/** 행별 줄 수 내역 — 진단 로그·테스트용. */
export function describeMonthlyRowLines(row: MonthlyRowTexts): Record<MonthlyWrapColumn, number> {
  const out = {} as Record<MonthlyWrapColumn, number>
  for (const key of Object.keys(MONTHLY_WRAP_COLUMNS) as MonthlyWrapColumn[]) {
    const metric = MONTHLY_WRAP_COLUMNS[key]
    out[key] = estimateLineCount(row[key], metric.textWidth, metric.charHeight)
  }
  return out
}
