'use client'

import { FinancialSummary, OccupancySummary } from '@/lib/lodging/summary'
import { joinGroupTotals } from '@/lib/lodging/export/summaryTables'
import { formatWon } from '@/lib/export/format'

interface LodgingSummaryPanelProps {
  year: number
  month: number
  occupancy: OccupancySummary
  financial: FinancialSummary
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e8e8e6', borderRadius: 8, padding: '12px 14px' }}>
      <div style={{ fontSize: 11, color: '#999', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: '#111' }}>{value}</div>
    </div>
  )
}

function GroupTable({ title, occupancy, financial }: { title: string; occupancy: OccupancySummary['byProject']; financial: FinancialSummary['byProject'] }) {
  const rows = joinGroupTotals(occupancy, financial)
  if (rows.length === 0) return null
  return (
    <div style={{ background: '#fff', border: '1px solid #e8e8e6', borderRadius: 8, padding: 12, marginBottom: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: '#111' }}>{title}</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #f0f0ee', color: '#666' }}>
            <th style={{ textAlign: 'left', padding: '4px 6px' }}>구분</th>
            <th style={{ textAlign: 'right', padding: '4px 6px' }}>숙박 박수</th>
            <th style={{ textAlign: 'right', padding: '4px 6px' }}>총금액</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.key} style={{ borderBottom: '1px solid #f7f7f6' }}>
              <td style={{ padding: '4px 6px' }}>{r.label}</td>
              <td style={{ padding: '4px 6px', textAlign: 'right' }}>{r.nights}박</td>
              <td style={{ padding: '4px 6px', textAlign: 'right' }}>{formatWon(r.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function LodgingSummaryPanel({ year, month, occupancy, financial }: LodgingSummaryPanelProps) {
  return (
    <div>
      <div style={{ marginBottom: 12, padding: '10px 14px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, fontSize: 12, color: '#92400e' }}>
        숙박현황은 실제 투숙일 기준이며 숙박비는 체크인월에 전액 귀속됩니다.
      </div>

      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: '#111' }}>{year}년 {month}월 숙박현황</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 16 }}>
        <StatCard label="예약 건수" value={`${occupancy.bookingCount}건`} />
        <StatCard label="대표 이용자 수" value={`${occupancy.uniqueGuestCount}명`} />
        <StatCard label="실제 숙박 연인원" value={`${occupancy.actualGuestPersonNights}인박`} />
        <StatCard label="실제 숙박인원 합계" value={`${occupancy.actualGuestSimpleSum}명`} />
        <StatCard label="총 숙박 박수" value={`${occupancy.totalNights}박`} />
        <StatCard label="총 객실박수" value={`${occupancy.totalRoomNights}실박`} />
      </div>

      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: '#111' }}>비용정산 (체크인월 전액 귀속)</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 16 }}>
        <StatCard label="예약 건수" value={`${financial.recordCount}건`} />
        <StatCard label="총금액" value={formatWon(financial.totalAmount)} />
      </div>

      <GroupTable title="프로젝트별 집계" occupancy={occupancy.byProject} financial={financial.byProject} />
      <GroupTable title="업무별 집계" occupancy={occupancy.byPurpose} financial={financial.byPurpose} />
      <GroupTable title="사람별 집계" occupancy={occupancy.byGuest} financial={financial.byGuest} />
    </div>
  )
}
