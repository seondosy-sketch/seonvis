/**
 * 기술인 출근부 — Project List 슬롯(director/staff_*) ↔ 기술인 주소록 자동연계 순수 로직 (Phase 3).
 *
 * 이 파일은 DB에 전혀 접근하지 않는다. 화면(ParticipantManagerModal)이 이미 불러온
 * project(5개 슬롯 텍스트), project_participant_links, engineer_contacts 목록을 넘기면
 * 슬롯별 현재 상태를 계산해 돌려준다 — "화면 조회만으로 DB 쓰기가 발생하지 않게"(사용자 지시 #10)
 * 하기 위해 실제 반영(insert/update)은 별도로 RPC를 호출하는 곳에서만 일어난다.
 */
import type { ProjectParticipantLink, SourceSlot } from './types'

export const SOURCE_SLOTS: SourceSlot[] = ['director', 'staff_arch', 'staff_civil', 'staff_mech', 'staff_safety']

export interface SlotMeta {
  label: string           // 화면 표시용 슬롯 이름
  role: string             // 자동 확정 시 project_participants.role에 넣을 값
  isDirector: boolean
  specialtyName: string | null // engineer_specialties.name — 여기서 id로 임의 매핑하지 않고, 실제
                                 // 마스터 목록에서 이 이름을 찾아 존재할 때만 specialty_id를 채운다
                                 // (없으면 분야 미지정으로 두고 사용자 확인 대상 — 사용자 지시 #4).
}

/** Project List 슬롯 컬럼 → 참여기술인 역할/분야 고정 매핑(사용자 지시 #4). */
export const SLOT_META: Record<SourceSlot, SlotMeta> = {
  director: { label: '단장', role: '책임', isDirector: true, specialtyName: '건축' },
  staff_arch: { label: '건축', role: '건축 담당', isDirector: false, specialtyName: '건축' },
  staff_civil: { label: '토목', role: '토목 담당', isDirector: false, specialtyName: '토목' },
  staff_mech: { label: '기계', role: '기계 담당', isDirector: false, specialtyName: '기계' },
  staff_safety: { label: '안전', role: '안전 담당', isDirector: false, specialtyName: '안전' },
}

export interface SlotSourceProject {
  director: string
  staff_arch: string
  staff_civil: string
  staff_mech: string
  staff_safety: string
}

export function slotValue(project: SlotSourceProject, slot: SourceSlot): string {
  return project[slot]
}

/** 공백 제거 비교 — 검색/매칭 보조용일 뿐 자동 신규등록에는 쓰지 않는다. */
export function normalizeEngineerName(name: string): string {
  return name.trim().replace(/\s+/g, '')
}

export interface EngineerLike {
  id: string
  name: string
}

/** 공백 제거 후 정확히 일치하는 기술인 후보 전체(동명이인 판정용 — 0/1/2명 이상을 구분해야 하므로 전부 반환). */
export function findEngineerCandidatesByName<T extends EngineerLike>(name: string, engineers: T[]): T[] {
  const norm = normalizeEngineerName(name)
  if (!norm) return []
  return engineers.filter(e => normalizeEngineerName(e.name) === norm)
}

/**
 * engineer_specialties 마스터에서 슬롯의 분야 이름과 정확히 일치하는 항목을 찾는다. 못 찾으면(마스터에
 * 없거나 시드가 바뀐 경우) null을 돌려주고, 호출부가 "분야 미지정"으로 두고 사용자 확인을 유도한다
 * (사용자 지시 #4 — 마스터에 없으면 자동 확정하지 않는다). director 슬롯은 애초에 분야가 없다.
 */
export function resolveSlotSpecialtyId(slot: SourceSlot, specialties: { id: string; name: string }[]): string | null {
  const name = SLOT_META[slot].specialtyName
  if (!name) return null
  return specialties.find(s => s.name === name)?.id ?? null
}

