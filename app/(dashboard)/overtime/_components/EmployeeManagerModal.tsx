'use client'

import { useCallback, useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { Employee, EmployeeTask } from '@/lib/overtime/types'

/**
 * 직원 등록/수정/정렬 관리. 삭제는 그 직원의 overtime_work_records가 하나도 없을 때만
 * 가능하다(FK ON DELETE RESTRICT) — 퇴사자는 "재직여부"만 끄고 행은 지우지 않는다
 * (2단계에서 정한 소프트 삭제 원칙, 과거 근무 기록 보존).
 *
 * "기본업무내용" 관리(8단계 완료 후 추가): 직원마다 자주 쓰는 업무내용을 여기서 등록해두면
 * 향후 근무입력 화면에서 드롭박스 선택지로 쓸 수 있는 기초자료가 된다. 행 하나를 펼치면
 * 그 직원의 업무내용 목록(overtime_employee_tasks)을 보여주고 추가/삭제할 수 있다.
 */
export default function EmployeeManagerModal({
  onClose,
  onChange,
}: {
  onClose: () => void
  onChange: () => void
}) {
  const supabase = createSupabaseBrowserClient()
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [newPosition, setNewPosition] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [tasksByEmployee, setTasksByEmployee] = useState<Record<string, EmployeeTask[]>>({})
  const [tasksLoading, setTasksLoading] = useState(false)
  const [newTaskName, setNewTaskName] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('overtime_employees').select('*').order('sort_order', { ascending: true })
    if (data) setEmployees(data as Employee[])
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { load() }, [load])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    setAdding(true)
    setError(null)
    const nextSortOrder = employees.length ? Math.max(...employees.map(emp => emp.sort_order)) + 10 : 0
    const { error: insertError } = await supabase
      .from('overtime_employees')
      .insert({ name: newName.trim(), position: newPosition.trim(), is_active: true, sort_order: nextSortOrder })
    setAdding(false)
    if (insertError) { setError(`추가 실패: ${insertError.message}`); return }
    setNewName('')
    setNewPosition('')
    await load()
    onChange()
  }

  async function updateEmployee(id: string, patch: Partial<Employee>) {
    setError(null)
    const { error: updateError } = await supabase.from('overtime_employees').update(patch).eq('id', id)
    if (updateError) { setError(`저장 실패: ${updateError.message}`); return }
    await load()
    onChange()
  }

  async function handleDelete(emp: Employee) {
    if (!confirm(`"${emp.name}"을 삭제하시겠습니까?`)) return
    setError(null)
    const { error: deleteError } = await supabase.from('overtime_employees').delete().eq('id', emp.id)
    if (deleteError) {
      setError(
        deleteError.code === '23503'
          ? '이 직원의 연장근무 기록이 있어 삭제할 수 없습니다. "재직여부"를 퇴사로 변경해 주세요.'
          : `삭제 실패: ${deleteError.message}`
      )
      return
    }
    await load()
    onChange()
  }

  const loadTasks = useCallback(async (employeeId: string) => {
    setTasksLoading(true)
    const { data } = await supabase
      .from('overtime_employee_tasks')
      .select('*')
      .eq('employee_id', employeeId)
      .order('sort_order', { ascending: true })
    if (data) setTasksByEmployee(prev => ({ ...prev, [employeeId]: data as EmployeeTask[] }))
    setTasksLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function toggleExpand(employeeId: string) {
    if (expandedId === employeeId) {
      setExpandedId(null)
      return
    }
    setExpandedId(employeeId)
    setNewTaskName('')
    if (!tasksByEmployee[employeeId]) loadTasks(employeeId)
  }

  async function handleAddTask(e: React.FormEvent, employeeId: string) {
    e.preventDefault()
    const name = newTaskName.trim()
    if (!name) return
    const existing = tasksByEmployee[employeeId] ?? []
    const nextSortOrder = existing.length ? Math.max(...existing.map(t => t.sort_order)) + 10 : 0
    const { error: insertError } = await supabase
      .from('overtime_employee_tasks')
      .insert({ employee_id: employeeId, task_name: name, sort_order: nextSortOrder })
    if (insertError) {
      setError(
        insertError.code === '23505'
          ? '이미 등록된 업무내용입니다.'
          : `업무내용 추가 실패: ${insertError.message}`
      )
      return
    }
    setError(null)
    setNewTaskName('')
    await loadTasks(employeeId)
  }

  async function handleDeleteTask(task: EmployeeTask) {
    const { error: deleteError } = await supabase.from('overtime_employee_tasks').delete().eq('id', task.id)
    if (deleteError) { setError(`업무내용 삭제 실패: ${deleteError.message}`); return }
    await loadTasks(task.employee_id)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 12, width: 560, maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #e8e8e6', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#111', borderRadius: '12px 12px 0 0' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>직원 관리</div>
          <button onClick={onClose} style={{ border: 'none', background: 'rgba(255,255,255,0.15)', color: '#fff', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 13 }}>✕</button>
        </div>

        <form onSubmit={handleAdd} style={{ padding: '16px 20px', borderBottom: '1px solid #f0f0ee', display: 'flex', gap: 8 }}>
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="이름" style={{ ...inp, flex: 1 }} />
          <input value={newPosition} onChange={e => setNewPosition(e.target.value)} placeholder="직급" style={{ ...inp, width: 100 }} />
          <button type="submit" disabled={adding} style={{ ...primaryBtn, opacity: adding ? 0.6 : 1 }}>{adding ? '추가 중...' : '추가'}</button>
        </form>

        {error && <div style={{ margin: '0 20px', marginTop: 12, padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, color: '#b91c1c' }}>{error}</div>}

        <div style={{ padding: '8px 20px 20px' }}>
          {loading ? (
            <div style={{ padding: 30, textAlign: 'center', color: '#bbb', fontSize: 13 }}>불러오는 중...</div>
          ) : employees.length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: '#bbb', fontSize: 13 }}>등록된 직원이 없습니다</div>
          ) : (
            employees.map((emp, i) => {
              const expanded = expandedId === emp.id
              const tasks = tasksByEmployee[emp.id] ?? []
              return (
                <div key={emp.id} style={{ borderBottom: i < employees.length - 1 ? '1px solid #f0f0ee' : 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0' }}>
                    <input
                      defaultValue={emp.name}
                      onBlur={e => { if (e.target.value.trim() && e.target.value !== emp.name) updateEmployee(emp.id, { name: e.target.value.trim() }) }}
                      style={{ ...inp, flex: 1 }}
                    />
                    <input
                      defaultValue={emp.position}
                      onBlur={e => { if (e.target.value !== emp.position) updateEmployee(emp.id, { position: e.target.value.trim() }) }}
                      placeholder="직급"
                      style={{ ...inp, width: 90 }}
                    />
                    <input
                      type="number"
                      defaultValue={emp.sort_order}
                      onBlur={e => { const v = parseInt(e.target.value, 10); if (!Number.isNaN(v) && v !== emp.sort_order) updateEmployee(emp.id, { sort_order: v }) }}
                      style={{ ...inp, width: 64 }}
                      title="정렬순서"
                    />
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#555', flexShrink: 0 }}>
                      <input type="checkbox" checked={emp.is_active} onChange={e => updateEmployee(emp.id, { is_active: e.target.checked })} />
                      재직중
                    </label>
                    <button onClick={() => toggleExpand(emp.id)} style={expanded ? taskBtnActive : taskBtn}>
                      기본업무내용{tasks.length > 0 ? ` (${tasks.length})` : ''} {expanded ? '▲' : '▼'}
                    </button>
                    <button onClick={() => handleDelete(emp)} style={deleteBtn}>삭제</button>
                  </div>

                  {expanded && (
                    <div style={{ margin: '0 0 12px', padding: 12, background: '#f8f8f7', border: '1px solid #e8e8e6', borderRadius: 8 }}>
                      <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>
                        {emp.name}의 기본업무내용 — 근무입력 시 드롭박스 선택지로 쓰일 목록입니다
                      </div>
                      {tasksLoading && !tasksByEmployee[emp.id] ? (
                        <div style={{ fontSize: 12, color: '#bbb' }}>불러오는 중...</div>
                      ) : (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                          {tasks.length === 0 ? (
                            <div style={{ fontSize: 12, color: '#bbb' }}>등록된 업무내용이 없습니다</div>
                          ) : (
                            tasks.map(t => (
                              <span key={t.id} style={taskChip}>
                                {t.task_name}
                                <button onClick={() => handleDeleteTask(t)} style={taskChipDelete} title="삭제">✕</button>
                              </span>
                            ))
                          )}
                        </div>
                      )}
                      <form onSubmit={e => handleAddTask(e, emp.id)} style={{ display: 'flex', gap: 8 }}>
                        <input
                          value={newTaskName}
                          onChange={e => setNewTaskName(e.target.value)}
                          placeholder="예: 품질관리 검토"
                          style={{ ...inp, flex: 1, background: '#fff' }}
                        />
                        <button type="submit" style={primaryBtn}>추가</button>
                      </form>
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
const primaryBtn: React.CSSProperties = { height: 34, padding: '0 16px', borderRadius: 6, border: 'none', background: '#111', color: '#fff', fontSize: 13, cursor: 'pointer' }
const deleteBtn: React.CSSProperties = { height: 28, padding: '0 10px', borderRadius: 4, border: 'none', background: '#fee2e2', color: '#b91c1c', fontSize: 11, cursor: 'pointer', flexShrink: 0 }
const taskBtn: React.CSSProperties = { height: 28, padding: '0 10px', borderRadius: 4, border: '1px solid #e8e8e6', background: '#fff', color: '#555', fontSize: 11, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }
const taskBtnActive: React.CSSProperties = { ...taskBtn, background: '#111', color: '#fff', borderColor: '#111' }
const taskChip: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, height: 26, padding: '0 6px 0 10px', borderRadius: 13, border: '1px solid #e8e8e6', background: '#fff', color: '#333', fontSize: 12 }
const taskChipDelete: React.CSSProperties = { border: 'none', background: 'transparent', color: '#999', fontSize: 11, cursor: 'pointer', padding: '2px 4px', lineHeight: 1 }
