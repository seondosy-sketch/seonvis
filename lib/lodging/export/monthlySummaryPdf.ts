/**
 * 숙박관리 — 월별 정산서(monthly-summary) PDF 출력. xlsx와 동일한 내용을 인쇄 적합 레이아웃으로 구성.
 */
import { buildPdfBuffer, commonTableLayout, withPdfDefaults, type Content } from '@/lib/export/pdf'
import { formatWon } from '@/lib/export/format'
import { FinancialSummary, OccupancySummary } from '@/lib/lodging/summary'
import { joinGroupTotals } from './summaryTables'

const NOTE = '숙박현황은 실제 투숙일 기준이며 숙박비는 체크인월에 전액 귀속됩니다.'

function groupTable(title: string, occupancy: OccupancySummary['byProject'], financial: FinancialSummary['byProject']): Content[] {
  const rows = joinGroupTotals(occupancy, financial)
  return [
    { text: title, bold: true, margin: [0, 10, 0, 4] },
    {
      table: {
        headerRows: 1,
        widths: ['*', 'auto', 'auto'],
        body: [
          [{ text: '구분', bold: true }, { text: '숙박 박수', bold: true }, { text: '총금액', bold: true }],
          ...rows.map(r => [r.label, `${r.nights}박`, formatWon(r.amount)]),
        ],
      },
      layout: commonTableLayout,
      fontSize: 9,
    },
  ]
}

export async function buildMonthlySummaryPdf(
  occupancy: OccupancySummary,
  financial: FinancialSummary,
  year: number,
  month: number,
): Promise<Buffer> {
  const content: Content[] = [
    { text: `숙박관리 월별 정산서 (${year}년 ${month}월)`, fontSize: 14, bold: true, margin: [0, 0, 0, 4] },
    { text: NOTE, italics: true, color: '#666666', margin: [0, 0, 0, 10] },
    { text: '숙박현황', bold: true, fontSize: 11 },
    {
      ul: [
        `예약 건수: ${occupancy.bookingCount}건`,
        `대표 이용자 수: ${occupancy.uniqueGuestCount}명`,
        `실제 숙박 연인원: ${occupancy.actualGuestPersonNights}인박`,
        `실제 숙박인원 단순 합계: ${occupancy.actualGuestSimpleSum}명`,
        `총 숙박 박수: ${occupancy.totalNights}박`,
        `총 객실박수: ${occupancy.totalRoomNights}실박`,
      ],
    },
    { text: '비용정산 (체크인월 전액 귀속)', bold: true, fontSize: 11, margin: [0, 10, 0, 0] },
    { ul: [`예약 건수: ${financial.recordCount}건`, `총금액: ${formatWon(financial.totalAmount)}`] },
    ...groupTable('프로젝트별 집계', occupancy.byProject, financial.byProject),
    ...groupTable('업무별 집계', occupancy.byPurpose, financial.byPurpose),
    ...groupTable('사람별 집계', occupancy.byGuest, financial.byGuest),
  ]
  const docDefinition = withPdfDefaults(content, 'portrait')

  return buildPdfBuffer(docDefinition)
}
