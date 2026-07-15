'use client'

import { useCallback, useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { EngineerSpecialty } from '@/lib/engineers/types'

/**
 * 전문분야 관리 — 이름·표시순서·활성화. 이미 지정된 분야는 삭제할 수 없고(FK RESTRICT)
 * 비활성화로 숨긴다. onBlur/onChange 즉시저장 (기존 관리 모달 패턴).
 */
export default function SpecialtyManagerModal({
  onClose,
  onChange,
}: {
  onClose: () => void
  onChange: () => void
}) {
  const supabase = createSupabaseBrowserClient()
  const [items, setItems] = useState<EngineerSpecialty[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data } = await supabase.from('engineer_specialties').select('*').order('sort_order', { ascending: true })
    if (data) setItems(data as EngineerSpecialty[])
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { load() }, [load])

  async function update(id: string, patch: Partial<EngineerSpecialty>) {
    setError(null)
    const { error: err } = await supabase.from('engineer_specialties').update(patch).eq('id', id)
    if (err) { setError(`저장 실패: ${err.message}`); return }
    await load()
    onChange()
  }

  async function add() {
    setError(null)
    if (!newName.trim()) return
    const nextSort = items.length ? Math.max(...items.map(i => i.sort_order)) + 10 : 0
    const { error: err } = await supabase.from('engineer_specialties')
      .insert({ name: newName.trim(), sort_order: nextSort })
    if (err) {
      setError(err.code === '23505' ? '이미 있는 분야명입니다.' : `추가 실패: ${err.message}`)
      return
    }
    setNewName('')
    await load()
    onChange()
  }

  async function remove(item: EngineerSpecialty) {
    if (!confirm(`"${item.name}" 분야를 삭제하시겠습니까?`)) return
    setError(null)
    const { error: err } = await supabase.from('engineer_specialties').delete().eq('id', item.id)
    if (err) {
      setError(err.code === '23503'
        ? '이 분야가 지정된 기술인이 있어 삭제할 수 없습니다. 비활성화하세요.'
        : `삭제 실패: ${err.message}`)
      return
    }
    await load()
    onChange()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 12, width: 460, maxWidth: 'calc(100vw - 40px)', maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #e8e8e6', background: '#111', borderRadius: '12px 12px 0 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>전문분야 관리</div>
            <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>기술인에게 복수 지정할 수 있는 분야 목록입니다</div>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'rgba(255,255,255,0.15)', color: '#fff', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 13 }}>✕</button>
        </div>

        <div style={{ padding: '12px 20px', display: 'flex', gap: 6, borderBottom: '1px solid #f0f0ee' }}>
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="새 분야명" style={{ ...inp, flex: 1 }} />
          <button onClick={add} style={primaryBtn}>추가</button>
        </div>

        {error && <div style={{ margin: '10px 20px 0', padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, color: '#b91c1c' }}>{error}</div>}

        <div style={{ padding: '8px 20px 20px' }}>
          {loading ? (
            <div style={{ padding: 30, textAlign: 'center', color: '#bbb', fontSize: 13 }}>불러오는 중...</div>
          ) : items.map(item => (
            <div key={item.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '7px 0', borderBottom: '1px solid #f5f5f3', opacity: item.is_active ? 1 : 0.5 }}>
              <input defaultValue={item.name} style={{ ...inp, flex: 1 }}
                onBlur={e => { if (e.target.value.trim() && e.target.value !== item.name) update(item.id, { name: e.target.value.trim() }) }} />
              <input type="number" defaultValue={item.sort_order} title="표시순서" style={{ ...inp, width: 64 }}
                onBlur={e => { const v = parseInt(e.target.value, 10); if (!Number.isNaN(v) && v !== item.sort_order) update(item.id, { sort_order: v }) }} />
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#555' }}>
                <input type="checkbox" checked={item.is_active} onChange={e => update(item.id, { is_active: e.target.checked })} />
                활성
              </label>
              <button onClick={() => remove(item)} style={deleteBtn}>삭제</button>
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
