import { describe, expect, it } from 'vitest'
import { replacementStartDate, selectAutoSyncCandidates, type AutoSyncParticipant } from './autoSync'
import type { ProjectParticipantLink } from './types'

function makeProject(overrides: Partial<Parameters<typeof selectAutoSyncCandidates>[0]['projects'][0]> = {}) {
  return {
    id: 'p1',
    director: '',
    staff_arch: '',
    staff_civil: '',
    staff_mech: '',
    staff_safety: '',
    bid_date: null,
    status: '진행중',
    ...overrides,
  }
}

const engineers = [{ id: 'e1', name: '홍길동' }, { id: 'e2', name: '김철수' }]

describe('selectAutoSyncCandidates', () => {
  it('후보가 정확히 1명인 슬롯만 자동 반영 대상으로 고른다', () => {
    const candidates = selectAutoSyncCandidates({
      projects: [makeProject({ staff_arch: '김철수' })],
      links: [],
      participants: [],
      engineers,
      today: '2026-07-22',
    })
    expect(candidates).toHaveLength(1)
    expect(candidates[0].evaluation.slot).toBe('staff_arch')
    expect(candidates[0].evaluation.status).toBe('auto_ready')
  })

  it('동명이인·주소록미등록 슬롯은 대상에서 제외한다', () => {
    const candidates = selectAutoSyncCandidates({
      projects: [makeProject({ director: '홍길동', staff_arch: '주소록에없음', staff_civil: '홍  길동' })],
      links: [],
      participants: [],
      engineers: [...engineers, { id: 'e3', name: '홍 길동' }], // director는 홍길동/홍 길동 동명이인
      today: '2026-07-22',
    })
    expect(candidates).toHaveLength(0)
  })

  it('이미 확정된 슬롯(링크 있음)은 다시 대상에 포함하지 않는다', () => {
    const link: ProjectParticipantLink = {
      id: 'link-1', project_id: 'p1', source_slot: 'staff_arch', source_name_snapshot: '김철수',
      engineer_id: 'e2', participant_id: 'participant-1', link_status: '자동연결',
      created_at: '', updated_at: '',
    }
    const candidates = selectAutoSyncCandidates({
      projects: [makeProject({ staff_arch: '김철수' })],
      links: [link],
      participants: [],
      engineers,
      today: '2026-07-22',
    })
    expect(candidates).toHaveLength(0)
  })

  it('개찰일이 오늘보다 이전인 프로젝트는 완전히 제외한다', () => {
    const candidates = selectAutoSyncCandidates({
      projects: [makeProject({ staff_arch: '김철수', bid_date: '2026-07-01' })],
      links: [],
      participants: [],
      engineers,
      today: '2026-07-22',
    })
    expect(candidates).toHaveLength(0)
  })

  it('개찰일이 오늘이거나 이후인 프로젝트는 대상에 포함한다', () => {
    const candidates = selectAutoSyncCandidates({
      projects: [makeProject({ staff_arch: '김철수', bid_date: '2026-07-22' })],
      links: [],
      participants: [],
      engineers,
      today: '2026-07-22',
    })
    expect(candidates).toHaveLength(1)
  })

  it('취소된 프로젝트는 완전히 제외한다', () => {
    const candidates = selectAutoSyncCandidates({
      projects: [makeProject({ staff_arch: '김철수', status: '취소' })],
      links: [],
      participants: [],
      engineers,
      today: '2026-07-22',
    })
    expect(candidates).toHaveLength(0)
  })

  it('개찰일이 없으면(null) 진행 중인 것으로 보고 대상에 포함한다', () => {
    const candidates = selectAutoSyncCandidates({
      projects: [makeProject({ staff_arch: '김철수', bid_date: null })],
      links: [],
      participants: [],
      engineers,
      today: '2026-07-22',
    })
    expect(candidates).toHaveLength(1)
  })

  it('여러 프로젝트를 한꺼번에 처리한다', () => {
    const candidates = selectAutoSyncCandidates({
      projects: [
        makeProject({ id: 'p1', staff_arch: '김철수' }),
        makeProject({ id: 'p2', director: '홍길동' }),
      ],
      links: [],
      participants: [],
      engineers,
      today: '2026-07-22',
    })
    expect(candidates.map(c => c.projectId).sort()).toEqual(['p1', 'p2'])
  })

  describe('단장 이름이 바뀐 경우(원본변경)', () => {
    const directorLink: ProjectParticipantLink = {
      id: 'link-d', project_id: 'p1', source_slot: 'director', source_name_snapshot: '홍길동',
      engineer_id: 'e1', participant_id: 'dir-1', link_status: '자동연결',
      created_at: '', updated_at: '',
    }
    const activeDirector: AutoSyncParticipant = {
      id: 'dir-1', engineer_id: 'e1', role: '책임', specialty_id: null, is_director: true,
      participation_start: null, participation_end: null, status: '진행중',
    }

    it('새 이름의 후보가 1명이면 단장 교체 대상으로 고른다', () => {
      const candidates = selectAutoSyncCandidates({
        projects: [makeProject({ director: '김철수' })],
        links: [directorLink],
        participants: [activeDirector],
        engineers,
        today: '2026-07-22',
      })
      expect(candidates).toHaveLength(1)
      const c = candidates[0]
      expect(c.kind).toBe('replace_director')
      if (c.kind !== 'replace_director') return
      expect(c.newEngineerId).toBe('e2')
      expect(c.oldParticipant.id).toBe('dir-1')
    })

    it('표기만 바뀌고 같은 사람이면 교체하지 않고 이름만 갱신한다', () => {
      const candidates = selectAutoSyncCandidates({
        projects: [makeProject({ director: '홍 길동' })],
        links: [directorLink],
        participants: [activeDirector],
        engineers,
        today: '2026-07-22',
      })
      expect(candidates.map(c => c.kind)).toEqual(['refresh_snapshot'])
    })

    it('새 이름이 동명이인이거나 주소록에 없으면 건드리지 않는다', () => {
      for (const director of ['홍길동2', '김철수']) {
        const candidates = selectAutoSyncCandidates({
          projects: [makeProject({ director })],
          links: [directorLink],
          participants: [activeDirector],
          engineers: [...engineers, { id: 'e3', name: '김 철수' }],
          today: '2026-07-22',
        })
        expect(candidates).toHaveLength(0)
      }
    })

    it('연결된 참여행이 이미 종료됐으면 건드리지 않는다', () => {
      const candidates = selectAutoSyncCandidates({
        projects: [makeProject({ director: '김철수' })],
        links: [directorLink],
        participants: [{ ...activeDirector, status: '종료' }],
        engineers,
        today: '2026-07-22',
      })
      expect(candidates).toHaveLength(0)
    })

    it('단장이 아닌 슬롯의 원본변경은 자동 처리하지 않는다', () => {
      const archLink: ProjectParticipantLink = { ...directorLink, id: 'link-a', source_slot: 'staff_arch', participant_id: 'arch-1' }
      const candidates = selectAutoSyncCandidates({
        projects: [makeProject({ staff_arch: '김철수' })],
        links: [archLink],
        participants: [{ ...activeDirector, id: 'arch-1', is_director: false }],
        engineers,
        today: '2026-07-22',
      })
      expect(candidates).toHaveLength(0)
    })

    it('개찰일이 지난 프로젝트는 단장 교체도 하지 않는다', () => {
      const candidates = selectAutoSyncCandidates({
        projects: [makeProject({ director: '김철수', bid_date: '2026-07-01' })],
        links: [directorLink],
        participants: [activeDirector],
        engineers,
        today: '2026-07-22',
      })
      expect(candidates).toHaveLength(0)
    })
  })
})

describe('replacementStartDate', () => {
  const old: AutoSyncParticipant = {
    id: 'dir-1', engineer_id: 'e1', role: '책임', specialty_id: null, is_director: true,
    participation_start: '2026-07-01', participation_end: null, status: '진행중',
  }

  it('기존 단장 출근기록이 없으면 기존 시작일을 물려받는다', () => {
    expect(replacementStartDate(old, 0, '2026-07-22')).toBe('2026-07-01')
    expect(replacementStartDate({ ...old, participation_start: null }, 0, '2026-07-22')).toBeNull()
  })

  it('출근기록이 있으면 오늘부터 시작한다', () => {
    expect(replacementStartDate(old, 3, '2026-07-22')).toBe('2026-07-22')
  })
})
