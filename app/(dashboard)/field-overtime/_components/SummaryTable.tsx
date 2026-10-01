'use client'

import { Employee } from '@/lib/overtime/types'
import { formatHours } from '@/lib/overtime/summary'

/** 표에서 고른 칸 — employeeId null = 전 직원(하단 합계 행), col null = 기간 전체(우측 합계 열) */
export interface SummarySelection {
  employeeId: string | null
  col: number | null
}

interface Props {
  /** 열 머리글 — 주차별이면 "1주차 / 10/1~10/4", 월별이면 "1월" */
  columns: { title: string; sub?: string }[]
  employees: Employee[]
  /** employee_id → 열 순서대로의 합계 */
  totals: Map<string, number[]>
  selected: SummarySelection | null
  /** 시간이 있는 칸을 누르면 호출 — 같은 칸을 다시 누르면 null(닫기) */
  onSelect: (selection: SummarySelection | null) => void
}

/**
 * 주차별/월별 집계가 같이 쓰는 표 — 행 = 직원, 열 = 기간, 우측 합계 열과 하단 합계 행.
 * 행은 재직자 전원 + (퇴사했지만 이 기간에 기록이 있는 직원) — 후자를 빼면 합계가 안 맞는다.
 * 시간이 있는 칸(합계 포함)을 누르면 그 칸을 이루는 기록 목록이 표 아래에 열린다(RecordList).
 */
export default function SummaryTable({ columns, employees, totals, selected, onSelect }: Props) {
  const rows = employees.filter(e => e.is_active || totals.has(e.id))
  const colTotals = columns.map((_, i) => rows.reduce((s, e) => s + (totals.get(e.id)?.[i] ?? 0), 0))
  const grand = colTotals.reduce((a, b) => a + b, 0)

  if (rows.length === 0) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#bbb', fontSize: 13, background: '#fff', border: '1px solid #e8e8e6', borderRadius: 8 }}>직원이 없습니다 — 기술인 주소록에서 소속을 &quot;미래사업팀&quot;으로 등록하세요</div>
  }

  const isSelected = (employeeId: string | null, col: number | null) =>
    !!selected && selected.employeeId === employeeId && selected.col === col

  /** 시간 칸 하나 — 0이면 누를 것이 없으니 클릭을 막는다 */
  const cell = (key: string | number, hours: number, employeeId: string | null, col: number | null, base: React.CSSProperties, empty = '-') => {
    const active = isSelected(employeeId, col)
    const clickable = hours > 0
    return (
      <td
        key={key}
        onClick={clickable ? () => onSelect(active ? null : { employeeId, col }) : undefined}
        style={{
          ...base,
          cursor: clickable ? 'pointer' : 'default',
          ...(active ? { background: '#fef3c7', boxShadow: 'inset 0 0 0 2px #f59e0b' } : {}),
        }}
        title={clickable ? '눌러서 기록 목록 보기' : undefined}
      >
        {hours ? formatHours(hours) : empty}
      </td>
    )
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #e8e8e6', borderRadius: 8, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 120 + columns.length * 64 }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: 'left', position: 'sticky', left: 0, background: '#f8f8f7', width: 110 }}>직원</th>
            {columns.map(c => (
              <th key={c.title} style={th}>
                <div>{c.title}</div>
                {c.sub && <div style={{ fontSize: 10, fontWeight: 400, color: '#aaa', marginTop: 2 }}>{c.sub}</div>}
              </th>
            ))}
            <th style={{ ...th, background: '#f0f0ee' }}>합계</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(emp => {
            const row = totals.get(emp.id) ?? columns.map(() => 0)
            const sum = row.reduce((a, b) => a + b, 0)
            return (
              <tr key={emp.id}>
                <td style={{ ...td, textAlign: 'left', position: 'sticky', left: 0, background: '#fff', fontWeight: 500 }}>
                  {emp.name}
                  {emp.position && <span style={{ fontSize: 11, color: '#999', marginLeft: 4 }}>{emp.position}</span>}
                  {!emp.is_active && <span style={{ fontSize: 10, color: '#b91c1c', marginLeft: 4 }}>(퇴사)</span>}
                </td>
                {row.map((h, i) => cell(i, h, emp.id, i, { ...td, color: h ? '#111' : '#ddd' }))}
                {cell('sum', sum, emp.id, null, { ...td, background: '#fafaf9', fontWeight: 600 }, '0h')}
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr>
            <td style={{ ...td, textAlign: 'left', position: 'sticky', left: 0, background: '#f8f8f7', fontWeight: 600 }}>합계</td>
            {colTotals.map((h, i) => cell(i, h, null, i, { ...td, background: '#f8f8f7', fontWeight: 600 }, '0h'))}
            {cell('grand', grand, null, null, { ...td, background: '#f0f0ee', fontWeight: 700 }, '0h')}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

const th: React.CSSProperties = { padding: '10px 8px', borderBottom: '1px solid #e8e8e6', background: '#f8f8f7', fontSize: 12, fontWeight: 600, color: '#555', textAlign: 'center', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '9px 8px', borderBottom: '1px solid #f0f0ee', textAlign: 'center', whiteSpace: 'nowrap' }
