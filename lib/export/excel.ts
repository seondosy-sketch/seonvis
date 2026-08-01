/**
 * 공통 Export 인프라 — exceljs 저수준 도우미.
 * 제목/헤더 스타일, 테두리, 인쇄설정, 틀고정처럼 어떤 출력물에도 반복되는 부분만 다룬다.
 * 실제 시트 레이아웃(달력, 상세카드, 표 등)은 각 기능의 export 레이어가 이 함수들을 조합해 만든다.
 */
import ExcelJS from 'exceljs'
import { PrintSetupOptions } from './types'

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin' },
  left: { style: 'thin' },
  bottom: { style: 'thin' },
  right: { style: 'thin' },
}

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFD9D9D9' },
}

export function createWorkbook(): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = '미래 Hub'
  workbook.created = new Date()
  return workbook
}

/** 시트 맨 위 제목 행 — colSpan만큼 병합, 굵게, 가운데 정렬. */
export function addTitleRow(worksheet: ExcelJS.Worksheet, text: string, colSpan: number, fontSize = 16): void {
  const row = worksheet.addRow([text])
  worksheet.mergeCells(row.number, 1, row.number, colSpan)
  const cell = worksheet.getCell(row.number, 1)
  cell.font = { size: fontSize, bold: true }
  cell.alignment = { horizontal: 'center', vertical: 'middle' }
}

/** 헤더 행 스타일 — 회색 음영 + 굵게 + 가운데 정렬 + 테두리. */
export function styleHeaderRow(row: ExcelJS.Row): void {
  row.eachCell(cell => {
    cell.fill = HEADER_FILL
    cell.font = { bold: true }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    cell.border = THIN_BORDER
  })
}

/** 셀 하나에 얇은 테두리 적용. */
export function applyBorder(cell: ExcelJS.Cell): void {
  cell.border = THIN_BORDER
}

/** 행 전체에 얇은 테두리 적용(데이터 행). */
export function applyRowBorder(row: ExcelJS.Row): void {
  row.eachCell(cell => applyBorder(cell))
}

/** 인쇄영역 공통 설정 — A4, 지정 방향, 가로 1페이지 폭에 맞춤(세로는 자연 확장). */
export function applyPrintSetup(worksheet: ExcelJS.Worksheet, opts: PrintSetupOptions): void {
  worksheet.pageSetup = {
    ...worksheet.pageSetup,
    paperSize: 9, // A4
    orientation: opts.orientation,
    fitToPage: true,
    fitToWidth: opts.fitToWidth ?? 1,
    fitToHeight: opts.fitToHeight ?? 0,
    margins: { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
  }
}

/** 상단 rowCount개 행을 틀고정(스크롤해도 헤더가 항상 보이게). */
export function freezeHeaderRows(worksheet: ExcelJS.Worksheet, rowCount: number): void {
  worksheet.views = [{ state: 'frozen', ySplit: rowCount }]
}

export async function workbookToBuffer(workbook: ExcelJS.Workbook): Promise<Buffer> {
  const arrayBuffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(arrayBuffer)
}
