'use client'

import { useCallback, useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { Employee, Project, ProjectMember } from '@/lib/overtime/types'

/**
 * 프로젝트 등록/수정/종료 관리. 삭제는 그 프로젝트를 참조하는 overtime_work_records가
 * 하나도 없을 때만 가능하다(FK ON DELETE RESTRICT) — 이미 쓰인 프로젝트는 "종료" 상태로만
 * 바꾸고 행 자체는 지우지 않는다(2단계에서 정한 소프트 삭제 원칙).
 *
 * 입찰 연계 프로젝트(source_project_id 있음)는 이름·기간(공고일~발표일)·상태가
 * 프로젝트 List에서 자동 동기화되므로(lib/overtime/sync.ts) 여기서 수정/삭제할 수 없다 —
 * 어차피 다음 페이지 로드 때 덮어써진다. 정렬순서와 담당직원 배정만 이 화면에서 관리한다.
 * 입찰 List에 없는 프로젝트(내부 업무 등)의 수동 등록은 기존대로 가능하다.
 *
 * "담당직원" 지정(8단계 완료 후 추가): 행을 펼치면 직원 체크박스 목록이 나오고, 체크/해제가
 * overtime_project_members에 즉시 저장된다. 실제 근무 이력(overtime_work_records)과 별개의
 * "배정" 정보로, 향후 프로젝트별 인원을 나열해 근무일을 표기하는 화면의 기초자료가 된다.
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

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [members, setMembers] = useState<ProjectMember[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('overtime_projects').select('*').order('sort_order', { ascending: true })
    if (data) setProjects(data as Project[])
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 배정 데이터는 프로젝트×직원 수준의 작은 테이블이므로 처음에 전부 불러온다 —
  // 토글 버튼에 담당 인원수를 바로 보여주기 위해 (기본업무내용처럼 lazy 조회하지 않음)
  const loadMembers = useCallback(async () => {
    const [empRes, memRes] = await Promise.all([
      supabase.from('overtime_employees').select('*').order('sort_order', { ascending: true }),
      supabase.from('overtime_project_members').select('*'),
    ])
    if (empRes.data) setEmployees(empRes.data as Employee[])
    if (memRes.data) setMembers(memRes.data as ProjectMember[])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { load(); loadMembers() }, [load, loadMembers])

  async function toggleMember(projectId: string, employeeId: string, assigned: boolean) {
    setError(null)
    const { error: toggleError } = assigned
      ? await supabase.from('overtime_project_members').insert({ project_id: projectId, employee_id: employeeId })
      : await supabase.from('overtime_project_members').delete().eq('project_id', projectId).eq('employee_id', employeeId)
    if (toggleError) { setError(`담당직원 저장 실패: ${toggleError.message}`); return }
    await loadMembers()
  }

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
      <div style={{ background: '#fff', borderRadius: 12, width: 780, maxWidth: 'calc(100vw - 40px)', maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }} onClick={e => e.stopPropagation()}>
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
            projects.map((p, i) => {
              const expanded = expandedId === p.id
              const memberIds = new Set(members.filter(m => m.project_id === p.id).map(m => m.employee_id))
              // 체크 목록은 재직 중인 직원만 보여주되, 이미 배정된 퇴사자는 해제할 수 있게 남겨둔다
              const selectable = employees.filter(emp => emp.is_active || memberIds.has(emp.id))
              // 입찰 연계 프로젝트: 이름·기간·상태는 프로젝트 List가 원본이므로 읽기 전용,
              // 삭제도 막는다(지워도 다음 로드 때 동기화로 되살아나 혼란만 준다).
              const synced = !!p.source_project_id
              return (
                <div key={p.id} style={{ borderBottom: i < projects.length - 1 ? '1px solid #f0f0ee' : 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0' }}>
                    {synced && (
                      <span style={syncedBadge} title="입찰 현황 프로젝트 List와 연계됨 — 이름·기간·상태는 그쪽에서 수정하세요">입찰연계</span>
                    )}
                    <input
                      defaultValue={p.name}
                      disabled={synced}
                      onBlur={e => { if (e.target.value.trim() && e.target.value !== p.name) updateProject(p.id, { name: e.target.value.trim() }) }}
                      style={{ ...inp, flex: 1, ...(synced ? inpDisabled : null) }}
                    />
                    <input
                      type="date"
                      defaultValue={p.start_date ?? ''}
                      disabled={synced}
                      onBlur={e => { const v = e.target.value || null; if (v !== p.start_date) updateProject(p.id, { start_date: v }) }}
                      style={{ ...inp, width: 128, ...(synced ? inpDisabled : null) }}
                      title={synced ? '공고일 (프로젝트 List 연동)' : '시작일'}
                    />
                    <span style={{ fontSize: 11, color: '#bbb', flexShrink: 0 }}>~</span>
                    <input
                      type="date"
                      defaultValue={p.end_date ?? ''}
                      disabled={synced}
                      onBlur={e => { const v = e.target.value || null; if (v !== p.end_date) updateProject(p.id, { end_date: v }) }}
                      style={{ ...inp, width: 128, ...(synced ? inpDisabled : null) }}
                      title={synced ? '발표일 (프로젝트 List 연동, 없으면 계속 표기)' : '종료일'}
                    />
                    <input
                      type="number"
                      defaultValue={p.sort_order}
                      onBlur={e => { const v = parseInt(e.target.value, 10); if (!Number.isNaN(v) && v !== p.sort_order) updateProject(p.id, { sort_order: v }) }}
                      style={{ ...inp, width: 64 }}
                      title="정렬순서"
                    />
                    <button onClick={() => setExpandedId(expanded ? null : p.id)} style={expanded ? memberBtnActive : memberBtn}>
                      담당직원{memberIds.size > 0 ? ` (${memberIds.size})` : ''} {expanded ? '▲' : '▼'}
                    </button>
                    <button
                      onClick={synced ? undefined : () => updateProject(p.id, { status: p.status === '진행중' ? '종료' : '진행중' })}
                      disabled={synced}
                      title={synced ? '입찰 연계 프로젝트의 상태는 프로젝트 List를 따릅니다' : undefined}
                      style={{ ...(p.status === '진행중' ? statusBtnActive : statusBtnEnded), ...(synced ? { cursor: 'default', opacity: 0.7 } : null) }}
                    >
                      {p.status}
                    </button>
                    {!synced && <button onClick={() => handleDelete(p)} style={deleteBtn}>삭제</button>}
                  </div>

                  {expanded && (
                    <div style={{ margin: '0 0 12px', padding: 12, background: '#f8f8f7', border: '1px solid #e8e8e6', borderRadius: 8 }}>
                      <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>
                        {p.name} 담당직원 — 체크하면 바로 저장됩니다 (향후 프로젝트별 인원·근무일 표기에 사용)
                      </div>
                      {selectable.length === 0 ? (
                        <div style={{ fontSize: 12, color: '#bbb' }}>등록된 직원이 없습니다 — 직원 관리에서 먼저 추가하세요</div>
                      ) : (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px' }}>
                          {selectable.map(emp => (
                            <label key={emp.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: emp.is_active ? '#333' : '#999', cursor: 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={memberIds.has(emp.id)}
                                onChange={e => toggleMember(p.id, emp.id, e.target.checked)}
                              />
                              {emp.name}{emp.position ? ` ${emp.position}` : ''}{emp.is_active ? '' : ' (퇴사)'}
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

const inp: React.CSSProperties = { height: 34, padding: '0 10px', border: '1px solid #e8e8e6', borderRadius: 6, fontSize: 13, background: '#fff', boxSizing: 'border-box' }
const inpDisabled: React.CSSProperties = { background: '#f8f8f7', color: '#888' }
const syncedBadge: React.CSSProperties = { flexShrink: 0, fontSize: 10, padding: '2px 6px', borderRadius: 4, background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', whiteSpace: 'nowrap', cursor: 'help' }
const primaryBtn: React.CSSProperties = { height: 34, padding: '0 16px', borderRadius: 6, border: 'none', background: '#111', color: '#fff', fontSize: 13, cursor: 'pointer' }
const deleteBtn: React.CSSProperties = { height: 28, padding: '0 10px', borderRadius: 4, border: 'none', background: '#fee2e2', color: '#b91c1c', fontSize: 11, cursor: 'pointer', flexShrink: 0 }
const statusBtnActive: React.CSSProperties = { height: 28, padding: '0 10px', borderRadius: 4, border: '1px solid #bbf7d0', background: '#f0fdf4', color: '#15803d', fontSize: 11, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }
const statusBtnEnded: React.CSSProperties = { height: 28, padding: '0 10px', borderRadius: 4, border: '1px solid #e8e8e6', background: '#f4f4f2', color: '#888', fontSize: 11, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }
// border 축약형 + borderColor 개별 속성을 섞으면 React가 리렌더 시 스타일 충돌을 경고하므로 개별 속성으로만 정의
const memberBtn: React.CSSProperties = { height: 28, padding: '0 10px', borderRadius: 4, borderWidth: 1, borderStyle: 'solid', borderColor: '#e8e8e6', background: '#fff', color: '#555', fontSize: 11, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }
const memberBtnActive: React.CSSProperties = { ...memberBtn, background: '#111', color: '#fff', borderColor: '#111' }
