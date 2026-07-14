'use client'

import { useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { AnnualLeaveBalance, DAY_UNIT_LABEL, LeaveEmployee, LeaveRecord, LeaveType } from '@/lib/leave/types'
import { formatDays, formatNightsDays } from '@/lib/leave/calc'

type SortKey = 'recent' | 'oldest' | 'deducted'

/**
 * 직원별 휴가 상세이력 — 메인 테이블에서 직원 행을 클릭하면 아래에 표시.
 * 요약 카드(부여/사용/잔여) + 필터(유형·차감여부·정렬) + 이력 테이블(수정/삭제).
 * 삭제는 일반 삭제 — 날짜별 전개는 FK CASCADE로 함께 지워지고, 집계는 재조회로 갱신된다.
 */
export default function EmployeeLeaveHistory({
  year,
  employee,
  balance,
  used,
  records,
  leaveTypes,
  onEdit,
  onChanged,
}: {
  year: number
  employee: LeaveEmployee
  balance: AnnualLeaveBalance | null
  used: number
  records: LeaveRecord[]
  leaveTypes: LeaveType[]
  onEdit: (record: LeaveRecord) => void
  onChanged: () => void
}) {
  const supabase = createSupabaseBrowserClient()
  const [typeFilter, setTypeFilter] = useState('전체')
  const [deductFilter, setDeductFilter] = useState<'전체' | '차감' | '미차감'>('전체')
  const [sort, setSort] = useState<SortKey>('recent')
  const [deleting, setDeleting] = useState<string | null>(null)

  const typeById = new Map(leaveTypes.map(t => [t.id, t]))
  const granted = balance ? Math.round((balance.granted_days + balance.adjustment_days) * 2) / 2 : null
  const remaining = granted !== null ? Math.round((granted - used) * 2) / 2 : null

  const filtered = records
    .filter(r => typeFilter === '전체' || typeById.get(r.leave_type_id)?.name === typeFilter)
    .filter(r => {
      if (deductFilter === '전체') return true
      const deducts = typeById.get(r.leave_type_id)?.deducts_annual_leave ?? false
      return deductFilter === '차감' ? deducts : !deducts
    })
    .sort((a, b) =>
      sort === 'recent' ? b.start_date.localeCompare(a.start_date)
      : sort === 'oldest' ? a.start_date.localeCompare(b.start_date)
      : b.deducted_days - a.deducted_days)

  async function remove(rec: LeaveRecord) {
    const type = typeById.get(rec.leave_type_id)?.name ?? ''
    if (!confirm(`${rec.start_date}${rec.start_date !== rec.end_date ? `~${rec.end_date}` : ''} ${type} 휴가를 삭제하시겠습니까?`)) return
    setDeleting(rec.id)
    await supabase.from('leave_records').delete().eq('id', rec.id) // dates는 CASCADE
    setDeleting(null)
    onChanged()
  }

  return (
    <div style={{ marginTop: 16 }}>
      {/* 요약 카드 */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <div style={{ background: '#111', color: '#fff', borderRadius: 8, padding: '12px 18px', minWidth: 140 }}>
          <div style={{ fontSize: 11, color: '#999' }}>{year}년</div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{employee.name} <span style={{ fontSize: 12, fontWeight: 400, color: '#bbb' }}>{employee.position}</span></div>
        </div>
        {[
          { label: '부여 연차', value: granted !== null ? `${formatDays(granted)}일` : '미설정', color: '#111' },
          { label: '사용 연차', value: `${formatDays(used)}일`, color: '#b91c1c' },
          { label: '잔여 연차', value: remaining !== null ? `${formatDays(remaining)}일` : '-', color: remaining !== null && remaining <= 0 ? '#b91c1c' : '#1d4ed8' },
        ].map(c => (
          <div key={c.label} style={{ background: '#fff', border: '1px solid #e8e8e6', borderRadius: 8, padding: '12px 18px', minWidth: 110 }}>
            <div style={{ fontSize: 11, color: '#999', marginBottom: 2 }}>{c.label}</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: c.color }}>{c.value}</div>
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', paddingBottom: 2 }}>
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} style={sel}>
            <option>전체</option>
            {leaveTypes.map(t => <option key={t.id}>{t.name}</option>)}
          </select>
          <select value={deductFilter} onChange={e => setDeductFilter(e.target.value as typeof deductFilter)} style={sel}>
            <option>전체</option>
            <option>차감</option>
            <option>미차감</option>
          </select>
          <select value={sort} onChange={e => setSort(e.target.value as SortKey)} style={sel}>
            <option value="recent">최근 휴가일 순</option>
            <option value="oldest">과거 휴가일 순</option>
            <option value="deducted">차감일수 많은 순</option>
          </select>
        </div>
      </div>

      {/* 이력 테이블 */}
      <div style={{ background: '#fff', border: '1px solid #e8e8e6', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: '#f4f4f2' }}>
              {['휴가 유형', '시작일', '종료일', '전체 기간', '실제 차감', '메모', '등록일', ''].map((h, i) => (
                <th key={i} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 500, color: '#555', borderBottom: '1px solid #e8e8e6', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: 30, textAlign: 'center', color: '#bbb' }}>{year}년 휴가 기록이 없습니다</td></tr>
            ) : filtered.map(rec => {
              const type = typeById.get(rec.leave_type_id)
              return (
                <tr key={rec.id} style={{ borderBottom: '1px solid #f0f0ee' }}>
                  <td style={td}>
                    {type?.name ?? '?'}
                    {type && !type.deducts_annual_leave && <span style={{ fontSize: 10, color: '#999' }}> (차감 없음)</span>}
                  </td>
                  <td style={td}>{rec.start_date}{rec.start_day_unit !== 'full' && <span style={{ fontSize: 10, color: '#888' }}> {DAY_UNIT_LABEL[rec.start_day_unit]}</span>}</td>
                  <td style={td}>{rec.end_date}{rec.start_date !== rec.end_date && rec.end_day_unit !== 'full' ? <span style={{ fontSize: 10, color: '#888' }}> {DAY_UNIT_LABEL[rec.end_day_unit]}</span> : null}</td>
                  <td style={td}>{formatNightsDays(rec.total_calendar_days)}</td>
                  <td style={{ ...td, fontWeight: 600, color: rec.deducted_days > 0 ? '#b45309' : '#999' }}>
                    {rec.deducted_days > 0 ? `${formatDays(rec.deducted_days)}일` : '-'}
                  </td>
                  <td style={{ ...td, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{rec.memo}</td>
                  <td style={{ ...td, color: '#999', fontSize: 11 }}>{rec.created_at?.slice(0, 10)}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button onClick={() => onEdit(rec)} style={editBtn}>수정</button>
                      <button onClick={() => remove(rec)} disabled={deleting === rec.id} style={deleteBtn}>삭제</button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const td: React.CSSProperties = { padding: '8px 12px', verticalAlign: 'middle', color: '#333', whiteSpace: 'nowrap' }
const sel: React.CSSProperties = { height: 30, padding: '0 8px', border: '1px solid #e8e8e6', borderRadius: 6, fontSize: 12, background: '#fff' }
const editBtn: React.CSSProperties = { height: 24, padding: '0 8px', borderRadius: 4, border: '1px solid #e8e8e6', background: '#fff', color: '#333', fontSize: 11, cursor: 'pointer' }
const deleteBtn: React.CSSProperties = { height: 24, padding: '0 8px', borderRadius: 4, border: 'none', background: '#fee2e2', color: '#b91c1c', fontSize: 11, cursor: 'pointer' }
