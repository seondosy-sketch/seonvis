/**
 * 기술인 출근부 — Project List 자동연계 백그라운드 동기화 (사용자 지시).
 *
 * 사용자가 "참여기술인 관리" 모달에서 수동으로 동기화 버튼을 누르기 전에, 후보가 정확히 1명인
 * 슬롯(auto_ready)은 화면 진입만으로 자동 반영한다. 동명이인/주소록미등록/원본변경/제거됨처럼
 * 사용자 판단이 필요한 상태는 여기서 절대 건드리지 않는다 — 그런 항목은 여전히 모달의 동기화
 * 패널에서 사용자가 직접 처리해야 한다(자동화 대상이 아님).
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
  resolveSlotSpecialtyId,
  type SlotEvaluation,
} from './engineerLink'
import type { ProjectParticipantLink } from './types'

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

export interface AutoSyncCandidate {
  projectId: string
  evaluation: SlotEvaluation
}

/** 자동 반영 대상 후보(슬롯)를 계산한다 — 순수 함수, DB 접근 없음. */
export function selectAutoSyncCandidates(input: {
  projects: AutoSyncProject[]
  links: ProjectParticipantLink[]
  engineers: AutoSyncEngineer[]
  today: string // YYYY-MM-DD
}): AutoSyncCandidate[] {
  const linksByProject = new Map<string, ProjectParticipantLink[]>()
  for (const l of input.links) {
    const list = linksByProject.get(l.project_id) ?? []
    list.push(l)
    linksByProject.set(l.project_id, list)
  }

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
      if (ev.status === 'auto_ready') result.push({ projectId: project.id, evaluation: ev })
    }
  }
  return result
}

interface SpecialtyLike {
  id: string
  name: string
}

/**
 * 후보를 실제로 반영한다(attendance_confirm_participant_link RPC 호출, DB 쓰기).
 * 개별 항목이 실패해도(예: 동시에 다른 사용자가 먼저 확정) 나머지는 계속 진행하고,
 * 성공한 개수만 반환한다 — 부분 실패로 전체가 멈추지 않게 한다.
 */
export async function applyAutoSyncCandidates(
  supabase: SupabaseClient,
  candidates: AutoSyncCandidate[],
  specialties: SpecialtyLike[],
): Promise<number> {
  let confirmed = 0
  for (const c of candidates) {
    const ev = c.evaluation
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
      p_source_name_snapshot: ev.currentName.trim(),
      p_link_status: '자동연결',
    })
    if (!error) confirmed++
  }
  return confirmed
}