export type SlotLinkStatus =
  | 'empty'           // 슬롯 텍스트 없음 + 확정 링크 없음 — 표시 대상 아님
  | 'auto_ready'      // 미확정, 후보 정확히 1명 — "신규 연결 예정"(동기화 버튼으로 반영 가능)
  | 'ambiguous'       // 미확정, 후보 2명 이상 — "동명이인"(사용자가 직접 선택해야 확정)
  | 'unregistered'    // 미확정, 후보 0명 — "주소록미등록"(자동 신규등록 금지)
  | 'linked_auto'     // 확정(자동연결), 이름 불변 — "자동연결"
  | 'linked_manual'   // 확정(수동선택), 이름 불변 — "연결완료"
  | 'source_changed'  // 확정, 현재 이름 ≠ 확정 당시 이름(source_name_snapshot) — "원본변경"(재매핑 금지, 사용자 확인 대상)
  | 'removed'         // 확정, 현재 슬롯 텍스트가 빈 문자열 — "제거됨"(참여행·출근기록 보존, 자동삭제 금지)

export const SLOT_LINK_STATUS_LABEL: Record<SlotLinkStatus, string> = {
  empty: '',
  auto_ready: '신규 연결 예정',
  ambiguous: '동명이인',
  unregistered: '주소록미등록',
  linked_auto: '자동연결',
  linked_manual: '연결완료',
  source_changed: '원본변경',
  removed: '제거됨',
}

export interface SlotEvaluation {
  slot: SourceSlot
  currentName: string // 현재 Project List 슬롯 텍스트(트림 전 원문)
  status: SlotLinkStatus
  link: ProjectParticipantLink | null
  candidates: EngineerLike[] // auto_ready/ambiguous일 때만 채움
}

/** 한 프로젝트의 한 슬롯 상태를 계산한다 — DB 접근 없는 순수 함수. */
export function evaluateSlot<T extends EngineerLike>(input: {
  slot: SourceSlot
  currentName: string
  link: ProjectParticipantLink | null
  engineers: T[]
}): SlotEvaluation {
  const trimmed = input.currentName.trim()
  const { slot, currentName, link } = input

  if (link && link.participant_id) {
    if (!trimmed) return { slot, currentName, status: 'removed', link, candidates: [] }
    if (trimmed !== link.source_name_snapshot.trim()) {
      return { slot, currentName, status: 'source_changed', link, candidates: [] }
    }
    return { slot, currentName, status: link.link_status === '자동연결' ? 'linked_auto' : 'linked_manual', link, candidates: [] }
  }

  // 아직 확정되지 않음(링크 행 자체가 없거나, 있어도 participant_id가 비어있음 — 연결 해제 후 대기)
  if (!trimmed) return { slot, currentName, status: 'empty', link, candidates: [] }
  const candidates = findEngineerCandidatesByName(trimmed, input.engineers)
  if (candidates.length === 1) return { slot, currentName, status: 'auto_ready', link, candidates }
  if (candidates.length === 0) return { slot, currentName, status: 'unregistered', link, candidates: [] }
  return { slot, currentName, status: 'ambiguous', link, candidates }
}

/** 프로젝트 1건의 5개 슬롯 전체 평가. */
export function evaluateProjectSlots<T extends EngineerLike>(input: {
  project: SlotSourceProject
  links: ProjectParticipantLink[] // 이 프로젝트에 속한 링크만 필터링해 넘겨도 되고, 전체를 넘겨도 내부에서 project_id로 거르지 않으므로 호출부가 프로젝트 단위로 넘긴다
  engineers: T[]
}): SlotEvaluation[] {
  const linkBySlot = new Map(input.links.map(l => [l.source_slot, l]))
  return SOURCE_SLOTS.map(slot =>
    evaluateSlot({
      slot,
      currentName: slotValue(input.project, slot),
      link: linkBySlot.get(slot) ?? null,
      engineers: input.engineers,
    }),
  )
}

export interface ProjectLinkDiffSummary {
  autoReadyCount: number
  ambiguousCount: number
  unregisteredCount: number
  sourceChangedCount: number
  removedCount: number
}

/** 동기화 미리보기 상단에 보여줄 요약 카운트("신규 연결 예정 2명" 등, 사용자 지시 #3 예시 형식). */
export function summarizeProjectLinkDiff(evaluations: SlotEvaluation[]): ProjectLinkDiffSummary {
  const count = (status: SlotLinkStatus) => evaluations.filter(e => e.status === status).length
  return {
    autoReadyCount: count('auto_ready'),
    ambiguousCount: count('ambiguous'),
    unregisteredCount: count('unregistered'),
    sourceChangedCount: count('source_changed'),
    removedCount: count('removed'),
  }
}
