import { DailySummary, Employee } from '@/lib/overtime/types'
import { formatHours, PayPeriodDay, summaryKey } from '@/lib/overtime/summary'

const DAY_LABEL = ['일', '월', '화', '수', '목', '금', '토']

/**
 * 월간 연장근무 그리드 — 첫 컬럼(직원)을 sticky로 고정해 "좌측 직원 목록 + 우측 월간 캘린더"를
 * 하나의 표로 표현한다. 셀 값(총 연장시간 "6h" + 건수 배지 "(3)")은 summaries에서 그대로 읽기만
 * 한다 — 합계·건수를 이 컴포넌트가 다시 계산하지 않는다 (계산은 lib/overtime/summary.ts).
 * 셀은 기록이 없어도 클릭 가능 — 비어 있는 날짜도 모달을 열어 업무를 추가할 수 있어야 하기 때문(6단계).
 *
 * `days`는 달력 월이 아니라 "전달 21일 ~ 이번달 20일" 급여 기준 기간이라 두 달에 걸칠 수 있다
 * (lib/overtime/summary.ts의 payPeriodDays 참고). 그래서 이 컴포넌트는 연/월을 직접 받지 않고,
 * 각 날짜의 실제 연/월/일이 이미 담긴 PayPeriodDay[]를 그대로 받아서 그린다 — 달력 월 경계를
 * 신경 쓸 필요 없이 "받은 날짜들을 순서대로 컬럼으로" 그리기만 하면 된다.
 */
export default function MonthGrid({
  days,
  employees,
  summaries,
  onCellClick,
}: {
  days: PayPeriodDay[]
  employees: Employee[]
  summaries: Map<string, DailySummary>
  onCellClick: (employeeId: string, date: string) => void
}) {
  const today = new Date()

  const dayMeta = (d: PayPeriodDay, isFirstOfMonth: boolean) => {
    const weekday = new Date(d.year, d.month, d.day).getDay()
    const isToday = today.getFullYear() === d.year && today.getMonth() === d.month && today.getDate() === d.day
    const color = weekday === 0 ? '#ef4444' : weekday === 6 ? '#3b82f6' : '#555'
    return { weekday, isToday, color, showMonthLabel: isFirstOfMonth }
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #e8e8e6', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 260px)' }}>
        {/*
          table-layout: fixed + colgroup으로 전체 너비를 항상 컨테이너 폭(100%)에 맞춘다.
          직원 컬럼만 고정 폭이고, 날짜 컬럼은 폭을 지정하지 않아 남은 공간을 균등하게 나눠 갖는다 —
          그래서 날짜가 며칠이든(전달 21일~이번달 20일 최대 31일) 가로 스크롤 없이 한 화면에 다 보인다.
        */}
        <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: 12 }}>
          <colgroup>
            <col style={{ width: 100 }} />
            {days.map(d => <col key={d.dateStr} />)}
          </colgroup>
          <thead>
            <tr>
              <th style={cornerHeaderCell}>직원</th>
              {days.map((d, i) => {
                const isFirstOfMonth = i === 0 || d.day === 1
                const { weekday, isToday, color, showMonthLabel } = dayMeta(d, isFirstOfMonth)
                return (
                  <th
                    key={d.dateStr}
                    style={{
                      ...dayHeaderCell,
                      background: isToday ? '#eff6ff' : '#f4f4f2',
                      borderLeft: isFirstOfMonth ? '2px solid #ccc' : dayHeaderCell.borderLeft,
                    }}
                  >
                    <div style={{ fontSize: 9, color: '#aaa', height: 11 }}>{showMonthLabel ? `${d.month + 1}월` : ''}</div>
                    <div style={{ color, fontWeight: 600 }}>{d.day}</div>
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
                  {days.map((d, i) => {
                    const isFirstOfMonth = i === 0 || d.day === 1
                    const summary = summaries.get(summaryKey(emp.id, d.dateStr))
                    return (
                      <td
                        key={d.dateStr}
                        style={{ ...dataCell, borderLeft: isFirstOfMonth ? '2px solid #ccc' : dataCell.borderLeft }}
                        onClick={() => onCellClick(emp.id, d.dateStr)}
                      >
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
  padding: '8px 8px',
  textAlign: 'left',
  fontWeight: 500,
  color: '#555',
  borderBottom: '1px solid #e8e8e6',
  overflow: 'hidden',
}

const dayHeaderCell: React.CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 2,
  padding: '6px 2px',
  textAlign: 'center',
  borderBottom: '1px solid #e8e8e6',
  borderLeft: '1px solid #f0f0ee',
  overflow: 'hidden',
}

const employeeCell: React.CSSProperties = {
  ...stickyBase,
  zIndex: 1,
  padding: '8px 8px',
  borderBottom: '1px solid #f0f0ee',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

const dataCell: React.CSSProperties = {
  height: 40,
  borderBottom: '1px solid #f0f0ee',
  borderLeft: '1px solid #f0f0ee',
  textAlign: 'center',
  cursor: 'pointer',
  overflow: 'hidden',
}

const countBadge: React.CSSProperties = {
  position: 'absolute',
  top: -8,
  right: -10,
  fontSize: 9,
  color: '#f59e0b',
  fontWeight: 600,
}
