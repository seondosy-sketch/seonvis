'use client'

import { useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import {
  AnnualLeaveBalance, DAY_UNIT_LABEL, DayUnit, Holiday, LeaveEmployee, LeaveRecord, LeaveType,
} from '@/lib/leave/types'
import {
  expandLeaveDates, findOverlaps, formatDays, formatNightsDays, sumDeducted,
  totalCalendarDays, validateLeaveInput,
} from '@/lib/leave/calc'

const DAY_UNITS: DayUnit[] = ['full', 'am', 'pm']

/**
 * 휴가 추가/수정 모달.
 * 저장 시 leave_records 1행 + leave_record_dates(날짜별 전개)를 함께 만들고,
 * 수정이면 기존 dates를 전부 지우고 재생성한다(부분 수정 없음 — 04 문서).
 * 전체 기간(몇 박 며칠)과 실제 차감일수를 입력과 동시에 분리 표시한다.
 *
 * 공동 등록(신규 등록 시에만): 회사 공동 연차처럼 여러 직원에게 같은 휴가를 한 번에
 * 넣는다 — 직원 수만큼 개별 레코드를 만들 뿐, 저장 단위는 그대로다(수정/삭제는 개별).
 * 입사 전/퇴사 후/날짜 겹침인 직원은 자동으로 건너뛰고 결과를 알려준다.
 */
export default function LeaveRecordModal({
  employees,
  leaveTypes,
  holidays,
  balances,
  used,
  edit,
  onClose,
  onSaved,
}: {
  employees: LeaveEmployee[]
  leaveTypes: LeaveType[]
  holidays: Holiday[]
  balances: Map<string, AnnualLeaveBalance>
  used: Map<string, number>
  edit: LeaveRecord | null
  onClose: () => void
  onSaved: () => void
}) {
  const supabase = createSupabaseBrowserClient()
  const [bulk, setBulk] = useState(false) // 공동 등록 모드 — 신규 등록에서만
  const [bulkIds, setBulkIds] = useState<Set<string>>(
    () => new Set(employees.filter(e => e.is_active).map(e => e.id))
  )
  const [employeeId, setEmployeeId] = useState(edit?.employee_id ?? '')
  const [typeId, setTypeId] = useState(edit?.leave_type_id ?? (leaveTypes.find(t => t.name === '연차')?.id ?? ''))
  const [start, setStart] = useState(edit?.start_date ?? '')
  const [end, setEnd] = useState(edit?.end_date ?? '')
  const [startUnit, setStartUnit] = useState<DayUnit>(edit?.start_day_unit ?? 'full')
  const [endUnit, setEndUnit] = useState<DayUnit>(edit?.end_day_unit ?? 'full')
  const [memo, setMemo] = useState(edit?.memo ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const holidayMap = useMemo(() => new Map(holidays.map(h => [h.holiday_date, h.name])), [holidays])
  const selectableEmployees = employees.filter(e => e.is_active || e.id === edit?.employee_id)
  const selectableTypes = leaveTypes.filter(t => t.is_active || t.id === edit?.leave_type_id)
  const selectedType = leaveTypes.find(t => t.id === typeId)
  const sameDay = start !== '' && start === end

  // 유형 "오전/오후 반차" 선택 시 같은 날 + 해당 단위로 자동 세팅 (06 문서 결정 ⑧)
  function pickType(id: string) {
    setTypeId(id)
    const t = leaveTypes.find(lt => lt.id === id)
    if (t?.name === '오전 반차' || t?.name === '오후 반차') {
      const unit: DayUnit = t.name === '오전 반차' ? 'am' : 'pm'
      setStartUnit(unit); setEndUnit(unit)
      if (start) setEnd(start)
    }
  }

  const preview = useMemo(() => {
    if (!start || !end || end < start || !selectedType) return null
    const expanded = expandLeaveDates(start, end, startUnit, sameDay ? startUnit : endUnit, selectedType.deducts_annual_leave, holidayMap)
    const calendarDays = totalCalendarDays(start, end)
    const deducted = sumDeducted(expanded)
    const excluded = expanded.filter(d => d.is_weekend || d.is_holiday).length
    return { expanded, calendarDays, deducted, excluded }
  }, [start, end, startUnit, endUnit, sameDay, selectedType, holidayMap])

  // 공동 등록 — 대상 직원마다 개별 레코드를 만든다. 입사 전/퇴사 후/겹침은 건너뛴다.
  async function bulkSave() {
    if (saving) return
    setError(null)
    if (!typeId || !selectedType) { setError('휴가 유형을 선택하세요.') ; return }
    if (!start || !end) { setError('시작일과 종료일을 입력하세요.'); return }
    if (end < start) { setError('종료일이 시작일보다 빠릅니다.'); return }
    if (!preview) { setError('기간을 확인하세요.'); return }
    const targets = employees.filter(e => bulkIds.has(e.id))
    if (targets.length === 0) { setError('대상 직원을 선택하세요.'); return }

    setSaving(true)
    try {
      const skipped: string[] = []
      let eligible = targets.filter(emp => {
        if (emp.hire_date && start < emp.hire_date) { skipped.push(`${emp.name}(입사 전)`); return false }
        if (emp.resign_date && end > emp.resign_date) { skipped.push(`${emp.name}(퇴사 후)`); return false }
        return true
      })

      if (eligible.length > 0) {
        const { data: existing } = await supabase.from('leave_record_dates')
          .select('leave_date, day_unit, leave_records!inner(employee_id)')
          .in('leave_records.employee_id', eligible.map(e => e.id))
          .gte('leave_date', start).lte('leave_date', end)
        const byEmployee = new Map<string, { leave_date: string; day_unit: DayUnit }[]>()
        for (const row of (existing ?? []) as unknown as Array<{ leave_date: string; day_unit: DayUnit; leave_records: { employee_id: string } }>) {
          const arr = byEmployee.get(row.leave_records.employee_id) ?? []
          arr.push({ leave_date: row.leave_date, day_unit: row.day_unit })
          byEmployee.set(row.leave_records.employee_id, arr)
        }
        eligible = eligible.filter(emp => {
          const conflicts = findOverlaps(preview.expanded, byEmployee.get(emp.id) ?? [])
          if (conflicts.length > 0) { skipped.push(`${emp.name}(겹침: ${conflicts.join(', ')})`); return false }
          return true
        })
      }

      if (eligible.length === 0) {
        setError(`저장할 직원이 없습니다 — 전부 제외됨: ${skipped.join(' / ')}`)
        return
      }

      // 잔여 초과 직원은 한 번에 모아 경고 (경고 후 허용 — 06 문서 ④)
      if (selectedType.deducts_annual_leave) {
        const over = eligible.filter(emp => {
          const bal = balances.get(emp.id)
          if (!bal) return false
          const remaining = Math.round((bal.granted_days + bal.adjustment_days - (used.get(emp.id) ?? 0)) * 2) / 2
          return preview.deducted > remaining
        })
        if (over.length > 0 && !confirm(`잔여 연차를 초과하는 직원이 있습니다: ${over.map(e => e.name).join(', ')}. 그래도 저장하시겠습니까?`)) return
      }

      const basePayload = {
        leave_type_id: typeId,
        start_date: start,
        end_date: end,
        start_day_unit: startUnit,
        end_day_unit: sameDay ? startUnit : endUnit,
        total_calendar_days: preview.calendarDays,
        deducted_days: preview.deducted,
        memo,
      }
      const { data: inserted, error: insErr } = await supabase.from('leave_records')
        .insert(eligible.map(emp => ({ ...basePayload, employee_id: emp.id })))
        .select('id')
      if (insErr || !inserted) { setError(`저장 실패: ${insErr?.message ?? ''}`); return }

      const { error: datesErr } = await supabase.from('leave_record_dates')
        .insert(inserted.flatMap(rec => preview.expanded.map(d => ({ ...d, leave_record_id: rec.id }))))
      if (datesErr) { setError(`날짜 저장 실패: ${datesErr.message}`); return }

      if (skipped.length > 0) alert(`${eligible.length}명 저장 완료. 제외된 직원: ${skipped.join(' / ')}`)
      onSaved()
    } finally { setSaving(false) }
  }

  async function save() {
    if (saving) return
    setError(null)
    const emp = employees.find(e => e.id === employeeId)
    const bal = balances.get(employeeId)
    // 수정 시 잔여는 이 휴가의 기존 차감을 되돌린 값 기준으로 비교한다
    const usedNow = (used.get(employeeId) ?? 0) - (edit && edit.employee_id === employeeId ? edit.deducted_days : 0)
    const remaining = bal ? Math.round((bal.granted_days + bal.adjustment_days - usedNow) * 2) / 2 : null

    const issues = validateLeaveInput({
      employeeId, leaveTypeId: typeId, start, end,
      hireDate: emp?.hire_date ?? null, resignDate: emp?.resign_date ?? null,
      deductedDays: preview?.deducted ?? 0,
      remainingDays: remaining,
      deductsAnnualLeave: selectedType?.deducts_annual_leave ?? false,
    })
    const blocks = issues.filter(i => i.level === 'block')
    if (blocks.length > 0) { setError(blocks[0].message); return }
    if (!preview) { setError('기간을 확인하세요.'); return }

    setSaving(true)
    try {
      // 중복 검증 — 같은 직원의 기존 날짜 점유와 비교 (수정 중인 자기 기록 제외)
      let overlapQuery = supabase.from('leave_record_dates')
        .select('leave_date, day_unit, leave_records!inner(employee_id)')
        .eq('leave_records.employee_id', employeeId)
        .gte('leave_date', start).lte('leave_date', end)
      if (edit) overlapQuery = overlapQuery.neq('leave_record_id', edit.id)
      const { data: existing } = await overlapQuery
      const conflicts = findOverlaps(preview.expanded, (existing ?? []) as { leave_date: string; day_unit: DayUnit }[])
      if (conflicts.length > 0) {
        setError(`기존 휴가와 날짜가 겹칩니다: ${conflicts.join(', ')}`)
        return
      }

      const warns = issues.filter(i => i.level === 'warn')
      for (const w of warns) {
        if (!confirm(w.message)) return
      }

      const payload = {
        employee_id: employeeId,
        leave_type_id: typeId,
        start_date: start,
        end_date: end,
        start_day_unit: startUnit,
        end_day_unit: sameDay ? startUnit : endUnit,
        total_calendar_days: preview.calendarDays,
        deducted_days: preview.deducted,
        memo,
      }

      let recordId = edit?.id
      if (edit) {
        const { error: upErr } = await supabase.from('leave_records')
          .update({ ...payload, updated_at: new Date().toISOString() }).eq('id', edit.id)
        if (upErr) { setError(`저장 실패: ${upErr.message}`); return }
        const { error: delErr } = await supabase.from('leave_record_dates').delete().eq('leave_record_id', edit.id)
        if (delErr) { setError(`날짜 재생성 실패: ${delErr.message}`); return }
      } else {
        const { data: inserted, error: insErr } = await supabase.from('leave_records')
          .insert(payload).select('id').single()
        if (insErr || !inserted) { setError(`저장 실패: ${insErr?.message ?? ''}`); return }
        recordId = inserted.id
      }

      const { error: datesErr } = await supabase.from('leave_record_dates')
        .insert(preview.expanded.map(d => ({ ...d, leave_record_id: recordId })))
      if (datesErr) { setError(`날짜 저장 실패: ${datesErr.message}`); return }

      onSaved()
    } finally { setSaving(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 12, width: 520, maxWidth: 'calc(100vw - 40px)', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #e8e8e6', background: '#111', borderRadius: '12px 12px 0 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>{edit ? '휴가 수정' : '휴가 추가'}</div>
          <button onClick={onClose} style={{ border: 'none', background: 'rgba(255,255,255,0.15)', color: '#fff', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 13 }}>✕</button>
        </div>

        <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {!edit && (
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={() => setBulk(false)} style={bulk ? modeBtn : modeBtnActive}>개별 등록</button>
              <button onClick={() => setBulk(true)} style={bulk ? modeBtnActive : modeBtn}>공동 등록</button>
              {bulk && <span style={{ fontSize: 11, color: '#888', alignSelf: 'center', marginLeft: 6 }}>회사 공동 연차 등 — 선택한 직원 모두에게 같은 휴가를 등록합니다</span>}
            </div>
          )}

          {bulk && !edit ? (
            <Field label={`대상 직원 (${bulkIds.size}명)`}>
              <div style={{ border: '1px solid #e8e8e6', borderRadius: 6, padding: '8px 10px', background: '#fafafa' }}>
                <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                  <button onClick={() => setBulkIds(new Set(employees.filter(e => e.is_active).map(e => e.id)))} style={miniBtn}>전체 선택</button>
                  <button onClick={() => setBulkIds(new Set())} style={miniBtn}>전체 해제</button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px 14px' }}>
                  {employees.filter(e => e.is_active).map(e => (
                    <label key={e.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#333', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={bulkIds.has(e.id)}
                        onChange={ev => setBulkIds(prev => {
                          const next = new Set(prev)
                          if (ev.target.checked) next.add(e.id); else next.delete(e.id)
                          return next
                        })}
                      />
                      {e.name}{e.position ? ` ${e.position}` : ''}
                    </label>
                  ))}
                </div>
              </div>
            </Field>
          ) : null}

          <Row2>
            {(!bulk || edit) && (
              <Field label="직원 *">
                <select style={inp} value={employeeId} onChange={e => setEmployeeId(e.target.value)}>
                  <option value="">선택...</option>
                  {selectableEmployees.map(e => <option key={e.id} value={e.id}>{e.name}{e.position ? ` ${e.position}` : ''}{e.is_active ? '' : ' (퇴사)'}</option>)}
                </select>
              </Field>
            )}
            <Field label="휴가 유형 *">
              <select style={inp} value={typeId} onChange={e => pickType(e.target.value)}>
                <option value="">선택...</option>
                {selectableTypes.map(t => (
                  <option key={t.id} value={t.id}>{t.name}{t.deducts_annual_leave ? '' : ' (차감 없음)'}</option>
                ))}
              </select>
            </Field>
          </Row2>
          <Row2>
            <Field label="시작일 *"><input style={inp} type="date" value={start} onChange={e => { setStart(e.target.value); if (!end || end < e.target.value) setEnd(e.target.value) }} /></Field>
            <Field label="종료일 *"><input style={inp} type="date" value={end} min={start || undefined} onChange={e => setEnd(e.target.value)} /></Field>
          </Row2>
          {sameDay ? (
            <Field label="사용 단위">
              <div style={{ display: 'flex', gap: 4 }}>
                {DAY_UNITS.map(u => (
                  <button key={u} onClick={() => { setStartUnit(u); setEndUnit(u) }} style={startUnit === u ? unitBtnActive : unitBtn}>{DAY_UNIT_LABEL[u]}</button>
                ))}
              </div>
            </Field>
          ) : (
            <Row2>
              <Field label="시작일 단위">
                <div style={{ display: 'flex', gap: 4 }}>
                  {DAY_UNITS.map(u => (
                    <button key={u} onClick={() => setStartUnit(u)} style={startUnit === u ? unitBtnActive : unitBtn}>{DAY_UNIT_LABEL[u]}</button>
                  ))}
                </div>
              </Field>
              <Field label="종료일 단위">
                <div style={{ display: 'flex', gap: 4 }}>
                  {DAY_UNITS.map(u => (
                    <button key={u} onClick={() => setEndUnit(u)} style={endUnit === u ? unitBtnActive : unitBtn}>{DAY_UNIT_LABEL[u]}</button>
                  ))}
                </div>
              </Field>
            </Row2>
          )}

          {preview && (
            <div style={{ padding: '10px 12px', background: '#f8f8f7', border: '1px solid #e8e8e6', borderRadius: 6, fontSize: 12, color: '#333', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <span>전체 <b>{formatNightsDays(preview.calendarDays)}</b></span>
              <span>실제 차감 <b style={{ color: '#b45309' }}>{formatDays(preview.deducted)}일</b></span>
              {preview.excluded > 0 && <span style={{ color: '#888' }}>(주말·공휴일 {preview.excluded}일 제외)</span>}
              {selectedType && !selectedType.deducts_annual_leave && <span style={{ color: '#888' }}>연차 미차감 유형</span>}
            </div>
          )}

          <Field label="메모"><input style={inp} value={memo} onChange={e => setMemo(e.target.value)} placeholder="사유, 특이사항 등" /></Field>

          {error && <div style={{ padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, color: '#b91c1c' }}>{error}</div>}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <button onClick={onClose} style={outlineBtn}>취소</button>
            <button onClick={bulk && !edit ? bulkSave : save} disabled={saving} style={{ ...primaryBtn, opacity: saving ? 0.6 : 1 }}>
              {saving ? '저장 중...' : bulk && !edit ? `${bulkIds.size}명에게 저장` : '저장'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div style={{ flex: 1 }}><div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>{label}</div>{children}</div>
}
function Row2({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>{children}</div>
}

const inp: React.CSSProperties = { width: '100%', height: 34, padding: '0 10px', border: '1px solid #e8e8e6', borderRadius: 6, fontSize: 13, background: '#fff', boxSizing: 'border-box' }
const primaryBtn: React.CSSProperties = { height: 34, padding: '0 16px', borderRadius: 6, border: 'none', background: '#111', color: '#fff', fontSize: 13, cursor: 'pointer' }
const outlineBtn: React.CSSProperties = { height: 34, padding: '0 14px', borderRadius: 6, border: '1px solid #e8e8e6', background: '#fff', color: '#333', fontSize: 13, cursor: 'pointer' }
const unitBtn: React.CSSProperties = { height: 30, padding: '0 10px', borderRadius: 6, border: '1px solid #e8e8e6', background: '#fff', color: '#555', fontSize: 12, cursor: 'pointer' }
const unitBtnActive: React.CSSProperties = { ...unitBtn, background: '#111', color: '#fff', border: '1px solid #111' }
const modeBtn: React.CSSProperties = { height: 28, padding: '0 12px', borderRadius: 6, border: '1px solid #e8e8e6', background: '#fff', color: '#555', fontSize: 12, cursor: 'pointer' }
const modeBtnActive: React.CSSProperties = { ...modeBtn, background: '#2563eb', color: '#fff', border: '1px solid #2563eb' }
const miniBtn: React.CSSProperties = { height: 24, padding: '0 8px', borderRadius: 4, border: '1px solid #e8e8e6', background: '#fff', color: '#555', fontSize: 11, cursor: 'pointer' }
