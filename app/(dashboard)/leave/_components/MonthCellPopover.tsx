import { LeaveEmployee, LeaveRecord, LeaveRecordDate, LeaveType } from '@/lib/leave/types'
import { formatDays, sumDeducted } from '@/lib/leave/calc'

/**
 * 월 셀 상세보기 — 그 직원·그 달의 개별 휴가 내역. 집계 확인 용도의 읽기 전용 창.
 * 수정은 상세이력 테이블의 수정 버튼으로만 한다 (요구 11).
 * 위치 계산은 projects 페이지 메모 팝업과 같은 방식 (fixed + viewport 클램프).
 */
export default function MonthCellPopover({
  employee,
  year,
  month,
  records,
  dates,
  leaveTypes,
  anchor,
  onClose,
}: {
  employee: LeaveEmployee
  year: number
  month: number
  records: LeaveRecord[]
  dates: LeaveRecordDate[]
  leaveTypes: LeaveType[]
  anchor: { x: number; y: number }
  onClose: () => void
}) {
  const typeName = new Map(leaveTypes.map(t => [t.id, t.name]))
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}`

  // record별로 이 달에 속한 날짜만 모아 요약 행을 만든다
  const rows = records.map(rec => {
    const inMonth = dates
      .filter(d => d.leave_record_id === rec.id && d.leave_date.startsWith(monthPrefix))
      .sort((a, b) => a.leave_date.localeCompare(b.leave_date))
    if (inMonth.length === 0) return null
    const first = inMonth[0].leave_date, last = inMonth[inMonth.length - 1].leave_date
    const fmt = (d: string) => `${parseInt(d.slice(5, 7), 10)}/${parseInt(d.slice(8, 10), 10)}`
    return {
      id: rec.id,
      range: first === last ? fmt(first) : `${fmt(first)}~${fmt(last)}`,
      type: typeName.get(rec.leave_type_id) ?? '?',
      deducted: sumDeducted(inMonth),
      startDate: first,
    }
  }).filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))

  const total = sumDeducted(rows.map(r => ({ deducted_days: r.deducted })))

  const popupW = 280
  const popupH = Math.min(90 + rows.length * 30, 320)
  const top = window.innerHeight - anchor.y >= popupH + 12 ? anchor.y + 8 : anchor.y - popupH - 8
  const left = Math.min(Math.max(anchor.x - popupW / 2, 8), window.innerWidth - popupW - 8)

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300 }} onClick={onClose}>
      <div
        style={{ position: 'fixed', top, left, width: popupW, background: '#fff', border: '1px solid #e8e8e6', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', padding: 12 }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ fontSize: 12, fontWeight: 600, color: '#111', marginBottom: 8 }}>
          {employee.name} · {year}년 {month}월 · 사용 <span style={{ color: '#b45309' }}>{formatDays(total)}일</span>
        </div>
        <div style={{ maxHeight: 220, overflowY: 'auto' }}>
          {rows.map(r => (
            <div key={r.id} style={{ display: 'flex', gap: 8, padding: '6px 0', borderBottom: '1px solid #f5f5f3', fontSize: 12 }}>
              <span style={{ color: '#555', width: 76, flexShrink: 0 }}>{r.range}</span>
              <span style={{ color: '#111', flex: 1 }}>{r.type}</span>
              <span style={{ fontWeight: 600, color: r.deducted > 0 ? '#b45309' : '#999' }}>
                {r.deducted > 0 ? `${formatDays(r.deducted)}일` : '차감 없음'}
              </span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 8, fontSize: 10, color: '#bbb' }}>수정은 직원 행을 클릭해 상세이력에서 하세요</div>
      </div>
    </div>
  )
}
