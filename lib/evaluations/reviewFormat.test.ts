import { describe, expect, it } from 'vitest'
import {
  formatAttendees,
  formatEvaluationDateTime,
  formatEvaluationType,
  formatEvaluatorCount,
  formatParticipantCompanies,
  searchReviews,
  sortReviewsByDateDesc,
} from './reviewFormat'
import type { EvaluationAttendee, ReviewListItem } from './types'

function makeAttendee(overrides: Partial<EvaluationAttendee> = {}): EvaluationAttendee {
  return {
    id: 'att-1',
    review_id: 'rev-1',
    engineer_contact_id: null,
    attendee_name_snapshot: '홍길동',
    attendee_role: '단장',
    sort_order: 0,
    created_at: '2026-08-19T00:00:00Z',
    ...overrides,
  }
}

function makeReview(overrides: Partial<ReviewListItem> = {}): ReviewListItem {
  const base: ReviewListItem = {
    id: 'rev-1',
    project_id: 'proj-1',
    evaluation_type_id: 'type-interview',
    evaluation_type_source: '',
    client_snapshot: '한국전력공사 경인건설본부 경기건설지사',
    project_name_snapshot: '154kV 당수변전소 토건공사 감독권한대행 등 건설사업관리용역',
    facility_type: '변전소',
    evaluation_date: '2026-08-19',
    evaluation_year: null,
    evaluation_year_effective: 2026,
    evaluation_time: '13:30~',
    location: '경기건설지사 5층 안전상황실',
    evaluator_count: 5,
    participant_company_count: 7,
    presentation_order: 1,
    participant_companies: 'A사, B사, C사, D사, E사, F사, G사',
    evaluation_method: 'PT 발표 후 기술인별 질의응답',
    special_notes: '',
    created_by: 'a@seon.co.kr',
    updated_by: 'a@seon.co.kr',
    created_at: '2026-08-19T00:00:00Z',
    updated_at: '2026-08-19T00:00:00Z',
    attendees: [],
    question_count: 4,
  }
  return { ...base, ...overrides }
}

const TYPE_NAMES = new Map([
  ['type-interview', '면접'],
  ['type-soq', 'SOQ'],
  ['type-tp', 'TP'],
])

describe('formatEvaluationDateTime', () => {
  it('날짜와 시각을 붙여 적는다 (원본 문서 표기 유지)', () => {
    expect(formatEvaluationDateTime({ evaluation_date: '2026-08-19', evaluation_year: null, evaluation_time: '13:30~' }))
      .toBe('2026-08-19 13:30~')
  })

  it('시각이 없으면 날짜만', () => {
    expect(formatEvaluationDateTime({ evaluation_date: '2026-08-19', evaluation_year: null, evaluation_time: '' })).toBe('2026-08-19')
    expect(formatEvaluationDateTime({ evaluation_date: '2026-08-19', evaluation_year: null, evaluation_time: '   ' })).toBe('2026-08-19')
  })

  it('연도만 아는 legacy 기록은 "2015년"으로 적는다 (가짜 월/일을 만들지 않는다)', () => {
    expect(formatEvaluationDateTime({ evaluation_date: null, evaluation_year: 2015, evaluation_time: '' })).toBe('2015년')
    expect(formatEvaluationDateTime({ evaluation_date: null, evaluation_year: 2015, evaluation_time: '14:00' })).toBe('2015년 14:00')
  })

  it('날짜·연도가 없고 시각만 있으면 시각만', () => {
    expect(formatEvaluationDateTime({ evaluation_date: null, evaluation_year: null, evaluation_time: '13:30~' })).toBe('13:30~')
  })

  it('아무것도 없으면 - 로 표시한다', () => {
    expect(formatEvaluationDateTime({ evaluation_date: null, evaluation_year: null, evaluation_time: '' })).toBe('-')
  })
})

describe('formatEvaluationType', () => {
  it('마스터에 연결돼 있으면 그 이름을 쓴다', () => {
    expect(formatEvaluationType({ evaluation_type_id: 'type-tp', evaluation_type_source: '' }, TYPE_NAMES)).toBe('TP')
  })

  it('표준 매핑이 안 된 legacy 원문만 있으면 원문을 그대로 보여준다', () => {
    expect(formatEvaluationType({ evaluation_type_id: null, evaluation_type_source: '기술자평가서/PPT' }, TYPE_NAMES))
      .toBe('기술자평가서/PPT')
  })

  it('둘 다 없으면 미지정', () => {
    expect(formatEvaluationType({ evaluation_type_id: null, evaluation_type_source: '  ' }, TYPE_NAMES)).toBe('미지정')
  })

  it('마스터에서 사라진 id면 원문으로 대체하고, 원문도 없으면 미지정', () => {
    expect(formatEvaluationType({ evaluation_type_id: 'type-gone', evaluation_type_source: 'SOQ\n종심제' }, TYPE_NAMES))
      .toBe('SOQ\n종심제')
    expect(formatEvaluationType({ evaluation_type_id: 'type-gone', evaluation_type_source: '' }, TYPE_NAMES)).toBe('미지정')
  })
})

