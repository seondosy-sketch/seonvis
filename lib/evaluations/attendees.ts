/**
 * 평가 DB — 참석 기술인 선택 순수 로직.
 *
 * 실제 업무에서 면접에 참석하는 기술인은 대부분 이미 해당 프로젝트의 Project List에 등록돼 있다.
 * 그래서 참석자 입력의 기본 source는 주소록 검색이 아니라
 *   projects → project_participants → engineer_contacts
 * 다. 기술인 master를 새로 만들지 않고 기존 테이블을 그대로 쓴다.
 *
 * 화면 흐름:
 *   프로젝트 선택 → 그 프로젝트의 참여기술인이 체크박스로 자동 표시 → 실제 참석자만 체크
 *   + 프로젝트에 없는 참석자(수행직원 등)는 "기타 참석자"로 따로 추가
 *
 * 이 파일은 DB에 접근하지 않는다.
 */
import type { EvaluationAttendee, AttendeeSavePayload } from './types'

/**
 * Project List에서 읽어온 참여기술인 1명.
 * role/specialty_name은 project_participants에 실제로 저장된 값이다 — 없는 역할/분야를 만들지 않는다.
 */
export interface ParticipantRef {
  engineer_contact_id: string
  name: string
  /** project_participants.role 원문 (예: '책임', '건축 담당', '토목 담당'). */
  role: string
  /** engineer_specialties.name (예: '건축'). 미지정이면 null. */
  specialty_name: string | null
  is_director: boolean
  sort_order: number
}

/** 체크박스 한 줄. */
export interface ParticipantRow extends ParticipantRef {
  checked: boolean
}

/** 프로젝트 참여기술인이 아닌 참석자(수행직원 등) 한 줄. */
export interface ExtraAttendeeDraft {
  /** React key 용도의 로컬 식별자 — DB에 저장되지 않는다. */
  key: string
  /** 주소록에서 골랐으면 그 id, 자유 입력이면 null. */
  engineer_contact_id: string | null
  name: string
  role: string
}

let keySeq = 0
export function newExtraAttendee(name = '', role = '', engineerId: string | null = null): ExtraAttendeeDraft {
  keySeq += 1
  return { key: `x${keySeq}`, engineer_contact_id: engineerId, name, role }
}

/**
 * 체크박스에 붙일 짧은 역할 표기.
 * 단장/책임은 role 원문을 그대로 쓴다 — 단장의 specialty_id는 자동연계 규칙상 '건축'으로 채워져
 * 있어서(lib/attendance/engineerLink.ts의 SLOT_META) 분야를 쓰면 "건축"으로 잘못 보인다.
 * 그 외에는 분야가 있으면 분야, 없으면 role 원문을 쓴다. 어느 쪽도 추측이 아니라 저장된 값이다.
 */
export function participantShortLabel(p: ParticipantRef): string {
  if (p.is_director) return p.role.trim() || '책임'
  const specialty = (p.specialty_name ?? '').trim()
  return specialty || p.role.trim() || '기술인'
}

/**
 * 저장할 때 attendee_role에 넣을 값 — project_participants.role 원문을 그대로 남긴다
 * (후기에 "그때 이 사람이 무슨 역할이었는지"를 원본대로 보존).
 */
export function participantAttendeeRole(p: ParticipantRef): string {
  return p.role.trim() || participantShortLabel(p)
}

/**
 * 프로젝트 참여기술인 목록 + 이미 저장된 참석자 → 체크박스 줄 목록.
 * 수정 모드에서는 이미 참석자로 저장돼 있던 사람이 체크된 상태로 열린다.
 * 신규 작성(attendees 빈 배열)에서는 아무도 체크되지 않는다 — 실제 참석자를 사용자가 고르게 한다.
 */
export function buildParticipantRows(
  participants: readonly ParticipantRef[],
  attendees: readonly EvaluationAttendee[],
): ParticipantRow[] {
  const attending = new Set(
    attendees.map(a => a.engineer_contact_id).filter((v): v is string => !!v),
  )
  return [...participants]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(p => ({ ...p, checked: attending.has(p.engineer_contact_id) }))
}

/**
 * 저장된 참석자 중 "프로젝트 참여기술인이 아닌 사람"만 뽑아 기타 참석자 줄로 만든다.
 * 주소록에 없는 수행직원(engineer_contact_id = null)과, 주소록에는 있지만 이 프로젝트의
 * 참여기술인은 아닌 사람이 모두 여기로 온다.
 */
export function buildExtraAttendees(
  attendees: readonly EvaluationAttendee[],
  participants: readonly ParticipantRef[],
): ExtraAttendeeDraft[] {
  const participantIds = new Set(participants.map(p => p.engineer_contact_id))
  return [...attendees]
    .sort((a, b) => a.sort_order - b.sort_order)
    .filter(a => !a.engineer_contact_id || !participantIds.has(a.engineer_contact_id))
    .map(a => newExtraAttendee(a.attendee_name_snapshot, a.attendee_role, a.engineer_contact_id))
}

/**
 * 프로젝트가 바뀌었을 때 체크 상태를 어떻게 할지.
 *
 * 이전 프로젝트의 선택이 그대로 남으면 다른 프로젝트의 기술인이 참석자로 저장될 수 있어서, 새
 * 프로젝트의 참여기술인 목록으로 갈아끼우고 체크는 모두 해제한다. 기타 참석자는 프로젝트와 무관한
 * 사람들이므로 유지한다(수행직원은 프로젝트가 바뀌어도 그대로인 경우가 많다).
 */
export function rowsForNewProject(participants: readonly ParticipantRef[]): ParticipantRow[] {
  return buildParticipantRows(participants, [])
}

/**
 * 저장 페이로드 조립 — 체크된 참여기술인 먼저, 그다음 기타 참석자.
 * 이름이 빈 기타 참석자 줄은 버린다(추가만 하고 안 채운 입력란).
 * 같은 사람이 참여기술인 체크와 기타 참석자에 중복으로 들어가면 앞쪽(참여기술인)만 남긴다.
 */
export function toAttendeePayloads(
  rows: readonly ParticipantRow[],
  extras: readonly ExtraAttendeeDraft[],
): AttendeeSavePayload[] {
  const out: AttendeeSavePayload[] = []
  const seenIds = new Set<string>()

  for (const row of rows) {
    if (!row.checked) continue
    out.push({
      engineer_contact_id: row.engineer_contact_id,
      attendee_name_snapshot: row.name.trim(),
      attendee_role: participantAttendeeRole(row),
    })
    seenIds.add(row.engineer_contact_id)
  }

  for (const extra of extras) {
    const name = extra.name.trim()
    if (!name) continue
    if (extra.engineer_contact_id && seenIds.has(extra.engineer_contact_id)) continue
    out.push({
      engineer_contact_id: extra.engineer_contact_id,
      attendee_name_snapshot: name,
      attendee_role: extra.role.trim(),
    })
    if (extra.engineer_contact_id) seenIds.add(extra.engineer_contact_id)
  }

  return out
}

/** 참석자가 한 명도 없는지 — 저장 전 안내에 쓴다(막지는 않는다: 참석자 미기재 후기도 있을 수 있다). */
export function countAttendees(
  rows: readonly ParticipantRow[],
  extras: readonly ExtraAttendeeDraft[],
): number {
  return toAttendeePayloads(rows, extras).length
}
