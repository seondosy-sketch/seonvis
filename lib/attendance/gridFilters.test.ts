import { describe, expect, it } from 'vitest'
import {
  attendanceRecordErrorMessage,
  filterParticipantRows,
  filterVisibleProjects,
  projectOverlapsPeriod,
  type ProjectForGridFilter,
} from './gridFilters'
import type { ProjectParticipant } from './types'

const periodStart = '2026-07-21'
const periodEnd = '2026-08-20'

function makeProject(overrides: Partial<ProjectForGridFilter> = {}): ProjectForGridFilter {
  return {
    id: 'proj-1', project_number: 'A001', name: '테스트프로젝트',
    announce_date: '2026-06-01', interview_date: '2026-08-10', status: '진행중',
    ...overrides,
  }
}

function makeParticipant(overrides: Partial<ProjectParticipant> = {}): ProjectParticipant {
  return {
    id: 'part-1', project_id: 'proj-1', engineer_id: 'eng-1', role: '단장', specialty_id: 'spec-1',
    is_director: true, participation_start: '2026-06-01', participation_end: null,
    status: '진행중', sort_order: 0, created_at: '2026-06-01T00:00:00Z', updated_at: '2026-06-01T00:00:00Z',
    ...overrides,
  }
}

describe('projectOverlapsPeriod', () => {
  it('공고일~면접일이 기간과 겹치면 true', () => {
    expect(projectOverlapsPeriod(makeProject(), periodStart, periodEnd)).toBe(true)
  })

  it('공고일이 기간 종료 이후면 false', () => {
    expect(projectOverlapsPeriod(makeProject({ announce_date: '2026-09-01' }), periodStart, periodEnd)).toBe(false)
  })

  it('면접일이 기간 시작 이전이면 false', () => {
    expect(projectOverlapsPeriod(makeProject({ interview_date: '2026-07-01' }), periodStart, periodEnd)).toBe(false)
  })

  it('면접일이 없으면 공고일만으로 계속 겹치는 것으로 본다', () => {
    expect(projectOverlapsPeriod(makeProject({ interview_date: null }), periodStart, periodEnd)).toBe(true)
  })

  it('공고일이 없으면 false', () => {
    expect(projectOverlapsPeriod(makeProject({ announce_date: null }), periodStart, periodEnd)).toBe(false)
  })
})

describe('filterParticipantRows — 기술인/분야 필터', () => {
  const specialtyNameById = new Map([['spec-arch', '건축'], ['spec-civil', '토목']])
  const engineerNameById = new Map([['eng-1', '김민준'], ['eng-2', '박서준']])

  it('기술인 검색어로 참여자를 필터링한다', () => {
    const participants = [
      makeParticipant({ id: 'p1', engineer_id: 'eng-1' }),
      makeParticipant({ id: 'p2', engineer_id: 'eng-2' }),
    ]
    const result = filterParticipantRows({
      participants, projectId: 'proj-1', recordedParticipantIds: new Set(),
      specialtyFilter: '전체', specialtyNameById, engineerSearch: '민준', engineerNameById,
    })
    expect(result.map(p => p.id)).toEqual(['p1'])
  })

  it('분야 필터로 참여자를 걸러낸다', () => {
    const participants = [
      makeParticipant({ id: 'p1', specialty_id: 'spec-arch' }),
      makeParticipant({ id: 'p2', specialty_id: 'spec-civil' }),
    ]
    const result = filterParticipantRows({
      participants, projectId: 'proj-1', recordedParticipantIds: new Set(),
      specialtyFilter: '토목', specialtyNameById, engineerSearch: '', engineerNameById,
    })
    expect(result.map(p => p.id)).toEqual(['p2'])
  })

  it('참여기술인이 없으면 빈 배열을 반환한다(참여기술인 없음 상태)', () => {
    const result = filterParticipantRows({
      participants: [], projectId: 'proj-1', recordedParticipantIds: new Set(),
      specialtyFilter: '전체', specialtyNameById, engineerSearch: '', engineerNameById,
    })
    expect(result).toEqual([])
  })

  it('단장 교체 시나리오: 종료된 기존 단장도 이 기간 기록이 있으면 행으로 유지되고, 신규 단장과 함께 표시된다', () => {
    const participants = [
      makeParticipant({ id: 'old-director', engineer_id: 'eng-1', status: '종료', participation_end: '2026-08-05' }),
      makeParticipant({ id: 'new-director', engineer_id: 'eng-2', status: '진행중', participation_start: '2026-08-06' }),
    ]
    // old-director는 종료됐지만 이 기간에 출근기록이 있다(recordedParticipantIds에 포함)
    const result = filterParticipantRows({
      participants, projectId: 'proj-1', recordedParticipantIds: new Set(['old-director']),
      specialtyFilter: '전체', specialtyNameById, engineerSearch: '', engineerNameById,
    })
    expect(result.map(p => p.id).sort()).toEqual(['new-director', 'old-director'])
  })

  it('종료됐고 이 기간 기록도 없는 참여자는 행에서 빠진다', () => {
    const participants = [makeParticipant({ id: 'old', status: '종료' })]
    const result = filterParticipantRows({
      participants, projectId: 'proj-1', recordedParticipantIds: new Set(),
      specialtyFilter: '전체', specialtyNameById, engineerSearch: '', engineerNameById,
    })
    expect(result).toEqual([])
  })
})

