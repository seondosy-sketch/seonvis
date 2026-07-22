import { describe, expect, it } from 'vitest'
import { selectAutoSyncCandidates } from './autoSync'
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
      engineers,
      today: '2026-07-22',
    })
    expect(candidates).toHaveLength(0)
  })

  it('개찰일이 오늘보다 이전인 프로젝트는 완전히 제외한다', () => {
    const candidates = selectAutoSyncCandidates({
      projects: [makeProject({ staff_arch: '김철수', bid_date: '2026-07-01' })],
      links: [],
      engineers,
      today: '2026-07-22',
    })
    expect(candidates).toHaveLength(0)
  })

  it('개찰일이 오늘이거나 이후인 프로젝트는 대상에 포함한다', () => {
    const candidates = selectAutoSyncCandidates({
      projects: [makeProject({ staff_arch: '김철수', bid_date: '2026-07-22' })],
      links: [],
      engineers,
      today: '2026-07-22',
    })
    expect(candidates).toHaveLength(1)
  })

  it('취소된 프로젝트는 완전히 제외한다', () => {
    const candidates = selectAutoSyncCandidates({
      projects: [makeProject({ staff_arch: '김철수', status: '취소' })],
      links: [],
      engineers,
      today: '2026-07-22',
    })
    expect(candidates).toHaveLength(0)
  })

  it('개찰일이 없으면(null) 진행 중인 것으로 보고 대상에 포함한다', () => {
    const candidates = selectAutoSyncCandidates({
      projects: [makeProject({ staff_arch: '김철수', bid_date: null })],
      links: [],
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
      engineers,
      today: '2026-07-22',
    })
    expect(candidates.map(c => c.projectId).sort()).toEqual(['p1', 'p2'])
  })
})
