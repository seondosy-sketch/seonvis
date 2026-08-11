/**
 * 프로젝트 List — "○○년 참여프로젝트 관리" xlsx 출력.
 *
 * 사용자가 손으로 관리하던 워크북의 서식을 그대로 재현한다(2시트). 원본에서 실측한 값
 * (열 너비, 행 높이, 맑은 고딕 11pt, 헤더 음영 BFBFBF, 날짜 표시형식 m"/"d, 노란 강조 FFFF00)을
 * 아래 상수로 못 박아 두었다 — 눈대중으로 고치면 원본과 어긋나므로 값 변경 시 원본을 다시 확인할 것.
 *
 * 공통 export 인프라(lib/export/excel.ts)는 이 서식을 강제하지 않는 저수준 도우미라
 * 여기서는 createWorkbook/workbookToBuffer/applyPrintSetup만 빌려 쓴다.
 */
import ExcelJS from 'exceljs'
import { applyPrintSetup, createWorkbook, workbookToBuffer } from '@/lib/export/excel'
import { computeProjectStatus, WRITTEN_EVALUATION_LABEL } from '@/lib/projectStatus'
import { buildParticipationSheet, toExcelDate, type LedgerProject, type ParticipationRow } from './ledgerRows'

const FONT: Partial<ExcelJS.Font> = { name: '맑은 고딕', size: 11 }
const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' },
}

/** 원본 헤더 음영 — "흰색, 배경1, 25% 더 어둡게". */
const HEADER_GRAY = 'FFBFBFBF'
/** 수주 강조 — 원본 2시트에서 수주 참여자 행에 칠해져 있던 색. */
const WIN_YELLOW = 'FFFFFF00'
/** 취소(드랍) 행 — 원본 1시트에서 "서충주 수주로 드랍" 행에 칠해져 있던 "검정, 텍스트1, 50% 밝게". */
const CANCELLED_GRAY = 'FF808080'

/** 원본의 날짜 표시형식. 값이 날짜가 아니면(예: "서면평가") 텍스트가 그대로 보인다. */
const DATE_FORMAT = 'm"/"d;@'

/** 1시트 머리글 — 순서·문구 모두 원본 그대로. O·P가 둘 다 "단장"인 것도 원본과 같다. */
const LEDGER_HEADERS = [
  '연번', '관리번호', '발주방식', '발주처', '용역명', '용역비(억)', 'T P', '배점',
  '제출일', '평가일', '평가결과', '최종 낙찰사', '참가업체', '비고',
  '단장', '단장', '건축', '안전', '토목', '기계',
]

/** 원본에서 잰 열 너비. Q~T(분야 4열)는 원본에 지정이 없어 단장 열과 같은 폭을 준다. */
const LEDGER_WIDTHS = [
  5.875, 9.25, 11.125, 17, 29.375, 13.125, 10.75, 9,
  9.875, 9, 9.5, 12.625, 33, 19.875,
  10.75, 9, 10.75, 10.75, 10.75, 10.75,
]

/** 왼쪽 정렬 열(용역명·참가업체) — 나머지는 전부 가운데 정렬. */
const LEDGER_LEFT_ALIGNED = new Set([5, 13])

const PARTICIPATION_HEADERS = ['번호', '성명', '분야', '참여프로젝트', '누적(회)']
const PARTICIPATION_WIDTHS = [6, 10.625, 7.125, 30.5, 9]
/** 2시트 오른쪽 블록의 참여프로젝트 열만 원본에서 0.25 넓다. */
const PARTICIPATION_RIGHT_WIDTHS = [6, 10.625, 7.125, 30.75, 9]
/** 두 블록 사이 빈 열(F). */
const PARTICIPATION_GAP_COLUMN = 6

/**
 * 시트 기본 열 너비.
 *
 * exceljs는 너비가 정확히 9인 열을 "기본값이라 적을 필요 없다"고 보고 <col>을 통째로 빼버린다
 * (Column#isCustomWidth). 그런데 엑셀의 진짜 기본값은 8.43이라 그대로 두면 원본이 9.0으로 지정한
 * 열(배점·평가일·단장·누적 등)만 눈에 띄게 좁아진다. 시트 기본값 자체를 9로 선언해 맞춘다.
 */
const DEFAULT_COL_WIDTH = 9

function solidFill(argb: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } }
}

/** 값이 숫자로 읽히면 숫자로 넣는다 — 관리번호·배점은 원본에서도 숫자 셀이다. */
function numberOrText(raw: string): number | string {
  const v = raw.trim()
  if (v === '') return ''
  return /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v
}

/** 평가일 칸 — 서면평가 건은 기다릴 발표가 없어 날짜 대신 글자가 들어간다(화면·주간보고와 같은 표기). */
function evaluationDateCell(p: LedgerProject): Date | string {
  if (p.interview_written) return WRITTEN_EVALUATION_LABEL
  return toExcelDate(p.interview_date) ?? ''
}

