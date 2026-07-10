import { DailySummary, Employee } from '@/lib/overtime/types'
import { formatHours, summaryKey } from '@/lib/overtime/summary'

const DAY_LABEL = ['일', '월', '화', '수', '목', '금', '토']

function toDateStr(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * 월간 연장근무 그리드 — 첫 컬럼(직원)을 sticky로 고정해 "좌측 직원 목록 + 우측 월간 캘린더"를
 * 하나의 표로 표현한다. 셀 값(총 연장시간 "6h" + 건수 배지 "(3)")은 summaries에서 그대로 읽기만
 * 한다 — 합계·건수를 이 컴포넌트가 다시 계산하지 않는다 (계산은 lib/overtime/summary.ts).
 * 셀은 기록이 없어도 클릭 가능 — 비어 있는 날짜도 모달을 열어 업무를 추가할 수 있어야 하기 때문(6단계).
 */
export default function MonthGrid({
  year,
  month, // 0-indexed
  employees,
  summaries,
  onCellClick,
}: {
  year: number
  month: number
  employees: Employee[]
  summaries: Map<string, DailySummary>
  onCellClick: (employeeId: string, date: string) => void
}) {
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1)
  const today = new Date()

  const dayMeta = (day: number) => {
    const date = new Date(year, month, day)
    const weekday = date.getDay()
    const isToday =
      today.getFullYear() === year && today.getMonth() === month && today.getDate() === day
    const color = weekday === 0 ? '#ef4444' : weekday === 6 ? '#3b82f6' : '#555'
    return { weekday, isToday, color }
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #e8e8e6', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 260px)' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              <th style={cornerHeaderCell}>직원</th>
              {days.map(day => {
                const { weekday, isToday, color } = dayMeta(day)
                return (
                  <th key={day} style={{ ...dayHeaderCell, background: isToday ? '#eff6ff' : '#f4f4f2' }}>
                    <div style={{ color, fontWeight: 600 }}>{day}</div>
                    <div style={{ color, opacity: 0.7, fontSize: 10 }}>{DAY_LABEL[weekday]}</div>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {employees.length === 0 ? (
              <tr>
                <td colSpan={days.length + 1} style={{ padding: 40, textAlign: 'center', color: '#bbb' }}>
                  등록된 직원이 없습니다. 직원 관리에서 추가하세요.
                </td>
              </tr>
            ) : (
              employees.map(emp => (
                <tr key={emp.id}>
                  <td style={employeeCell}>
                    <div style={{ fontWeight: 600, color: '#111' }}>{emp.name}</div>
                    {emp.position && <div style={{ fontSize: 10, color: '#999' }}>{emp.position}</div>}
                  </td>
                  {days.map(day => {
                    const dateStr = toDateStr(year, month, day)
                    const summary = summaries.get(summaryKey(emp.id, dateStr))
                    return (
                      <td key={day} style={dataCell} onClick={() => onCellClick(emp.id, dateStr)}>
                        {summary && (
                          <div style={{ position: 'relative', display: 'inline-block' }}>
                            <span style={{ fontWeight: 600, color: '#111' }}>{formatHours(summary.total_hours)}</span>
                            {summary.record_count > 1 && (
                              <span style={countBadge}>({summary.record_count})</span>
                            )}
                          </div>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const stickyBase: React.CSSProperties = {
  position: 'sticky',
  left: 0,
  background: '#fff',
  borderRight: '1px solid #e8e8e6',
}

const cornerHeaderCell: React.CSSProperties = {
  ...stickyBase,
  top: 0,
  zIndex: 3,
  background: '#f4f4f2',
  minWidth: 120,
  padding: '8px 12px',
  textAlign: 'left',
  fontWeight: 500,
  color: '#555',
  borderBottom: '1px solid #e8e8e6',
}

const dayHeaderCell: React.CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 2,
  minWidth: 44,
  padding: '6px 4px',
  textAlign: 'center',
  borderBottom: '1px solid #e8e8e6',
  borderLeft: '1px solid #f0f0ee',
}

const employeeCell: React.CSSProperties = {
  ...stickyBase,
  zIndex: 1,
  minWidth: 120,
  padding: '8px 12px',
  borderBottom: '1px solid #f0f0ee',
  whiteSpace: 'nowrap',
}

const dataCell: React.CSSProperties = {
  minWidth: 44,
  height: 40,
  borderBottom: '1px solid #f0f0ee',
  borderLeft: '1px solid #f0f0ee',
  textAlign: 'center',
  cursor: 'pointer',
}

const countBadge: React.CSSProperties = {
  position: 'absolute',
  top: -8,
  right: -16,
  fontSize: 9,
  color: '#f59e0b',
  fontWeight: 600,
}