describe('formatAttendees', () => {
  it('이름(역할) 형태로 sort_order 순서대로 잇는다', () => {
    const attendees = [
      makeAttendee({ id: 'a3', attendee_name_snapshot: '이영희 차장', attendee_role: '수행', sort_order: 20 }),
      makeAttendee({ id: 'a1', attendee_name_snapshot: '홍길동', attendee_role: '단장', sort_order: 0 }),
      makeAttendee({ id: 'a2', attendee_name_snapshot: '김철수', attendee_role: '안전', sort_order: 10 }),
    ]
    expect(formatAttendees(attendees)).toBe('홍길동(단장), 김철수(안전), 이영희 차장(수행)')
  })

  it('역할이 비어 있으면 이름만 적는다', () => {
    expect(formatAttendees([makeAttendee({ attendee_role: '' })])).toBe('홍길동')
  })

  it('참석자가 없으면 - 로 표시한다', () => {
    expect(formatAttendees([])).toBe('-')
  })
})

describe('formatParticipantCompanies', () => {
  it('개수·순서·업체명을 원본 표기대로 조합한다', () => {
    expect(formatParticipantCompanies({
      participant_company_count: 7, presentation_order: 1, participant_companies: 'A사, B사, C사',
    })).toBe('7개 중 1번째 (A사, B사, C사)')
  })

  it('개수만 / 순서만 / 업체명만 있는 경우', () => {
    expect(formatParticipantCompanies({ participant_company_count: 7, presentation_order: null, participant_companies: '' })).toBe('7개')
    expect(formatParticipantCompanies({ participant_company_count: null, presentation_order: 3, participant_companies: '' })).toBe('3번째')
    expect(formatParticipantCompanies({ participant_company_count: null, presentation_order: null, participant_companies: 'A사, B사' })).toBe('A사, B사')
  })

  it('아무것도 없으면 - 로 표시한다', () => {
    expect(formatParticipantCompanies({ participant_company_count: null, presentation_order: null, participant_companies: '' })).toBe('-')
  })
})

describe('formatEvaluatorCount', () => {
  it('명수를 인 단위로 적는다', () => {
    expect(formatEvaluatorCount(5)).toBe('5인')
  })

  it('값이 없으면 - 로 표시한다', () => {
    expect(formatEvaluatorCount(null)).toBe('-')
  })
})

describe('searchReviews', () => {
  const reviews = [
    makeReview({ id: 'kepco' }),
    makeReview({
      id: 'lh',
      client_snapshot: 'LH공사',
      project_name_snapshot: '행복주택 건설사업관리용역',
      facility_type: '공동주택',
      attendees: [makeAttendee({ attendee_name_snapshot: '박민수' })],
    }),
  ]

  it('용역명 / 발주처 / 시설용도 / 참석자 이름으로 찾는다', () => {
    expect(searchReviews(reviews, '당수변전소').map(r => r.id)).toEqual(['kepco'])
    expect(searchReviews(reviews, 'LH').map(r => r.id)).toEqual(['lh'])
    expect(searchReviews(reviews, '공동주택').map(r => r.id)).toEqual(['lh'])
    expect(searchReviews(reviews, '박민수').map(r => r.id)).toEqual(['lh'])
  })

  it('검색어가 없으면 전체를 돌려준다', () => {
    expect(searchReviews(reviews, '   ')).toHaveLength(2)
  })
})

describe('sortReviewsByDateDesc', () => {
  it('최근 평가가 먼저 오고 연도 미상은 맨 뒤로 간다', () => {
    const reviews = [
      makeReview({ id: 'old', evaluation_date: '2024-01-01', evaluation_year_effective: 2024 }),
      makeReview({ id: 'none', evaluation_date: null, evaluation_year: null, evaluation_year_effective: null }),
      makeReview({ id: 'new', evaluation_date: '2026-08-19', evaluation_year_effective: 2026 }),
    ]
    expect(sortReviewsByDateDesc(reviews).map(r => r.id)).toEqual(['new', 'old', 'none'])
  })

  it('legacy 연도-only 기록도 시간순 안에 섞여 정렬된다', () => {
    const reviews = [
      makeReview({ id: 'legacy2015', evaluation_date: null, evaluation_year: 2015, evaluation_year_effective: 2015 }),
      makeReview({ id: 'dated2020', evaluation_date: '2020-01-01', evaluation_year_effective: 2020 }),
      makeReview({ id: 'legacy2024', evaluation_date: null, evaluation_year: 2024, evaluation_year_effective: 2024 }),
    ]
    expect(sortReviewsByDateDesc(reviews).map(r => r.id)).toEqual(['legacy2024', 'dated2020', 'legacy2015'])
  })

  it('같은 연도면 정확한 날짜가 있는 쪽이 먼저', () => {
    const reviews = [
      makeReview({ id: 'yearonly', evaluation_date: null, evaluation_year: 2024, evaluation_year_effective: 2024 }),
      makeReview({ id: 'dated', evaluation_date: '2024-07-01', evaluation_year_effective: 2024 }),
    ]
    expect(sortReviewsByDateDesc(reviews).map(r => r.id)).toEqual(['dated', 'yearonly'])
  })

  it('연도·날짜가 같으면 최근 등록이 먼저', () => {
    const reviews = [
      makeReview({ id: 'first', created_at: '2026-08-19T01:00:00Z' }),
      makeReview({ id: 'second', created_at: '2026-08-19T09:00:00Z' }),
    ]
    expect(sortReviewsByDateDesc(reviews).map(r => r.id)).toEqual(['second', 'first'])
  })

  it('원본 배열을 변형하지 않는다', () => {
    const reviews = [
      makeReview({ id: 'a', evaluation_date: '2024-01-01', evaluation_year_effective: 2024 }),
      makeReview({ id: 'b', evaluation_date: '2026-01-01', evaluation_year_effective: 2026 }),
    ]
    sortReviewsByDateDesc(reviews)
    expect(reviews.map(r => r.id)).toEqual(['a', 'b'])
  })
})
