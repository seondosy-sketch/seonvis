import { describe, expect, it } from 'vitest'
import {
  buildExtraAttendees,
  buildParticipantRows,
  countAttendees,
  newExtraAttendee,
  participantAttendeeRole,
  participantShortLabel,
  rowsForNewProject,
  toAttendeePayloads,
  type ParticipantRef,
} from './attendees'
import type { EvaluationAttendee } from './types'

/** 운영 DB의 project_participants 실측 값 모양(role/specialty/is_director). */
const PARTICIPANTS: ParticipantRef[] = [
  { engineer_contact_id: 'e-lead', name: '홍길동', role: '책임', specialty_name: '건축', is_director: true, sort_order: 0 },
  { engineer_contact_id: 'e-arch', name: '김철수', role: '건축 담당', specialty_name: '건축', is_director: false, sort_order: 10 },
  { engineer_contact_id: 'e-safe', name: '박민수', role: '안전 담당', specialty_name: '안전', is_director: false, sort_order: 20 },
  { engineer_contact_id: 'e-civil', name: '이영희', role: '토목 담당', specialty_name: '토목', is_director: false, sort_order: 30 },
]

function makeAttendee(overrides: Partial<EvaluationAttendee> = {}): EvaluationAttendee {
  return {
    id: 'att-1',
    review_id: 'rev-1',
    engineer_contact_id: null,
    attendee_name_snapshot: '최수행 차장',
    attendee_role: '수행',
    sort_order: 0,
    created_at: '2026-08-19T00:00:00Z',
    ...overrides,
  }
}

describe('participantShortLabel — Project List의 실제 역할/분야만 표시', () => {
  it('단장/책임은 role 원문을 쓴다 (분야가 건축으로 채워져 있어도 "건축"으로 보이지 않게)', () => {
    expect(participantShortLabel(PARTICIPANTS[0])).toBe('책임')
    expect(participantShortLabel({ ...PARTICIPANTS[0], role: '단장' })).toBe('단장')
  })

  it('분야기술인은 분야명을 쓴다', () => {
    expect(participantShortLabel(PARTICIPANTS[1])).toBe('건축')
    expect(participantShortLabel(PARTICIPANTS[2])).toBe('안전')
  })

  it('분야가 없으면 role 원문으로 대체한다 (없는 값을 만들지 않는다)', () => {
    expect(participantShortLabel({ ...PARTICIPANTS[1], specialty_name: null })).toBe('건축 담당')
  })

  it('역할·분야가 모두 비면 최소 표기로 떨어진다', () => {
    expect(participantShortLabel({ ...PARTICIPANTS[1], role: '', specialty_name: null })).toBe('기술인')
  })

  it('저장되는 attendee_role은 project_participants.role 원문이다', () => {
    expect(participantAttendeeRole(PARTICIPANTS[1])).toBe('건축 담당')
    expect(participantAttendeeRole(PARTICIPANTS[0])).toBe('책임')
  })
})

describe('buildParticipantRows — 프로젝트 선택 시 자동 표시', () => {
  it('신규 작성이면 전원 표시되고 아무도 체크되지 않는다', () => {
    const rows = buildParticipantRows(PARTICIPANTS, [])
    expect(rows).toHaveLength(4)
    expect(rows.every(r => !r.checked)).toBe(true)
    expect(rows.map(r => r.name)).toEqual(['홍길동', '김철수', '박민수', '이영희'])
  })

  it('sort_order 순으로 정렬한다', () => {
    const shuffled = [PARTICIPANTS[2], PARTICIPANTS[0], PARTICIPANTS[3], PARTICIPANTS[1]]
    expect(buildParticipantRows(shuffled, []).map(r => r.name)).toEqual(['홍길동', '김철수', '박민수', '이영희'])
  })

  it('수정 모드면 이미 참석자였던 사람이 체크된 상태로 열린다', () => {
    const attendees = [
      makeAttendee({ id: 'a1', engineer_contact_id: 'e-lead', attendee_name_snapshot: '홍길동', attendee_role: '책임' }),
      makeAttendee({ id: 'a2', engineer_contact_id: 'e-safe', attendee_name_snapshot: '박민수', attendee_role: '안전 담당' }),
    ]
    const rows = buildParticipantRows(PARTICIPANTS, attendees)
    expect(rows.filter(r => r.checked).map(r => r.name)).toEqual(['홍길동', '박민수'])
  })

  it('참여기술인이 없는 프로젝트면 빈 목록', () => {
    expect(buildParticipantRows([], [])).toEqual([])
  })
})

