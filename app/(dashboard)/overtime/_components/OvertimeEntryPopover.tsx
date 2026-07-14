'use client'

import { useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { Employee, EmployeeTask, Project, WorkRecord } from '@/lib/overtime/types'
import { calculateRecognizedHours } from '@/lib/overtime/time'

/**
 * 프로젝트별 그리드의 셀 클릭 시 열리는 작은 팝오버 입력창.
 * 프로젝트명/직원명/근무일은 셀에서 이미 정해져 있으므로 자동 표시만 하고,
 * 사용자는 업무내용(직원별 기본업무내용 드롭다운) + 근무시간 유형만 고른다.
 *
 * 근무시간 유형 (인정시간 계산 기준):
 *   - 2시간: 18:00~21:00, 휴게 1시간 → 인정 2시간
 *   - 3시간: 18:00~22:00, 휴게 1시간 → 인정 3시간
 *   - 기타: 시작/종료/휴게시간 직접 입력 → 인정 = 종료 - 시작 - 휴게, 1시간 단위 절삭
 *     (계산은 lib/overtime/time.ts의 calculateRecognizedHours)
 *
 * 저장 단위는 그대로 WorkRecord 1건 — "직원 1명 + 날짜 1개 + 프로젝트 1개 + 업무 1개"(1단계 원칙).
 * 같은 셀에 이미 여러 업무가 있으면 상단 목록에서 골라 수정하거나 "+ 추가"로 새 업무를 만든다.
 */

const CUSTOM_TASK = '__custom__'

type TimeType = '2h' | '3h' | 'custom'

const PRESETS: Record<'2h' | '3h', { start: string; end: string; breakH: number; hours: number; label: string; desc: string }> = {
  '2h': { start: '18:00', end: '21:00', breakH: 1, hours: 2, label: '2시간', desc: '18:00~21:00 · 휴게 1시간' },
  '3h': { start: '18:00', end: '22:00', breakH: 1, hours: 3, label: '3시간', desc: '18:00~22:00 · 휴게 1시간' },
}

function detectTimeType(r: WorkRecord): TimeType {
  if (r.start_time === PRESETS['2h'].start && r.end_time === PRESETS['2h'].end && r.hours === PRESETS['2h'].hours) return '2h'
  if (r.start_time === PRESETS['3h'].start && r.end_time === PRESETS['3h'].end && r.hours === PRESETS['3h'].hours) return '3h'
  return 'custom'
}

/** "YYYY-MM-DD" → "M월 D일" (UTC 파싱 버그 회피를 위해 문자열 직접 분해, docs/conventions.md) */
function formatDate(date: string): string {
  const [, month, day] = date.split('-').map(Number)
  return `${month}월 ${day}일`
}

export default function OvertimeEntryPopover({
  project,
  employee,
  date,
  records,
  tasks,
  anchor,
  onClose,
  onSaved,
}: {
  project: Project
  employee: Employee
  date: string
  records: WorkRecord[]      // 이 셀(직원×프로젝트×날짜)의 기존 기록들
  tasks: EmployeeTask[]      // 이 직원의 기본업무내용 — 업무내용 드롭다운 선택지
  anchor: { x: number; y: number } // 클릭한 셀 위치 — 팝오버를 이 근처에 띄운다
  onClose: () => void
  onSaved: () => void
}) {
  const supabase = createSupabaseBrowserClient()
  const first = records[0] ?? null

  const [editingId, setEditingId] = useState<string | null>(first?.id ?? null)
  const [taskChoice, setTaskChoice] = useState<string>(() => initTaskChoice(first))
  const [customTask, setCustomTask] = useState(first?.task_description ?? '')
  const [timeType, setTimeType] = useState<TimeType>(first ? detectTimeType(first) : '2h')
  const [startTime, setStartTime] = useState(first?.start_time ?? '18:00')
  const [endTime, setEndTime] = useState(first?.end_time ?? '')
  const [breakHours, setBreakHours] = useState(String(first?.break_hours ?? 1))
  const [note, setNote] = useState(first?.note ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 드롭다운 선택지에 없는 업무내용(직접 입력했거나 목록에서 지워진 것)은 "직접 입력"으로 취급
  function initTaskChoice(r: WorkRecord | null): string {
    if (!r || !r.task_description) return ''
    return tasks.some(t => t.task_name === r.task_description) ? r.task_description : CUSTOM_TASK
  }

  function applyRecord(r: WorkRecord | null) {
    setEditingId(r?.id ?? null)
    setTaskChoice(initTaskChoice(r))
    setCustomTask(r?.task_description ?? '')
    setTimeType(r ? detectTimeType(r) : '2h')
    setStartTime(r?.start_time ?? '18:00')
    setEndTime(r?.end_time ?? '')
    setBreakHours(String(r?.break_hours ?? 1))
    setNote(r?.note ?? '')
    setError(null)
  }

  const customCalc = timeType === 'custom'
    ? calculateRecognizedHours(startTime, endTime, parseFloat(breakHours))
    : null

  async function handleSave() {
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
      const p = PRESETS[timeType]
      payloadTimes = { start_time: p.start, end_time: p.end, break_hours: p.breakH, hours: p.hours }
    }

    setSaving(true)
    setError(null)
    const payload = {
      employee_id: employee.id,
      project_id: project.id,
      work_date: date,
      task_description: taskDescription,
      note: note.trim(),
      ...payloadTimes,
    }
    const { error: saveError } = editingId
      ? await supabase.from('overtime_work_records').update(payload).eq('id', editingId)
      : await supabase.from('overtime_work_records').insert(payload)
    setSaving(false)
    if (saveError) { setError(`저장 실패: ${saveError.message}`); return }
    onSaved()
    onClose()
  }

  async function handleDelete() {
    if (!editingId) return
    if (!confirm('이 업무 기록을 삭제하시겠습니까?')) return
    setSaving(true)
    const { error: deleteError } = await supabase.from('overtime_work_records').delete().eq('id', editingId)
    setSaving(false)
    if (deleteError) { setError(`삭제 실패: ${deleteError.message}`); return }
    onSaved()
    onClose()
  }

  // 클릭 위치 근처에 띄우되 화면 밖으로 나가지 않게 고정
  const width = 320
  const left = Math.max(8, Math.min(anchor.x - width / 2, (typeof window !== 'undefined' ? window.innerWidth : 1200) - width - 8))
  const top = Math.max(8, Math.min(anchor.y + 10, (typeof window !== 'undefined' ? window.innerHeight : 800) - 500))

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200 }} onClick={onClose}>
      <div
        style={{ position: 'fixed', left, top, width, maxHeight: 'calc(100vh - 16px)', overflowY: 'auto', background: '#fff', borderRadius: 10, boxShadow: '0 12px 40px rgba(0,0,0,0.25)', border: '1px solid #e8e8e6' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: '12px 16px', background: '#111', borderRadius: '10px 10px 0 0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>초과근무 입력</div>
            <div style={{ fontSize: 11, color: '#aaa', marginTop: 3 }}>
              {project.name} · {employee.name} · {formatDate(date)}
            </div>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'rgba(255,255,255,0.15)', color: '#fff', borderRadius: 5, padding: '2px 8px', cursor: 'pointer', fontSize: 12 }}>✕</button>
        </div>

        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {records.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={lbl}>이 날짜의 업무 ({records.length}건)</div>
              {records.map(r => (
                <button
                  key={r.id}
                  onClick={() => applyRecord(r)}
                  style={{ ...recordRow, borderColor: r.id === editingId ? '#111' : '#e8e8e6', background: r.id === editingId ? '#f4f4f2' : '#fff' }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.task_description || '(업무내용 없음)'}</span>
                  <span style={{ flexShrink: 0, fontWeight: 600 }}>{r.hours}h</span>
                </button>
              ))}
              {editingId && (
                <button onClick={() => applyRecord(null)} style={{ ...recordRow, justifyContent: 'center', color: '#555', borderStyle: 'dashed' }}>
                  + 새 업무 추가
                </button>
              )}
            </div>
          )}

          <div>
            <div style={lbl}>업무내용</div>
            <select value={taskChoice} onChange={e => setTaskChoice(e.target.value)} style={inp}>
              <option value="">선택하세요</option>
              {tasks.map(t => <option key={t.id} value={t.task_name}>{t.task_name}</option>)}
              {/* 수정 중인 기록의 업무내용이 기본업무 목록에 없으면 그대로 보여줘야 하므로 직접 입력으로 매핑된다 */}
              <option value={CUSTOM_TASK}>직접 입력...</option>
            </select>
            {tasks.length === 0 && taskChoice !== CUSTOM_TASK && (
              <div style={{ fontSize: 10, color: '#999', marginTop: 3 }}>
                직원 관리 → 기본업무내용에 자주 쓰는 업무를 등록해두면 여기서 바로 고를 수 있습니다
              </div>
            )}
            {taskChoice === CUSTOM_TASK && (
              <input value={customTask} onChange={e => setCustomTask(e.target.value)} placeholder="업무내용 직접 입력" style={{ ...inp, marginTop: 6 }} />
            )}
          </div>

          <div>
            <div style={lbl}>근무시간 유형</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['2h', '3h', 'custom'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTimeType(t)}
                  style={timeType === t ? typeBtnActive : typeBtn}
                >
                  {t === 'custom' ? '기타' : PRESETS[t].label}
                </button>
              ))}
            </div>
            {timeType !== 'custom' ? (
              <div style={{ fontSize: 10, color: '#999', marginTop: 4 }}>
                {PRESETS[timeType].desc} → 인정 {PRESETS[timeType].hours}시간
              </div>
            ) : (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                  <div>
                    <div style={lbl}>시작</div>
                    <input value={startTime} onChange={e => setStartTime(e.target.value)} placeholder="18:00" style={inp} />
                  </div>
                  <div>
                    <div style={lbl}>종료</div>
                    <input value={endTime} onChange={e => setEndTime(e.target.value)} placeholder="23:30" style={inp} />
                  </div>
                  <div>
                    <div style={lbl}>휴게(시간)</div>
                    <input type="number" min={0} step={0.5} value={breakHours} onChange={e => setBreakHours(e.target.value)} style={inp} />
                  </div>
                </div>
                <div style={{ fontSize: 10, color: customCalc ? '#555' : '#bbb' }}>
                  {customCalc
                    ? `인정 초과근무시간: ${customCalc.recognized}시간${customCalc.raw !== customCalc.recognized ? ` (계산 ${customCalc.raw}시간 → 1시간 단위 절삭)` : ''}`
                    : '인정시간 = 종료 − 시작 − 휴게시간 (1시간 단위 절삭, 자정 넘으면 24:00 이상으로)'}
                </div>
              </div>
            )}
          </div>

          <div>
            <div style={lbl}>상세 메모</div>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="선택 입력" style={inp} />
          </div>

          {error && <div style={{ fontSize: 11, color: '#b91c1c' }}>{error}</div>}

          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            {editingId && (
              <button onClick={handleDelete} disabled={saving} style={deleteBtn}>삭제</button>
            )}
            <button onClick={handleSave} disabled={saving} style={{ ...saveBtn, opacity: saving ? 0.6 : 1 }}>
              {saving ? '저장 중...' : '저장'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const lbl: React.CSSProperties = { fontSize: 10, color: '#888', marginBottom: 3 }
const inp: React.CSSProperties = { width: '100%', height: 30, padding: '0 8px', border: '1px solid #e8e8e6', borderRadius: 5, fontSize: 12, background: '#fff', boxSizing: 'border-box' }
const typeBtn: React.CSSProperties = { flex: 1, height: 30, borderRadius: 5, border: '1px solid #e8e8e6', background: '#fff', color: '#555', fontSize: 12, cursor: 'pointer' }
const typeBtnActive: React.CSSProperties = { ...typeBtn, background: '#111', color: '#fff', borderColor: '#111' }
const recordRow: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, height: 28, padding: '0 8px', borderRadius: 5, border: '1px solid #e8e8e6', background: '#fff', fontSize: 11, color: '#333', cursor: 'pointer', textAlign: 'left' }
const deleteBtn: React.CSSProperties = { height: 30, padding: '0 12px', borderRadius: 5, border: 'none', background: '#fee2e2', color: '#b91c1c', fontSize: 12, cursor: 'pointer' }
const saveBtn: React.CSSProperties = { height: 30, padding: '0 16px', borderRadius: 5, border: 'none', background: '#111', color: '#fff', fontSize: 12, cursor: 'pointer' }
