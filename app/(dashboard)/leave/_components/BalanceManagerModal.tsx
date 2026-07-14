'use client'

import { useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { AnnualLeaveBalance, LeaveEmployee } from '@/lib/leave/types'
import { formatDays } from '@/lib/leave/calc'

/**
 * 연차 설정 — 대상 연도의 직원별 기본 부여/조정일수(+사유) 입력·수정.
 * onBlur 즉시저장(ProjectManagerModal 패턴). 저장할 때마다
 * annual_leave_balance_history에 변경 전/후를 1행씩 남긴다.
 *
 * 입사일/퇴사일(overtime_employees 공용 컬럼)도 여기서 편집한다 —
 * 연장근무 직원 관리 화면은 수정 금지 제약이 있어 휴가관리 쪽에 편집 UI를 둔다
 * (docs/leave-management/06-open-decisions.md ②). 직원 등록/삭제는 여전히 연장근무 쪽.
 */
export default function BalanceManagerModal({
  year,
  employees,
  balances,
  used,
  onClose,
  onChange,
}: {
  year: number
  employees: LeaveEmployee[]
  balances: AnnualLeaveBalance[]
  used: Map<string, number>
  onClose: () => void
  onChange: () => void
}) {
  const supabase = createSupabaseBrowserClient()
  const [error, setError] = useState<string | null>(null)
  const balByEmp = new Map(balances.map(b => [b.employee_id, b]))

  async function saveEmployeeDates(employeeId: string, patch: { hire_date?: string | null; resign_date?: string | null }) {
    setError(null)
    const { error: err } = await supabase.from('overtime_employees').update(patch).eq('id', employeeId)
    if (err) { setError(`저장 실패: ${err.message}`); return }
    onChange()
  }

  async function saveBalance(
    employeeId: string,
    patch: Partial<Pick<AnnualLeaveBalance, 'granted_days' | 'adjustment_days' | 'adjustment_reason'>>,
  ) {
    setError(null)
    const cur = balByEmp.get(employeeId)
    const next = {
      granted_days: patch.granted_days ?? cur?.granted_days ?? 0,
      adjustment_days: patch.adjustment_days ?? cur?.adjustment_days ?? 0,
      adjustment_reason: patch.adjustment_reason ?? cur?.adjustment_reason ?? '',
    }
    const { error: err } = await supabase.from('annual_leave_balances').upsert(
      { employee_id: employeeId, year, ...next, updated_at: new Date().toISOString() },
      { onConflict: 'employee_id,year' },
    )
    if (err) { setError(`저장 실패: ${err.message}`); return }
    // 부여/조정 이력 — 사유만 바뀐 경우는 기록하지 않는다
    if (patch.granted_days !== undefined || patch.adjustment_days !== undefined) {
      await supabase.from('annual_leave_balance_history').insert({
        employee_id: employeeId,
        year,
        previous_granted_days: cur?.granted_days ?? null,
        new_granted_days: next.granted_days,
        previous_adjustment_days: cur?.adjustment_days ?? null,
        new_adjustment_days: next.adjustment_days,
        reason: next.adjustment_reason,
      })
    }
    onChange()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 12, width: 880, maxWidth: 'calc(100vw - 40px)', maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #e8e8e6', background: '#111', borderRadius: '12px 12px 0 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>{year}년 연차 설정</div>
            <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>입력 칸에서 나가면 바로 저장됩니다 · 최종 = 기본 부여 + 조정</div>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'rgba(255,255,255,0.15)', color: '#fff', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 13 }}>✕</button>
        </div>

        {error && <div style={{ margin: '12px 20px 0', padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, color: '#b91c1c' }}>{error}</div>}

        <div style={{ padding: '12px 20px 20px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                {['직원', '입사일', '퇴사일', '기본 부여', '조정', '조정 사유', '최종', '사용', '수정일시'].map(h => (
                  <th key={h} style={{ padding: '8px 8px', textAlign: 'left', fontWeight: 500, color: '#555', borderBottom: '1px solid #e8e8e6', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {employees.map(emp => {
                const bal = balByEmp.get(emp.id)
                const final = bal ? Math.round((bal.granted_days + bal.adjustment_days) * 2) / 2 : null
                const usedDays = used.get(emp.id) ?? 0
                const overUsed = final !== null && usedDays > final
                return (
                  <tr key={emp.id} style={{ borderBottom: '1px solid #f0f0ee' }}>
                    <td style={{ padding: '6px 8px', whiteSpace: 'nowrap', fontWeight: 600, color: emp.is_active ? '#111' : '#999' }}>
                      {emp.name}{emp.position ? ` ${emp.position}` : ''}{emp.is_active ? '' : ' (퇴사)'}
                    </td>
                    <td style={{ padding: '4px 4px' }}>
                      <input type="date" defaultValue={emp.hire_date ?? ''} style={{ ...inp, width: 130 }}
                        onBlur={e => { const v = e.target.value || null; if (v !== emp.hire_date) saveEmployeeDates(emp.id, { hire_date: v }) }} />
                    </td>
                    <td style={{ padding: '4px 4px' }}>
                      <input type="date" defaultValue={emp.resign_date ?? ''} style={{ ...inp, width: 130 }}
                        onBlur={e => { const v = e.target.value || null; if (v !== emp.resign_date) saveEmployeeDates(emp.id, { resign_date: v }) }} />
                    </td>
                    <td style={{ padding: '4px 4px' }}>
                      <input type="number" step="0.5" defaultValue={bal?.granted_days ?? ''} placeholder="15" style={{ ...inp, width: 70 }}
                        onBlur={e => {
                          const v = e.target.value === '' ? null : parseFloat(e.target.value)
                          if (v !== null && !Number.isNaN(v) && v !== (bal?.granted_days ?? null)) saveBalance(emp.id, { granted_days: v })
                        }} />
                    </td>
                    <td style={{ padding: '4px 4px' }}>
                      <input type="number" step="0.5" defaultValue={bal?.adjustment_days ?? ''} placeholder="0" style={{ ...inp, width: 64 }}
                        onBlur={e => {
                          const v = e.target.value === '' ? 0 : parseFloat(e.target.value)
                          if (!Number.isNaN(v) && v !== (bal?.adjustment_days ?? 0)) saveBalance(emp.id, { adjustment_days: v })
                        }} />
                    </td>
                    <td style={{ padding: '4px 4px' }}>
                      <input defaultValue={bal?.adjustment_reason ?? ''} placeholder="이월, 추가 부여 등" style={{ ...inp, width: '100%', minWidth: 110 }}
                        onBlur={e => { if (e.target.value !== (bal?.adjustment_reason ?? '')) saveBalance(emp.id, { adjustment_reason: e.target.value }) }} />
                    </td>
                    <td style={{ padding: '6px 8px', fontWeight: 700, color: '#1d4ed8', whiteSpace: 'nowrap' }}>{final !== null ? formatDays(final) : '-'}</td>
                    <td style={{ padding: '6px 8px', whiteSpace: 'nowrap', color: overUsed ? '#b91c1c' : '#555', fontWeight: overUsed ? 700 : 400 }}
                      title={overUsed ? '이미 사용한 연차일수보다 부여 연차일수가 적습니다' : undefined}>
                      {usedDays > 0 ? formatDays(usedDays) : ''}
                      {overUsed && ' ⚠'}
                    </td>
                    <td style={{ padding: '6px 8px', fontSize: 11, color: '#999', whiteSpace: 'nowrap' }}>
                      {bal?.updated_at ? bal.updated_at.slice(0, 16).replace('T', ' ') : '-'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div style={{ marginTop: 10, fontSize: 11, color: '#999' }}>
            ⚠ 표시는 이미 사용한 연차보다 부여 연차가 적은 경우입니다 — 저장은 되지만 잔여가 음수로 표시됩니다.
            부여/조정 변경 이력은 자동으로 저장됩니다.
          </div>
        </div>
      </div>
    </div>
  )
}

const inp: React.CSSProperties = { height: 30, padding: '0 8px', border: '1px solid #e8e8e6', borderRadius: 6, fontSize: 12, background: '#fff', boxSizing: 'border-box' }
