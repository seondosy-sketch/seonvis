/**
 * 기술인 출근부 — 월별 출근명부 xlsx 조립 (Phase 5).
 * 레이아웃은 docs/attendance/05-export-spec.md §2를 따른다.
 *
 *   행1        제목
 *   행2        대상기간 / 출력일 / 마감 상태
 *   행3        (빈 줄)
 *   행4~6      머리글 — 날짜는 월 병합(4) + 일자(5) + 요일(6) 3단, 나머지 열은 세로 병합
 *   행7~       데이터 (프로젝트별 블록, 프로젝트명·비고는 블록 높이만큼 세로 병합)
 *   마지막 행  합계
 *
 * 출근 칸은 배경색만 칠하지 않고 값 `1`을 명시적으로 넣는다(스펙 §2.3/§5). 오른쪽 "출근일수"는
 * 그 값을 SUM하는 수식이라 화면·파일·합계가 항상 같은 데이터에서 나온다.
 */
import type ExcelJS from 'exceljs'
import {
  applyBorder,
  applyPrintSetup,
  createWorkbook,
  workbookToBuffer,
} from '@/lib/export/excel'
import type { PayPeriodDay } from '../period'
import type { MonthlyExportProjectBlock } from './monthlyRows'

/** 출근 칸 음영 — 스펙 §2.3에서 고정 채택한 값. */
const PRESENT_FILL = 'FFD9D9D9'
/** 체크 가능 기간이 아닌 칸 — 화면의 회색(#f4f4f2)과 같은 뜻. */
const OUT_OF_PERIOD_FILL = 'FFF4F4F2'
const HEADER_FILL = 'FFF4F4F2'
/** 일요일·공휴일 / 토요일 머리글 — 화면 글자색(#ef4444 / #3b82f6)의 연한 배경판. */
const SUNDAY_FILL = 'FFFDEAEA'
const SATURDAY_FILL = 'FFE8F1FD'

const DAY_LABEL = ['일', '월', '화', '수', '목', '금', '토']

const INFO_HEADERS = ['프로젝트', '직책', '분야', '성명']
const INFO_COL_COUNT = INFO_HEADERS.length

export interface MonthlyWorkbookInput {
  year: number
  /** 회계월 라벨(1~12) */
  periodMonth: number
  days: PayPeriodDay[]
  periodStart: string
  periodEnd: string
  blocks: MonthlyExportProjectBlock[]
  /** YYYY-MM-DD 집합 — 머리글 배경을 일요일과 같게 칠한다 */
  holidays: ReadonlySet<string>
  /** 마감 상태 문구. 미마감이면 그 사실을 그대로 적는다 */
  closureLabel: string
  /** 출력 시각(YYYY-MM-DD) — 서버가 KST로 확정해 넘긴다 */
  printedOn: string
}

function dotted(dateStr: string): string {
  return dateStr.replace(/-/g, '.')
}

function fill(cell: ExcelJS.Cell, argb: string): void {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } }
}

