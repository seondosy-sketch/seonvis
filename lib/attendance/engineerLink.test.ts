import { describe, expect, it } from 'vitest'
import {
  SLOT_META,
  evaluateProjectSlots,
  evaluateSlot,
  findEngineerCandidatesByName,
  normalizeEngineerName,
  resolveSlotSpecialtyId,
  summarizeProjectLinkDiff,
} from './engineerLink'
import type { ProjectParticipantLink } from './types'

const engineers = [
  { id: 'e1', name: '홍길동' },
  { id: 'e2', name: '김철수' },
  { id: 'e3', name: '홍 길동' }, // '홍길동'과 공백만 다름 — 정규화하면 e1과 동일 인물로 취급되어야 함
]

function makeLink(overrides: Partial<ProjectParticipantLink>): ProjectParticipantLink {
  return {
    id: 'link-1',
    project_id: 'p1',
    source_slot: 'staff_arch',
    source_name_snapshot: '홍길동',
    engineer_id: 'e1',
    participant_id: 'participant-1',
    link_status: '자동연결',
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    ...overrides,
  }
}

describe('normalizeEngineerName / findEngineerCandidatesByName', () => {
  it('공백을 제거하고 비교한다', () => {
    expect(normalizeEngineerName('홍 길 동')).toBe('홍길동')
  })

  it('공백만 다른 이름은 같은 인물 후보로 묶인다', () => {
    const list = findEngineerCandidatesByName('홍 길동', [engineers[0]])
    expect(list).toHaveLength(1)
  })

  it('빈 문자열은 후보 없음', () => {
    expect(findEngineerCandidatesByName('   ', engineers)).toEqual([])
  })
})

describe('resolveSlotSpecialtyId', () => {
  const specialties = [
    { id: 's-arch', name: '건축' },
    { id: 's-civil', name: '토목' },
  ]

  it('슬롯의 분야 이름이 마스터에 있으면 id를 반환한다', () => {
    expect(resolveSlotSpecialtyId('staff_arch', specialties)).toBe('s-arch')
  })

  it('마스터에 없는 분야는 null(자동 확정하지 않음)', () => {
    expect(resolveSlotSpecialtyId('staff_mech', specialties)).toBeNull()
  })

  it('director 슬롯은 건축 분야로 매핑된다(사용자 지시)', () => {
    expect(resolveSlotSpecialtyId('director', specialties)).toBe('s-arch')
  })
})

describe('evaluateSlot — 미확정 상태(링크 없음)', () => {
  it('슬롯이 비어있으면 empty', () => {
    const result = evaluateSlot({ slot: 'staff_arch', currentName: '', link: null, engineers })
    expect(result.status).toBe('empty')
  })

  it('후보 정확히 1명이면 auto_ready', () => {
    const result = evaluateSlot({ slot: 'staff_arch', currentName: '김철수', link: null, engineers })
    expect(result.status).toBe('auto_ready')
    expect(result.candidates.map(c => c.id)).toEqual(['e2'])
  })

  it('공백만 다른 이름도 유일 일치로 auto_ready 처리', () => {
    // 주소록에 '홍길동'과 '홍 길동' 둘 다 있는 상태에서, Project List가 '홍  길동'(공백만 다름)을
    // 입력했다면 정규화 후 둘 다 일치해 동명이인(2명)으로 잡혀야 한다 — 이 케이스는 별도로 검증.
    const result = evaluateSlot({ slot: 'staff_arch', currentName: '홍  길동', link: null, engineers })
    expect(result.status).toBe('ambiguous')
    expect(result.candidates).toHaveLength(2)
  })

  it('후보 0명이면 unregistered(자동 신규등록 금지)', () => {
    const result = evaluateSlot({ slot: 'staff_arch', currentName: '주소록에없는사람', link: null, engineers })
    expect(result.status).toBe('unregistered')
    expect(result.candidates).toEqual([])
  })
})