function buildLedgerSheet(workbook: ExcelJS.Workbook, year: number, projects: LedgerProject[]): void {
  const sheet = workbook.addWorksheet(`${year}년`, { properties: { defaultColWidth: DEFAULT_COL_WIDTH } })

  LEDGER_WIDTHS.forEach((w, i) => { sheet.getColumn(i + 1).width = w })

  // 제목 — 원본은 A가 아니라 B부터 N까지 병합한 자리에 24pt로 적혀 있다.
  const titleRow = sheet.getRow(1)
  titleRow.height = 38.25
  sheet.mergeCells(1, 2, 1, 14)
  const titleCell = sheet.getCell(1, 2)
  titleCell.value = `${String(year).slice(2)}년 프로젝트 관리 대장`
  titleCell.font = { ...FONT, size: 24 }
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' }
  titleCell.border = { bottom: { style: 'thin' } }

  const headerRow = sheet.getRow(2)
  headerRow.height = 23.25
  LEDGER_HEADERS.forEach((label, i) => {
    const cell = headerRow.getCell(i + 1)
    cell.value = label
    cell.font = { ...FONT, bold: true }
    cell.fill = solidFill(HEADER_GRAY)
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    cell.border = THIN_BORDER
  })

  projects.forEach((p, index) => {
    const row = sheet.getRow(3 + index)
    const values: (string | number | Date)[] = [
      index + 1,
      numberOrText(p.project_number),
      p.type ?? '',
      p.client ?? '',
      p.name ?? '',
      p.fee ?? '',
      p.tp_score ?? '',
      numberOrText(p.duration_days ?? ''),
      toExcelDate(p.submit_date) ?? '',
      evaluationDateCell(p),
      p.result_score ?? '',
      p.evaluation ?? '',
      p.participants ?? '',
      p.note ?? '',
      p.director ?? '',
      p.director ?? '',
      p.staff_arch ?? '',
      p.staff_safety ?? '',
      p.staff_civil ?? '',
      p.staff_mech ?? '',
    ]

    // 상태에 따른 행 강조 — 수주는 노랑, 취소(드랍)는 회색. 원본에서 손으로 칠하던 것을 규칙화했다.
    const status = computeProjectStatus(p)
    const fill = status === '수주' ? WIN_YELLOW : status === '취소' ? CANCELLED_GRAY : null

    values.forEach((value, i) => {
      const cell = row.getCell(i + 1)
      cell.value = value
      cell.font = FONT
      cell.border = THIN_BORDER
      cell.alignment = {
        horizontal: LEDGER_LEFT_ALIGNED.has(i + 1) ? 'left' : 'center',
        vertical: 'middle',
      }
      if (i + 1 === 9 || i + 1 === 10) cell.numFmt = DATE_FORMAT
      if (fill) cell.fill = solidFill(fill)
    })
  })

  // 제목·머리글 2행 고정 — 원본의 틀고정(33행)은 편집 중 스크롤 위치가 굳은 것이라 따르지 않는다.
  sheet.views = [{ state: 'frozen', ySplit: 2 }]
  applyPrintSetup(sheet, { orientation: 'landscape' })
}

/** 2시트의 한쪽 블록(왼쪽 책임기술인 / 오른쪽 분야별)을 지정한 시작 열에 그린다. */
function writeParticipationBlock(
  sheet: ExcelJS.Worksheet,
  startColumn: number,
  title: string,
  rows: ParticipationRow[],
  widths: number[],
): void {
  widths.forEach((w, i) => { sheet.getColumn(startColumn + i).width = w })

  sheet.mergeCells(1, startColumn, 1, startColumn + widths.length - 1)
  const titleCell = sheet.getCell(1, startColumn)
  titleCell.value = title
  titleCell.font = { ...FONT, size: 14 }
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' }

  PARTICIPATION_HEADERS.forEach((label, i) => {
    const cell = sheet.getCell(2, startColumn + i)
    cell.value = label
    cell.font = FONT
    cell.fill = solidFill(HEADER_GRAY)
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    cell.border = THIN_BORDER
  })

  rows.forEach((row, index) => {
    const values: (string | number)[] = [
      index + 1,
      row.name,
      row.field,
      row.projectNames.join('\n'),
      row.count,
    ]
    values.forEach((value, i) => {
      const cell = sheet.getCell(3 + index, startColumn + i)
      cell.value = value
      cell.font = FONT
      cell.border = THIN_BORDER
      // 참여프로젝트만 줄바꿈 왼쪽 정렬 — 행 높이는 지정하지 않아 엑셀이 줄 수에 맞춰 늘린다.
      cell.alignment = i === 3
        ? { vertical: 'middle', wrapText: true }
        : { horizontal: 'center', vertical: 'middle' }
      if (row.hasWin) cell.fill = solidFill(WIN_YELLOW)
    })
  })
}

function buildParticipationWorksheet(workbook: ExcelJS.Workbook, year: number, projects: LedgerProject[]): void {
  const sheet = workbook.addWorksheet(`${String(year).slice(2)}년 참여기술자`, {
    properties: { defaultColWidth: DEFAULT_COL_WIDTH },
  })
  const { directors, specialists } = buildParticipationSheet(projects)

  sheet.getRow(1).height = 30.75
  sheet.getRow(2).height = 23.25

  writeParticipationBlock(sheet, 1, '책임기술인 참여현황', directors, PARTICIPATION_WIDTHS)
  writeParticipationBlock(sheet, PARTICIPATION_GAP_COLUMN + 1, '분야별 기술인 참여현황', specialists, PARTICIPATION_RIGHT_WIDTHS)

  applyPrintSetup(sheet, { orientation: 'portrait' })
}

/**
 * 두 시트를 담은 워크북 버퍼. `year`는 시트명·제목에 쓴다(2026 → "2026년" / "26년 프로젝트 관리 대장").
 * `projects`는 이미 정렬·필터가 끝난 상태로 받는다 — 연번은 받은 순서대로 1부터 매긴다.
 */
export async function buildProjectLedgerWorkbook(year: number, projects: LedgerProject[]): Promise<Buffer> {
  const workbook = createWorkbook()
  buildLedgerSheet(workbook, year, projects)
  buildParticipationWorksheet(workbook, year, projects)
  return workbookToBuffer(workbook)
}
