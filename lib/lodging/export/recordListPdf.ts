/**
 * 숙박관리 — 숙박 내역(record-list) PDF 출력. Excel과 열 구성은 같지만 페이지 넘김 등
 * 인쇄 적합성 위주로 구성 — 픽셀 단위로 동일할 필요는 없다.
 */
import { buildPdfBuffer, commonTableLayout, withPdfDefaults, type Content } from '@/lib/export/pdf'
import { formatWon } from '@/lib/export/format'
import { formatStayPeriod } from '@/lib/lodging/period'
import { LodgingRecord } from '@/lib/lodging/types'

const HEADERS = ['대표 이용자', '프로젝트', '업무', '숙소', '룸타입', '체크인', '체크아웃', '숙박기간', '객실수', '단가', '총금액', '비고']

export async function buildRecordListPdf(records: LodgingRecord[], title: string): Promise<Buffer> {
  const body = [
    HEADERS.map(h => ({ text: h, bold: true })),
    ...records.map(r => [
      r.guest_name_snapshot,
      r.project_name_snapshot || '(비프로젝트)',
      r.purpose,
      r.hotel_name_snapshot,
      r.room_type,
      r.check_in,
      r.check_out,
      formatStayPeriod(r.check_in, r.check_out),
      String(r.room_count),
      formatWon(r.price_per_night),
      formatWon(r.total_price),
      r.memo,
    ]),
  ]

  const content: Content[] = [
    { text: title, fontSize: 14, bold: true, margin: [0, 0, 0, 10] },
    {
      table: { headerRows: 1, widths: Array(HEADERS.length).fill('auto'), body },
      layout: commonTableLayout,
      fontSize: 8,
    },
  ]
  const docDefinition = withPdfDefaults(content)

  return buildPdfBuffer(docDefinition)
}
