import { AnnualLeaveBalance, LeaveEmployee } from '@/lib/leave/types'
import { formatDays, sumDeducted } from '@/lib/leave/calc'

/**
 * 직원 × 월(1~12) 메인 그리드.
 * 좌측(직급·직원명·입사일·부여)과 우측(사용·잔여)은 sticky 고정, 월 영역은 가로 스크롤.
 * 분기 경계(4월·7월·10월)에 굵은 세로선 — 참고 엑셀의 분기 구분을 재현.
 * 월 셀은 집계 확인 용도(클릭 → 읽기 전용 상세 팝오버), 직접 수정 불가.
 */
export default function LeaveYearTable({
  employees,
  balances,
  monthly,
  used,
  selectedEmployeeId,
  onRowClick,
  onCellClick,
}: {
  employees: LeaveEmployee[]
  balances: Map<string, AnnualLeaveBalance>
  monthly: Map<string, number[]>
  used: Map<string, number>
  selectedEmployeeId: string | null
  onRowClick: (employeeId: string) => void
  onCellClick: (employeeId: string, month: number, anchor: { x: number; y: number }) => void
}) {
  // sticky 열 좌표 — 배경을 칠해야 스크롤 시 월 셀이 밑으로 지나가는 게 안 보인다
  const LEFT_COLS = [
    { label: '직급', width: 64, left: 0 },
    { label: '직원명', width: 84, left: 64 },
    { label: '입사일', width: 92, left: 148 },
    { label: '부여', width: 56, left: 240 },
  ]
  const RIGHT_COLS = [
    { label: '사용', width: 56, right: 56 },
    { label: '잔여', width: 56, right: 0 },
  ]

  return (
    <div style={{ background: '#fff', border: '1px solid #e8e8e6', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 240px)' }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 0, fontSize: 12, width: '100%', minWidth: 296 + 12 * 56 + 112 }}>
          <thead>
            <tr>
              {LEFT_COLS.map(c => (
                <th key={c.label} style={{ ...headerCell, position: 'sticky', top: 0, left: c.left, zIndex: 4, minWidth: c.width, width: c.width, borderRight: c.label === '부여' ? '2px solid #ddd' : headerCell.borderRight }}>
                  {c.label}
                </th>
              ))}
              {MONTHS.map(m => (
                <th key={m} style={{ ...headerCell, position: 'sticky', top: 0, zIndex: 3, textAlign: 'center', minWidth: 52, borderLeft: isQuarterStart(m) ? '2px solid #ccc' : headerCell.borderLeft }}>
                  {m}월
                </th>
              ))}
              {RIGHT_COLS.map(c => (
                <th key={c.label} style={{ ...headerCell, position: 'sticky', top: 0, right: c.right, zIndex: 4, textAlign: 'center', minWidth: c.width, width: c.width, borderLeft: c.label === '사용' ? '2px solid #ddd' : headerCell.borderLeft }}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {employees.length === 0 ? (
              <tr><td colSpan={18} style={{ padding: 40, textAlign: 'center', color: '#bbb' }}>표시할 직원이 없습니다</td></tr>
            ) : employees.map(emp => {
              const bal = balances.get(emp.id)
              const granted = bal ? sumDeducted([{ deducted_days: bal.granted_days }, { deducted_days: bal.adjustment_days }]) : null
              const months = monthly.get(emp.id) ?? Array(12).fill(0)
              const usedDays = used.get(emp.id) ?? 0
              const remaining = granted !== null ? Math.round((granted - usedDays) * 2) / 2 : null
              const selected = selectedEmployeeId === emp.id
              const rowBg = selected ? '#fef9f0' : '#fff'
              return (
                <tr key={emp.id} onClick={() => onRowClick(emp.id)} style={{ cursor: 'pointer' }}>
                  <td style={{ ...stickyCell, left: 0, minWidth: 64, background: rowBg }}>{emp.position}</td>
                  <td style={{ ...stickyCell, left: 64, minWidth: 84, background: rowBg, fontWeight: 600, color: '#111' }}>
                    {emp.name}{!emp.is_active && <span style={{ fontWeight: 400, color: '#999' }}> (퇴사)</span>}
                  </td>
                  <td style={{ ...stickyCell, left: 148, minWidth: 92, background: rowBg, color: '#555' }}>{emp.hire_date ?? '-'}</td>
                  <td style={{ ...stickyCell, left: 240, minWidth: 56, background: rowBg, textAlign: 'center', borderRight: '2px solid #ddd', fontWeight: 600 }}>
                    {granted !== null ? formatDays(granted) : '-'}
                  </td>
                  {MONTHS.map((m, i) => {
                    const v = months[i]
                    const hasValue = v > 0
                    return (
                      <td
                        key={m}
                        onClick={e => { e.stopPropagation(); if (hasValue) onCellClick(emp.id, m, { x: e.clientX, y: e.clientY }) }}
                        title={hasValue ? '클릭하면 상세 내역을 봅니다' : undefined}
                        style={{
                          ...dataCell,
                          borderLeft: isQuarterStart(m) ? '2px solid #ccc' : dataCell.borderLeft,
                          background: hasValue ? '#fffbeb' : '#fff',
                          color: hasValue ? '#b45309' : '#ccc',
                          fontWeight: hasValue ? 600 : 400,
                          cursor: hasValue ? 'pointer' : 'default',
                        }}
                      >
                        {hasValue ? formatDays(v) : ''}
                      </td>
                    )
                  })}
                  <td style={{ ...stickyCell, right: 56, minWidth: 56, background: rowBg, textAlign: 'center', borderLeft: '2px solid #ddd', fontWeight: 600, color: '#b91c1c' }}>
                    {usedDays > 0 ? formatDays(usedDays) : ''}
                  </td>
                  <td style={{
                    ...stickyCell, right: 0, minWidth: 56, textAlign: 'center', fontWeight: 700,
                    background: remaining !== null && remaining <= 0 ? '#fef2f2' : rowBg,
                    color: remaining !== null && remaining <= 0 ? '#b91c1c' : '#1d4ed8',
                  }}>
                    {remaining !== null ? formatDays(remaining) : '-'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div style={{ padding: '6px 12px', borderTop: '1px solid #f0f0ee', fontSize: 11, color: '#999', display: 'flex', gap: 14 }}>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 2, verticalAlign: -1 }} /> 사용한 달</span>
        <span>잔여 = 부여(기본+조정) − 사용 · 행 클릭 → 상세이력 · 월 칸 클릭 → 그 달 내역</span>
      </div>
    </div>
  )
}

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
const isQuarterStart = (m: number) => m === 4 || m === 7 || m === 10

const headerCell: React.CSSProperties = {
  background: '#f4f4f2',
  padding: '8px 10px',
  textAlign: 'left',
  fontWeight: 500,
  color: '#555',
  borderBottom: '1px solid #e8e8e6',
  borderLeft: '1px solid #f0f0ee',
  whiteSpace: 'nowrap',
}

const stickyCell: React.CSSProperties = {
  position: 'sticky',
  zIndex: 2,
  padding: '8px 10px',
  borderBottom: '1px solid #f0f0ee',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

const dataCell: React.CSSProperties = {
  padding: '8px 4px',
  borderBottom: '1px solid #f0f0ee',
  borderLeft: '1px solid #f0f0ee',
  textAlign: 'center',
  whiteSpace: 'nowrap',
}
