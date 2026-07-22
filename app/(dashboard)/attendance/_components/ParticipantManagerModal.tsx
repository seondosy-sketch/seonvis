'use client'

import { useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import type { ProjectParticipant, ProjectParticipantLink, SourceSlot } from '@/lib/attendance/types'
import { directorReplaceErrorMessage } from '@/lib/attendance/directorReplace'
import { confirmParticipantLinkErrorMessage, reassignEngineerErrorMessage } from '@/lib/attendance/reassignEngineer'
import {
  SLOT_LINK_STATUS_LABEL,
  SLOT_META,
  evaluateProjectSlots,
  resolveSlotSpecialtyId,
  slotValue,
  summarizeProjectLinkDiff,
  type SlotEvaluation,
} from '@/lib/attendance/engineerLink'
import { ATTENDANCE_PERIOD_WARNINGS, computeAttendancePeriod } from '@/lib/attendance/participantPeriod'
import { todayKST } from '@/lib/attendance/period'
import type { EngineerContact, EngineerSpecialty } from '@/lib/engineers/types'
import type { AttendanceProjectRow } from '../types'

/** 적용 시작일 표시 문구 — 파싱 실패/미입력 시 임의 날짜 대신 안내 문구로 대체(사용자 지시 #8). */
function displayStart(result: ReturnType<typeof computeAttendancePeriod>): string {
  if (result.warnings.includes(ATTENDANCE_PERIOD_WARNINGS.ANNOUNCE_DATE_MISSING)) return '공고일 미입력'
  if (result.warnings.includes(ATTENDANCE_PERIOD_WARNINGS.ANNOUNCE_DATE_INVALID)) return '공고일 확인 필요'
  return result.effectiveStart ?? '-'
}

/** 적용 종료일 표시 문구 — 면접일 미정/일정 미확정이면 회계월 말일을 실제 날짜처럼 보여주지 않는다. */
function displayEnd(result: ReturnType<typeof computeAttendancePeriod>): string {
  if (
    result.warnings.includes(ATTENDANCE_PERIOD_WARNINGS.INTERVIEW_DATE_MISSING) ||
    result.warnings.includes(ATTENDANCE_PERIOD_WARNINGS.SCHEDULE_UNCONFIRMED)
  ) {
    return '면접일 미정'
  }
  return result.effectiveEnd ?? '-'
}

/**
 * 프로젝트별 참여기술인 관리 — Phase 3: Project List(director/staff_*)의 5개 슬롯을 기술인
 * 주소록(engineer_contacts)과 자동 연계하고(project_participant_links), 확정된 연결은
 * 수정·재배정할 수 있게 한다. 슬롯과 무관한 "수동 등록" 참여기술인(전기/통신/소방 등)은
 * 기존처럼 검색 후 직접 추가한다.
 *
 * 자동연계 원칙(사용자 확정, docs/attendance/*.md 예정 반영):
 *  - 이미 확정된 연결(project_participant_links.participant_id 있음)은 이름이 바뀌어도 재매핑하지
 *    않는다 — "원본변경" 상태로만 표시하고 사용자가 유지/재배정을 직접 선택한다.
 *  - 후보가 정확히 1명일 때만 자동연결 후보로 보여준다(공백제거 비교). 0명/2명 이상은 항상
 *    사용자가 직접 선택해야 하며, 주소록에 없는 사람을 자동으로 새로 만들지 않는다.
 *  - 화면 조회만으로는 DB에 아무것도 쓰지 않는다 — "동기화" 패널을 열어도 순수 계산만 하고,
 *    각 항목의 반영 버튼을 눌러야 실제 저장이 일어난다.
 *  - 출근기록이 있는 참여자의 연결 기술인을 바꿀 때는 기존 행을 직접 UPDATE하지 않고
 *    attendance_reassign_engineer(단장은 attendance_replace_director)로 "종료+신규" 처리한다.
 */
export default function ParticipantManagerModal({
  project,
  participants,
  engineers,
  specialties,
  links,
  viewedPeriodEnd,
  onClose,
  onChange,
  onToast,
}: {
  project: AttendanceProjectRow
  participants: ProjectParticipant[]
  engineers: EngineerContact[]
  specialties: EngineerSpecialty[]
  links: ProjectParticipantLink[]
  viewedPeriodEnd: string
  onClose: () => void
  onChange: () => void
  onToast: (msg: string) => void
}) {
  const supabase = createSupabaseBrowserClient()
  const engineerById = useMemo(() => new Map(engineers.map(e => [e.id, e])), [engineers])
  const participantById = useMemo(() => new Map(participants.map(p => [p.id, p])), [participants])

  const evaluations = useMemo(() => evaluateProjectSlots({ project, links, engineers }), [project, links, engineers])
  const diffSummary = useMemo(() => summarizeProjectLinkDiff(evaluations), [evaluations])
  const pendingCount =
    diffSummary.autoReadyCount + diffSummary.ambiguousCount + diffSummary.unregisteredCount +
    diffSummary.sourceChangedCount + diffSummary.removedCount

  const linkedRows = evaluations.filter(e =>
    e.status === 'linked_auto' || e.status === 'linked_manual' || e.status === 'source_changed' || e.status === 'removed',
  )
  const pendingRows = evaluations.filter(e =>
    e.status === 'auto_ready' || e.status === 'ambiguous' || e.status === 'unregistered' ||
    e.status === 'source_changed' || e.status === 'removed',
  )

  const linkedParticipantIds = useMemo(
    () => new Set(links.filter(l => l.participant_id).map(l => l.participant_id as string)),
    [links],
  )
  const manualParticipants = participants.filter(p => !linkedParticipantIds.has(p.id))
  const activeManual = manualParticipants.filter(p => p.status === '진행중')
  const endedManual = manualParticipants.filter(p => p.status === '종료')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [syncOpen, setSyncOpen] = useState(false)
  const [ambiguousPick, setAmbiguousPick] = useState<Record<string, string>>({})

  // 수정(역할/분야/기간/상태) 모드 — engineer_id·is_director는 여기서 다루지 않는다(별도 재배정/단장교체 경로).
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editRole, setEditRole] = useState('')
  const [editSpecialtyId, setEditSpecialtyId] = useState('')
  const [editStart, setEditStart] = useState('')
  const [editEnd, setEditEnd] = useState('')
  const [editStatus, setEditStatus] = useState<'진행중' | '종료'>('진행중')

  // 기술인 재배정(연결 기술인 변경) 모드
  const [reassignForId, setReassignForId] = useState<string | null>(null)
  const [reassignSearch, setReassignSearch] = useState('')
  const [reassignEngineerId, setReassignEngineerId] = useState<string | null>(null)
  const [reassignEffectiveFrom, setReassignEffectiveFrom] = useState(todayKST())

  // 신규(수동) 참여기술인 추가 모드
  const [searchInput, setSearchInput] = useState('')
  const [selectedEngineerId, setSelectedEngineerId] = useState<string | null>(null)
  const [role, setRole] = useState('')
  const [specialtyId, setSpecialtyId] = useState('')
  const [isDirector, setIsDirector] = useState(false)
  const [participationStart, setParticipationStart] = useState('')
  const [participationEnd, setParticipationEnd] = useState('')

  const normalizedQuery = searchInput.trim().replace(/\s+/g, '').toLowerCase()
  const matches = useMemo(() => {
    if (!normalizedQuery) return []
    return engineers.filter(e => e.name.replace(/\s+/g, '').toLowerCase().includes(normalizedQuery)).slice(0, 20)
  }, [engineers, normalizedQuery])

  const normalizedReassignQuery = reassignSearch.trim().replace(/\s+/g, '').toLowerCase()
  const reassignMatches = useMemo(() => {
    if (!normalizedReassignQuery) return []
    return engineers.filter(e => e.name.replace(/\s+/g, '').toLowerCase().includes(normalizedReassignQuery)).slice(0, 20)
  }, [engineers, normalizedReassignQuery])

  const currentActiveDirector = participants.find(p => p.status === '진행중' && p.is_director)

  function periodFor(participant: ProjectParticipant) {
    return computeAttendancePeriod({
      announceDate: project.announce_date,
      interviewDate: project.interview_date,
      participationStart: participant.participation_start,
      participationEnd: participant.participation_end,
      viewedPeriodEnd,
    })
  }

  function periodSource(participant: ProjectParticipant): '프로젝트 기본기간' | '개별 기간' {
    return participant.participation_start || participant.participation_end ? '개별 기간' : '프로젝트 기본기간'
  }

  // ── 동기화: 자동연결 후보 확정(개별/전체) ─────────────────────────────────
  async function runConfirm(slot: SourceSlot, engineerId: string, nameSnapshot: string, linkStatus: '자동연결' | '연결완료') {
    const meta = SLOT_META[slot]
    const specialtyIdForSlot = resolveSlotSpecialtyId(slot, specialties)
    return supabase.rpc('attendance_confirm_participant_link', {
      p_project_id: project.id,
      p_source_slot: slot,
      p_engineer_id: engineerId,
      p_role: meta.role,
      p_specialty_id: specialtyIdForSlot,
      p_is_director: meta.isDirector,
      p_participation_start: null, // NULL = 공고일 상속(사용자 지시 #8)
      p_participation_end: null,   // NULL = 면접일 상속
      p_source_name_snapshot: nameSnapshot,
      p_link_status: linkStatus,
    })
  }

  async function confirmAuto(ev: SlotEvaluation) {
    if (busy || !ev.candidates[0]) return
    setBusy(true); setError(null)
    const { error: rpcError } = await runConfirm(ev.slot, ev.candidates[0].id, ev.currentName.trim(), '자동연결')
    setBusy(false)
    if (rpcError) { setError(confirmParticipantLinkErrorMessage(rpcError)); return }
    onToast(`${SLOT_META[ev.slot].label} 슬롯을 연결했습니다.`)
    onChange()
  }

  async function confirmAllAuto() {
    if (busy) return
    setBusy(true); setError(null)
    for (const ev of evaluations.filter(e => e.status === 'auto_ready')) {
      if (!ev.candidates[0]) continue
      const { error: rpcError } = await runConfirm(ev.slot, ev.candidates[0].id, ev.currentName.trim(), '자동연결')
      if (rpcError) { setBusy(false); setError(confirmParticipantLinkErrorMessage(rpcError)); return }
    }
    setBusy(false)
    onToast('자동 연결 대상을 모두 반영했습니다.')
    onChange()
  }

  async function confirmAmbiguous(ev: SlotEvaluation) {
    const engineerId = ambiguousPick[ev.slot]
    if (!engineerId) { setError('연결할 기술인을 선택하세요.'); return }
    if (busy) return
    setBusy(true); setError(null)
    const { error: rpcError } = await runConfirm(ev.slot, engineerId, ev.currentName.trim(), '연결완료')
    setBusy(false)
    if (rpcError) { setError(confirmParticipantLinkErrorMessage(rpcError)); return }
    onToast(`${SLOT_META[ev.slot].label} 슬롯을 연결했습니다.`)
    onChange()
  }

  // ── 원본변경: 유지(스냅샷만 갱신) ──────────────────────────────────────────
  async function keepSourceChanged(ev: SlotEvaluation) {
    if (!ev.link || busy) return
    setBusy(true)
    const { error: updErr } = await supabase
      .from('project_participant_links')
      .update({ source_name_snapshot: ev.currentName.trim(), updated_at: new Date().toISOString() })
      .eq('id', ev.link.id)
    setBusy(false)
    if (updErr) { onToast('처리에 실패했습니다.'); return }
    onToast('현재 연결을 유지했습니다.')
    onChange()
  }

  // ── 제거됨: 참여 종료 + 링크 해제 ──────────────────────────────────────────
  async function endRemovedSlot(ev: SlotEvaluation) {
    if (!ev.link?.participant_id || busy) return
    if (!confirm('이 참여를 종료 처리할까요? 과거 출근기록은 그대로 보존됩니다.')) return
    setBusy(true)
    const participant = participantById.get(ev.link.participant_id)
    await supabase
      .from('project_participants')
      .update({ status: '종료', participation_end: participant?.participation_end ?? todayKST() })
      .eq('id', ev.link.participant_id)
    await supabase.from('project_participant_links').update({ participant_id: null }).eq('id', ev.link.id)
    setBusy(false)
    onToast('참여를 종료하고 연결을 해제했습니다.')
    onChange()
  }

  // ── 종료(수동 등록 참여자용, 기존 기능 유지) ───────────────────────────────
  async function endParticipant(p: ProjectParticipant) {
    if (busy) return
    if (!confirm('이 참여를 종료 처리할까요? 과거 출근기록은 그대로 보존됩니다.')) return
    setBusy(true)
    const { error: endError } = await supabase
      .from('project_participants')
      .update({ status: '종료', participation_end: p.participation_end ?? todayKST() })
      .eq('id', p.id)
    setBusy(false)
    if (endError) { onToast('종료 처리에 실패했습니다.'); return }
    onToast('참여를 종료 처리했습니다.')
    onChange()
  }

  // ── 수정(역할/분야/기간/상태) ──────────────────────────────────────────────
  function startEdit(p: ProjectParticipant) {
    setEditingId(p.id)
    setEditRole(p.role)
    setEditSpecialtyId(p.specialty_id ?? '')
    setEditStart(p.participation_start ?? '')
    setEditEnd(p.participation_end ?? '')
    setEditStatus(p.status)
    setError(null)
  }

  async function saveEdit(participantId: string) {
    if (busy) return
    setBusy(true); setError(null)
    const { error: updErr } = await supabase
      .from('project_participants')
      .update({
        role: editRole.trim(),
        specialty_id: editSpecialtyId || null,
        participation_start: editStart || null,
        participation_end: editEnd || null,
        status: editStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', participantId)
    setBusy(false)
    if (updErr) { setError('수정에 실패했습니다.'); return }
    setEditingId(null)
    onToast('수정했습니다.')
    onChange()
  }

  // ── 기술인 재배정(연결 기술인 변경) ────────────────────────────────────────
  function startReassign(p: ProjectParticipant) {
    setReassignForId(p.id)
    setReassignSearch('')
    setReassignEngineerId(null)
    setReassignEffectiveFrom(todayKST())
    setError(null)
  }

  async function confirmReassign(p: ProjectParticipant) {
    if (!reassignEngineerId || busy) { if (!reassignEngineerId) setError('변경할 기술인을 선택하세요.'); return }
    setBusy(true); setError(null)

    const link = links.find(l => l.participant_id === p.id) ?? null

    if (p.is_director) {
      const { error: rpcError } = await supabase.rpc('attendance_replace_director', {
        p_project_id: project.id,
        p_old_participant_id: p.id,
        p_new_engineer_id: reassignEngineerId,
        p_new_role: p.role,
        p_new_specialty_id: p.specialty_id,
        p_new_participation_start: reassignEffectiveFrom || null,
        p_new_participation_end: p.participation_end,
      })
      setBusy(false)
      if (rpcError) { setError(directorReplaceErrorMessage(rpcError)); return }
      onToast('단장을 교체했습니다.')
      setReassignForId(null)
      onChange()
      return
    }

    // 출근기록 유무로 분기(사용자 지시 #4): 없으면 단순 UPDATE, 있으면 종료+신규(RPC)로만.
    const { count } = await supabase
      .from('attendance_records')
      .select('id', { count: 'exact', head: true })
      .eq('participant_id', p.id)

    if (!count) {
      const { error: updErr } = await supabase
        .from('project_participants')
        .update({ engineer_id: reassignEngineerId, updated_at: new Date().toISOString() })
        .eq('id', p.id)
      if (updErr) {
        setBusy(false)
        setError(updErr.code === '23505' ? '이미 이 프로젝트의 진행중 참여기술인입니다.' : '재배정에 실패했습니다.')
        return
      }
      if (link) {
        await supabase
          .from('project_participant_links')
          .update({
            engineer_id: reassignEngineerId,
            source_name_snapshot: slotValue(project, link.source_slot),
            link_status: '연결완료',
            updated_at: new Date().toISOString(),
          })
          .eq('id', link.id)
      }
      setBusy(false)
    } else {
      const { error: rpcError } = await supabase.rpc('attendance_reassign_engineer', {
        p_old_participant_id: p.id,
        p_new_engineer_id: reassignEngineerId,
        p_new_role: null,
        p_new_specialty_id: null,
        p_new_participation_start: reassignEffectiveFrom || null,
        p_new_participation_end: p.participation_end,
        p_effective_from: reassignEffectiveFrom || null,
      })
      setBusy(false)
      if (rpcError) { setError(reassignEngineerErrorMessage(rpcError)); return }
    }

    onToast('기술인을 재배정했습니다.')
    setReassignForId(null)
    onChange()
  }

  // ── 신규(수동) 참여기술인 추가 — Project List 5개 슬롯과 무관한 인원(전기/통신/소방 등) ──
  async function handleAdd() {
    if (busy) return
    setError(null)
    if (!selectedEngineerId) { setError('검색 결과에서 기술인을 선택하세요.'); return }

    const existingActiveSameEngineer = participants.find(p => p.status === '진행중' && p.engineer_id === selectedEngineerId)
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

    setBusy(true)

    if (isDirector) {
      const { error: rpcError } = await supabase.rpc('attendance_replace_director', {
        p_project_id: project.id,
        p_old_participant_id: replacingDirector ? currentActiveDirector!.id : null,
        p_new_engineer_id: selectedEngineerId,
        p_new_role: role.trim() || SLOT_META.director.role,
        p_new_specialty_id: specialtyId || null,
        p_new_participation_start: participationStart || null,
        p_new_participation_end: participationEnd || null,
      })
      setBusy(false)
      if (rpcError) { setError(directorReplaceErrorMessage(rpcError)); return }
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
      setBusy(false)
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
    setParticipationStart('')
    setParticipationEnd('')
    onChange()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }} onClick={busy ? undefined : onClose}>
      <div style={{ background: '#fff', borderRadius: 12, width: 760, maxWidth: 'calc(100vw - 40px)', maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #e8e8e6', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#111', borderRadius: '12px 12px 0 0' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>참여기술인 관리 — {project.name}</div>
          <button
            onClick={busy ? undefined : onClose}
            disabled={busy}
            title={busy ? '처리가 끝난 뒤 닫을 수 있습니다' : undefined}
            style={{ border: 'none', background: 'rgba(255,255,255,0.15)', color: '#fff', borderRadius: 6, padding: '4px 10px', cursor: busy ? 'not-allowed' : 'pointer', fontSize: 13, opacity: busy ? 0.5 : 1 }}
          >✕</button>
        </div>

        {/* 상단: Project List 일정 + 동기화 */}
        <div style={{ padding: '12px 20px', borderBottom: '1px solid #f0f0ee', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: 12, color: '#555' }}>
            공고일 <b style={{ color: '#111' }}>{project.announce_date || '미입력'}</b>
            <span style={{ margin: '0 6px', color: '#ccc' }}>·</span>
            면접일 <b style={{ color: '#111' }}>{project.interview_date || '미정'}</b>
          </div>
          <button onClick={() => setSyncOpen(v => !v)} style={syncBtn} disabled={busy}>
            Project List와 동기화{pendingCount > 0 ? ` (${pendingCount})` : ''}
          </button>
        </div>

        {syncOpen && (
          <div style={{ padding: '12px 20px', borderBottom: '1px solid #f0f0ee', background: '#fbfbfa' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 11, color: '#666', marginBottom: 10 }}>
              <span>신규 연결 예정 {diffSummary.autoReadyCount}명</span>
              <span>동명이인 확인 필요 {diffSummary.ambiguousCount}명</span>
              <span>주소록미등록 {diffSummary.unregisteredCount}명</span>
              <span>원본변경 {diffSummary.sourceChangedCount}명</span>
              <span>Project List에서 제거됨 {diffSummary.removedCount}명</span>
              {diffSummary.autoReadyCount > 0 && (
                <button onClick={confirmAllAuto} disabled={busy} style={{ ...miniBtn, marginLeft: 'auto' }}>자동연결 전체 반영</button>
              )}
            </div>

            {pendingRows.length === 0 ? (
              <div style={{ fontSize: 12, color: '#bbb' }}>확인이 필요한 항목이 없습니다.</div>
            ) : (
              pendingRows.map(ev => (
                <div key={ev.slot} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px dashed #e8e8e6', fontSize: 12 }}>
                  <span style={{ minWidth: 40, color: '#888' }}>{SLOT_META[ev.slot].label}</span>
                  <span style={{ fontWeight: 600, color: '#111' }}>{ev.currentName || '(비어있음)'}</span>
                  <span style={statusBadge}>{SLOT_LINK_STATUS_LABEL[ev.status]}</span>

                  {ev.status === 'auto_ready' && (
                    <>
                      <span style={{ color: '#999' }}>→ {ev.candidates[0]?.name}</span>
                      <button onClick={() => confirmAuto(ev)} disabled={busy} style={{ ...miniBtn, marginLeft: 'auto' }}>연결</button>
                    </>
                  )}

                  {ev.status === 'ambiguous' && (
                    <>
                      <select
                        value={ambiguousPick[ev.slot] ?? ''}
                        onChange={e => setAmbiguousPick(prev => ({ ...prev, [ev.slot]: e.target.value }))}
                        style={{ ...inp, height: 26 }}
                      >
                        <option value="">후보 선택</option>
                        {ev.candidates.map(c => {
                          const full = engineerById.get(c.id)
                          return <option key={c.id} value={c.id}>{c.name} {full ? `(${full.rank} ${full.company})` : ''}</option>
                        })}
                      </select>
                      <button onClick={() => confirmAmbiguous(ev)} disabled={busy} style={{ ...miniBtn, marginLeft: 'auto' }}>연결 확정</button>
                    </>
                  )}

                  {ev.status === 'unregistered' && (
                    <span style={{ color: '#bbb', marginLeft: 'auto' }}>기술인 주소록에서 먼저 등록해주세요</span>
                  )}

                  {ev.status === 'source_changed' && (
                    <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
                      <span style={{ color: '#999' }}>기존: {ev.link?.source_name_snapshot}</span>
                      <button onClick={() => keepSourceChanged(ev)} disabled={busy} style={miniBtn}>유지</button>
                      <button
                        onClick={() => { const p = ev.link?.participant_id ? participantById.get(ev.link.participant_id) : null; if (p) startReassign(p) }}
                        disabled={busy}
                        style={miniBtn}
                      >재배정</button>
                    </div>
                  )}

                  {ev.status === 'removed' && (
                    <button onClick={() => endRemovedSlot(ev)} disabled={busy} style={{ ...miniBtn, marginLeft: 'auto' }}>참여 종료</button>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* Project List 연계 참여기술인 목록 */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #f0f0ee' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 8 }}>Project List 연계 참여기술인</div>
          {linkedRows.length === 0 ? (
            <div style={{ fontSize: 12, color: '#bbb', padding: '8px 0' }}>확정된 연결이 없습니다. 위 동기화 패널에서 반영하세요.</div>
          ) : (
            linkedRows.map(ev => {
              const participant = ev.link?.participant_id ? participantById.get(ev.link.participant_id) : undefined
              if (!participant) return null
              const period = periodFor(participant)
              const isEditing = editingId === participant.id
              const isReassigning = reassignForId === participant.id
              return (
                <div key={ev.slot} style={rowBox}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: 12 }}>
                    <span style={{ minWidth: 40, color: '#888' }}>{SLOT_META[ev.slot].label}</span>
                    <span style={{ color: '#bbb' }}>{ev.currentName}</span>
                    <span style={{ fontWeight: 700, color: '#111' }}>{engineerById.get(participant.engineer_id)?.name ?? '(알 수 없음)'}</span>
                    <span style={statusBadge}>{SLOT_LINK_STATUS_LABEL[ev.status]}</span>
                    {participant.is_director && <span style={directorBadge}>단장</span>}
                    <span style={{ marginLeft: 'auto', color: participant.status === '종료' ? '#bbb' : '#555' }}>{participant.status}</span>
                    {participant.status === '진행중' && !isEditing && !isReassigning && (
                      <>
                        <button onClick={() => startEdit(participant)} disabled={busy} style={miniBtn}>수정</button>
                        <button onClick={() => startReassign(participant)} disabled={busy} style={miniBtn}>기술인 변경</button>
                      </>
                    )}
                  </div>
                  {!isEditing && !isReassigning && (
                    <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>
                      {displayStart(period)} ~ {displayEnd(period)} · 기간출처: {periodSource(participant)}
                    </div>
                  )}

                  {isEditing && (
                    <EditForm
                      role={editRole} setRole={setEditRole}
                      specialtyId={editSpecialtyId} setSpecialtyId={setEditSpecialtyId}
                      start={editStart} setStart={setEditStart}
                      end={editEnd} setEnd={setEditEnd}
                      status={editStatus} setStatus={setEditStatus}
                      specialties={specialties}
                      onUseDefaultPeriod={() => { setEditStart(''); setEditEnd('') }}
                      onCancel={() => setEditingId(null)}
                      onSave={() => saveEdit(participant.id)}
                      busy={busy}
                    />
                  )}

                  {isReassigning && (
                    <ReassignForm
                      search={reassignSearch} setSearch={setReassignSearch}
                      matches={reassignMatches}
                      selectedId={reassignEngineerId} setSelectedId={setReassignEngineerId}
                      effectiveFrom={reassignEffectiveFrom} setEffectiveFrom={setReassignEffectiveFrom}
                      isDirector={participant.is_director}
                      onCancel={() => setReassignForId(null)}
                      onConfirm={() => confirmReassign(participant)}
                      busy={busy}
                    />
                  )}
                </div>
              )
            })
          )}
        </div>

        {/* 수동 등록 참여기술인(Project List 5개 슬롯과 무관) */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #f0f0ee' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 8 }}>수동 등록 참여기술인</div>
          {activeManual.length === 0 ? (
            <div style={{ fontSize: 12, color: '#bbb', padding: '8px 0' }}>등록된 참여기술인이 없습니다.</div>
          ) : (
            activeManual.map(p => {
              const period = periodFor(p)
              const isEditing = editingId === p.id
              const isReassigning = reassignForId === p.id
              return (
                <div key={p.id} style={rowBox}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                    <span style={{ fontWeight: 600, color: '#111', minWidth: 70 }}>{engineerById.get(p.engineer_id)?.name ?? '(알 수 없음)'}</span>
                    <span style={{ color: '#888' }}>{p.role}{p.is_director ? ' · 단장' : ''}</span>
                    <span style={{ color: '#888' }}>{specialties.find(s => s.id === p.specialty_id)?.name ?? ''}</span>
                    {!isEditing && !isReassigning && (
                      <>
                        <button onClick={() => startEdit(p)} disabled={busy} style={{ ...miniBtn, marginLeft: 'auto' }}>수정</button>
                        <button onClick={() => startReassign(p)} disabled={busy} style={miniBtn}>기술인 변경</button>
                        <button onClick={() => endParticipant(p)} disabled={busy} style={endBtn}>종료</button>
                      </>
                    )}
                  </div>
                  {!isEditing && !isReassigning && (
                    <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>
                      {displayStart(period)} ~ {displayEnd(period)} · 기간출처: {periodSource(p)}
                    </div>
                  )}
                  {isEditing && (
                    <EditForm
                      role={editRole} setRole={setEditRole}
                      specialtyId={editSpecialtyId} setSpecialtyId={setEditSpecialtyId}
                      start={editStart} setStart={setEditStart}
                      end={editEnd} setEnd={setEditEnd}
                      status={editStatus} setStatus={setEditStatus}
                      specialties={specialties}
                      onUseDefaultPeriod={() => { setEditStart(''); setEditEnd('') }}
                      onCancel={() => setEditingId(null)}
                      onSave={() => saveEdit(p.id)}
                      busy={busy}
                    />
                  )}
                  {isReassigning && (
                    <ReassignForm
                      search={reassignSearch} setSearch={setReassignSearch}
                      matches={reassignMatches}
                      selectedId={reassignEngineerId} setSelectedId={setReassignEngineerId}
                      effectiveFrom={reassignEffectiveFrom} setEffectiveFrom={setReassignEffectiveFrom}
                      isDirector={p.is_director}
                      onCancel={() => setReassignForId(null)}
                      onConfirm={() => confirmReassign(p)}
                      busy={busy}
                    />
                  )}
                </div>
              )
            })
          )}
          {endedManual.length > 0 && (
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed #e8e8e6' }}>
              <div style={{ fontSize: 11, color: '#bbb', marginBottom: 4 }}>종료된 참여 (이력 보존)</div>
              {endedManual.map(p => (
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
          <div style={{ fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 8 }}>새 참여기술인 추가(Project List 슬롯 외 인원)</div>

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
                  </div>
                ))
              )}
            </div>
          )}

          {selectedEngineerId && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: '#111', fontWeight: 600 }}>선택됨: {engineerById.get(selectedEngineerId)?.name}</span>
              <input value={role} onChange={e => setRole(e.target.value)} placeholder="참여직책 (예: 책임)" style={{ ...inp, width: 120 }} />
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
                    if (e.target.checked) {
                      if (!role.trim()) setRole(SLOT_META.director.role)
                      if (!specialtyId) {
                        const arch = specialties.find(s => s.name === SLOT_META.director.specialtyName)
                        if (arch) setSpecialtyId(arch.id)
                      }
                    }
                  }}
                />
                단장
              </label>
              <input type="date" value={participationStart} onChange={e => setParticipationStart(e.target.value)} style={inp} title="참여 시작일(비워두면 공고일 상속)" />
              <span style={{ fontSize: 11, color: '#bbb' }}>~</span>
              <input type="date" value={participationEnd} onChange={e => setParticipationEnd(e.target.value)} style={inp} title="참여 종료일(비워두면 면접일 상속)" />
            </div>
          )}

          {error && <div style={{ padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, color: '#b91c1c', marginBottom: 10 }}>{error}</div>}

          <button onClick={handleAdd} disabled={!selectedEngineerId || busy} style={{ ...primaryBtn, opacity: !selectedEngineerId || busy ? 0.5 : 1 }}>
            {busy ? '저장 중...' : '추가'}
          </button>
        </div>
      </div>
    </div>
  )
}

function EditForm({
  role, setRole, specialtyId, setSpecialtyId, start, setStart, end, setEnd, status, setStatus,
  specialties, onUseDefaultPeriod, onCancel, onSave, busy,
}: {
  role: string; setRole: (v: string) => void
  specialtyId: string; setSpecialtyId: (v: string) => void
  start: string; setStart: (v: string) => void
  end: string; setEnd: (v: string) => void
  status: '진행중' | '종료'; setStatus: (v: '진행중' | '종료') => void
  specialties: EngineerSpecialty[]
  onUseDefaultPeriod: () => void
  onCancel: () => void
  onSave: () => void
  busy: boolean
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 8, padding: 8, background: '#f8f8f7', borderRadius: 6 }}>
      <input value={role} onChange={e => setRole(e.target.value)} placeholder="참여직책" style={{ ...inp, width: 100 }} />
      <select value={specialtyId} onChange={e => setSpecialtyId(e.target.value)} style={inp}>
        <option value="">분야 선택</option>
        {specialties.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <input type="date" value={start} onChange={e => setStart(e.target.value)} style={inp} title="참여 시작일(비워두면 공고일 상속)" />
      <span style={{ fontSize: 11, color: '#bbb' }}>~</span>
      <input type="date" value={end} onChange={e => setEnd(e.target.value)} style={inp} title="참여 종료일(비워두면 면접일 상속)" />
      <button onClick={onUseDefaultPeriod} disabled={busy} style={miniBtn}>기본기간 사용</button>
      <select value={status} onChange={e => setStatus(e.target.value as '진행중' | '종료')} style={inp}>
        <option value="진행중">진행중</option>
        <option value="종료">종료</option>
      </select>
      <button onClick={onSave} disabled={busy} style={primaryBtnSmall}>저장</button>
      <button onClick={onCancel} disabled={busy} style={miniBtn}>취소</button>
    </div>
  )
}

function ReassignForm({
  search, setSearch, matches, selectedId, setSelectedId, effectiveFrom, setEffectiveFrom, isDirector, onCancel, onConfirm, busy,
}: {
  search: string; setSearch: (v: string) => void
  matches: EngineerContact[]
  selectedId: string | null; setSelectedId: (v: string | null) => void
  effectiveFrom: string; setEffectiveFrom: (v: string) => void
  isDirector: boolean
  onCancel: () => void
  onConfirm: () => void
  busy: boolean
}) {
  return (
    <div style={{ marginTop: 8, padding: 8, background: '#f8f8f7', borderRadius: 6 }}>
      <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>
        {isDirector ? '단장교체 원자성 로직을 통해 처리됩니다.' : '출근기록이 있으면 기존 참여는 종료되고 새 참여로 이어집니다(과거 기록 보존).'}
      </div>
      <input
        value={search}
        onChange={e => { setSearch(e.target.value); setSelectedId(null) }}
        placeholder="새 기술인 성명 검색"
        style={{ ...inp, width: '100%', marginBottom: 6 }}
      />
      {search.trim() && (
        <div style={{ maxHeight: 120, overflowY: 'auto', border: '1px solid #e8e8e6', borderRadius: 6, marginBottom: 6 }}>
          {matches.length === 0 ? (
            <div style={{ padding: 8, fontSize: 12, color: '#bbb' }}>일치하는 기술인이 없습니다.</div>
          ) : (
            matches.map(e => (
              <div
                key={e.id}
                onClick={() => setSelectedId(e.id)}
                style={{ padding: '6px 10px', fontSize: 12, cursor: 'pointer', background: selectedId === e.id ? '#eff6ff' : '#fff', borderBottom: '1px solid #f0f0ee' }}
              >
                <span style={{ fontWeight: 600 }}>{e.name}</span>
                <span style={{ color: '#999', marginLeft: 8 }}>{e.rank} {e.company}</span>
              </div>
            ))
          )}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input type="date" value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)} style={inp} title="변경 시작일" />
        <button onClick={onConfirm} disabled={!selectedId || busy} style={{ ...primaryBtnSmall, opacity: !selectedId || busy ? 0.5 : 1 }}>변경 확정</button>
        <button onClick={onCancel} disabled={busy} style={miniBtn}>취소</button>
      </div>
    </div>
  )
}

const inp: React.CSSProperties = { height: 34, padding: '0 10px', border: '1px solid #e8e8e6', borderRadius: 6, fontSize: 13, background: '#fff', boxSizing: 'border-box' }
const primaryBtn: React.CSSProperties = { height: 34, padding: '0 16px', borderRadius: 6, border: 'none', background: '#111', color: '#fff', fontSize: 13, cursor: 'pointer' }
const primaryBtnSmall: React.CSSProperties = { height: 28, padding: '0 12px', borderRadius: 6, border: 'none', background: '#111', color: '#fff', fontSize: 12, cursor: 'pointer' }
const endBtn: React.CSSProperties = { height: 24, padding: '0 10px', borderRadius: 4, border: 'none', background: '#fee2e2', color: '#b91c1c', fontSize: 11, cursor: 'pointer' }
const miniBtn: React.CSSProperties = { height: 24, padding: '0 10px', borderRadius: 4, border: '1px solid #e8e8e6', background: '#fff', color: '#555', fontSize: 11, cursor: 'pointer' }
const syncBtn: React.CSSProperties = { height: 30, padding: '0 12px', borderRadius: 6, border: '1px solid #e8e8e6', background: '#fff', color: '#111', fontSize: 12, fontWeight: 600, cursor: 'pointer' }
const statusBadge: React.CSSProperties = { fontSize: 10, padding: '1px 6px', borderRadius: 3, background: '#f0f0ee', color: '#555' }
const directorBadge: React.CSSProperties = { fontSize: 9, padding: '1px 4px', borderRadius: 3, background: '#fffbeb', color: '#b45309', border: '1px solid #fde68a' }
const rowBox: React.CSSProperties = { padding: '8px 0', borderBottom: '1px solid #f5f5f4' }
