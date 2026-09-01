import { describe, expect, it } from 'vitest'
import {
  applyProjectDates,
  dedupePerformingByName,
  keepYear,
  type ProjectDateSource,
} from './performingCalendar'
import type { PerformingProject } from '@/lib/supabase'

function makeRow(overrides: Partial<PerformingProject> = {}): PerformingProject {
  return {
    status: '진행중',
    name: '테스트사업',
    director: '홍길동',
    submit_date: '추후',
    interview_date: '추후',
    result_date: '추후',
    fee: null,
    note: '',
    sort_order: 0,
    week: '2026-W35',
    ...overrides,
  }
}

describe('keepYear', () => {
  it('값이 있으면 연도가 살아 있는 문자열을 그대로 돌려준다', () => {
    expect(keepYear('2025-11-25')).toBe('2025-11-25')
  })

  it('비었거나 공백뿐이면 추후로 본다', () => {
    expect(keepYear(null)).toBe('추후')
    expect(keepYear('')).toBe('추후')
    expect(keepYear('   ')).toBe('추후')
  })
})

describe('applyProjectDates', () => {
  it('Project List 날짜가 스냅샷 날짜를 덮어쓴다', () => {
    const rows = [makeRow({ submit_date: '11/25', interview_date: '12/01', result_date: '12/10' })]
    const projByName = new Map<string, ProjectDateSource>([
      ['테스트사업', { submit_date: '2026-08-25', interview_date: '2026-09-01', bid_date: '2026-09-10' }],
    ])
    expect(applyProjectDates(rows, projByName)[0]).toMatchObject({
      submit_date: '2026-08-25',
      interview_date: '2026-09-01',
      result_date: '2026-09-10',
    })
  })

  it('Project List에 없는 수동 추가 행은 저장된 날짜를 그대로 쓴다', () => {
    const rows = [makeRow({ name: '수동추가건', submit_date: '11/25' })]
    expect(applyProjectDates(rows, new Map())[0]).toMatchObject({ submit_date: '11/25', interview_date: '추후' })
  })

  it('Project List 날짜가 비어 있으면 추후로 둔다', () => {
    const rows = [makeRow({ submit_date: '11/25' })]
    const projByName = new Map<string, ProjectDateSource>([['테스트사업', { submit_date: null, bid_date: null }]])
    // submit_date가 null이면 ?? 로 스냅샷 값으로 떨어지고, 아예 없는 interview_date는 추후가 된다
    expect(applyProjectDates(rows, projByName)[0]).toMatchObject({ submit_date: '11/25', result_date: '추후' })
  })
})

describe('dedupePerformingByName', () => {
  it('여러 주차에 걸친 같은 사업을 한 행으로 접는다', () => {
    const rows = [
      makeRow({ week: '2026-W33' }),
      makeRow({ week: '2026-W34' }),
      makeRow({ week: '2026-W35' }),
    ]
    expect(dedupePerformingByName(rows)).toHaveLength(1)
  })

  it('가장 최근 주차의 행을 남긴다', () => {
    const rows = [
      makeRow({ week: '2026-W33', note: '오래된 비고' }),
      makeRow({ week: '2026-W35', note: '최신 비고' }),
      makeRow({ week: '2026-W34', note: '중간 비고' }),
    ]
    expect(dedupePerformingByName(rows)[0].note).toBe('최신 비고')
  })

  it('주차가 해를 넘어가도 사전순 비교로 최신을 고른다', () => {
    const rows = [
      makeRow({ week: '2026-W52', note: '작년' }),
      makeRow({ week: '2027-W01', note: '올해' }),
    ]
    expect(dedupePerformingByName(rows)[0].note).toBe('올해')
  })

  it('주차 번호가 한 자리여도 0으로 채워져 있어 순서가 뒤집히지 않는다', () => {
    const rows = [
      makeRow({ week: '2026-W09', note: '9주차' }),
      makeRow({ week: '2026-W10', note: '10주차' }),
    ]
    expect(dedupePerformingByName(rows)[0].note).toBe('10주차')
  })

  it('다른 사업은 그대로 남기고 처음 나온 순서를 유지한다', () => {
    const rows = [
      makeRow({ name: '가사업', week: '2026-W33' }),
      makeRow({ name: '나사업', week: '2026-W33' }),
      makeRow({ name: '가사업', week: '2026-W35' }),
    ]
    expect(dedupePerformingByName(rows).map(r => r.name)).toEqual(['가사업', '나사업'])
  })

  it('이름이 빈 행은 버린다', () => {
    expect(dedupePerformingByName([makeRow({ name: '' })])).toEqual([])
  })
})
