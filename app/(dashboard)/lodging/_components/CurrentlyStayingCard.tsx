'use client'

import { LodgingRecord } from '@/lib/lodging/types'
import { currentlyStayingRecords } from '@/lib/lodging/status'

export default function CurrentlyStayingCard({ records, todayStr }: { records: LodgingRecord[]; todayStr: string }) {
  const staying = currentlyStayingRecords(records, todayStr)
  if (staying.length === 0) return null

  return (
    <div style={{ marginBottom: 12, padding: '10px 14px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 6 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#1e40af', marginBottom: 6 }}>
        오늘 체크인 중 ({staying.length}건)
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {staying.map(r => (
          <span key={r.id} style={{ fontSize: 12, padding: '3px 10px', background: '#fff', border: '1px solid #bfdbfe', borderRadius: 12, color: '#1e3a8a' }}>
            {r.guest_name_snapshot}
            {r.actual_guest_count > 1 ? ` 외 ${r.actual_guest_count - 1}명` : ''} · {r.hotel_name_snapshot}
          </span>
        ))}
      </div>
    </div>
  )
}
