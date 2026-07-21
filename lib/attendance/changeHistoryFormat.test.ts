import { describe, expect, it } from 'vitest'
import { formatChangeHistoryForPeriod } from './changeHistoryFormat'
import type { ProjectChangeHistory } from './types'

function makeHistory(overrides: Partial<ProjectChangeHistory>): ProjectChangeHistory {
  return {
    id: 'h', project_id: 'proj-1', change_type: 'other', change_date: '2026-03-14',
    before_value: null, after_value: null, memo: '', created_by: 'a@seon.co.kr', created_at: '2026-03-14T00:00:00Z',
    ...overrides,
  }
}

describe('formatChangeHistoryForPeriod — 마스터 프롬프트 예시 포맷 재현', () => {
  it('director_change: "03.14 단장 홍길동 → 김철수 변경"', () => {
    const history = [makeHistory({
      change_type: 'director_change', change_date: '2026-03-14', before_value: '홍길동', after_value: '김철수',
    })]
    expect(formatChangeHistoryForPeriod(history, '2026-01-01', '2026-12-31')).toEqual([
      '03.14 단장 홍길동 → 김철수 변경',
    ])
  })

  it('cancelled: "05.02 공고 취소"', () => {
    const history = [makeHistory({ change_type: 'cancelled', change_date: '2026-05-02' })]
    expect(formatChangeHistoryForPeriod(history, '2026-01-01', '2026-12-31')).toEqual(['05.02 공고 취소'])
  })

  it('reannounced: "05.20 재공고"', () => {
    const history = [makeHistory({ change_type: 'reannounced', change_date: '2026-05-20' })]
    expect(formatChangeHistoryForPeriod(history, '2026-01-01', '2026-12-31')).toEqual(['05.20 재공고'])
  })

  it('interview_date_change: "06.04 면접일 06.10 → 06.17 변경"', () => {
    const history = [makeHistory({
      change_type: 'interview_date_change', change_date: '2026-06-04',
      before_value: '2026-06-10', after_value: '2026-06-17',
    })]
    expect(formatChangeHistoryForPeriod(history, '2026-01-01', '2026-12-31')).toEqual([
      '06.04 면접일 06.10 → 06.17 변경',
    ])
  })

  it('여러 건은 발생일자순으로 정렬된다(입력 순서와 무관)', () => {
    const history = [
      makeHistory({ change_type: 'reannounced', change_date: '2026-05-20' }),
      makeHistory({ change_type: 'cancelled', change_date: '2026-05-02' }),
      makeHistory({
        change_type: 'director_change', change_date: '2026-03-14', before_value: '홍길동', after_value: '김철수',
      }),
    ]
    expect(formatChangeHistoryForPeriod(history, '2026-01-01', '2026-12-31')).toEqual([
      '03.14 단장 홍길동 → 김철수 변경',
      '05.02 공고 취소',
      '05.20 재공고',
    ])
  })

  it('기간 밖 이력은 제외한다', () => {
    const history = [
      makeHistory({ change_type: 'cancelled', change_date: '2026-05-02' }),
      makeHistory({ change_type: 'reannounced', change_date: '2026-09-01' }),
    ]
    expect(formatChangeHistoryForPeriod(history, '2026-07-21', '2026-08-20')).toEqual([])
  })

  it('projectId를 넘기면 그 프로젝트로 한정한다', () => {
    const history = [
      makeHistory({ project_id: 'proj-1', change_type: 'cancelled', change_date: '2026-05-02' }),
      makeHistory({ project_id: 'proj-2', change_type: 'reannounced', change_date: '2026-05-03' }),
    ]
    expect(formatChangeHistoryForPeriod(history, '2026-01-01', '2026-12-31', 'proj-1')).toEqual([
      '05.02 공고 취소',
    ])
  })
})