describe('buildExtraAttendees — 기타 참석자 분리', () => {
  it('주소록에 없는 수행직원은 기타 참석자로 온다', () => {
    const attendees = [
      makeAttendee({ id: 'a1', engineer_contact_id: 'e-lead', attendee_name_snapshot: '홍길동', attendee_role: '책임' }),
      makeAttendee({ id: 'a2', engineer_contact_id: null, attendee_name_snapshot: '최수행 차장', attendee_role: '수행', sort_order: 10 }),
    ]
    const extras = buildExtraAttendees(attendees, PARTICIPANTS)
    expect(extras).toHaveLength(1)
    expect(extras[0]).toMatchObject({ name: '최수행 차장', role: '수행', engineer_contact_id: null })
  })

  it('주소록에는 있지만 이 프로젝트 참여기술인이 아닌 사람도 기타로 온다', () => {
    const attendees = [makeAttendee({ id: 'a3', engineer_contact_id: 'e-outsider', attendee_name_snapshot: '외부기술인', attendee_role: '지원' })]
    const extras = buildExtraAttendees(attendees, PARTICIPANTS)
    expect(extras.map(e => e.name)).toEqual(['외부기술인'])
    expect(extras[0].engineer_contact_id).toBe('e-outsider')
  })

  it('참여기술인으로 체크된 사람은 기타로 중복되지 않는다', () => {
    const attendees = [makeAttendee({ id: 'a1', engineer_contact_id: 'e-arch', attendee_name_snapshot: '김철수', attendee_role: '건축 담당' })]
    expect(buildExtraAttendees(attendees, PARTICIPANTS)).toEqual([])
  })

  it('프로젝트 연결이 없는 legacy 기록이면 저장된 참석자 전원이 기타로 온다', () => {
    const attendees = [
      makeAttendee({ id: 'a1', engineer_contact_id: 'e-lead', attendee_name_snapshot: '홍길동', attendee_role: '책임' }),
      makeAttendee({ id: 'a2', engineer_contact_id: null, attendee_name_snapshot: '최수행 차장', attendee_role: '수행', sort_order: 10 }),
    ]
    // participants = [] (프로젝트 미연결) → 전원 기타로 표시되어 편집 가능
    expect(buildExtraAttendees(attendees, []).map(e => e.name)).toEqual(['홍길동', '최수행 차장'])
  })
})

describe('rowsForNewProject — 프로젝트 변경 시 선택 초기화', () => {
  it('새 프로젝트의 참여기술인으로 갈아끼우고 체크는 모두 해제한다', () => {
    const otherProject: ParticipantRef[] = [
      { engineer_contact_id: 'e-new', name: '정기술', role: '기계 담당', specialty_name: '기계', is_director: false, sort_order: 0 },
    ]
    const rows = rowsForNewProject(otherProject)
    expect(rows.map(r => r.name)).toEqual(['정기술'])
    expect(rows.every(r => !r.checked)).toBe(true)
  })

  it('이전 프로젝트에서 체크했던 기술인이 남지 않는다', () => {
    const before = buildParticipantRows(PARTICIPANTS, [
      makeAttendee({ engineer_contact_id: 'e-lead', attendee_name_snapshot: '홍길동' }),
    ])
    expect(before.some(r => r.checked)).toBe(true)

    const after = rowsForNewProject([])
    expect(after).toEqual([])
    expect(toAttendeePayloads(after, [])).toEqual([])
  })
})

