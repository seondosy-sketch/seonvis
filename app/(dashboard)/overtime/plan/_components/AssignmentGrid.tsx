'use client'

import type { PayPeriodDay } from '@/lib/overtime/summary'

/**
 * 자동배정 결과·초안 그리드 — 행 = 직원, 열 = 급여기간 날짜, 셀 = "프로젝트 표시 + 시간".
 * 미리보기(저장 전 엔진 결과)와 저장된 초안이 같은 모양으로 보이게 한 표에서 그린다.
 * 주말·공휴일 열은 머리글 색으로, 주말·공휴일 배정은 빨간 테두리 + 사유 툴팁으로 구분한다.
 */

export interface GridCell {
  projectId: string
  hours: number
  reason: string | null        // 주말·공휴일 배정 사유
  status?: 'draft' | 'confirmed' | 'locked' | 'existing'
  title?: string
}

export interface GridRow {
  id: string
  name: string
  sub?: string                 // 직급·요약
  cells: Map<string, GridCell> // date → cell
}

const DAY = ['일', '월', '화', '수', '목', '금', '토']
// 기존 연장근무 대시보드와 같은 6색 — 프로젝트 정체성 구분용
const PALETTE = ['#f59e0b', '#3b82f6', '#22c55e', '#f97316', '#8b5cf6', '#ef4444']

export function projectColor(index: number): string {
  return PALETTE[index % PALETTE.length]
}

export default function AssignmentGrid({
  days,
  holidays,
  rows,
  projectOrder,
  onCellClick,
}: {
  days: PayPeriodDay[]
  holidays: Map<string, string>
  rows: GridRow[]
  projectOrder: string[]       // 색 순서(우선순위 순 프로젝트 id)
  onCellClick?: (rowId: string, date: string, cell: GridCell | undefined) => void
}) {
  const colorOf = (pid: string) => {
    const i = projectOrder.indexOf(pid)
    return i >= 0 ? projectColor(i) : '#9ca3af'
  }
  return (
    <div style={{ overflow: 'auto', border: '1px solid #e8e8e6', borderRadius: 8, background: '#fff' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 11, width: '100%', tableLayout: 'fixed', minWidth: 900 }}>
        <colgroup>
          <col style={{ width: 96 }} />
          {days.map(d => <col key={d.dateStr} />)}
          <col style={{ width: 44 }} />
        </colgroup>
        <thead>
          <tr>
            <th style={{ ...th, position: 'sticky', left: 0, zIndex: 2, textAlign: 'left' }}>직원</th>
            {days.map((d, i) => {
              const wd = new Date(d.year, d.month, d.day).getDay()
              const holiday = holidays.get(d.dateStr)
              const color = holiday || wd === 0 ? '#ef4444' : wd === 6 ? '#3b82f6' : '#555'
              return (
                <th key={d.dateStr} title={holiday ?? undefined}
                  style={{ ...th, color, borderLeft: i === 0 || d.day === 1 ? '2px solid #ccc' : th.borderLeft, background: holiday || wd === 0 || wd === 6 ? '#fdf2f2' : '#f4f4f2' }}>
                  <div style={{ fontSize: 9, color: '#aaa', height: 10 }}>{i === 0 || d.day === 1 ? `${d.month + 1}월` : ''}</div>
                  <div style={{ fontWeight: 600 }}>{d.day}</div>
                  <div style={{ fontSize: 9, opacity: 0.8 }}>{holiday ? '휴' : DAY[wd]}</div>
                </th>
              )
            })}
            <th style={th}>합계</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={days.length + 2} style={{ padding: 30, textAlign: 'center', color: '#bbb' }}>표시할 배정이 없습니다</td></tr>
          ) : rows.map(row => {
            const total = [...row.cells.values()].reduce((s, c) => s + c.hours, 0)
            return (
              <tr key={row.id}>
                <td style={{ ...td, position: 'sticky', left: 0, background: '#fff', textAlign: 'left', padding: '4px 6px' }}>
                  <div style={{ fontWeight: 600, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}</div>
                  {row.sub && <div style={{ fontSize: 9, color: '#999', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.sub}</div>}
                </td>
                {days.map((d, i) => {
                  const cell = row.cells.get(d.dateStr)
                  const color = cell ? colorOf(cell.projectId) : null
                  const muted = cell?.status === 'existing' || cell?.status === 'locked'
                  return (
                    <td key={d.dateStr}
                      onClick={onCellClick ? () => onCellClick(row.id, d.dateStr, cell) : undefined}
                      title={cell?.title ?? (cell?.reason ? `주말·공휴일 배정: ${cell.reason}` : undefined)}
                      style={{
                        ...td,
                        cursor: onCellClick ? 'pointer' : 'default',
                        borderLeft: i === 0 || d.day === 1 ? '2px solid #ccc' : td.borderLeft,
                        background: cell ? (muted ? '#f4f4f2' : `${color}26`) : '#fff',
                        outline: cell?.reason ? '2px solid #ef4444' : undefined,
                        outlineOffset: -2,
                      }}>
                      {cell && (
                        <div style={{ lineHeight: 1.15 }}>
                          <div style={{ width: 8, height: 8, borderRadius: 2, background: muted ? '#bbb' : color!, margin: '0 auto 2px' }} />
                          <span style={{ fontWeight: 700, color: muted ? '#888' : '#111' }}>{cell.hours}</span>
                          {cell.status === 'confirmed' && <div style={{ fontSize: 8, color: '#15803d' }}>확정</div>}
                          {cell.status === 'existing' && <div style={{ fontSize: 8, color: '#888' }}>기존</div>}
                          {cell.status === 'locked' && <div style={{ fontSize: 8, color: '#888' }}>잠금</div>}
                        </div>
                      )}
                    </td>
                  )
                })}
                <td style={{ ...td, fontWeight: 700 }}>{total || ''}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

const th: React.CSSProperties = { padding: '4px 2px', borderBottom: '1px solid #e8e8e6', borderLeft: '1px solid #f0f0ee', textAlign: 'center', fontWeight: 500, background: '#f4f4f2', position: 'sticky', top: 0 }
const td: React.CSSProperties = { height: 38, borderBottom: '1px solid #f0f0ee', borderLeft: '1px solid #f0f0ee', textAlign: 'center', overflow: 'hidden' }
