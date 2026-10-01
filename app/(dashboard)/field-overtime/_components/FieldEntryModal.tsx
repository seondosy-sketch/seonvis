'use client'

import { useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { FieldOvertimeRecord } from '@/lib/field-overtime/types'
import { Employee } from '@/lib/overtime/types'
import { FIELD_BREAK_HOURS, FIELD_START_TIME, HOLIDAY_DEFAULT_START, calculateFieldHours, normalizeEndTime, restDayName } from '@/lib/field-overtime/calc'

const QUICK_END_TIMES = ['20:00', '21:00', '22:00', '23:00', '24:00']
const QUICK_HOLIDAY_END_TIMES = ['12:00', '15:00', '18:00', '20:00', '22:00']

interface Props {
  /** 수정이면 기존 기록, 신규면 null */
  record: FieldOvertimeRecord | null
  defaultDate: string
  /** 선택지 — 재직자. 수정 중인 기록의 직원이 퇴사자면 호출부가 함께 넣어준다 */
  employees: Employee[]
  /** 신규 입력 시 같은 직원·같은 날 기록이 이미 있는지 안내하는 데 쓴다 */
  records: FieldOvertimeRecord[]
  /** 휴가관리 holidays(법정공휴일·회사휴무) — holiday_date → 이름 */
  holidays: Map<string, string>
  onClose: () => void
  onSaved: () => void
}

/**
 * 실무자 연장근무 입력 — 직원·날짜·종료시간만 받는다. 시작(18:00)·휴게(1시간)는 규칙으로 고정이고
 * 인정시간은 입력하는 동안 바로 계산해 보여준다(lib/field-overtime/calc.ts).
 * 휴일(주말·휴가관리의 공휴일/회사휴무)은 정규 근무가 없어 시작시간도 받는다(기본 09:00).
 * 하루 1인 1건(DB UNIQUE)이라, 신규 입력인데 같은 직원·날짜 기록이 이미 있으면 그 기록을 덮어쓴다.
 */
export default function FieldEntryModal({ record, defaultDate, employees, records, holidays, onClose, onSaved }: Props) {
  const supabase = createSupabaseBrowserClient()
  const [date, setDate] = useState(record?.work_date ?? defaultDate)
  const [employeeId, setEmployeeId] = useState(record?.employee_id ?? '')
  const [startTime, setStartTime] = useState(record?.start_time ?? HOLIDAY_DEFAULT_START)
  const [endTime, setEndTime] = useState(record?.end_time ?? '')
  const [note, setNote] = useState(record?.note ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 날짜를 바꾸면 휴일 여부가 바로 다시 정해진다 — 평일로 옮기면 시작시간은 저장하지 않는다(18:00 고정)
  const restDay = date ? restDayName(date, holidays) : null
  const effectiveStart = restDay ? startTime : null
  const calc = endTime.trim() ? calculateFieldHours(endTime, effectiveStart) : null
  const duplicate = !record && employeeId
    ? records.find(r => r.employee_id === employeeId && r.work_date === date)
    : undefined

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!employeeId) { setError('직원을 선택하세요.'); return }
    if (!date) { setError('날짜를 입력하세요.'); return }
    if (!calc || !calc.ok) { setError(calc && !calc.ok ? calc.reason : '종료시간을 입력하세요.'); return }
    setSaving(true)
    setError(null)
    const row = { employee_id: employeeId, work_date: date, start_time: effectiveStart ? normalizeEndTime(effectiveStart) : null, end_time: normalizeEndTime(endTime), hours: calc.recognized, note: note.trim(), updated_at: new Date().toISOString() }
    const { error: saveError } = record
      ? await supabase.from('field_overtime_records').update(row).eq('id', record.id)
      : await supabase.from('field_overtime_records').upsert(row, { onConflict: 'employee_id,work_date' })
    setSaving(false)
    if (saveError) {
      setError(saveError.code === '23505' ? '그 직원은 해당 날짜에 이미 기록이 있습니다. 그 기록을 수정해 주세요.' : `저장 실패: ${saveError.message}`)
      return
    }
    onSaved()
    onClose()
  }

  async function handleDelete() {
    if (!record || !confirm('이 기록을 삭제하시겠습니까?')) return
    const { error: deleteError } = await supabase.from('field_overtime_records').delete().eq('id', record.id)
    if (deleteError) { setError(`삭제 실패: ${deleteError.message}`); return }
    onSaved()
    onClose()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 16 }} onClick={onClose}>
      <form onSubmit={handleSave} style={{ background: '#fff', borderRadius: 12, width: 420, maxWidth: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#111', borderRadius: '12px 12px 0 0' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>{record ? '연장근무 수정' : '연장근무 신규 입력'}</div>
          <button type="button" onClick={onClose} style={{ border: 'none', background: 'rgba(255,255,255,0.15)', color: '#fff', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 13 }}>✕</button>
        </div>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <label style={{ ...lbl, flex: 1 }}>
              날짜
              <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inp} />
            </label>
            <label style={{ ...lbl, flex: 1 }}>
              직원
              <select value={employeeId} onChange={e => setEmployeeId(e.target.value)} style={inp} autoFocus={!record}>
                <option value="">선택</option>
                {employees.map(emp => (
                  <option key={emp.id} value={emp.id}>{emp.name}{emp.position ? ` ${emp.position}` : ''}{emp.is_active ? '' : ' (퇴사)'}</option>
                ))}
              </select>
            </label>
          </div>

          {restDay && (
            <div style={{ fontSize: 12, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '8px 10px', marginBottom: -4 }}>
              휴일 근무 — {restDay}. 시작시간부터 계산합니다.
            </div>
          )}

          {restDay && (
            <label style={lbl}>
              근무 시작시간
              <input
                value={startTime}
                onChange={e => setStartTime(e.target.value)}
                onBlur={() => { if (startTime.trim()) setStartTime(normalizeEndTime(startTime)) }}
                placeholder="예: 09:00"
                inputMode="numeric"
                style={inp}
              />
            </label>
          )}

          <label style={lbl}>
            근무 종료시간
            <input
              value={endTime}
              onChange={e => setEndTime(e.target.value)}
              onBlur={() => { if (endTime.trim()) setEndTime(normalizeEndTime(endTime)) }}
              placeholder="예: 21:30 (2130도 가능, 자정 넘으면 25:00)"
              inputMode="numeric"
              style={inp}
            />
          </label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: -6 }}>
            {(restDay ? QUICK_HOLIDAY_END_TIMES : QUICK_END_TIMES).map(t => (
              <button key={t} type="button" onClick={() => setEndTime(t)} style={endTime === t ? chipActive : chip}>{t}</button>
            ))}
          </div>

          <div style={{ padding: '10px 12px', borderRadius: 8, background: calc && !calc.ok ? '#fef2f2' : '#f8f8f7', border: `1px solid ${calc && !calc.ok ? '#fecaca' : '#e8e8e6'}`, fontSize: 12, color: '#555', lineHeight: 1.6 }}>
            <div>{restDay ? '입력한 시작시간부터' : `시작 ${FIELD_START_TIME} 고정`} · 휴게 {FIELD_BREAK_HOURS}시간 차감 · 1시간 단위 절삭</div>
            {!calc ? (
              <div style={{ color: '#aaa' }}>종료시간을 입력하면 인정시간이 계산됩니다</div>
            ) : calc.ok ? (
              <div>
                {effectiveStart ? normalizeEndTime(effectiveStart) : FIELD_START_TIME} ~ {normalizeEndTime(endTime)} →
                {calc.raw !== calc.recognized && <> 계산 {calc.raw}시간 →</>}
                <b style={{ fontSize: 14, color: '#111', marginLeft: 4 }}>인정 {calc.recognized}시간</b>
              </div>
            ) : (
              <div style={{ color: '#b91c1c' }}>{calc.reason}</div>
            )}
          </div>

          <label style={lbl}>
            <span>비고 <span style={{ color: '#bbb', fontWeight: 400 }}>(선택)</span></span>
            <input value={note} onChange={e => setNote(e.target.value)} style={inp} />
          </label>

          {duplicate && (
            <div style={{ fontSize: 12, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: '8px 10px' }}>
              이 직원은 이 날짜에 이미 기록(~{duplicate.end_time})이 있습니다. 저장하면 덮어씁니다.
            </div>
          )}
          {error && <div style={{ fontSize: 12, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '8px 10px' }}>{error}</div>}
        </div>

        <div style={{ padding: '0 20px 20px', display: 'flex', gap: 8 }}>
          {record && <button type="button" onClick={handleDelete} style={deleteBtn}>삭제</button>}
          <div style={{ flex: 1 }} />
          <button type="button" onClick={onClose} style={outlineBtn}>취소</button>
          <button type="submit" disabled={saving} style={{ ...primaryBtn, opacity: saving ? 0.6 : 1 }}>{saving ? '저장 중...' : '저장'}</button>
        </div>
      </form>
    </div>
  )
}