describe('toAttendeePayloads — 저장 페이로드', () => {
  it('체크된 참여기술인만, 원본 role과 함께 저장된다', () => {
    const rows = buildParticipantRows(PARTICIPANTS, []).map(r => (
      r.engineer_contact_id === 'e-lead' || r.engineer_contact_id === 'e-safe' ? { ...r, checked: true } : r
    ))
    expect(toAttendeePayloads(rows, [])).toEqual([
      { engineer_contact_id: 'e-lead', attendee_name_snapshot: '홍길동', attendee_role: '책임' },
      { engineer_contact_id: 'e-safe', attendee_name_snapshot: '박민수', attendee_role: '안전 담당' },
    ])
  })

  it('기타 참석자는 참여기술인 뒤에 붙는다', () => {
    const rows = buildParticipantRows(PARTICIPANTS, []).map(r => (
      r.engineer_contact_id === 'e-lead' ? { ...r, checked: true } : r
    ))
    const extras = [newExtraAttendee('최수행 차장', '수행')]
    expect(toAttendeePayloads(rows, extras).map(a => a.attendee_name_snapshot)).toEqual(['홍길동', '최수행 차장'])
  })

  it('이름이 빈 기타 참석자 줄은 저장하지 않는다', () => {
    const extras = [newExtraAttendee('   ', '수행'), newExtraAttendee('', '')]
    expect(toAttendeePayloads([], extras)).toEqual([])
  })

  it('같은 사람이 참여기술인 체크와 기타에 겹치면 참여기술인 쪽만 남는다', () => {
    const rows = buildParticipantRows(PARTICIPANTS, []).map(r => (
      r.engineer_contact_id === 'e-arch' ? { ...r, checked: true } : r
    ))
    const extras = [newExtraAttendee('김철수', '중복', 'e-arch')]
    const payloads = toAttendeePayloads(rows, extras)
    expect(payloads).toHaveLength(1)
    expect(payloads[0].attendee_role).toBe('건축 담당')
  })

  it('아무도 안 골랐으면 빈 배열 (참석자 미기재 후기도 허용)', () => {
    expect(toAttendeePayloads(buildParticipantRows(PARTICIPANTS, []), [])).toEqual([])
  })

  it('countAttendees는 실제 저장될 참석자 수를 센다', () => {
    const rows = buildParticipantRows(PARTICIPANTS, []).map(r => ({ ...r, checked: true }))
    expect(countAttendees(rows, [newExtraAttendee('최수행 차장', '수행'), newExtraAttendee('', '')])).toBe(5)
  })

  it('수정 왕복이 무손실이다 — 저장된 참석자를 되돌려 다시 저장하면 같은 결과', () => {
    const attendees = [
      makeAttendee({ id: 'a1', engineer_contact_id: 'e-lead', attendee_name_snapshot: '홍길동', attendee_role: '책임', sort_order: 0 }),
      makeAttendee({ id: 'a2', engineer_contact_id: 'e-safe', attendee_name_snapshot: '박민수', attendee_role: '안전 담당', sort_order: 10 }),
      makeAttendee({ id: 'a3', engineer_contact_id: null, attendee_name_snapshot: '최수행 차장', attendee_role: '수행', sort_order: 20 }),
    ]
    const rows = buildParticipantRows(PARTICIPANTS, attendees)
    const extras = buildExtraAttendees(attendees, PARTICIPANTS)

    expect(toAttendeePayloads(rows, extras)).toEqual([
      { engineer_contact_id: 'e-lead', attendee_name_snapshot: '홍길동', attendee_role: '책임' },
      { engineer_contact_id: 'e-safe', attendee_name_snapshot: '박민수', attendee_role: '안전 담당' },
      { engineer_contact_id: null, attendee_name_snapshot: '최수행 차장', attendee_role: '수행' },
    ])
  })
})