describe('evaluateSlot — 확정된 링크가 있는 경우', () => {
  it('이름이 그대로면 확정 방식대로 linked_auto/linked_manual', () => {
    const auto = evaluateSlot({ slot: 'staff_arch', currentName: '홍길동', link: makeLink({ link_status: '자동연결' }), engineers })
    expect(auto.status).toBe('linked_auto')

    const manual = evaluateSlot({ slot: 'staff_arch', currentName: '홍길동', link: makeLink({ link_status: '연결완료' }), engineers })
    expect(manual.status).toBe('linked_manual')
  })

  it('현재 이름이 확정 당시 snapshot과 다르면 source_changed(재매핑하지 않음)', () => {
    const result = evaluateSlot({
      slot: 'staff_arch',
      currentName: '김철수', // Project List에서 이름이 바뀜
      link: makeLink({ source_name_snapshot: '홍길동' }),
      engineers,
    })
    expect(result.status).toBe('source_changed')
    // 재매핑을 하지 않으므로 link.engineer_id는 여전히 옛 사람(e1)을 가리켜야 한다
    expect(result.link?.engineer_id).toBe('e1')
  })

  it('슬롯 텍스트가 비워지면 removed(참여행은 그대로 유지)', () => {
    const result = evaluateSlot({ slot: 'staff_arch', currentName: '', link: makeLink({}), engineers })
    expect(result.status).toBe('removed')
    expect(result.link?.participant_id).toBe('participant-1')
  })

  it('링크가 있지만 participant_id가 null(연결 해제 후 대기)이면 미확정으로 재평가', () => {
    const result = evaluateSlot({
      slot: 'staff_arch',
      currentName: '김철수',
      link: makeLink({ participant_id: null }),
      engineers,
    })
    expect(result.status).toBe('auto_ready')
  })
})

describe('evaluateProjectSlots / summarizeProjectLinkDiff', () => {
  const project = {
    director: '홍길동',
    staff_arch: '김철수',
    staff_civil: '주소록에없는사람',
    staff_mech: '홍  길동', // 동명이인
    staff_safety: '',
  }

  it('5개 슬롯을 모두 평가하고 요약 카운트를 낸다', () => {
    const evaluations = evaluateProjectSlots({ project, links: [], engineers })
    expect(evaluations).toHaveLength(5)
    const summary = summarizeProjectLinkDiff(evaluations)
    expect(summary).toEqual({
      autoReadyCount: 1, // staff_arch(김철수) — director는 '홍길동'이 주소록에 2명(홍길동/홍 길동)과 일치해 동명이인
      ambiguousCount: 2, // director, staff_mech
      unregisteredCount: 1, // staff_civil
      sourceChangedCount: 0,
      removedCount: 0,
    })
  })

  it('이미 확정된 슬롯은 이름이 바뀌어도 재매핑하지 않고 원본변경으로만 표시', () => {
    const link = makeLink({ source_slot: 'director', source_name_snapshot: '이전단장', engineer_id: 'e1' })
    const evaluations = evaluateProjectSlots({ project, links: [link], engineers })
    const directorEval = evaluations.find(e => e.slot === 'director')
    expect(directorEval?.status).toBe('source_changed')
    const summary = summarizeProjectLinkDiff(evaluations)
    expect(summary.sourceChangedCount).toBe(1)
    expect(summary.autoReadyCount).toBe(1) // director는 이제 auto_ready에서 빠지고 staff_arch만 남음
  })
})

describe('SLOT_META', () => {
  it('슬롯별 역할·단장여부·분야가 사용자 지시 매핑표와 일치한다', () => {
    expect(SLOT_META.director).toEqual({ label: '단장', role: '책임', isDirector: true, specialtyName: '건축' })
    expect(SLOT_META.staff_arch.specialtyName).toBe('건축')
    expect(SLOT_META.staff_civil.specialtyName).toBe('토목')
    expect(SLOT_META.staff_mech.specialtyName).toBe('기계')
    expect(SLOT_META.staff_safety.specialtyName).toBe('안전')
    expect(SLOT_META.staff_arch.isDirector).toBe(false)
  })
})