const lbl: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 500, color: '#555' }
const inp: React.CSSProperties = { height: 36, padding: '0 10px', border: '1px solid #e8e8e6', borderRadius: 6, fontSize: 13, background: '#fff', boxSizing: 'border-box', width: '100%' }
const primaryBtn: React.CSSProperties = { height: 36, padding: '0 18px', borderRadius: 6, border: 'none', background: '#111', color: '#fff', fontSize: 13, cursor: 'pointer' }
const outlineBtn: React.CSSProperties = { height: 36, padding: '0 14px', borderRadius: 6, border: '1px solid #e8e8e6', background: '#fff', color: '#333', fontSize: 13, cursor: 'pointer' }
const deleteBtn: React.CSSProperties = { height: 36, padding: '0 14px', borderRadius: 6, border: 'none', background: '#fee2e2', color: '#b91c1c', fontSize: 13, cursor: 'pointer' }
// border 축약형 + borderColor 개별 속성을 섞으면 React가 리렌더 시 경고하므로 개별 속성으로만 정의
const chip: React.CSSProperties = { height: 26, padding: '0 10px', borderRadius: 13, borderWidth: 1, borderStyle: 'solid', borderColor: '#e8e8e6', background: '#fff', color: '#555', fontSize: 12, cursor: 'pointer' }
const chipActive: React.CSSProperties = { ...chip, background: '#111', color: '#fff', borderColor: '#111' }
