'use client'

import { useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { Project, WorkRecord } from '@/lib/overtime/types'
import { calculateHours } from '@/lib/overtime/time'

/**
 * 업무 1건(WorkRecord) 추가/수정 폼. 저장 시 연장시간(hours)은 항상 이 폼에서
 * start_time/end_time으로부터 계산해서 넣는다 — 그리드/대시보드는 저장된 hours만 읽는다.
 */
export default function WorkRecordForm({
  employeeId,
  workDate,
  projects,
  initial,
  defaultProjectId,
  onCancel,
  onSaved,
}: {
  employeeId: string
  workDate: string
  projects: Project[]
  initial?: WorkRecord
  defaultProjectId?: string // 프로젝트별 그리드에서 셀을 눌러 들어온 경우, 그 프로젝트를 미리 선택
  onCancel: () => void
  onSaved: () => void
}) {
  const supabase = createSupabaseBrowserClient()
  const [projectId, setProjectId] = useState(initial?.project_id ?? defaultProjectId ?? '')
  const [taskDescription, setTaskDescription] = useState(initial?.task_description ?? '')
  // 연장근무는 보통 정규 근무가 끝나는 18시부터 시작하므로 기본값으로 넣어둔다 — 물론 수정 가능.
  const [startTime, setStartTime] = useState(initial?.start_time ?? '18:00')
  const [endTime, setEndTime] = useState(initial?.end_time ?? '')
  const [note, setNote] = useState(initial?.note ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!projectId) { setError('프로젝트를 선택하세요'); return }
    if (!taskDescription.trim()) { setError('업무내용을 입력하세요'); return }
    const hours = calculateHours(startTime, endTime)
    if (hours === null) {
      setError('시작/종료 시간을 "HH:mm" 형식으로 입력하세요. 종료시간은 시작시간보다 늦어야 합니다 (자정을 넘으면 24:00 이상으로 입력, 예: 21:00~24:00)')
      return
    }

    setSaving(true)
    setError(null)
    const payload = {
      employee_id: employeeId,
      project_id: projectId,
      work_date: workDate,
      task_description: taskDescription.trim(),
      start_time: startTime.trim(),
      end_time: endTime.trim(),
      hours,
      note: note.trim(),
    }
    const { error: saveError } = initial
      ? await supabase.from('overtime_work_records').update(payload).eq('id', initial.id)
      : await supabase.from('overtime_work_records').insert(payload)
    setSaving(false)

    if (saveError) { setError(`저장 실패: ${saveError.message}`); return }
    onSaved()
  }

  return (
    <form onSubmit={handleSubmit} style={{ padding: '14px 0', borderTop: '1px solid #f0f0ee', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Field label="프로젝트">
        <select value={projectId} onChange={e => setProjectId(e.target.value)} style={inp}>
          <option value="">선택하세요</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </Field>
      <Field label="업무내용">
        <input value={taskDescription} onChange={e => setTaskDescription(e.target.value)} placeholder="예: 품질관리 검토" style={inp} />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="시작시간">
          <input value={startTime} onChange={e => setStartTime(e.target.value)} placeholder="18:00" style={inp} />
        </Field>
        <Field label="종료시간">
          <input value={endTime} onChange={e => setEndTime(e.target.value)} placeholder="20:00 (자정 넘으면 24:00+)" style={inp} />
        </Field>
      </div>
      <div style={{ fontSize: 11, color: '#999' }}>12시 또는 18시부터 시작하면 그 안에 낀 식사시간 1시간이 자동으로 빠집니다.</div>
      <Field label="비고">
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="선택 입력" style={inp} />
      </Field>

      {error && <div style={{ fontSize: 12, color: '#b91c1c' }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
        <button type="button" onClick={onCancel} style={cancelBtn}>취소</button>
        <button type="submit" disabled={saving} style={{ ...saveBtn, opacity: saving ? 0.6 : 1 }}>{saving ? '저장 중...' : '저장'}</button>
      </div>
    </form>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>{label}</div>{children}</div>
}

const inp: React.CSSProperties = { width: '100%', height: 34, padding: '0 10px', border: '1px solid #e8e8e6', borderRadius: 6, fontSize: 13, background: '#fff', boxSizing: 'border-box' }
const cancelBtn: React.CSSProperties = { height: 32, padding: '0 14px', borderRadius: 6, border: '1px solid #e8e8e6', background: '#fff', color: '#555', fontSize: 13, cursor: 'pointer' }
const saveBtn: React.CSSProperties = { height: 32, padding: '0 14px', borderRadius: 6, border: 'none', background: '#111', color: '#fff', fontSize: 13, cursor: 'pointer' }
