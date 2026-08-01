/**
 * 숙박관리 — 숙박 내역(record-list) xlsx 출력.
 * 표 형태: 대표 이용자/프로젝트/업무/숙소/룸타입/체크인/체크아웃/숙박기간/객실수/단가/총금액/비고.
 */
import {
  addTitleRow,
  applyPrintSetup,
  applyRowBorder,
  createWorkbook,
  freezeHeaderRows,
  styleHeaderRow,
  workbookToBuffer,
} from '@/lib/export/excel'
import { formatWon } from '@/lib/export/format'
import { formatStayPeriod } from '@/lib/lodging/period'
import { LodgingRecord } from '@/lib/lodging/types'

const HEADERS = ['대표 이용자', '프로젝트', '업무', '숙소', '룸타입', '체크인', '체크아웃', '숙박기간', '객실수', '단가', '총금액', '비고']
const COL_COUNT = HEADERS.length

export async function buildRecordListWorkbook(records: LodgingRecord[], title: string): Promise<Buffer> {
  const workbook = createWorkbook()
  const worksheet = workbook.addWorksheet('숙박 내역')

  addTitleRow(worksheet, title, COL_COUNT)
  worksheet.addRow([])

  const headerRow = worksheet.addRow(HEADERS)
  styleHeaderRow(headerRow)

  for (const r of records) {
    const row = worksheet.addRow([
      r.guest_name_snapshot,
      r.project_name_snapshot || '(비프로젝트)',
      r.purpose,
      r.hotel_name_snapshot,
      r.room_type,
      r.check_in,
      r.check_out,
      formatStayPeriod(r.check_in, r.check_out),
      r.room_count,
      formatWon(r.price_per_night),
      formatWon(r.total_price),
      r.memo,
    ])
    applyRowBorder(row)
  }

  worksheet.columns.forEach(col => { col.width = 14 })
  freezeHeaderRows(worksheet, 3)
  applyPrintSetup(worksheet, { orientation: 'landscape' })

  return workbookToBuffer(workbook)
}
