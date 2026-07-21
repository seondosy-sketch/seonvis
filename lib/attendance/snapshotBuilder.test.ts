import { describe, expect, it } from 'vitest'
import {
  assertNoDuplicateSnapshotKeys,
  buildAttendanceDatesForSnapshot,
  buildSnapshotRow,
} from './snapshotBuilder'
import type { ProjectParticipant } from './types'

const periodStart = '2026-07-21'
const periodEnd = '2026-08-20'

function makeParticipant(overrides: Partial<ProjectParticipant> = {}): ProjectParticipant {
  return {
    id: 'part-1', project_id: 'proj-1', engineer_id: 'eng-1', role: '단장', specialty_id: 'spec-1',
    is_director: true, participation_start: '2026-06-01', participation_end: null,
    status: '진행중', sort_order: 0, created_at: '2026-06-01T00:00:00Z', updated_at: '2026-06-01T00:00:00Z',
    ...overrides,
  }
}

describe('buildAttendanceDatesForSnapshot', () => {
  it('중복 날짜는 조용히 제거하고 정렬해 반환한다', () => {
    const result = buildAttendanceDatesForSnapshot(
      ['2026-08-01', '2026-07-25', '2026-08-01'], periodStart, periodEnd,
    )
    expect(result).toEqual(['2026-07-25', '2026-08-01'])
  })

  it('마감기간 밖 날짜가 있으면 예외를 던진다(조용히 걸러내지 않음)', () => {
    expect(() =>
      buildAttendanceDatesForSnapshot(['2026-07-21', '2026-09-01'], periodStart, periodEnd),
    ).toThrow(/마감기간/)
  })

  it('경계값(시작일·종료일 자체)은 정상 포함된다', () => {
    const result = buildAttendanceDatesForSnapshot([periodStart, periodEnd], periodStart, periodEnd)
    expect(result).toEqual([periodStart, periodEnd])
  })
})

describe('buildSnapshotRow', () => {
  it('present_count는 항상 attendance_dates 배열 길이와 일치한다', () => {
    const row = buildSnapshotRow({
      closureId: 'closure-1', projectId: 'proj-1', projectName: '테스트프로젝트',
      participant: makeParticipant(), engineerName: '김민준', specialtyName: '건축',
      rawAttendanceDates: ['2026-08-01', '2026-08-02', '2026-08-01'], // 중복 포함
      periodStart, periodEnd, noteSnapshot: '',
    })
    expect(row.present_count).toBe(row.attendance_dates.length)
    expect(row.present_count).toBe(2)
  })

  it('프로젝트명·성명 등은 값으로 복사되어, 원본 객체를 나중에 바꿔도 스냅샷은 변하지 않는다 (Project List 수정 후 과거 스냅샷 불변)', () => {
    const participant = makeParticipant()
    const projectName = '테스트프로젝트'
    const row = buildSnapshotRow({
      closureId: 'closure-1', projectId: 'proj-1', projectName,
      participant, engineerName: '김민준', specialtyName: '건축',
      rawAttendanceDates: ['2026-08-01'], periodStart, periodEnd, noteSnapshot: '',
    })
    // "Project List 수정"을 시뮬레이션 — 원본 참여자/프로젝트명을 나중에 바꿔본다
    participant.role = '팀원(수정됨)'
    const mutatedProjectName = projectName + '(변경됨)'

    expect(row.role_snapshot).toBe('단장') // 원본이 바뀌어도 스냅샷은 그대로
    expect(row.project_name_snapshot).toBe('테스트프로젝트')
    expect(row.project_name_snapshot).not.toBe(mutatedProjectName)
  })
})

describe('assertNoDuplicateSnapshotKeys — 단장 교체 시나리오 (사용자 검토 지시 #4)', () => {
  it('같은 프로젝트라도 참여자(participant_id)가 다르면(단장 교체) 여러 스냅샷 행이 허용된다', () => {
    const oldDirector = buildSnapshotRow({
      closureId: 'closure-1', projectId: 'proj-1', projectName: '테스트프로젝트B',
      participant: makeParticipant({ id: 'part-old', engineer_id: 'eng-old' }),
      engineerName: '박서준', specialtyName: '건축',
      rawAttendanceDates: ['2026-07-25'], periodStart, periodEnd, noteSnapshot: '',
    })
    const newDirector = buildSnapshotRow({
      closureId: 'closure-1', projectId: 'proj-1', projectName: '테스트프로젝트B',
      participant: makeParticipant({ id: 'part-new', engineer_id: 'eng-new' }),
      engineerName: '이도윤', specialtyName: '건축',
      rawAttendanceDates: ['2026-08-10'], periodStart, periodEnd, noteSnapshot: '08.05 단장 박서준 → 이도윤 변경',
    })
    // 기존 단장과 신규 단장이 같은 월에 모두 출근 기록이 있어도(서로 다른 participant_id) 문제없다
    expect(() => assertNoDuplicateSnapshotKeys([oldDirector, newDirector])).not.toThrow()
    expect(oldDirector.participant_id).not.toBe(newDirector.participant_id)
  })

  it('같은 참여자(participant_id)의 스냅샷 행이 중복되면 예외를 던진다', () => {
    const participant = makeParticipant()
    const row1 = buildSnapshotRow({
      closureId: 'closure-1', projectId: 'proj-1', projectName: 'X',
      participant, engineerName: '김민준', specialtyName: '건축',
      rawAttendanceDates: ['2026-08-01'], periodStart, periodEnd, noteSnapshot: '',
    })
    const row2 = { ...row1 } // 같은 closure_id + participant_id로 실수로 두 번 생성된 상황을 재현
    expect(() => assertNoDuplicateSnapshotKeys([row1, row2])).toThrow(/중복/)
  })
})
