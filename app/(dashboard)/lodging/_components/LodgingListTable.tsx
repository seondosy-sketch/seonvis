'use client'

import { LodgingRecord } from '@/lib/lodging/types'
import { formatStayPeriod } from '@/lib/lodging/period'
import { formatWon } from '@/lib/export/format'

interface LodgingListTableProps {
  records: LodgingRecord[]
  canWrite: boolean
  onEdit: (record: LodgingRecord) => void
  onDelete: (record: LodgingRecord) => void
}

export default function LodgingListTable({ records, canWrite, onEdit, onDelete }: LodgingListTableProps) {
  if (records.length === 0) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#bbb', fontSize: 13 }}>표시할 숙박 기록이 없습니다.</div>
  }

  return (
    <div style={{ overflowX: 'auto', background: '#fff', border: '1px solid #e8e8e6', borderRadius: 8 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e8e8e6' }}>
            {['대표 이용자', '프로젝트', '업무', '숙소', '룸타입', '체크인', '체크아웃', '숙박기간', '객실수', '단가', '총금액', '비고', ''].map(h => (
              <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: '#666', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {records.map(r => (
            <tr key={r.id} style={{ borderBottom: '1px solid #f0f0ee' }}>
              <td style={td}>
                {r.guest_name_snapshot}
                {r.actual_guest_count > 1 && <span style={{ color: '#999' }}> 외 {r.actual_guest_count - 1}명</span>}
              </td>
              <td style={td}>{r.project_name_snapshot || <span style={{ color: '#bbb' }}>(비프로젝트)</span>}</td>
              <td style={td}>{r.purpose}</td>
              <td style={td}>{r.hotel_name_snapshot}</td>
              <td style={td}>{r.room_type}</td>
              <td style={td}>{r.check_in}</td>
              <td style={td}>{r.check_out}</td>
              <td style={td}>{formatStayPeriod(r.check_in, r.check_out)}</td>
              <td style={td}>{r.room_count}</td>
              <td style={td}>{formatWon(r.price_per_night)}</td>
              <td style={{ ...td, fontWeight: 600 }}>{formatWon(r.total_price)}</td>
              <td style={{ ...td, maxWidth: 160, whiteSpace: 'normal' }}>{r.memo}</td>
              <td style={{ ...td, whiteSpace: 'nowrap' }}>
                {canWrite && (
                  <>
                    <button onClick={() => onEdit(r)} style={miniBtn}>수정</button>
                    <button onClick={() => onDelete(r)} style={{ ...miniBtn, color: '#b91c1c' }}>삭제</button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const td: React.CSSProperties = { padding: '8px 10px', whiteSpace: 'nowrap', color: '#333' }
const miniBtn: React.CSSProperties = { border: '1px solid #e8e8e6', background: '#fff', borderRadius: 4, padding: '3px 8px', fontSize: 11, cursor: 'pointer', marginRight: 4 }
