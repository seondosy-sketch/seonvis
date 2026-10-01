'use client'

import { FieldOvertimeRecord } from '@/lib/field-overtime/types'
import { Employee } from '@/lib/overtime/types'
import { FIELD_START_TIME, restDayName } from '@/lib/field-overtime/calc'
import { formatHours } from '@/lib/overtime/summary'

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토']

interface Props {
  /** 목록 제목 — 예: "김철수 · 2주차 (10/5~10/11)" */
  title: string
  records: FieldOvertimeRecord[]
  employees: Employee[]
  holidays: Map<string, string>
  onClose: () => void
  /** 쓰기 권한이 있으면 행을 눌러 수정 모달을 연다 */
  onRecordClick?: (record: FieldOvertimeRecord) => void
}

/**
 * 집계표에서 고른 칸을 이루는 기록 목록 — 날짜순, 같은 날은 직원 정렬순서대로.
 * 합계가 표의 칸 숫자와 같아야 하므로 목록 하단에 합계를 다시 적는다.
 */
export default function RecordList({ title, records, employees, holidays, onClose, onRecordClick }: Props) {
  const orderOf = new Map(employees.map((e, i) => [e.id, i]))
  const empOf = new Map(employees.map(e => [e.id, e]))
  const sorted = [...records].sort((a, b) =>
    a.work_date.localeCompare(b.work_date) || (orderOf.get(a.employee_id) ?? 999) - (orderOf.get(b.employee_id) ?? 999))
  const total = sorted.reduce((s, r) => s + Number(r.hours), 0)

  return (
    <div style={{ marginTop: 12, background: '#fff', border: '1px solid #e8e8e6', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid #e8e8e6', background: '#fffbeb' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>
          {title}
          <span style={{ fontSize: 12, fontWeight: 400, color: '#888', marginLeft: 8 }}>{sorted.length}건 · 합계 {formatHours(total)}</span>
        </div>
        <button onClick={onClose} style={{ border: 'none', background: 'none', color: '#999', cursor: 'pointer', fontSize: 14 }} title="닫기">✕</button>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 520 }}>
          <thead>
            <tr>
              <th style={th}>날짜</th>
              <th style={th}>직원</th>
              <th style={th}>근무시간</th>
              <th style={{ ...th, textAlign: 'right' }}>인정시간</th>
              <th style={{ ...th, textAlign: 'left' }}>비고</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(r => {
              const [y, m, d] = r.work_date.split('-').map(Number)
              const dow = new Date(y, m - 1, d).getDay()
              const holidayName = holidays.get(r.work_date)
              const rest = restDayName(r.work_date, holidays)
              const emp = empOf.get(r.employee_id)
              return (
                <tr
                  key={r.id}
                  onClick={onRecordClick ? () => onRecordClick(r) : undefined}
                  style={{ cursor: onRecordClick ? 'pointer' : 'default' }}
                >
                  <td style={{ ...td, color: rest ? '#ef4444' : '#333' }}>
                    {m}/{d} ({DAY_NAMES[dow]})
                    {holidayName && <span style={{ fontSize: 11, marginLeft: 4 }}>{holidayName}</span>}
                  </td>
                  <td style={td}>
                    {emp?.name ?? '(알 수 없음)'}
                    {emp?.position && <span style={{ fontSize: 11, color: '#999', marginLeft: 4 }}>{emp.position}</span>}
                  </td>
                  <td style={td}>{r.start_time ?? FIELD_START_TIME} ~ {r.end_time}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{formatHours(Number(r.hours))}</td>
                  <td style={{ ...td, textAlign: 'left', color: '#666', whiteSpace: 'normal' }}>{r.note}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const th: React.CSSProperties = { padding: '8px 12px', borderBottom: '1px solid #e8e8e6', background: '#f8f8f7', fontSize: 12, fontWeight: 600, color: '#555', textAlign: 'center', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '8px 12px', borderBottom: '1px solid #f0f0ee', textAlign: 'center', whiteSpace: 'nowrap' }
