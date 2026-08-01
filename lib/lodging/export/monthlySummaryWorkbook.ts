/**
 * 숙박관리 — 월별 정산서(monthly-summary) xlsx 출력.
 * 숙박현황(occupancy)과 비용정산(financial)을 명확히 분리해 표시 — 화면(LodgingSummaryPanel)과
 * 동일한 안내 문구를 그대로 싣는다.
 */
import { addTitleRow, applyPrintSetup, applyRowBorder, createWorkbook, styleHeaderRow, workbookToBuffer } from '@/lib/export/excel'
import { formatWon } from '@/lib/export/format'
import { FinancialSummary, OccupancySummary } from '@/lib/lodging/summary'
import { joinGroupTotals } from './summaryTables'

const NOTE = '숙박현황은 실제 투숙일 기준이며 숙박비는 체크인월에 전액 귀속됩니다.'
const COL_COUNT = 4

function addKeyValueRows(worksheet: import('exceljs').Worksheet, rows: Array<[string, string | number]>) {
  for (const [label, value] of rows) {
    const row = worksheet.addRow([label, value])
    applyRowBorder(row)
  }
}

function addJoinedGroupTable(
  worksheet: import('exceljs').Worksheet,
  title: string,
  occupancy: OccupancySummary['byProject'],
  financial: FinancialSummary['byProject'],
) {
  worksheet.addRow([])
  const headingRow = worksheet.addRow([title])
  headingRow.font = { bold: true }

  const headerRow = worksheet.addRow(['구분', '숙박 박수', '총금액', ''])
  styleHeaderRow(headerRow)

  for (const g of joinGroupTotals(occupancy, financial)) {
    const row = worksheet.addRow([g.label, g.nights, formatWon(g.amount), ''])
    applyRowBorder(row)
  }
}

export async function buildMonthlySummaryWorkbook(
  occupancy: OccupancySummary,
  financial: FinancialSummary,
  year: number,
  month: number,
): Promise<Buffer> {
  const workbook = createWorkbook()
  const worksheet = workbook.addWorksheet('월별 정산서')

  addTitleRow(worksheet, `숙박관리 월별 정산서 (${year}년 ${month}월)`, COL_COUNT)
  const noteRow = worksheet.addRow([NOTE])
  worksheet.mergeCells(noteRow.number, 1, noteRow.number, COL_COUNT)
  noteRow.font = { italic: true, color: { argb: 'FF666666' } }
  worksheet.addRow([])

  const occupancyHeader = worksheet.addRow(['숙박현황'])
  occupancyHeader.font = { bold: true, size: 12 }
  addKeyValueRows(worksheet, [
    ['예약 건수', `${occupancy.bookingCount}건`],
    ['대표 이용자 수', `${occupancy.uniqueGuestCount}명`],
    ['실제 숙박 연인원', `${occupancy.actualGuestPersonNights}인박`],
    ['실제 숙박인원 단순 합계', `${occupancy.actualGuestSimpleSum}명`],
    ['총 숙박 박수', `${occupancy.totalNights}박`],
    ['총 객실박수', `${occupancy.totalRoomNights}실박`],
  ])

  worksheet.addRow([])
  const financialHeader = worksheet.addRow(['비용정산 (체크인월 전액 귀속)'])
  financialHeader.font = { bold: true, size: 12 }
  addKeyValueRows(worksheet, [
    ['예약 건수', `${financial.recordCount}건`],
    ['총금액', formatWon(financial.totalAmount)],
  ])

  addJoinedGroupTable(worksheet, '프로젝트별 집계', occupancy.byProject, financial.byProject)
  addJoinedGroupTable(worksheet, '업무별 집계', occupancy.byPurpose, financial.byPurpose)
  addJoinedGroupTable(worksheet, '사람별 집계', occupancy.byGuest, financial.byGuest)

  worksheet.columns.forEach(col => { col.width = 20 })
  applyPrintSetup(worksheet, { orientation: 'portrait' })

  return workbookToBuffer(workbook)
}
