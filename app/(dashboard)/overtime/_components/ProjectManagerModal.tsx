'use client'

import { useCallback, useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { Project } from '@/lib/overtime/types'

/**
 * 프로젝트 등록/수정/종료 관리. 삭제는 그 프로젝트를 참조하는 overtime_work_records가
 * 하나도 없을 때만 가능하다(FK ON DELETE RESTRICT) — 이미 쓰인 프로젝트는 "종료" 상태로만
 * 바꾸고 행 자체는 지우지 않는다(2단계에서 정한 소프트 삭제 원칙).
 */
export default function ProjectManagerModal({
  onClose,
  onChange,
}: {
  onClose: () => void
  onChange: () => void
}) {
  const supabase = createSupabaseBrowserClient()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('overtime_projects').select('*').order('sort_order', { ascending: true })
    if (data) setProjects(data as Project[])
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { load() }, [load])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    setAdding(true)
    setError(null)
    const nextSortOrder = projects.length ? Math.max(...projects.map(p => p.sort_order)) + 10 : 0
    const { error: insertError } = await supabase
      .from('overtime_projects')
      .insert({ name: newName.trim(), status: '진행중', sort_order: nextSortOrder })
    setAdding(false)
    if (insertError) { setError(`추가 실패: ${insertError.message}`); return }
    setNewName('')
    await load()
    onChange()
  }

  async function updateProject(id: string, patch: Partial<Project>) {
    setError(null)
    const { error: updateError } = await supabase.from('overtime_projects').update(patch).eq('id', id)
    if (updateError) { setError(`저장 실패: ${updateError.message}`); return }
    await load()
    onChange()
  }

  async function handleDelete(project: Project) {
    if (!confirm(`"${project.name}"을 삭제하시겠습니까?`)) return
    setError(null)
    const { error: deleteError } = await supabase.from('overtime_projects').delete().eq('id', project.id)
    if (deleteError) {
      setError(
        deleteError.code === '23503'
          ? '이 프로젝트로 등록된 연장근무 기록이 있어 삭제할 수 없습니다. "종료" 처리해 주세요.'
          : `삭제 실패: ${deleteError.message}`
      )
      return
    }
    await load()
    onChange()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 12, width: 520, maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #e8e8e6', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#111', borderRadius: '12px 12px 0 0' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>프로젝트 관리</div>
          <button onClick={onClose} style={{ border: 'none', background: 'rgba(255,255,255,0.15)', color: '#fff', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 13 }}>✕</button>
        </div>

        <form onSubmit={handleAdd} style={{ padding: '16px 20px', borderBottom: '1px solid #f0f0ee', display: 'flex', gap: 8 }}>
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="새 프로젝트명" style={{ ...inp, flex: 1 }} />
          <button type="submit" disabled={adding} style={{ ...primaryBtn, opacity: adding ? 0.6 : 1 }}>{adding ? '추가 중...' : '추가'}</button>
        </form>

        {error && <div style={{ margin: '0 20px', marginTop: 12, padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, color: '#b91c1c' }}>{error}</div>}

        <div style={{ padding: '8px 20px 20px' }}>
          {loading ? (
            <div style={{ padding: 30, textAlign: 'center', color: '#bbb', fontSize: 13 }}>불러오는 중...</div>
          ) : projects.length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: '#bbb', fontSize: 13 }}>등록된 프로젝트가 없습니다</div>
          ) : (
            projects.map((p, i) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0', borderBottom: i < projects.length - 1 ? '1px solid #f0f0ee' : 'none' }}>
                <input
                  defaultValue={p.name}
                  onBlur={e => { if (e.target.value.trim() && e.target.value !== p.name) updateProject(p.id, { name: e.target.value.trim() }) }}
                  style={{ ...inp, flex: 1 }}
                />
                <input
                  type="number"
                  defaultValue={p.sort_order}
                  onBlur={e => { const v = parseInt(e.target.value, 10); if (!Number.isNaN(v) && v !== p.sort_order) updateProject(p.id, { sort_order: v }) }}
                  style={{ ...inp, width: 64 }}
                  title="정렬순서"
                />
                <button
                  onClick={() => updateProject(p.id, { status: p.status === '진행중' ? '종료' : '진행중' })}
                  style={p.status === '진행중' ? statusBtnActive : statusBtnEnded}
                >
                  {p.status}
                </button>
                <button onClick={() => handleDelete(p)} style={deleteBtn}>삭제</button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

const inp: React.CSSProperties = { height: 34, padding: '0 10px', border: '1px solid #e8e8e6', borderRadius: 6, fontSize: 13, background: '#fff', boxSizing: 'border-box' }
const primaryBtn: React.CSSProperties = { height: 34, padding: '0 16px', borderRadius: 6, border: 'none', background: '#111', color: '#fff', fontSize: 13, cursor: 'pointer' }
const deleteBtn: React.CSSProperties = { height: 28, padding: '0 10px', borderRadius: 4, border: 'none', background: '#fee2e2', color: '#b91c1c', fontSize: 11, cursor: 'pointer', flexShrink: 0 }
const statusBtnActive: React.CSSProperties = { height: 28, padding: '0 10px', borderRadius: 4, border: '1px solid #bbf7d0', background: '#f0fdf4', color: '#15803d', fontSize: 11, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }
const statusBtnEnded: React.CSSProperties = { height: 28, padding: '0 10px', borderRadius: 4, border: '1px solid #e8e8e6', background: '#f4f4f2', color: '#888', fontSize: 11, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }
