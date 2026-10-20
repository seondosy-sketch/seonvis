/**
 * 기술인 출근부 — Project List 자동연계 백그라운드 동기화 (사용자 지시).
 *
 * 사용자가 "참여기술인 관리" 모달에서 수동으로 동기화 버튼을 누르기 전에, 화면 진입만으로 다음을
 * 자동 반영한다.
 *  - 후보가 정확히 1명인 미확정 슬롯(auto_ready) → 최초 연결.
 *  - 단장 슬롯의 원본변경(source_changed) 중 새 이름의 후보가 정확히 1명인 것 → 단장 교체
 *    (사용자 지시: Project List에서 단장을 바꾸면 출근부 단장도 따라 바뀌어야 한다). 새 후보가
 *    이미 연결된 그 사람이면(표기만 바뀜) 교체 없이 확정 당시 이름만 갱신한다.
 * 동명이인/주소록미등록/제거됨, 그리고 단장이 아닌 슬롯의 원본변경처럼 사용자 판단이 필요한 상태는
 * 여기서 절대 건드리지 않는다 — 모달의 동기화 패널에서 사용자가 직접 처리해야 한다.
 *
 * 개찰일(bid_date)이 이미 지난 프로젝트, 그리고 상태가 '취소'인 프로젝트는 대상에서 제외한다
 * (사용자 지시) — 개찰이 끝났거나 취소된 사업에 새 참여기술인을 자동으로 연계할 필요가 없다.
 * today는 호출부가 명시적으로 넘긴다(이 파일 안에서 Date.now()/new Date()를 직접 쓰지 않음 —
 * 워크플로/재현성 관례).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  SLOT_META,
  evaluateProjectSlots,
  findEngineerCandidatesByName,
  resolveSlotSpecialtyId,
  type SlotEvaluation,
} from './engineerLink'
import type { ProjectParticipant, ProjectParticipantLink } from './types'

export interface AutoSyncProject {
  id: string
  director: string
  staff_arch: string
  staff_civil: string
  staff_mech: string
  staff_safety: string
  bid_date: string | null
  status: string
}

export interface AutoSyncEngineer {
  id: string
  name: string
}

export type AutoSyncParticipant = Pick<
  ProjectParticipant,
  'id' | 'engineer_id' | 'role' | 'specialty_id' | 'is_director' | 'participation_start' | 'participation_end' | 'status'
>

export type AutoSyncCandidate =
  /** 미확정 슬롯 최초 연결. */
  | { kind: 'confirm'; projectId: string; evaluation: SlotEvaluation }
  /** 단장 슬롯 이름이 다른 사람으로 바뀜 — 기존 단장 종료 + 새 단장 등록. */
  | { kind: 'replace_director'; projectId: string; evaluation: SlotEvaluation; oldParticipant: AutoSyncParticipant; newEngineerId: string }
  /** 단장 슬롯 표기만 바뀌고 같은 사람 — 확정 당시 이름만 갱신. */
  | { kind: 'refresh_snapshot'; projectId: string; evaluation: SlotEvaluation }

/** 자동 반영 대상 후보(슬롯)를 계산한다 — 순수 함수, DB 접근 없음. */
export function selectAutoSyncCandidates(input: {
  projects: AutoSyncProject[]
  links: ProjectParticipantLink[]
  participants: AutoSyncParticipant[]
  engineers: AutoSyncEngineer[]
  today: string // YYYY-MM-DD
}): AutoSyncCandidate[] {
  const linksByProject = new Map<string, ProjectParticipantLink[]>()
  for (const l of input.links) {
    const list = linksByProject.get(l.project_id) ?? []
    list.push(l)
    linksByProject.set(l.project_id, list)
  }
  const participantById = new Map(input.participants.map(p => [p.id, p]))

  const result: AutoSyncCandidate[] = []
  for (const project of input.projects) {
    if (project.status === '취소') continue // 취소된 사업 제외(사용자 지시)
    if (project.bid_date && project.bid_date < input.today) continue // 개찰일이 지난 사업 제외

    const evaluations = evaluateProjectSlots({
      project,
      links: linksByProject.get(project.id) ?? [],
      engineers: input.engineers,
    })
    for (const ev of evaluations) {
      if (ev.status === 'auto_ready') {
        result.push({ kind: 'confirm', projectId: project.id, evaluation: ev })
        continue
      }
      if (ev.status !== 'source_changed' || ev.slot !== 'director' || !ev.link?.participant_id) continue

      // 연결된 참여행이 지금도 활성 단장일 때만 자동 교체한다 — 이미 종료됐거나 단장이 아니면
      // 사람이 손댄 흔적이므로 모달에서 직접 확인하게 둔다.
      const old = participantById.get(ev.link.participant_id)
      if (!old || old.status !== '진행중' || !old.is_director) continue
      const candidates = findEngineerCandidatesByName(ev.currentName.trim(), input.engineers)
      if (candidates.length !== 1) continue

      if (candidates[0].id === old.engineer_id) {
        result.push({ kind: 'refresh_snapshot', projectId: project.id, evaluation: ev })
      } else {
        result.push({ kind: 'replace_director', projectId: project.id, evaluation: ev, oldParticipant: old, newEngineerId: candidates[0].id })
      }
    }
  }
  return result
}

interface SpecialtyLike {
  id: string
  name: string
}

/**
 * 단장 교체 시 새 단장의 참여 시작일.
 * 기존 단장의 출근기록이 하나도 없으면 잘못 적은 이름을 고친 것으로 보고 기존 시작일을 그대로
 * 물려받는다(대개 null = 공고일 상속). 출근기록이 있으면 실제 교체이므로 오늘부터 시작한다 —
 * 모달의 수동 재배정 기본값(오늘)과 같다.
 */
export function replacementStartDate(oldParticipant: AutoSyncParticipant, oldRecordCount: number, today: string): string | null {
  return oldRecordCount > 0 ? today : oldParticipant.participation_start
}

/**
 * 후보를 실제로 반영한다(DB 쓰기).
 * 개별 항목이 실패해도(예: 동시에 다른 사용자가 먼저 확정) 나머지는 계속 진행하고,
 * 성공한 개수만 반환한다 — 부분 실패로 전체가 멈추지 않게 한다.
 */
export async function applyAutoSyncCandidates(
  supabase: SupabaseClient,
  candidates: AutoSyncCandidate[],
  specialties: SpecialtyLike[],
  clock: { today: string; nowIso: string }, // today = YYYY-MM-DD(KST), nowIso = updated_at에 쓸 시각
): Promise<number> {
  let applied = 0
  for (const c of candidates) {
    const ev = c.evaluation
    const name = ev.currentName.trim()

    if (c.kind === 'confirm') {
      const candidateEngineer = ev.candidates[0]
      if (!candidateEngineer) continue
      const meta = SLOT_META[ev.slot]
      const specialtyId = resolveSlotSpecialtyId(ev.slot, specialties)
      const { error } = await supabase.rpc('attendance_confirm_participant_link', {
        p_project_id: c.projectId,
        p_source_slot: ev.slot,
        p_engineer_id: candidateEngineer.id,
        p_role: meta.role,
        p_specialty_id: specialtyId,
        p_is_director: meta.isDirector,
        p_participation_start: null,
        p_participation_end: null,
        p_source_name_snapshot: name,
        p_link_status: '자동연결',
      })
      if (!error) applied++
      continue
    }

    if (!ev.link) continue

    if (c.kind === 'replace_director') {
      const { count, error: countError } = await supabase
        .from('attendance_records')
        .select('id', { count: 'exact', head: true })
        .eq('participant_id', c.oldParticipant.id)
      if (countError) continue
      // attendance_replace_director가 director 링크를 새 참여행으로 옮긴다(같은 트랜잭션).
      const { error } = await supabase.rpc('attendance_replace_director', {
        p_project_id: c.projectId,
        p_old_participant_id: c.oldParticipant.id,
        p_new_engineer_id: c.newEngineerId,
        p_new_role: c.oldParticipant.role,
        p_new_specialty_id: c.oldParticipant.specialty_id,
        p_new_participation_start: replacementStartDate(c.oldParticipant, count ?? 0, clock.today),
        p_new_participation_end: c.oldParticipant.participation_end,
      })
      if (error) continue
    }

    // 확정 당시 이름을 지금 이름으로 맞춘다. attendance_replace_director는 이 값을 갱신하지 않아서,
    // 빠뜨리면 교체가 끝난 뒤에도 '원본변경'으로 남는다. 여기서 실패해도 다음 진입 때
    // refresh_snapshot 후보로 다시 잡혀 마저 맞춰진다.
    const { error: linkError } = await supabase
      .from('project_participant_links')
      .update({ source_name_snapshot: name, updated_at: clock.nowIso })
      .eq('id', ev.link.id)
    if (c.kind === 'replace_director' || !linkError) applied++
  }
  return applied
}
