'use client'

import { LodgingRecord } from '@/lib/lodging/types'
import { isDateOccupied } from '@/lib/lodging/monthRange'

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토']

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function toDateStr(year: number, month0: number, day: number): string {
  return `${year}-${pad2(month0 + 1)}-${pad2(day)}`
}

interface LodgingCalendarProps {
  year: number
  month: number  // 1~12
  records: LodgingRecord[]
  todayStr: string
  selectedDate: string | null
  onSelectDate: (dateStr: string) => void
}

/**
 * 날짜별 배지 = 그 날짜에 재실 중인 레코드의 actual_guest_count 합계(실제 인원)를 기본값으로
 * 표시하고, 예약 건수도 함께 표시한다(예: "3명 (2건)") — 대표 이용자 레코드 수만 세지 않는다
 * (사용자 확정 원칙).
 */
export default function LodgingCalendar({ year, month, records, todayStr, selectedDate, onSelectDate }: LodgingCalendarProps) {
  const month0 = month - 1
  const firstOfMonth = new Date(year, month0, 1)
  const daysInMonth = new Date(year, month0 + 1, 0).getDate()
  const leadingBlanks = firstOfMonth.getDay()

  const cells: Array<{ day: number; dateStr: string } | null> = []
  for (let i = 0; i < leadingBlanks; i++) cells.push(null)
  for (let day = 1; day <= daysInMonth; day++) cells.push({ day, dateStr: toDateStr(year, month0, day) })
  while (cells.length % 7 !== 0) cells.push(null)

  return (
    <div style={{ background: '#fff', border: '1px solid #e8e8e6', borderRadius: 8, padding: '0 8px 8px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, paddingTop: 8 }}>
        {DAY_NAMES.map((d, i) => (
          <div key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: 500, padding: '6px 0', color: i === 0 ? '#ef4444' : i === 6 ? '#3b82f6' : '#888' }}>
            {d}
          </div>
        ))}

        {cells.map((cell, idx) => {
          if (!cell) return <div key={idx} />
          const di = idx % 7
          const occupying = records.filter(r => isDateOccupied(r, cell.dateStr))
          const guestCount = occupying.reduce((sum, r) => sum + r.actual_guest_count, 0)
          const bookingCount = occupying.length
          const isToday = cell.dateStr === todayStr
          const isSelected = cell.dateStr === selectedDate

          return (
            <div
              key={idx}
              onClick={() => onSelectDate(cell.dateStr)}
              style={{
                borderRadius: 6,
                border: isSelected ? '1px solid #111' : '1px solid #e8e8e6',
                background: isSelected ? '#f3f4f6' : '#fff',
                padding: '6px 5px',
                minHeight: 64,
                cursor: 'pointer',
              }}
            >
              <div style={{
                width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: isToday ? '#111' : 'transparent', fontSize: 12, fontWeight: isToday ? 600 : 400,
                color: isToday ? '#fff' : di === 0 ? '#ef4444' : di === 6 ? '#3b82f6' : '#333',
              }}>
                {cell.day}
              </div>
              {bookingCount > 0 && (
                <div style={{ marginTop: 4, fontSize: 11, color: '#1e40af', lineHeight: 1.3 }}>
                  {guestCount}명 <span style={{ color: '#93c5fd' }}>({bookingCount}건)</span>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
