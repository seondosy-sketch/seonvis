'use client'

import { useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { GuestCandidate, LodgingHotel, LodgingRecord, WorkDateType } from '@/lib/lodging/types'
import { searchGuestDirectory } from '@/lib/lodging/guestDirectory'
import { findOverlappingStays } from '@/lib/lodging/duplicateCheck'
import { formatStayPeriod, nightsBetween, previewTotalPrice } from '@/lib/lodging/period'
import { lodgingRecordErrorMessage } from '@/lib/lodging/errors'
import { formatWon } from '@/lib/export/format'
import { LodgingProjectRef } from '../types'

const PURPOSE_OPTIONS = ['면접 준비', '기술제안서 작성', '현장조사', '교육', '출장', '회의', '워크샵', '기타']
const ROOM_TYPE_OPTIONS = ['Standard', 'Deluxe', 'Twin', 'Double', 'Suite', '기타']
const WORK_DATE_TYPE_OPTIONS: Array<{ value: WorkDateType; label: string }> = [
  { value: 'interview', label: '면접일시' },
  { value: 'proposal_submission', label: '제안서작성일' },
  { value: 'other', label: '기타' },
]

interface LodgingFormModalProps {
  record: LodgingRecord | null  // null = 신규 등록
  existingRecords: LodgingRecord[]
  guestCandidates: GuestCandidate[]
  projects: LodgingProjectRef[]
  hotels: LodgingHotel[]
  currentUserEmail: string
  onClose: () => void
  onSaved: (record: LodgingRecord) => void
  onToast: (msg: string) => void
}

interface SelectedGuest {
  source: GuestCandidate['source']
  id: string
  name: string
}

export default function LodgingFormModal({
  record, existingRecords, guestCandidates, projects, hotels, currentUserEmail, onClose, onSaved, onToast,
}: LodgingFormModalProps) {
  const supabase = createSupabaseBrowserClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [guestQuery, setGuestQuery] = useState(record?.guest_name_snapshot ?? '')
  const [selectedGuest, setSelectedGuest] = useState<SelectedGuest | null>(
    record ? { source: record.guest_source, id: (record.engineer_contact_id ?? record.overtime_employee_id) as string, name: record.guest_name_snapshot } : null,
  )
  const [guestDropdownOpen, setGuestDropdownOpen] = useState(false)

  const [projectQuery, setProjectQuery] = useState(record?.project_name_snapshot ?? '')
  const [selectedProject, setSelectedProject] = useState<LodgingProjectRef | null>(
    record?.project_id ? { id: record.project_id, name: record.project_name_snapshot } : null,
  )
  const [projectDropdownOpen, setProjectDropdownOpen] = useState(false)

  const [purpose, setPurpose] = useState(record?.purpose ?? '')

  const [hotelQuery, setHotelQuery] = useState(record?.hotel_name_snapshot ?? '')
  const [selectedHotelId, setSelectedHotelId] = useState<string | null>(record?.hotel_id ?? null)
  const [hotelDropdownOpen, setHotelDropdownOpen] = useState(false)

  const [roomType, setRoomType] = useState(record?.room_type ?? '')
  const [checkIn, setCheckIn] = useState(record?.check_in ?? '')
  const [checkOut, setCheckOut] = useState(record?.check_out ?? '')
  const [roomCount, setRoomCount] = useState(String(record?.room_count ?? 1))
  const [actualGuestCount, setActualGuestCount] = useState(String(record?.actual_guest_count ?? 1))
  const [companionNames, setCompanionNames] = useState(record?.companion_names ?? '')
  const [workDate, setWorkDate] = useState(record?.work_date ?? '')
  const [workDateType, setWorkDateType] = useState<WorkDateType>(record?.work_date_type ?? 'other')
  const [pricePerNight, setPricePerNight] = useState(String(record?.price_per_night ?? 0))
  const [memo, setMemo] = useState(record?.memo ?? '')

  const guestMatches = useMemo(() => searchGuestDirectory(guestCandidates, guestQuery), [guestCandidates, guestQuery])
  const projectMatches = useMemo(() => {
    const q = projectQuery.trim()
    if (!q) return []
    return projects.filter(p => p.name.includes(q)).slice(0, 20)
  }, [projects, projectQuery])
  const hotelMatches = useMemo(() => {
    const q = hotelQuery.trim()
    if (!q) return []
    return hotels.filter(h => h.name.includes(q)).slice(0, 20)
  }, [hotels, hotelQuery])

  const nights = nightsBetween(checkIn, checkOut)
  const previewTotal = previewTotalPrice(Number(pricePerNight) || 0, nights, Number(roomCount) || 0)

  const duplicateWarnings = useMemo(() => {
    if (!selectedGuest || !checkIn || !checkOut) return []
    return findOverlappingStays(
      existingRecords,
      {
        guest_source: selectedGuest.source,
        engineer_contact_id: selectedGuest.source === 'engineer_contact' ? selectedGuest.id : null,
        overtime_employee_id: selectedGuest.source === 'overtime_employee' ? selectedGuest.id : null,
      },
      checkIn,
      checkOut,
      record?.id,
    )
  }, [existingRecords, selectedGuest, checkIn, checkOut, record?.id])

  function pickHotel(hotel: LodgingHotel) {
    setSelectedHotelId(hotel.id)
    setHotelQuery(hotel.name)
    setHotelDropdownOpen(false)
    if (!pricePerNight || pricePerNight === '0') setPricePerNight(String(hotel.default_price_per_night))
  }

  async function handleSave() {
    if (busy) return
    if (!selectedGuest) { setError('대표 이용자를 선택하세요.'); return }
    if (!checkIn || !checkOut) { setError('체크인/체크아웃 날짜를 입력하세요.'); return }
    if (checkOut <= checkIn) { setError('체크아웃일은 체크인일보다 이후여야 합니다.'); return }
    if (Number(roomCount) <= 0) { setError('객실수는 1 이상이어야 합니다.'); return }
    if (Number(actualGuestCount) <= 0) { setError('실제 숙박인원은 1 이상이어야 합니다.'); return }
    if (workDate && !workDateType) { setError('업무일자 유형을 선택하세요.'); return }

    setBusy(true)
    setError(null)

    const payload = {
      guest_source: selectedGuest.source,
      engineer_contact_id: selectedGuest.source === 'engineer_contact' ? selectedGuest.id : null,
      overtime_employee_id: selectedGuest.source === 'overtime_employee' ? selectedGuest.id : null,
      guest_name_snapshot: selectedGuest.name,
      actual_guest_count: Number(actualGuestCount),
      companion_names: companionNames.trim(),
      project_id: selectedProject?.id ?? null,
      project_name_snapshot: selectedProject?.name ?? '',
      purpose: purpose.trim(),
      work_date: workDate || null,
      work_date_type: workDate ? workDateType : null,
      hotel_id: selectedHotelId,
      hotel_name_snapshot: hotelQuery.trim(),
      room_type: roomType.trim(),
      check_in: checkIn,
      check_out: checkOut,
      room_count: Number(roomCount),
      price_per_night: Number(pricePerNight) || 0,
      memo: memo.trim(),
      updated_by: currentUserEmail,
    }

    const result = record
      ? await supabase.from('lodging_records').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', record.id).select().single()
      : await supabase.from('lodging_records').insert({ ...payload, created_by: currentUserEmail }).select().single()

    setBusy(false)
    if (result.error) {
      setError(lodgingRecordErrorMessage(record ? 'update' : 'insert', result.error.code))
      return
    }
    onSaved(result.data as LodgingRecord)
    onToast(record ? '숙박 정보를 수정했습니다.' : '숙박을 등록했습니다.')
    onClose()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }} onClick={busy ? undefined : onClose}>
      <div style={{ background: '#fff', borderRadius: 10, width: 640, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{record ? '숙박 정보 수정' : '숙박 등록'}</span>
          <button onClick={onClose} disabled={busy} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 14, color: '#888' }}>✕</button>
        </div>

        <div style={{ padding: 18, overflowY: 'auto' }}>
          {error && <div style={{ marginBottom: 10, padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, color: '#b91c1c' }}>{error}</div>}

          {duplicateWarnings.length > 0 && (
            <div style={{ marginBottom: 10, padding: '8px 12px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, fontSize: 12, color: '#92400e' }}>
              동일 대표 이용자의 겹치는 숙박이 있습니다(저장은 계속 가능합니다):
              {duplicateWarnings.map(w => (
                <div key={w.record.id} style={{ marginTop: 4 }}>
                  · {w.hotel_name_snapshot} / {w.check_in} ~ {w.check_out} / {w.project_name_snapshot || '(비프로젝트)'}
                </div>
              ))}
            </div>
          )}

          <Field label="대표 이용자">
            <div style={{ position: 'relative' }}>
              <input
                value={guestQuery}
                onChange={e => { setGuestQuery(e.target.value); setSelectedGuest(null); setGuestDropdownOpen(true) }}
                onFocus={() => setGuestDropdownOpen(true)}
                placeholder="이름 검색 (기술인/직원 통합)"
                style={inp}
              />
              {guestDropdownOpen && guestMatches.length > 0 && (
                <div style={dropdown}>
                  {guestMatches.map(c => (
                    <div key={`${c.source}:${c.id}`} style={dropdownItem} onClick={() => {
                      setSelectedGuest({ source: c.source, id: c.id, name: c.name })
                      setGuestQuery(c.name)
                      setGuestDropdownOpen(false)
                    }}>
                      <span>{c.name}</span>
                      <span style={{ color: '#999', fontSize: 11, marginLeft: 8 }}>{c.subLabel}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Field>

          <Field label="프로젝트 (선택)">
            <div style={{ position: 'relative' }}>
              <input
                value={projectQuery}
                onChange={e => { setProjectQuery(e.target.value); setSelectedProject(null); setProjectDropdownOpen(true) }}
                onFocus={() => setProjectDropdownOpen(true)}
                placeholder="프로젝트명 검색 (비워두면 비프로젝트 숙박)"
                style={inp}
              />
              {projectDropdownOpen && projectMatches.length > 0 && (
                <div style={dropdown}>
                  {projectMatches.map(p => (
                    <div key={p.id} style={dropdownItem} onClick={() => { setSelectedProject(p); setProjectQuery(p.name); setProjectDropdownOpen(false) }}>
                      {p.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Field>

          <Field label="업무">
            <input value={purpose} onChange={e => setPurpose(e.target.value)} list="lodging-purpose-options" placeholder="업무 목적" style={inp} />
            <datalist id="lodging-purpose-options">{PURPOSE_OPTIONS.map(p => <option key={p} value={p} />)}</datalist>
          </Field>

          <Field label="숙소">
            <div style={{ position: 'relative' }}>
              <input
                value={hotelQuery}
                onChange={e => { setHotelQuery(e.target.value); setSelectedHotelId(null); setHotelDropdownOpen(true) }}
                onFocus={() => setHotelDropdownOpen(true)}
                placeholder="숙소 이름 (직접 입력 가능)"
                style={inp}
              />
              {hotelDropdownOpen && hotelMatches.length > 0 && (
                <div style={dropdown}>
                  {hotelMatches.map(h => (
                    <div key={h.id} style={dropdownItem} onClick={() => pickHotel(h)}>
                      <span>{h.name}</span>
                      <span style={{ color: '#999', fontSize: 11, marginLeft: 8 }}>{formatWon(h.default_price_per_night)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Field>

          <Field label="룸타입">
            <input value={roomType} onChange={e => setRoomType(e.target.value)} list="lodging-room-type-options" style={inp} />
            <datalist id="lodging-room-type-options">{ROOM_TYPE_OPTIONS.map(r => <option key={r} value={r} />)}</datalist>
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="체크인"><input type="date" value={checkIn} onChange={e => setCheckIn(e.target.value)} style={inp} /></Field>
            <Field label="체크아웃"><input type="date" value={checkOut} onChange={e => setCheckOut(e.target.value)} style={inp} /></Field>
          </div>
          {nights > 0 && <div style={{ fontSize: 12, color: '#666', margin: '4px 0 10px' }}>숙박기간: {formatStayPeriod(checkIn, checkOut)}</div>}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="객실수"><input type="number" min={1} value={roomCount} onChange={e => setRoomCount(e.target.value)} style={inp} /></Field>
            <Field label="실제 숙박인원"><input type="number" min={1} value={actualGuestCount} onChange={e => setActualGuestCount(e.target.value)} style={inp} /></Field>
          </div>

          <Field label="동반자 (선택)">
            <input value={companionNames} onChange={e => setCompanionNames(e.target.value)} placeholder="동반자 이름 (자유 입력)" style={inp} />
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="면접일시·제안서작성일 (선택)"><input type="date" value={workDate} onChange={e => setWorkDate(e.target.value)} style={inp} /></Field>
            <Field label="유형">
              <select value={workDateType} onChange={e => setWorkDateType(e.target.value as WorkDateType)} disabled={!workDate} style={inp}>
                {WORK_DATE_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
          </div>

          <Field label="1박 단가">
            <input type="number" min={0} value={pricePerNight} onChange={e => setPricePerNight(e.target.value)} style={inp} />
          </Field>

          <div style={{ margin: '4px 0 12px', fontSize: 13 }}>
            총금액(예상): <strong>{formatWon(previewTotal)}</strong>
            <span style={{ color: '#999', fontSize: 11, marginLeft: 6 }}>(저장 시 서버가 다시 확정합니다)</span>
          </div>

          <Field label="비고">
            <textarea value={memo} onChange={e => setMemo(e.target.value)} rows={2} style={{ ...inp, height: 'auto', resize: 'vertical' }} />
          </Field>
        </div>

        <div style={{ padding: '12px 18px', borderTop: '1px solid #eee', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} disabled={busy} style={miniBtn}>취소</button>
          <button onClick={handleSave} disabled={busy} style={primaryBtn}>{busy ? '저장 중...' : '저장'}</button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  )
}

const inp: React.CSSProperties = { width: '100%', height: 34, padding: '0 10px', border: '1px solid #e8e8e6', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }
const dropdown: React.CSSProperties = { position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #e8e8e6', borderRadius: 6, marginTop: 2, maxHeight: 180, overflowY: 'auto', zIndex: 10, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }
const dropdownItem: React.CSSProperties = { padding: '6px 10px', fontSize: 12, cursor: 'pointer' }
const primaryBtn: React.CSSProperties = { border: 'none', background: '#111', color: '#fff', borderRadius: 6, padding: '8px 16px', fontSize: 12, cursor: 'pointer' }
const miniBtn: React.CSSProperties = { border: '1px solid #e8e8e6', background: '#fff', borderRadius: 6, padding: '8px 14px', fontSize: 12, cursor: 'pointer' }
