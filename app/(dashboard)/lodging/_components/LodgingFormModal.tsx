'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { GuestCandidate, LodgingHotel, LodgingRecord, WorkDateType } from '@/lib/lodging/types'
import { searchGuestDirectory } from '@/lib/lodging/guestDirectory'
import { findOverlappingStays } from '@/lib/lodging/duplicateCheck'
import { formatStayPeriod, nightsBetween, previewTotalPrice } from '@/lib/lodging/period'
import { lodgingRecordErrorMessage } from '@/lib/lodging/errors'
import { formatWon } from '@/lib/export/format'
import { buildProjectOptions, projectFilterPeriod } from '@/lib/lodging/projectOptions'
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
  /** 체크인·체크아웃을 아직 안 넣었을 때 프로젝트 목록을 거를 기간(보고 있는 달). */
  fallbackPeriod: { start: string; end: string }
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
  record, existingRecords, guestCandidates, projects, hotels, fallbackPeriod, currentUserEmail, onClose, onSaved, onToast,
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
  const [selectedProject, setSelectedProject] = useState<{ id: string; name: string } | null>(
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
  // 프로젝트 목록은 기술인 출근부와 같은 일정 기준으로 거른다 — 검색어를 비워두면 이 숙박 기간에
  // 해당하는 프로젝트만, 검색하면 기간 밖 프로젝트까지 찾아준다(lib/lodging/projectOptions.ts).
  const projectPeriod = useMemo(
    () => projectFilterPeriod(checkIn, checkOut, fallbackPeriod),
    [checkIn, checkOut, fallbackPeriod],
  )
  const projectMatches = useMemo(
    () => buildProjectOptions({
      projects,
      periodStart: projectPeriod.start,
      periodEnd: projectPeriod.end,
      query: projectQuery === selectedProject?.name ? '' : projectQuery,
    }),
    [projects, projectPeriod, projectQuery, selectedProject],
  )
  // 숙소는 등록된 목록이 많지 않아 열면 전부 보여주고, 입력하면 좁힌다. 이미 고른 숙소의 이름이
  // 그대로 들어 있을 때(다시 펼친 경우)도 그 한 건만 남기지 않고 전체를 보여준다.
  const selectedHotelName = useMemo(
    () => hotels.find(h => h.id === selectedHotelId)?.name ?? null,
    [hotels, selectedHotelId],
  )
  const hotelMatches = useMemo(() => {
    const q = hotelQuery.trim()
    const showAll = !q || q === selectedHotelName
    const list = showAll ? hotels : hotels.filter(h => h.name.includes(q))
    return list.slice(0, 30)
  }, [hotels, hotelQuery, selectedHotelName])

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

  const closeProjectDropdown = useCallback(() => setProjectDropdownOpen(false), [])
  const closeHotelDropdown = useCallback(() => setHotelDropdownOpen(false), [])
  const projectBoxRef = useCloseOnOutsideClick(projectDropdownOpen, closeProjectDropdown)
  const hotelBoxRef = useCloseOnOutsideClick(hotelDropdownOpen, closeHotelDropdown)

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
            <div ref={projectBoxRef} style={{ position: 'relative' }}>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  value={projectQuery}
                  onChange={e => { setProjectQuery(e.target.value); setSelectedProject(null); setProjectDropdownOpen(true) }}
                  onFocus={() => setProjectDropdownOpen(true)}
                  placeholder="목록에서 선택하거나 검색 (비워두면 비프로젝트 숙박)"
                  style={inp}
                />
                <button
                  type="button"
                  onClick={() => setProjectDropdownOpen(v => !v)}
                  style={caretBtn}
                  title="프로젝트 목록 열기"
                >{projectDropdownOpen ? '▲' : '▼'}</button>
                {selectedProject && (
                  <button
                    type="button"
                    onClick={() => { setSelectedProject(null); setProjectQuery(''); setProjectDropdownOpen(false) }}
                    style={caretBtn}
                    title="선택 해제 (비프로젝트 숙박)"
                  >✕</button>
                )}
              </div>
              {projectDropdownOpen && (
                <div style={dropdown}>
                  {projectMatches.length === 0 ? (
                    <div style={{ ...dropdownItem, color: '#999', cursor: 'default' }}>
                      이 기간에 해당하는 프로젝트가 없습니다 — 이름이나 공사번호로 검색해 보세요.
                    </div>
                  ) : (
                    projectMatches.map(({ project, inPeriod }) => (
                      <div
                        key={project.id}
                        style={dropdownItem}
                        onClick={() => {
                          setSelectedProject({ id: project.id, name: project.name })
                          setProjectQuery(project.name)
                          setProjectDropdownOpen(false)
                        }}
                      >
                        <span style={{ color: '#bbb', marginRight: 6 }}>{project.project_number}</span>
                        <span>{project.name}</span>
                        {!inPeriod && <span style={{ color: '#c2410c', fontSize: 11, marginLeft: 6 }}>일정 밖</span>}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
            <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>
              공고일~발표일이 숙박 기간과 겹치는 프로젝트만 기본 표시합니다(기술인 출근부와 같은 기준).
            </div>
          </Field>

          <Field label="업무">
            <input value={purpose} onChange={e => setPurpose(e.target.value)} list="lodging-purpose-options" placeholder="업무 목적" style={inp} />
            <datalist id="lodging-purpose-options">{PURPOSE_OPTIONS.map(p => <option key={p} value={p} />)}</datalist>
          </Field>

          <Field label="숙소">
            <div ref={hotelBoxRef} style={{ position: 'relative' }}>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  value={hotelQuery}
                  onChange={e => { setHotelQuery(e.target.value); setSelectedHotelId(null); setHotelDropdownOpen(true) }}
                  onFocus={() => setHotelDropdownOpen(true)}
                  placeholder="목록에서 선택하거나 직접 입력"
                  style={inp}
                />
                <button
                  type="button"
                  onClick={() => setHotelDropdownOpen(v => !v)}
                  style={caretBtn}
                  title="숙소 목록 열기"
                >{hotelDropdownOpen ? '▲' : '▼'}</button>
              </div>
              {hotelDropdownOpen && (
                <div style={dropdown}>
                  {hotelMatches.length === 0 ? (
                    <div style={{ ...dropdownItem, color: '#999', cursor: 'default' }}>
                      {hotels.length === 0
                        ? '등록된 숙소가 없습니다 — "숙소 관리"에서 추가하거나 그냥 직접 입력하세요.'
                        : '일치하는 숙소가 없습니다 — 직접 입력한 이름 그대로 저장됩니다.'}
                    </div>
                  ) : (
                    hotelMatches.map(h => (
                      <div key={h.id} style={dropdownItem} onClick={() => pickHotel(h)}>
                        <span>{h.name}</span>
                        <span style={{ color: '#999', fontSize: 11, marginLeft: 8 }}>{formatWon(h.default_price_per_night)}</span>
                      </div>
                    ))
                  )}
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

/**
 * 목록을 펼친 상태에서 바깥을 누르면 닫는다. 프로젝트·숙소 드롭다운은 검색어가 없어도 전체 목록을
 * 펼치므로, 고르지 않고 다른 칸으로 넘어갔을 때 아래 입력칸을 계속 가리지 않게 해야 한다.
 */
function useCloseOnOutsideClick(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open, close])
  return ref
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
const caretBtn: React.CSSProperties = { flexShrink: 0, width: 34, height: 34, border: '1px solid #e8e8e6', background: '#fff', borderRadius: 6, fontSize: 11, cursor: 'pointer', color: '#666' }
const primaryBtn: React.CSSProperties = { border: 'none', background: '#111', color: '#fff', borderRadius: 6, padding: '8px 16px', fontSize: 12, cursor: 'pointer' }
const miniBtn: React.CSSProperties = { border: '1px solid #e8e8e6', background: '#fff', borderRadius: 6, padding: '8px 14px', fontSize: 12, cursor: 'pointer' }