describe('filterVisibleProjects — 프로젝트 필터', () => {
  const baseInput = {
    projects: [makeProject()],
    periodStart, periodEnd,
    statusFilter: '전체',
    search: '',
    projectIdsWithActiveParticipants: new Set<string>(),
    projectIdsWithRecords: new Set<string>(),
    rowParticipantCount: () => 1,
    hasParticipantFilter: false,
  }

  it('기본적으로 기간과 겹치는 프로젝트를 보여준다', () => {
    expect(filterVisibleProjects(baseInput)).toHaveLength(1)
  })

  it('상태 필터에 맞지 않으면 제외한다', () => {
    const result = filterVisibleProjects({ ...baseInput, statusFilter: '수주' })
    expect(result).toHaveLength(0)
  })

  it('프로젝트명/번호 검색어로 필터링한다', () => {
    expect(filterVisibleProjects({ ...baseInput, search: '테스트' })).toHaveLength(1)
    expect(filterVisibleProjects({ ...baseInput, search: 'A001' })).toHaveLength(1)
    expect(filterVisibleProjects({ ...baseInput, search: '없는프로젝트' })).toHaveLength(0)
  })

  it('기간과 안 겹쳐도 활성 참여자나 이 기간 기록이 있으면 보여준다', () => {
    const outOfPeriod = makeProject({ announce_date: '2026-01-01', interview_date: '2026-02-01' })
    expect(filterVisibleProjects({ ...baseInput, projects: [outOfPeriod] })).toHaveLength(0)
    expect(filterVisibleProjects({
      ...baseInput, projects: [outOfPeriod], projectIdsWithActiveParticipants: new Set([outOfPeriod.id]),
    })).toHaveLength(1)
  })

  it('기술인/분야 필터가 걸려 있는데 참여자 행이 0건이면 프로젝트 자체를 숨긴다', () => {
    const result = filterVisibleProjects({ ...baseInput, hasParticipantFilter: true, rowParticipantCount: () => 0 })
    expect(result).toHaveLength(0)
  })
})

describe('attendanceRecordErrorMessage', () => {
  it('삭제 실패는 항상 동일한 안내 문구', () => {
    expect(attendanceRecordErrorMessage('delete', undefined)).toBe('출근 체크 해제에 실패했습니다.')
  })

  it('저장 실패 중 유니크 위반(23505)은 "이미 저장된 출근기록" 문구', () => {
    expect(attendanceRecordErrorMessage('insert', '23505')).toBe('이미 저장된 출근기록입니다.')
  })

  it('그 외 저장 실패는 일반 실패 문구', () => {
    expect(attendanceRecordErrorMessage('insert', 'other')).toBe('출근 체크 저장에 실패했습니다.')
  })
})
