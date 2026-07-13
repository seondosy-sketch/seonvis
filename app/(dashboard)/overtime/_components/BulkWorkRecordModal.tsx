'use client'

import { useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { Employee, Project } from '@/lib/overtime/types'
import { PayPeriodDay } from '@/lib/overtime/summary'
import { calculateHours } from '@/lib/overtime/time'

/**
 * 같은 프로젝트·같은 업무를 여러 날짜에 한 번에 등록한다 (예: 이번 주 내내 같은 현장 점검 업무).
 * 직원 1명 + 프로젝트 1개 + 업무내용 1개는 고정하고, 날짜만 여러 개 선택 — 선택한 날짜 수만큼
 * WorkRecord를 한 번에 insert한다. "직원 1명 + 날짜 1개 + 프로젝트 1개 + 업무 1개 = Record 1개"
 * 원칙은 그대로다 — 이 모달은 그 레코드를 여러 개 동시에 만드는 입력 편의 기능일 뿐이다.
 */
export default function BulkWorkRecordModal({
  employees,
  projects,
  days,
  onClose,
  onSaved,
}: {
  employees: Employee[]
  projects: Project[]
  days: PayPeriodDay[]
  onClose: () => void
  onSaved: () => void
}) {
  const supabase = createSupabaseBrowserClient()
  const [employeeId, setEmployeeId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [taskDescription, setTaskDescription] = useState('')
  const [startTime, setStartTime] = useState('18:00')
  const [endTime, setEndTime] = useState('')
  const [note, setNote] = useState('')
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const weekdayOf = (d: PayPeriodDay) => new Date(d.year, d.month, d.day).getDay()

  function toggleDate(dateStr: string) {
    setSelectedDates(prev => {
      const next = new Set(prev)
      if (next.has(dateStr)) next.delete(dateStr)
      else next.add(dateStr)
      return next
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!employeeId) { setError('직원을 선택하세요'); return }
    if (!projectId) { setError('프로젝트를 선택하세요'); return }
    if (!taskDescription.trim()) { setError('업무내용을 입력하세요'); return }
    const hours = calculateHours(startTime, endTime)
    if (hours === null) {
      setError('시작/종료 시간을 "HH:mm" 형식으로 입력하세요. 종료시간은 시작시간보다 늦어야 합니다.')
      return
    }
    if (selectedDates.size === 0) { setError('날짜를 하나 이상 선택하세요'); return }

    setSaving(true)
    setError(null)
    const rows = [...selectedDates].map(work_date => ({
      employee_id: employeeId,
      project_id: projectId,
      work_date,
      task_description: taskDescription.trim(),
      start_time: startTime.trim(),
      end_time: endTime.trim(),
      hours,
      note: note.trim(),
    }))
    const { error: saveError } = await supabase.from('overtime_work_records').insert(rows)
    setSaving(false)

    if (saveError) { setError(`저장 실패: ${saveError.message}`); return }
    onSaved()
    onClose()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 12, width: 620, maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #e8e8e6', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', background: '#111', borderRadius: '12px 12px 0 0' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>일괄 업무 입력</div>
            <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>같은 프로젝트·같은 업무를 여러 날짜에 한 번에 등록합니다</div>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'rgba(255,255,255,0.15)', color: '#fff', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 13 }}>✕</button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="직원">
              <select value={employeeId} onChange={e => setEmployeeId(e.target.value)} style={inp}>
                <option value="">선택하세요</option>
                {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
              </select>
            </Field>
            <Field label="프로젝트">
              <select value={projectId} onChange={e => setProjectId(e.target.value)} style={inp}>
                <option value="">선택하세요</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
          </div>
          <Field label="업무내용">
            <input value={taskDescription} onChange={e => setTaskDescription(e.target.value)} placeholder="예: 현장 품질점검" style={inp} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="시작시간">
              <input value={startTime} onChange={e => setStartTime(e.target.value)} placeholder="18:00" style={inp} />
            </Field>
            <Field label="종료시간">
              <input value={endTime} onChange={e => setEndTime(e.target.value)} placeholder="20:00 (자정 넘으면 24:00+)" style={inp} />
            </Field>
          </div>
          <div style={{ fontSize: 11, color: '#999' }}>12시 또는 18시부터 시작하면 식사시간 1시간이 자동으로 빠집니다. 선택한 모든 날짜에 같은 시간이 적용됩니다.</div>
          <Field label="비고">
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="선택 입력" style={inp} />
          </Field>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ fontSize: 11, color: '#888' }}>날짜 선택 ({selectedDates.size}일)</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" onClick={() => setSelectedDates(new Set(days.map(d => d.dateStr)))} style={quickBtn}>전체 선택</button>
                <button
                  type="button"
                  onClick={() => setSelectedDates(new Set(days.filter(d => { const wd = weekdayOf(d); return wd !== 0 && wd !== 6 }).map(d => d.dateStr)))}
                  style={quickBtn}
                >평일만</button>
                <button type="button" onClick={() => setSelectedDates(new Set())} style={quickBtn}>전체 해제</button>
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: 10, background: '#f8f8f7', borderRadius: 6, border: '1px solid #e8e8e6' }}>
              {days.map((d, i) => {
                const isFirstOfMonth = i === 0 || d.day === 1
                const weekday = weekdayOf(d)
                const selected = selectedDates.has(d.dateStr)
                const color = weekday === 0 ? '#ef4444' : weekday === 6 ? '#3b82f6' : '#555'
                return (
                  <button
                    type="button"
                    key={d.dateStr}
                    onClick={() => toggleDate(d.dateStr)}
                    title={`${d.month + 1}/${d.day}`}
                    style={{
                      ...dayPill,
                      marginLeft: isFirstOfMonth ? 6 : 0,
                      background: selected ? '#111' : '#fff',
                      color: selected ? '#fff' : color,
                      borderColor: selected ? '#111' : '#e8e8e6',
                    }}
                  >
                    {isFirstOfMonth && <div style={{ fontSize: 8, opacity: 0.7 }}>{d.month + 1}월</div>}
                    {d.day}
                  </button>
                )
              })}
            </div>
          </div>

          {error && <div style={{ fontSize: 12, color: '#b91c1c' }}>{error}</div>}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
            <button type="button" onClick={onClose} style={cancelBtn}>취소</button>
            <button type="submit" disabled={saving} style={{ ...saveBtn, opacity: saving ? 0.6 : 1 }}>
              {saving ? '저장 중...' : `선택한 ${selectedDates.size}일에 등록`}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>{label}</div>{children}</div>
}

const inp: React.CSSProperties = { width: '100%', height: 34, padding: '0 10px', border: '1px solid #e8e8e6', borderRadius: 6, fontSize: 13, background: '#fff', boxSizing: 'border-box' }
const cancelBtn: React.CSSProperties = { height: 32, padding: '0 14px', borderRadius: 6, border: '1px solid #e8e8e6', background: '#fff', color: '#555', fontSize: 13, cursor: 'pointer' }
const saveBtn: React.CSSProperties = { height: 32, padding: '0 14px', borderRadius: 6, border: 'none', background: '#111', color: '#fff', fontSize: 13, cursor: 'pointer' }
const quickBtn: React.CSSProperties = { height: 24, padding: '0 8px', borderRadius: 4, border: '1px solid #e8e8e6', background: '#fff', color: '#555', fontSize: 11, cursor: 'pointer' }
const dayPill: React.CSSProperties = { width: 30, height: 30, borderRadius: 6, border: '1px solid #e8e8e6', fontSize: 11, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', lineHeight: 1.1 }
