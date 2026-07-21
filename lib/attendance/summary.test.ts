import { describe, expect, it } from 'vitest'
import { findRecord, isPresent, presentCountByParticipant, presentDatesByParticipant } from './summary'
import type { AttendanceRecord } from './types'

function makeRecord(overrides: Partial<AttendanceRecord> = {}): AttendanceRecord {
  return {
    id: 'r1', project_id: 'proj-1', engineer_id: 'eng-1', participant_id: 'part-1',
    work_date: '2026-08-01', status: 'present', created_by: 'a@seon.co.kr', updated_by: 'a@seon.co.kr',
    created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z', note: '',
    ...overrides,
  }
}

describe('presentCountByParticipant — 출근일수 합계', () => {
  it('참여자별 출근기록 건수를 센다', () => {
    const records = [
      makeRecord({ participant_id: 'p1', work_date: '2026-08-01' }),
      makeRecord({ participant_id: 'p1', work_date: '2026-08-02' }),
      makeRecord({ participant_id: 'p2', work_date: '2026-08-01' }),
    ]
    const result = presentCountByParticipant(records)
    expect(result.get('p1')).toBe(2)
    expect(result.get('p2')).toBe(1)
  })

  it('기록이 없는 참여자는 결과 맵에 없다(0이 아니라 undefined — 호출부가 ?? 0으로 처리)', () => {
    const result = presentCountByParticipant([])
    expect(result.get('p1')).toBeUndefined()
  })
})

describe('presentDatesByParticipant', () => {
  it('참여자별 출근 날짜 집합을 만든다', () => {
    const records = [
      makeRecord({ participant_id: 'p1', work_date: '2026-08-01' }),
      makeRecord({ participant_id: 'p1', work_date: '2026-08-02' }),
    ]
    const result = presentDatesByParticipant(records)
    expect(result.get('p1')?.has('2026-08-01')).toBe(true)
    expect(result.get('p1')?.has('2026-08-02')).toBe(true)
    expect(result.get('p1')?.has('2026-08-03')).toBe(false)
  })
})

describe('isPresent / findRecord', () => {
  it('출근기록이 있으면 true, 없으면 false', () => {
    const records = [makeRecord({ participant_id: 'p1', work_date: '2026-08-01' })]
    expect(isPresent(records, 'p1', '2026-08-01')).toBe(true)
    expect(isPresent(records, 'p1', '2026-08-02')).toBe(false)
    expect(isPresent(records, 'p2', '2026-08-01')).toBe(false)
  })

  it('findRecord는 정확히 그 행(id 포함)을 반환한다 — 체크 해제 시 정확한 행을 지목하기 위함', () => {
    const records = [makeRecord({ id: 'rec-123', participant_id: 'p1', work_date: '2026-08-01' })]
    expect(findRecord(records, 'p1', '2026-08-01')?.id).toBe('rec-123')
    expect(findRecord(records, 'p1', '2026-08-02')).toBeUndefined()
  })
})
