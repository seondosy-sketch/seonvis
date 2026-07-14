'use client'

import { useCallback, useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { LeaveType } from '@/lib/leave/types'

/**
 * 휴가 유형 관리 — 이름·연차 차감 여부·기본 차감 단위·표시 순서·활성화.
 * 이미 사용된 유형은 삭제할 수 없고(FK RESTRICT) 비활성화로 숨긴다 — 소프트 삭제 원칙.
 * onBlur/onChange 즉시저장 (ProjectManagerModal 패턴).
 */
export default function LeaveTypeManagerModal({
  onClose,
  onChange,
}: {
  onClose: () => void
  onChange: () => void
}) {
  const supabase = createSupabaseBrowserClient()
  const [types, setTypes] = useState<LeaveType[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data } = await supabase.from('leave_types').select('*').order('sort_order', { ascending: true })
    if (data) setTypes(data as LeaveType[])
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { load() }, [load])

  async function update(id: string, patch: Partial<LeaveType>) {
    setError(null)
    const { error: err } = await supabase.from('leave_types').update(patch).eq('id', id)
    if (err) { setError(`저장 실패: ${err.message}`); return }
    await load()
    onChange()
  }

  async function add() {
    setError(null)
    if (!newName.trim()) return
    const nextSort = types.length ? Math.max(...types.map(t => t.sort_order)) + 10 : 0
    const { error: err } = await supabase.from('leave_types')
      .insert({ name: newName.trim(), deducts_annual_leave: false, default_deduction_unit: 0, sort_order: nextSort })
    if (err) { setError(`추가 실패: ${err.message}`); return }
    setNewName('')
    await load()
    onChange()
  }

  async function remove(t: LeaveType) {
    if (!confirm(`"${t.name}" 유형을 삭제하시겠습니까?`)) return
    setError(null)
    const { error: err } = await supabase.from('leave_types').delete().eq('id', t.id)
    if (err) {
      setError(err.code === '23503'
        ? '이 유형으로 등록된 휴가가 있어 삭제할 수 없습니다. 비활성화하세요.'
        : `삭제 실패: ${err.message}`)
      return
    }
    await load()
    onChange()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 12, width: 620, maxWidth: 'calc(100vw - 40px)', maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #e8e8e6', background: '#111', borderRadius: '12px 12px 0 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>휴가 유형 관리</div>
            <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>차감 여부·단위 변경은 이후 등록되는 휴가부터 적용됩니다</div>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'rgba(255,255,255,0.15)', color: '#fff', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 13 }}>✕</button>
        </div>

        <div style={{ padding: '12px 20px', display: 'flex', gap: 6, borderBottom: '1px solid #f0f0ee' }}>
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="새 유형명" style={{ ...inp, flex: 1 }} />
          <button onClick={add} style={primaryBtn}>추가</button>
        </div>

        {error && <div style={{ margin: '10px 20px 0', padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, color: '#b91c1c' }}>{error}</div>}

        <div style={{ padding: '8px 20px 20px' }}>
          <div style={{ display: 'flex', gap: 8, padding: '6px 0', fontSize: 11, color: '#888', borderBottom: '1px solid #e8e8e6' }}>
            <span style={{ flex: 1 }}>유형명</span>
            <span style={{ width: 80, textAlign: 'center' }}>연차 차감</span>
            <span style={{ width: 90 }}>기본 단위</span>
            <span style={{ width: 56 }}>순서</span>
            <span style={{ width: 64, textAlign: 'center' }}>활성</span>
            <span style={{ width: 48 }} />
          </div>
          {loading ? (
            <div style={{ padding: 30, textAlign: 'center', color: '#bbb', fontSize: 13 }}>불러오는 중...</div>
          ) : types.map(t => (
            <div key={t.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '7px 0', borderBottom: '1px solid #f5f5f3', opacity: t.is_active ? 1 : 0.5 }}>
              <input defaultValue={t.name} style={{ ...inp, flex: 1 }}
                onBlur={e => { if (e.target.value.trim() && e.target.value !== t.name) update(t.id, { name: e.target.value.trim() }) }} />
              <span style={{ width: 80, textAlign: 'center' }}>
                <input type="checkbox" checked={t.deducts_annual_leave} onChange={e => update(t.id, { deducts_annual_leave: e.target.checked })} />
              </span>
              <select value={t.default_deduction_unit} onChange={e => update(t.id, { default_deduction_unit: parseFloat(e.target.value) })} style={{ ...inp, width: 90 }}>
                <option value={1}>1일</option>
                <option value={0.5}>0.5일</option>
                <option value={0}>0일</option>
              </select>
              <input type="number" defaultValue={t.sort_order} style={{ ...inp, width: 56 }}
                onBlur={e => { const v = parseInt(e.target.value, 10); if (!Number.isNaN(v) && v !== t.sort_order) update(t.id, { sort_order: v }) }} />
              <span style={{ width: 64, textAlign: 'center' }}>
                <input type="checkbox" checked={t.is_active} onChange={e => update(t.id, { is_active: e.target.checked })} />
              </span>
              <button onClick={() => remove(t)} style={deleteBtn}>삭제</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const inp: React.CSSProperties = { height: 30, padding: '0 8px', border: '1px solid #e8e8e6', borderRadius: 6, fontSize: 12, background: '#fff', boxSizing: 'border-box' }
const primaryBtn: React.CSSProperties = { height: 30, padding: '0 14px', borderRadius: 6, border: 'none', background: '#111', color: '#fff', fontSize: 12, cursor: 'pointer', flexShrink: 0 }
const deleteBtn: React.CSSProperties = { height: 26, padding: '0 10px', borderRadius: 4, border: 'none', background: '#fee2e2', color: '#b91c1c', fontSize: 11, cursor: 'pointer', flexShrink: 0 }
