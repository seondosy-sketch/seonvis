'use client'

import { useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { Employee, EmployeeTask, Project } from '@/lib/overtime/types'
import { PayPeriodDay } from '@/lib/overtime/summary'
import { calculateRecognizedHours, TIME_TYPE_PRESETS, TimeType } from '@/lib/overtime/time'

const CUSTOM_TASK = '__custom__'

/**
 * 같은 프로젝트·같은 업무를 여러 날짜에 한 번에 등록한다 (예: 이번 주 내내 같은 현장 점검 업무).
 * 직원 1명 + 프로젝트 1개 + 업무내용 1개는 고정하고, 날짜만 여러 개 선택 — 선택한 날짜 수만큼
 * WorkRecord를 한 번에 insert한다. "직원 1명 + 날짜 1개 + 프로젝트 1개 + 업무 1개 = Record 1개"
 * 원칙은 그대로다 — 이 모달은 그 레코드를 여러 개 동시에 만드는 입력 편의 기능일 뿐이다.
 *
 * 업무내용/근무시간 입력 방식은 셀 팝오버(OvertimeEntryPopover)와 동일하다:
 * 업무내용은 선택한 직원의 기본업무내용 드롭다운(+직접 입력), 근무시간은
 * 2시간/3시간/기타 유형(기타 = 종료 − 시작 − 휴게, 1시간 단위 절삭).
 */
export default function BulkWorkRecordModal({
  employees,
  projects,
  tasks,
  days,
  onClose,
  onSaved,
}: {
  employees: Employee[]
  projects: Project[]
  tasks: EmployeeTask[] // 전체 직원의 기본업무내용 — 선택한 직원 것만 걸러서 드롭다운에 쓴다
  days: PayPeriodDay[]
  onClose: () => void
  onSaved: () => void
}) {
  const supabase = createSupabaseBrowserClient()
  const [employeeId, setEmployeeId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [taskChoice, setTaskChoice] = useState('')
  const [customTask, setCustomTask] = useState('')
  const [timeType, setTimeType] = useState<TimeType>('2h')
  const [startTime, setStartTime] = useState('18:00')
  const [endTime, setEndTime] = useState('')
  const [breakHours, setBreakHours] = useState('1')
  const [note, setNote] = useState('')
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const employeeTasks = tasks.filter(t => t.employee_id === employeeId)
  const customCalc = timeType === 'custom'
    ? calculateRecognizedHours(startTime, endTime, parseFloat(breakHours))
    : null

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
    const taskDescription = (taskChoice === CUSTOM_TASK ? customTask : taskChoice).trim()
    if (!taskDescription) { setError('업무내용을 선택하거나 입력하세요'); return }

    let payloadTimes: { start_time: string; end_time: string; break_hours: number; hours: number }
    if (timeType === 'custom') {
      const calc = calculateRecognizedHours(startTime, endTime, parseFloat(breakHours))
      if (!calc) {
        setError('시작/종료를 "HH:mm"으로, 휴게시간을 0 이상으로 입력하세요. 인정시간이 0보다 커야 합니다 (자정을 넘으면 24:00 이상으로 입력)')
        return
      }
      if (calc.recognized < 1) { setError('인정시간이 1시간 미만입니다 (1시간 단위 절삭)'); return }
      payloadTimes = { start_time: startTime.trim(), end_time: endTime.trim(), break_hours: parseFloat(breakHours), hours: calc.recognized }
    } else {
      const p = TIME_TYPE_PRESETS[timeType]
      payloadTimes = { start_time: p.start, end_time: p.end, break_hours: p.breakH, hours: p.hours }
    }
    if (selectedDates.size === 0) { setError('날짜를 하나 이상 선택하세요'); return }

    setSaving(true)
    setError(null)
    const rows = [...selectedDates].map(work_date => ({
      employee_id: employeeId,
      project_id: projectId,
      work_date,
      task_description: taskDescription,
      note: note.trim(),
      ...payloadTimes,
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
              {/* 직원이 바뀌면 기본업무내용 목록도 바뀌므로 선택돼 있던 업무내용을 초기화한다 */}
              <select value={employeeId} onChange={e => { setEmployeeId(e.target.value); setTaskChoice('') }} style={inp}>
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
            <select value={taskChoice} onChange={e => setTaskChoice(e.target.value)} style={inp}>
              <option value="">선택하세요</option>
              {employeeTasks.map(t => <option key={t.id} value={t.task_name}>{t.task_name}</option>)}
              <option value={CUSTOM_TASK}>직접 입력...</option>
            </select>
            {employeeId && employeeTasks.length === 0 && taskChoice !== CUSTOM_TASK && (
              <div style={{ fontSize: 10, color: '#999', marginTop: 3 }}>
                직원 관리 → 기본업무내용에 자주 쓰는 업무를 등록해두면 여기서 바로 고를 수 있습니다
              </div>
            )}
            {taskChoice === CUSTOM_TASK && (
              <input value={customTask} onChange={e => setCustomTask(e.target.value)} placeholder="업무내용 직접 입력" style={{ ...inp, marginTop: 6 }} />
            )}
          </Field>
          <Field label="근무시간 유형">
            <div style={{ display: 'flex', gap: 6 }}>
              {(['2h', '3h', 'custom'] as const).map(t => (
                <button key={t} type="button" onClick={() => setTimeType(t)} style={timeType === t ? typeBtnActive : typeBtn}>
                  {t === 'custom' ? '기타' : TIME_TYPE_PRESETS[t].label}
                </button>
              ))}
            </div>
            {timeType !== 'custom' ? (
              <div style={{ fontSize: 11, color: '#999', marginTop: 6 }}>
                {TIME_TYPE_PRESETS[timeType].desc} → 인정 {TIME_TYPE_PRESETS[timeType].hours}시간 · 선택한 모든 날짜에 같은 시간이 적용됩니다
              </div>
            ) : (
              <div style={{ marginTop: 8 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                  <Field label="시작">
                    <input value={startTime} onChange={e => setStartTime(e.target.value)} placeholder="18:00" style={inp} />
                  </Field>
                  <Field label="종료">
                    <input value={endTime} onChange={e => setEndTime(e.target.value)} placeholder="23:30" style={inp} />
                  </Field>
                  <Field label="휴게(시간)">
                    <input type="number" min={0} step={0.5} value={breakHours} onChange={e => setBreakHours(e.target.value)} style={inp} />
                  </Field>
                </div>
                <div style={{ fontSize: 11, color: customCalc ? '#555' : '#bbb', marginTop: 6 }}>
                  {customCalc
                    ? `인정 초과근무시간: ${customCalc.recognized}시간${customCalc.raw !== customCalc.recognized ? ` (계산 ${customCalc.raw}시간 → 1시간 단위 절삭)` : ''} · 선택한 모든 날짜에 같은 시간이 적용됩니다`
                    : '인정시간 = 종료 − 시작 − 휴게시간 (1시간 단위 절삭, 자정 넘으면 24:00 이상으로)'}
                </div>
              </div>
            )}
          </Field>
          <Field label="상세 메모">
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
// border 축약형 + borderColor 개별 속성을 섞으면 React가 리렌더 시 스타일 충돌을 경고하므로 개별 속성으로만 정의
const typeBtn: React.CSSProperties = { flex: 1, height: 32, borderRadius: 6, borderWidth: 1, borderStyle: 'solid', borderColor: '#e8e8e6', background: '#fff', color: '#555', fontSize: 13, cursor: 'pointer' }
const typeBtnActive: React.CSSProperties = { ...typeBtn, background: '#111', color: '#fff', borderColor: '#111' }
const dayPill: React.CSSProperties = { width: 30, height: 30, borderRadius: 6, border: '1px solid #e8e8e6', fontSize: 11, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', lineHeight: 1.1 }
