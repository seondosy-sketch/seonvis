'use client'

import { useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import type { ProjectParticipant } from '@/lib/attendance/types'
import { directorReplaceErrorMessage } from '@/lib/attendance/directorReplace'
import type { EngineerContact, EngineerSpecialty } from '@/lib/engineers/types'
import type { AttendanceProjectRow } from '../types'

/** 오늘 날짜(KST) — app/api/chat/route.ts와 동일한 방식(Asia/Seoul 고정, UTC 자정 부근 하루밀림 방지). */
function todayKST(): string {
  return new Date()
    .toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' })
    .replace(/\. /g, '-')
    .replace('.', '')
}

interface Candidate {
  label: string
  name: string
  role: string
  specialtyName: string | null
  isDirector: boolean
}

/**
 * 프로젝트별 참여기술인 관리 — Project List의 기존 텍스트(director/staff_*)를 "연결 후보"로만
 * 보여주고, engineer_contacts 검색·선택 후 사용자가 확인해야만 project_participants를 저장한다.
 * 실명 기반 자동 매핑은 절대 하지 않는다(동명이인 확정 금지, 사용자 확인 후에만 저장 — Phase 2 원칙).
 *
 * 단장 추가/교체는 DB 함수 `attendance_replace_director`(supabase/migration_attendance_director_rpc.sql)
 * 하나로 원자적으로 처리한다 — "기존 단장 종료(UPDATE) + 신규 단장 추가(INSERT)"를 클라이언트에서
 * 별도 요청 두 번으로 나누면 두 번째가 실패했을 때 활성 단장이 아무도 없는 부분완료 상태가 생길 수
 * 있어서다(사용자 검토 지시 반영). 일반(단장 아닌) 참여기술인은 기존처럼 단순 insert만 한다 —
 * 원자성이 필요한 경우가 아니기 때문. 기존 참여 행은 삭제하지 않고 status='종료'로 바꿔 보존한다.
 */
export default function ParticipantManagerModal({
  project,
  participants,
  engineers,
  specialties,
  onClose,
  onChange,
  onToast,
}: {
  project: AttendanceProjectRow
  participants: ProjectParticipant[]
  engineers: EngineerContact[]
  specialties: EngineerSpecialty[]
  onClose: () => void
  onChange: () => void
  onToast: (msg: string) => void
}) {
  const supabase = createSupabaseBrowserClient()
  const engineerById = useMemo(() => new Map(engineers.map(e => [e.id, e])), [engineers])

  const activeParticipants = participants.filter(p => p.status === '진행중')
  const endedParticipants = participants.filter(p => p.status === '종료')

  const [searchInput, setSearchInput] = useState('')
  const [selectedEngineerId, setSelectedEngineerId] = useState<string | null>(null)
  const [role, setRole] = useState('')
  const [specialtyId, setSpecialtyId] = useState('')
  const [isDirector, setIsDirector] = useState(false)
  const [participationStart, setParticipationStart] = useState(project.announce_date ?? '')
  const [participationEnd, setParticipationEnd] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [endingId, setEndingId] = useState<string | null>(null)

  const candidates = useMemo(() => {
    const list: Candidate[] = []
    if (project.director.trim()) {
      list.push({ label: `단장 후보: ${project.director}`, name: project.director.trim(), role: '단장', specialtyName: null, isDirector: true })
    }
    const staffFields: Array<[string, string]> = [
      [project.staff_arch, '건축'], [project.staff_civil, '토목'], [project.staff_mech, '기계'], [project.staff_safety, '안전'],
    ]
    for (const [value, specialtyName] of staffFields) {
      if (value.trim()) list.push({ label: `${specialtyName} 후보: ${value}`, name: value.trim(), role: '', specialtyName, isDirector: false })
    }
    return list
  }, [project])

  function applyCandidate(c: Candidate) {
    setSearchInput(c.name)
    setSelectedEngineerId(null)
    setRole(c.role)
    setIsDirector(c.isDirector)
    const spec = c.specialtyName ? specialties.find(s => s.name === c.specialtyName) : undefined
    setSpecialtyId(spec?.id ?? '')
  }

  // 공백 제거·대소문자 무시 매칭 — 검색 보조 용도일 뿐 동일인 자동 확정에는 쓰지 않는다(항상 목록에서 사용자가 직접 선택).
  const normalizedQuery = searchInput.trim().replace(/\s+/g, '').toLowerCase()
  const matches = useMemo(() => {
    if (!normalizedQuery) return []
    return engineers
      .filter(e => e.name.replace(/\s+/g, '').toLowerCase().includes(normalizedQuery))
      .slice(0, 20)
  }, [engineers, normalizedQuery])

  const currentActiveDirector = activeParticipants.find(p => p.is_director)

  async function endParticipant(p: ProjectParticipant) {
    if (endingId || saving) return // 중복 클릭/동시 처리 방지
    if (!confirm('이 참여를 종료 처리할까요? 과거 출근기록은 그대로 보존됩니다.')) return
    setEndingId(p.id)
    const { error: endError } = await supabase
      .from('project_participants')
      .update({ status: '종료', participation_end: p.participation_end ?? todayKST() })
      .eq('id', p.id)
    setEndingId(null)
    if (endError) { onToast('종료 처리에 실패했습니다.'); return }
    onToast('참여를 종료 처리했습니다.')
    onChange()
  }

  async function handleAdd() {
    if (saving) return // 처리 중 재실행 방지
    setError(null)
    if (!selectedEngineerId) { setError('검색 결과에서 기술인을 선택하세요.'); return }

    // 이미 이 프로젝트의 진행중 참여자인 경우: 단장으로 승격하려는 게 아니라면 중복 등록을 막는다.
    // 단장으로 승격하려는 경우(isDirector 체크)는 막지 않고 RPC의 "경로 B"(기존 행을 단장으로 UPDATE)로 보낸다.
    const existingActiveSameEngineer = activeParticipants.find(p => p.engineer_id === selectedEngineerId)
    if (existingActiveSameEngineer && !isDirector) {
      setError('이미 이 프로젝트의 진행중 참여기술인입니다.')
      return
    }
    if (existingActiveSameEngineer?.is_director) {
      setError('이미 이 프로젝트의 단장으로 지정되어 있습니다.')
      return
    }

    const replacingDirector = isDirector && !!currentActiveDirector && currentActiveDirector.engineer_id !== selectedEngineerId
    const promotingExisting = isDirector && !!existingActiveSameEngineer
    if (replacingDirector || promotingExisting) {
      const oldName = currentActiveDirector ? (engineerById.get(currentActiveDirector.engineer_id)?.name ?? '기존 단장') : null
      const message = promotingExisting
        ? `${engineerById.get(selectedEngineerId)?.name ?? '선택한 기술인'}을(를) 이 프로젝트의 단장으로 승격합니다.` +
          (oldName ? `\n기존 단장(${oldName})은 종료 처리되고 출근기록은 그대로 보존됩니다.` : '\n참여 시작일은 기존 그대로 유지됩니다.')
        : `이미 단장(${oldName})이 등록되어 있습니다. 교체할까요?\n기존 참여는 종료 처리되고 출근기록은 그대로 보존됩니다.`
      if (!confirm(message)) return
    }

    setSaving(true)

    if (isDirector) {
      // 단장 추가/교체는 원자적 RPC 하나로 처리 — 성공 응답을 받기 전에는 화면을 갱신하지 않는다
      // (기존 단장 표시를 그대로 유지 — 성공 후에만 onChange()로 목록을 다시 불러온다).
      const { error: rpcError } = await supabase.rpc('attendance_replace_director', {
        p_project_id: project.id,
        p_old_participant_id: replacingDirector ? currentActiveDirector!.id : null,
        p_new_engineer_id: selectedEngineerId,
        p_new_role: role.trim() || '단장',
        p_new_specialty_id: specialtyId || null,
        p_new_participation_start: participationStart || null,
        p_new_participation_end: participationEnd || null,
      })
      setSaving(false)
      if (rpcError) {
        setError(directorReplaceErrorMessage(rpcError))
        return
      }
    } else {
      const nextSortOrder = participants.length ? Math.max(...participants.map(p => p.sort_order)) + 10 : 0
      const { error: insertError } = await supabase.from('project_participants').insert({
        project_id: project.id,
        engineer_id: selectedEngineerId,
        role: role.trim(),
        specialty_id: specialtyId || null,
        is_director: false,
        participation_start: participationStart || null,
        participation_end: participationEnd || null,
        status: '진행중',
        sort_order: nextSortOrder,
      })
      setSaving(false)
      if (insertError) {
        setError(insertError.code === '23505' ? '이미 진행중인 참여로 등록되어 있습니다.' : `저장 실패: ${insertError.message}`)
        return
      }
    }

    onToast(promotingExisting ? '단장으로 승격했습니다.' : isDirector ? '단장을 등록/교체했습니다.' : '참여기술인을 등록했습니다.')
    setSearchInput('')
    setSelectedEngineerId(null)
    setRole('')
    setSpecialtyId('')
    setIsDirector(false)
    setParticipationStart(project.announce_date ?? '')
    setParticipationEnd('')
    onChange() // 성공했을 때만 목록 갱신
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }} onClick={saving ? undefined : onClose}>
      <div style={{ background: '#fff', borderRadius: 12, width: 640, maxWidth: 'calc(100vw - 40px)', maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #e8e8e6', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#111', borderRadius: '12px 12px 0 0' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>참여기술인 관리 — {project.name}</div>
          <button
            onClick={saving ? undefined : onClose}
            disabled={saving}
            title={saving ? '처리가 끝난 뒤 닫을 수 있습니다' : undefined}
            style={{ border: 'none', background: 'rgba(255,255,255,0.15)', color: '#fff', borderRadius: 6, padding: '4px 10px', cursor: saving ? 'not-allowed' : 'pointer', fontSize: 13, opacity: saving ? 0.5 : 1 }}
          >✕</button>
        </div>

        <div style={{ padding: '16px 20px', borderBottom: '1px solid #f0f0ee' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 8 }}>현재 참여기술인</div>
          {activeParticipants.length === 0 ? (
            <div style={{ fontSize: 12, color: '#bbb', padding: '8px 0' }}>등록된 참여기술인이 없습니다.</div>
          ) : (
            activeParticipants.map(p => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', fontSize: 12 }}>
                <span style={{ fontWeight: 600, color: '#111', minWidth: 70 }}>{engineerById.get(p.engineer_id)?.name ?? '(알 수 없음)'}</span>
                <span style={{ color: '#888' }}>{p.role}{p.is_director ? ' · 단장' : ''}</span>
                <span style={{ color: '#888' }}>{specialties.find(s => s.id === p.specialty_id)?.name ?? ''}</span>
                <span style={{ color: '#bbb', fontSize: 11 }}>{p.participation_start ?? ''}~{p.participation_end ?? ''}</span>
                <button onClick={() => endParticipant(p)} disabled={endingId === p.id || saving} style={endBtn}>
                  {endingId === p.id ? '처리 중...' : '종료'}
                </button>
              </div>
            ))
          )}
          {endedParticipants.length > 0 && (
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed #e8e8e6' }}>
              <div style={{ fontSize: 11, color: '#bbb', marginBottom: 4 }}>종료된 참여 (이력 보존)</div>
              {endedParticipants.map(p => (
                <div key={p.id} style={{ display: 'flex', gap: 8, padding: '3px 0', fontSize: 11, color: '#bbb' }}>
                  <span style={{ minWidth: 70 }}>{engineerById.get(p.engineer_id)?.name ?? '(알 수 없음)'}</span>
                  <span>{p.role}{p.is_director ? ' · 단장' : ''}</span>
                  <span>{p.participation_start ?? ''}~{p.participation_end ?? ''}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ padding: '16px 20px' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 8 }}>새 참여기술인 추가</div>

          {candidates.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
              {candidates.map((c, i) => (
                <button key={i} onClick={() => applyCandidate(c)} style={candidateChip} title="Project List에 입력된 이름 — 클릭하면 검색창에 채워집니다(자동 확정 아님)">
                  {c.label}
                </button>
              ))}
            </div>
          )}

          <input
            value={searchInput}
            onChange={e => { setSearchInput(e.target.value); setSelectedEngineerId(null) }}
            placeholder="기술인 성명 검색"
            style={{ ...inp, width: '100%', marginBottom: 8 }}
          />

          {normalizedQuery && (
            <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid #e8e8e6', borderRadius: 6, marginBottom: 10 }}>
              {matches.length === 0 ? (
                <div style={{ padding: 10, fontSize: 12, color: '#bbb' }}>일치하는 기술인이 없습니다. 기술인 주소록에서 먼저 등록해주세요.</div>
              ) : (
                matches.map(e => (
                  <div
                    key={e.id}
                    onClick={() => setSelectedEngineerId(e.id)}
                    style={{
                      padding: '8px 10px', fontSize: 12, cursor: 'pointer',
                      background: selectedEngineerId === e.id ? '#eff6ff' : '#fff',
                      borderBottom: '1px solid #f0f0ee',
                    }}
                  >
                    <span style={{ fontWeight: 600, color: '#111' }}>{e.name}</span>
                    <span style={{ color: '#999', marginLeft: 8 }}>{e.rank} {e.company}</span>
                    <span style={{ color: '#bbb', marginLeft: 8 }}>{e.mobile_phone}</span>
                    {/* 동명이인 구분용 정보를 함께 보여주고, 여러 명이면 전부 나열해 사용자가 직접 고르게 한다 */}
                  </div>
                ))
              )}
            </div>
          )}

          {selectedEngineerId && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: '#111', fontWeight: 600 }}>선택됨: {engineerById.get(selectedEngineerId)?.name}</span>
              <input value={role} onChange={e => setRole(e.target.value)} placeholder="참여직책 (예: 단장)" style={{ ...inp, width: 120 }} />
              <select value={specialtyId} onChange={e => setSpecialtyId(e.target.value)} style={inp}>
                <option value="">분야 선택</option>
                {specialties.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={isDirector}
                  onChange={e => {
                    setIsDirector(e.target.checked)
                    if (e.target.checked && !role.trim()) setRole('단장')
                  }}
                />
                단장
              </label>
              <input type="date" value={participationStart ?? ''} onChange={e => setParticipationStart(e.target.value)} style={inp} title="참여 시작일" />
              <span style={{ fontSize: 11, color: '#bbb' }}>~</span>
              <input type="date" value={participationEnd} onChange={e => setParticipationEnd(e.target.value)} style={inp} title="참여 종료일(선택)" />
            </div>
          )}

          {error && <div style={{ padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, color: '#b91c1c', marginBottom: 10 }}>{error}</div>}

          <button onClick={handleAdd} disabled={!selectedEngineerId || saving} style={{ ...primaryBtn, opacity: !selectedEngineerId || saving ? 0.5 : 1 }}>
            {saving ? '저장 중...' : '추가'}
          </button>
        </div>
      </div>
    </div>
  )
}

const inp: React.CSSProperties = { height: 34, padding: '0 10px', border: '1px solid #e8e8e6', borderRadius: 6, fontSize: 13, background: '#fff', boxSizing: 'border-box' }
const primaryBtn: React.CSSProperties = { height: 34, padding: '0 16px', borderRadius: 6, border: 'none', background: '#111', color: '#fff', fontSize: 13, cursor: 'pointer' }
const endBtn: React.CSSProperties = { height: 24, padding: '0 10px', borderRadius: 4, border: 'none', background: '#fee2e2', color: '#b91c1c', fontSize: 11, cursor: 'pointer', marginLeft: 'auto' }
const candidateChip: React.CSSProperties = { height: 26, padding: '0 10px', borderRadius: 13, border: '1px solid #e8e8e6', background: '#f8f8f7', color: '#555', fontSize: 11, cursor: 'pointer' }