export async function buildMonthlyAttendanceWorkbook(input: MonthlyWorkbookInput): Promise<Buffer> {
  const { days, blocks } = input
  const dayCount = days.length
  const firstDayCol = INFO_COL_COUNT + 1
  const lastDayCol = INFO_COL_COUNT + dayCount
  const totalCol = lastDayCol + 1
  const noteCol = totalCol + 1
  const lastCol = noteCol

  const workbook = createWorkbook()
  const worksheet = workbook.addWorksheet(`${input.year}년 ${input.periodMonth}월`)

  // ── 행1: 제목 ────────────────────────────────────────────────────────────
  worksheet.getRow(1).getCell(1).value = `기술인 출근명부 (${input.year}년 ${input.periodMonth}월분)`
  worksheet.mergeCells(1, 1, 1, lastCol)
  const titleCell = worksheet.getCell(1, 1)
  titleCell.font = { size: 16, bold: true }
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' }
  worksheet.getRow(1).height = 26

  // ── 행2: 대상기간 / 출력일 / 마감 ────────────────────────────────────────
  worksheet.getRow(2).getCell(1).value =
    `대상기간 ${dotted(input.periodStart)} ~ ${dotted(input.periodEnd)}    |    출력일 ${input.printedOn}    |    마감 ${input.closureLabel}`
  worksheet.mergeCells(2, 1, 2, lastCol)
  worksheet.getCell(2, 1).font = { size: 10, color: { argb: 'FF666666' } }
  worksheet.getCell(2, 1).alignment = { horizontal: 'left', vertical: 'middle' }

  // 행3은 빈 줄로 남긴다(스펙 §2.1).

  // ── 행4~6: 머리글 ────────────────────────────────────────────────────────
  const HEADER_TOP = 4
  const HEADER_BOTTOM = 6

  INFO_HEADERS.forEach((label, i) => {
    const col = i + 1
    worksheet.mergeCells(HEADER_TOP, col, HEADER_BOTTOM, col)
    const cell = worksheet.getCell(HEADER_TOP, col)
    cell.value = label
    cell.font = { bold: true }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    fill(cell, HEADER_FILL)
  })

  worksheet.mergeCells(HEADER_TOP, totalCol, HEADER_BOTTOM, totalCol)
  worksheet.getCell(HEADER_TOP, totalCol).value = '출근일수'
  worksheet.mergeCells(HEADER_TOP, noteCol, HEADER_BOTTOM, noteCol)
  worksheet.getCell(HEADER_TOP, noteCol).value = '비고'
  for (const col of [totalCol, noteCol]) {
    const cell = worksheet.getCell(HEADER_TOP, col)
    cell.font = { bold: true }
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    fill(cell, HEADER_FILL)
  }

  // 행4: 회계기간이 두 달에 걸치므로 달이 바뀌는 지점마다 병합해 "N월"을 적는다.
  let blockStart = 0
  for (let i = 0; i <= dayCount; i++) {
    const isBoundary = i === dayCount || (i > 0 && days[i].month !== days[blockStart].month)
    if (!isBoundary) continue
    const from = firstDayCol + blockStart
    const to = firstDayCol + i - 1
    if (to > from) worksheet.mergeCells(HEADER_TOP, from, HEADER_TOP, to)
    const cell = worksheet.getCell(HEADER_TOP, from)
    cell.value = `${days[blockStart].month + 1}월`
    cell.font = { bold: true, size: 10 }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    fill(cell, HEADER_FILL)
    blockStart = i
  }

  // 행5·6: 일자와 요일. 주말·공휴일은 배경으로 구분한다.
  days.forEach((d, i) => {
    const col = firstDayCol + i
    const weekday = new Date(d.year, d.month, d.day).getDay()
    const isHoliday = input.holidays.has(d.dateStr)
    const bg = weekday === 0 || isHoliday ? SUNDAY_FILL : weekday === 6 ? SATURDAY_FILL : HEADER_FILL

    const dayCell = worksheet.getCell(5, col)
    dayCell.value = d.day
    dayCell.font = { bold: true, size: 10 }
    dayCell.alignment = { horizontal: 'center', vertical: 'middle' }
    fill(dayCell, bg)

    const labelCell = worksheet.getCell(6, col)
    labelCell.value = DAY_LABEL[weekday]
    labelCell.font = { size: 9, color: { argb: 'FF777777' } }
    labelCell.alignment = { horizontal: 'center', vertical: 'middle' }
    fill(labelCell, bg)
  })

  for (let r = HEADER_TOP; r <= HEADER_BOTTOM; r++) {
    for (let c = 1; c <= lastCol; c++) applyBorder(worksheet.getCell(r, c))
  }
  worksheet.getRow(5).height = 16
  worksheet.getRow(6).height = 14

  // ── 데이터 행 ────────────────────────────────────────────────────────────
  let rowNum = HEADER_BOTTOM + 1
  for (const block of blocks) {
    const blockTop = rowNum
    const rowsInBlock = Math.max(block.participants.length, 1)

    if (block.participants.length === 0) {
      // 참여기술인이 없는 프로젝트도 명부에 남긴다 — 누락과 구분되어야 한다(화면과 동일).
      worksheet.getCell(rowNum, 2).value = '등록된 참여기술인 없음'
      worksheet.mergeCells(rowNum, 2, rowNum, totalCol)
      worksheet.getCell(rowNum, 2).font = { color: { argb: 'FF999999' }, size: 10 }
      worksheet.getCell(rowNum, 2).alignment = { horizontal: 'left', vertical: 'middle' }
      rowNum++
    } else {
      for (const p of block.participants) {
        const presentSet = new Set(p.presentDates)
        const eligibleSet = new Set(p.eligibleDates)

        worksheet.getCell(rowNum, 2).value = p.role
        worksheet.getCell(rowNum, 3).value = p.specialty
        worksheet.getCell(rowNum, 4).value = p.name
        for (const col of [2, 3, 4]) {
          worksheet.getCell(rowNum, col).alignment = { horizontal: 'center', vertical: 'middle' }
        }
        if (p.isDirector) worksheet.getCell(rowNum, 2).font = { bold: true }

        days.forEach((d, i) => {
          const cell = worksheet.getCell(rowNum, firstDayCol + i)
          if (presentSet.has(d.dateStr)) {
            cell.value = 1
            fill(cell, PRESENT_FILL)
            cell.font = { bold: true }
          } else if (!eligibleSet.has(d.dateStr)) {
            fill(cell, OUT_OF_PERIOD_FILL)
          }
          cell.alignment = { horizontal: 'center', vertical: 'middle' }
        })

        // 합계는 하드코딩하지 않고 그 행의 날짜 칸을 SUM한다(스펙 §2.3).
        const firstRef = worksheet.getCell(rowNum, firstDayCol).address
        const lastRef = worksheet.getCell(rowNum, lastDayCol).address
        const totalCell = worksheet.getCell(rowNum, totalCol)
        totalCell.value = { formula: `SUM(${firstRef}:${lastRef})`, result: p.presentCount }
        totalCell.font = { bold: true }
        totalCell.alignment = { horizontal: 'center', vertical: 'middle' }

        rowNum++
      }
    }

    const blockBottom = rowNum - 1

    // 프로젝트명은 블록 높이만큼 세로 병합한다(스펙 §2.2). 직책은 행마다 값이 다르므로 병합하지
    // 않는다 — 스펙 문구에는 "프로젝트명·직책"으로 적혀 있으나 직책을 병합하면 단장/분야 구분이
    // 사라져 명부로서 뜻이 달라진다. 화면 그리드도 프로젝트 칸만 rowSpan한다.
    if (blockBottom > blockTop) worksheet.mergeCells(blockTop, 1, blockBottom, 1)
    const projectCell = worksheet.getCell(blockTop, 1)
    projectCell.value = block.projectNumber
      ? `${block.projectName}\n(${block.projectNumber})`
      : block.projectName
    projectCell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true }
    projectCell.font = { bold: true }

    // 비고는 프로젝트 단위 값(변경이력)이라 같은 높이로 병합한다.
    if (blockBottom > blockTop) worksheet.mergeCells(blockTop, noteCol, blockBottom, noteCol)
    const noteCell = worksheet.getCell(blockTop, noteCol)
    noteCell.value = block.note
    noteCell.alignment = { horizontal: 'left', vertical: 'top', wrapText: true }
    noteCell.font = { size: 10 }

    for (let r = blockTop; r <= blockBottom; r++) {
      worksheet.getRow(r).height = 22
      for (let c = 1; c <= lastCol; c++) applyBorder(worksheet.getCell(r, c))
    }

    // 비고가 길면 병합된 칸 안에서 잘리므로 블록 첫 행 높이를 줄 수에 비례해 키운다(스펙 §2.5).
    const noteLines = block.note ? block.note.split('\n').length : 0
    if (noteLines > rowsInBlock) {
      worksheet.getRow(blockTop).height = Math.max(22, 22 * (noteLines - rowsInBlock + 1))
    }
  }

  // ── 합계 행 ──────────────────────────────────────────────────────────────
  const sumRow = rowNum
  worksheet.getCell(sumRow, 1).value = `합계 (프로젝트 ${blocks.length}건)`
  worksheet.mergeCells(sumRow, 1, sumRow, INFO_COL_COUNT)
  worksheet.getCell(sumRow, 1).font = { bold: true }
  worksheet.getCell(sumRow, 1).alignment = { horizontal: 'center', vertical: 'middle' }

  days.forEach((d, i) => {
    const col = firstDayCol + i
    const from = worksheet.getCell(HEADER_BOTTOM + 1, col).address
    const to = worksheet.getCell(sumRow - 1, col).address
    const cell = worksheet.getCell(sumRow, col)
    if (sumRow > HEADER_BOTTOM + 1) cell.value = { formula: `SUM(${from}:${to})`, result: undefined }
    cell.font = { bold: true }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
  })

  const grandFrom = worksheet.getCell(HEADER_BOTTOM + 1, totalCol).address
  const grandTo = worksheet.getCell(sumRow - 1, totalCol).address
  const grandCell = worksheet.getCell(sumRow, totalCol)
  if (sumRow > HEADER_BOTTOM + 1) grandCell.value = { formula: `SUM(${grandFrom}:${grandTo})`, result: undefined }
  grandCell.font = { bold: true }
  grandCell.alignment = { horizontal: 'center', vertical: 'middle' }

  for (let c = 1; c <= lastCol; c++) {
    const cell = worksheet.getCell(sumRow, c)
    fill(cell, HEADER_FILL)
    applyBorder(cell)
  }

  // ── 열 너비 / 틀고정 / 인쇄 설정 ─────────────────────────────────────────
  worksheet.getColumn(1).width = 26
  worksheet.getColumn(2).width = 10
  worksheet.getColumn(3).width = 10
  worksheet.getColumn(4).width = 10
  for (let c = firstDayCol; c <= lastDayCol; c++) worksheet.getColumn(c).width = 3.5
  worksheet.getColumn(totalCol).width = 8
  worksheet.getColumn(noteCol).width = 11.875 // 첨부 엑셀 실측값(스펙 §2.5)

  worksheet.views = [{ state: 'frozen', xSplit: INFO_COL_COUNT, ySplit: HEADER_BOTTOM }]

  applyPrintSetup(worksheet, { orientation: 'landscape' })
  worksheet.pageSetup.printTitlesRow = `1:${HEADER_BOTTOM}`
  worksheet.pageSetup.printTitlesColumn = `A:${worksheet.getColumn(INFO_COL_COUNT).letter}`
  worksheet.headerFooter = { oddFooter: '&R&P / &N 페이지' }

  return workbookToBuffer(workbook)
}
