import { describe, expect, it } from 'vitest'
import {
  ALL,
  EMPTY_FILTER,
  UNSET,
  UNSPECIFIED_NAME,
  buildFilterOptions,
  filterQuestions,
  hasActiveFilter,
  matchesQuestionFilter,
  questionYear,
  resolveUnspecifiedIds,
  splitUnspecifiedOption,
  type QuestionFilterState,
} from './questionFilters'
import type { QuestionWithReview } from './types'

function makeQuestion(overrides: {
  id?: string
  question_text?: string
  role_id?: string | null
  category_id?: string | null
  review_id?: string
  group_order?: number
  question_order?: number
  evaluationTypeId?: string | null
  client?: string
  facility?: string
  projectName?: string
  evaluationDate?: string | null
  /** review.evaluation_year_effective — 지정하지 않으면 evaluationDate의 연도에서 뽑는다. */
  yearEffective?: number | null
} = {}): QuestionWithReview {
  const reviewId = overrides.review_id ?? 'rev-1'
  const date = overrides.evaluationDate === undefined ? '2026-08-19' : overrides.evaluationDate
  const derivedYear = date ? parseInt(date.slice(0, 4), 10) : null
  return {
    id: overrides.id ?? 'q-1',
    review_id: reviewId,
    question_text: overrides.question_text ?? '작업계획서 대상과 포함되어야 할 내용은?',
    role_id: overrides.role_id === undefined ? 'group-safety' : overrides.role_id,
    category_id: overrides.category_id === undefined ? 'cat-safety' : overrides.category_id,
    specialty_id: null,
    group_order: overrides.group_order ?? 0,
    question_order: overrides.question_order ?? 0,
    created_at: '2026-08-19T00:00:00Z',
    updated_at: '2026-08-19T00:00:00Z',
    review: {
      id: reviewId,
      evaluation_type_id: overrides.evaluationTypeId === undefined ? 'type-interview' : overrides.evaluationTypeId,
      client_snapshot: overrides.client ?? '한국전력공사 경인건설본부 경기건설지사',
      project_name_snapshot: overrides.projectName ?? '154kV 당수변전소 토건공사 감독권한대행 등 건설사업관리용역',
      facility_type: overrides.facility ?? '변전소',
      evaluation_date: date,
      evaluation_year_effective: overrides.yearEffective === undefined ? derivedYear : overrides.yearEffective,
    },
  }
}

function filter(overrides: Partial<QuestionFilterState> = {}): QuestionFilterState {
  return { ...EMPTY_FILTER, ...overrides }
}

describe('전체검색', () => {
  const q = makeQuestion()

  it('질문 본문에서 찾는다', () => {
    expect(matchesQuestionFilter(q, filter({ search: '작업계획서' }))).toBe(true)
    expect(matchesQuestionFilter(q, filter({ search: '품질관리' }))).toBe(false)
  })

  it('용역명과 발주처에서도 찾는다', () => {
    expect(matchesQuestionFilter(q, filter({ search: '당수변전소' }))).toBe(true)
    expect(matchesQuestionFilter(q, filter({ search: '경기건설지사' }))).toBe(true)
  })

  it('대소문자를 구분하지 않는다', () => {
    const soq = makeQuestion({ question_text: 'SOQ 작성 기준은?' })
    expect(matchesQuestionFilter(soq, filter({ search: 'soq' }))).toBe(true)
  })

  it('앞뒤 공백만 입력하면 제한이 걸리지 않는다', () => {
    expect(matchesQuestionFilter(q, filter({ search: '   ' }))).toBe(true)
  })
})

describe('평가유형 필터', () => {
  it('선택한 평가유형의 질문만 남는다', () => {
    const tp = makeQuestion({ evaluationTypeId: 'type-tp' })
    const interview = makeQuestion({ evaluationTypeId: 'type-interview' })
    const f = filter({ evaluationTypeId: 'type-tp' })

    expect(matchesQuestionFilter(tp, f)).toBe(true)
    expect(matchesQuestionFilter(interview, f)).toBe(false)
  })

  it("'미지정'은 평가유형이 비어 있는 질문만 (legacy 평가자료 빈 행)", () => {
    const f = filter({ evaluationTypeId: UNSET })
    expect(matchesQuestionFilter(makeQuestion({ evaluationTypeId: null }), f)).toBe(true)
    expect(matchesQuestionFilter(makeQuestion({ evaluationTypeId: 'type-soq' }), f)).toBe(false)
  })

  it("'전체'는 평가유형이 없는 질문도 포함한다", () => {
    expect(matchesQuestionFilter(makeQuestion({ evaluationTypeId: null }), filter({ evaluationTypeId: ALL }))).toBe(true)
  })
})

describe('질의그룹 필터', () => {
  it('선택한 그룹의 질문만 남는다', () => {
    const f = filter({ groupId: 'group-lead' })
    expect(matchesQuestionFilter(makeQuestion({ role_id: 'group-lead' }), f)).toBe(true)
    expect(matchesQuestionFilter(makeQuestion({ role_id: 'group-safety' }), f)).toBe(false)
  })

  it("legacy '타사' 그룹도 다른 그룹과 똑같이 걸러진다", () => {
    const f = filter({ groupId: 'group-other-company' })
    expect(matchesQuestionFilter(makeQuestion({ role_id: 'group-other-company' }), f)).toBe(true)
    expect(matchesQuestionFilter(makeQuestion({ role_id: 'group-lead' }), f)).toBe(false)
  })

  it("'미지정'은 그룹이 비어 있는 질문만", () => {
    const f = filter({ groupId: UNSET })
    expect(matchesQuestionFilter(makeQuestion({ role_id: null }), f)).toBe(true)
    expect(matchesQuestionFilter(makeQuestion({ role_id: 'group-safety' }), f)).toBe(false)
  })
})

describe('질의분류 필터', () => {
  it('선택한 분류의 질문만 남는다', () => {
    const f = filter({ categoryId: 'cat-schedule' })
    expect(matchesQuestionFilter(makeQuestion({ category_id: 'cat-schedule' }), f)).toBe(true)
    expect(matchesQuestionFilter(makeQuestion({ category_id: 'cat-quality' }), f)).toBe(false)
  })

  it("'미지정'은 분류가 비어 있는 질문만 (legacy 질문 수용)", () => {
    const f = filter({ categoryId: UNSET })
    expect(matchesQuestionFilter(makeQuestion({ category_id: null }), f)).toBe(true)
    expect(matchesQuestionFilter(makeQuestion({ category_id: 'cat-quality' }), f)).toBe(false)
  })

  it("'전체'는 분류가 없는 질문도 포함한다", () => {
    expect(matchesQuestionFilter(makeQuestion({ category_id: null }), filter({ categoryId: ALL }))).toBe(true)
  })

  it('질의그룹과 질의분류는 서로 독립적인 축이다', () => {
    // 책임에게 나온 공정 질문 / 안전에게 나온 품질 질문
    const leadSchedule = makeQuestion({ role_id: 'group-lead', category_id: 'cat-schedule' })
    const safeQuality = makeQuestion({ role_id: 'group-safety', category_id: 'cat-quality' })

    expect(matchesQuestionFilter(leadSchedule, filter({ groupId: 'group-lead', categoryId: 'cat-schedule' }))).toBe(true)
    expect(matchesQuestionFilter(leadSchedule, filter({ groupId: 'group-lead', categoryId: 'cat-quality' }))).toBe(false)
    expect(matchesQuestionFilter(safeQuality, filter({ groupId: 'group-safety', categoryId: 'cat-quality' }))).toBe(true)
    expect(matchesQuestionFilter(safeQuality, filter({ groupId: 'group-lead', categoryId: 'cat-quality' }))).toBe(false)
  })
})

describe('발주처 필터 (부분일치)', () => {
  it('상위 기관명만 입력해도 산하 본부·지사 건이 잡힌다', () => {
    const kepco = makeQuestion({ client: '한국전력공사 경인건설본부 경기건설지사' })
    expect(matchesQuestionFilter(kepco, filter({ clientQuery: '한국전력공사' }))).toBe(true)
    expect(matchesQuestionFilter(kepco, filter({ clientQuery: '경인건설본부' }))).toBe(true)
  })

  it('다른 발주처는 걸러진다', () => {
    expect(matchesQuestionFilter(makeQuestion({ client: 'LH공사' }), filter({ clientQuery: '한국전력공사' }))).toBe(false)
  })
})

describe('시설용도 필터 (부분일치)', () => {
  it('선택한 용도가 포함되면 남는다', () => {
    expect(matchesQuestionFilter(makeQuestion({ facility: '변전소' }), filter({ facilityQuery: '변전소' }))).toBe(true)
  })

  it('한 칸에 여러 용도가 적힌 값도 잡힌다 (실제 자료의 "업무시설/노유자시설" 패턴)', () => {
    expect(matchesQuestionFilter(makeQuestion({ facility: '업무시설/노유자시설' }), filter({ facilityQuery: '노유자시설' }))).toBe(true)
  })

  it('해당 없는 용도는 걸러진다', () => {
    expect(matchesQuestionFilter(makeQuestion({ facility: '공동주택' }), filter({ facilityQuery: '변전소' }))).toBe(false)
  })
})

describe('연도 필터 — effective year 기준', () => {
  it('실제 평가일이 있는 기록은 그 날짜의 연도로 걸러진다', () => {
    const q2024 = makeQuestion({ evaluationDate: '2024-05-10' })
    expect(matchesQuestionFilter(q2024, filter({ yearFrom: '2024', yearTo: '2026' }))).toBe(true)
    expect(matchesQuestionFilter(q2024, filter({ yearFrom: '2025' }))).toBe(false)
  })

  it('연도만 아는 legacy 질문도 연도 필터에 걸린다 (가짜 날짜 없이)', () => {
    const legacy = makeQuestion({ evaluationDate: null, yearEffective: 2015 })
    expect(matchesQuestionFilter(legacy, filter({ yearFrom: '2015', yearTo: '2016' }))).toBe(true)
    expect(matchesQuestionFilter(legacy, filter({ yearFrom: '2024' }))).toBe(false)
    expect(questionYear(legacy)).toBe(2015)
  })

  it('한쪽만 지정하면 그 방향만 제한한다', () => {
    const q2020 = makeQuestion({ evaluationDate: '2020-01-01' })
    expect(matchesQuestionFilter(q2020, filter({ yearFrom: '2019' }))).toBe(true)
    expect(matchesQuestionFilter(q2020, filter({ yearTo: '2019' }))).toBe(false)
  })

  it('연도를 전혀 알 수 없는 질문은 연도 필터를 걸면 제외되고, 안 걸면 포함된다', () => {
    const unknown = makeQuestion({ evaluationDate: null, yearEffective: null })
    expect(matchesQuestionFilter(unknown, filter({ yearFrom: '2024' }))).toBe(false)
    expect(matchesQuestionFilter(unknown, filter())).toBe(true)
    expect(questionYear(unknown)).toBeNull()
  })
})

describe('여러 필터 동시 적용', () => {
  it('한국전력공사 + 변전소 + TP + 책임 + 공정 + 2022~2026 을 모두 만족해야 남는다', () => {
    const target = makeQuestion({
      id: 'hit',
      evaluationTypeId: 'type-tp',
      client: '한국전력공사 경인건설본부',
      facility: '변전소',
      role_id: 'group-lead',
      category_id: 'cat-schedule',
      evaluationDate: '2025-06-01',
    })
    const f = filter({
      evaluationTypeId: 'type-tp',
      clientQuery: '한국전력공사',
      facilityQuery: '변전소',
      groupId: 'group-lead',
      categoryId: 'cat-schedule',
      yearFrom: '2022',
      yearTo: '2026',
    })

    expect(matchesQuestionFilter(target, f)).toBe(true)

    // 조건 하나만 어긋나도 제외된다
    expect(matchesQuestionFilter({ ...target, role_id: 'group-safety' }, f)).toBe(false)
    expect(matchesQuestionFilter({ ...target, category_id: 'cat-quality' }, f)).toBe(false)
    expect(matchesQuestionFilter(
      { ...target, review: { ...target.review, evaluation_type_id: 'type-soq' } }, f,
    )).toBe(false)
    expect(matchesQuestionFilter(
      { ...target, review: { ...target.review, facility_type: '공동주택' } }, f,
    )).toBe(false)
    expect(matchesQuestionFilter(
      { ...target, review: { ...target.review, evaluation_year_effective: 2015 } }, f,
    )).toBe(false)
  })

  it('종심제 + 안전(그룹) + 최근 연도 조합도 동작한다', () => {
    const q = makeQuestion({
      evaluationTypeId: 'type-jongsimje',
      role_id: 'group-safety',
      evaluationDate: '2024-03-01',
    })
    const f = filter({ evaluationTypeId: 'type-jongsimje', groupId: 'group-safety', yearFrom: '2022' })
    expect(matchesQuestionFilter(q, f)).toBe(true)
    expect(matchesQuestionFilter({ ...q, role_id: 'group-arch' }, f)).toBe(false)
  })

  it('전체검색과 평가유형을 같이 쓸 수 있다', () => {
    const q = makeQuestion({ question_text: '혹서기 관리방안은?', evaluationTypeId: 'type-soq' })
    expect(matchesQuestionFilter(q, filter({ search: '혹서기', evaluationTypeId: 'type-soq' }))).toBe(true)
    expect(matchesQuestionFilter(q, filter({ search: '혹서기', evaluationTypeId: 'type-tp' }))).toBe(false)
  })
})

describe('filterQuestions — 정렬', () => {
  it('최근 연도가 먼저 오고, 연도 미상은 맨 뒤로 간다', () => {
    const questions = [
      makeQuestion({ id: 'old', evaluationDate: '2020-01-01' }),
      makeQuestion({ id: 'none', evaluationDate: null, yearEffective: null }),
      makeQuestion({ id: 'new', evaluationDate: '2026-08-19' }),
    ]
    expect(filterQuestions(questions, filter()).map(q => q.id)).toEqual(['new', 'old', 'none'])
  })

  it('legacy 연도-only 기록도 시간순 안에 섞여 정렬된다', () => {
    const questions = [
      makeQuestion({ id: 'legacy2015', evaluationDate: null, yearEffective: 2015 }),
      makeQuestion({ id: 'dated2020', evaluationDate: '2020-01-01' }),
      makeQuestion({ id: 'legacy2024', evaluationDate: null, yearEffective: 2024 }),
    ]
    expect(filterQuestions(questions, filter()).map(q => q.id)).toEqual(['legacy2024', 'dated2020', 'legacy2015'])
  })

  it('같은 연도면 정확한 날짜가 있는 쪽이 먼저 온다', () => {
    const questions = [
      makeQuestion({ id: 'yearonly', evaluationDate: null, yearEffective: 2024 }),
      makeQuestion({ id: 'dated', evaluationDate: '2024-07-01' }),
    ]
    expect(filterQuestions(questions, filter()).map(q => q.id)).toEqual(['dated', 'yearonly'])
  })

  it('같은 기록 안에서는 평가에서 나온 순서를 유지한다', () => {
    const questions = [
      makeQuestion({ id: 'q2', group_order: 0, question_order: 1 }),
      makeQuestion({ id: 'q1', group_order: 0, question_order: 0 }),
      makeQuestion({ id: 'q3', group_order: 1, question_order: 0 }),
    ]
    expect(filterQuestions(questions, filter()).map(q => q.id)).toEqual(['q1', 'q2', 'q3'])
  })

  it('원본 배열을 변형하지 않는다', () => {
    const questions = [
      makeQuestion({ id: 'a', evaluationDate: '2020-01-01' }),
      makeQuestion({ id: 'b', evaluationDate: '2026-01-01' }),
    ]
    filterQuestions(questions, filter())
    expect(questions.map(q => q.id)).toEqual(['a', 'b'])
  })
})

describe('hasActiveFilter', () => {
  it('아무 조건도 없으면 false', () => {
    expect(hasActiveFilter(EMPTY_FILTER)).toBe(false)
  })

  it('조건이 하나라도 있으면 true', () => {
    expect(hasActiveFilter(filter({ search: '공정' }))).toBe(true)
    expect(hasActiveFilter(filter({ evaluationTypeId: 'type-tp' }))).toBe(true)
    expect(hasActiveFilter(filter({ groupId: 'group-arch' }))).toBe(true)
    expect(hasActiveFilter(filter({ categoryId: 'cat-quality' }))).toBe(true)
    expect(hasActiveFilter(filter({ clientQuery: 'LH' }))).toBe(true)
    expect(hasActiveFilter(filter({ facilityQuery: '변전소' }))).toBe(true)
    expect(hasActiveFilter(filter({ yearFrom: '2024' }))).toBe(true)
    expect(hasActiveFilter(filter({ groupId: UNSET }))).toBe(true)
  })
})

describe('buildFilterOptions — 선택 후보를 데이터에서 뽑는다', () => {
  it('발주처·시설용도는 빈도 내림차순, 연도는 최신순', () => {
    const questions = [
      makeQuestion({ id: '1', client: 'LH공사', facility: '공동주택', evaluationDate: '2024-01-01' }),
      makeQuestion({ id: '2', client: 'LH공사', facility: '공동주택', evaluationDate: '2026-01-01' }),
      makeQuestion({ id: '3', client: '한국전력공사', facility: '변전소', evaluationDate: '2025-01-01' }),
    ]
    const options = buildFilterOptions(questions)
    expect(options.clients).toEqual(['LH공사', '한국전력공사'])
    expect(options.facilities).toEqual(['공동주택', '변전소'])
    expect(options.years).toEqual([2026, 2025, 2024])
  })

  it('legacy 연도-only 기록의 연도도 후보에 들어간다', () => {
    const questions = [
      makeQuestion({ id: '1', evaluationDate: null, yearEffective: 2015 }),
      makeQuestion({ id: '2', evaluationDate: '2026-01-01' }),
    ]
    expect(buildFilterOptions(questions).years).toEqual([2026, 2015])
  })

  it('빈 값과 연도 미상 건은 후보에서 빠진다', () => {
    const questions = [
      makeQuestion({ id: '1', client: '', facility: '   ', evaluationDate: null, yearEffective: null }),
      makeQuestion({ id: '2', client: '조달청', facility: '군시설', evaluationDate: '2023-01-01' }),
    ]
    const options = buildFilterOptions(questions)
    expect(options.clients).toEqual(['조달청'])
    expect(options.facilities).toEqual(['군시설'])
    expect(options.years).toEqual([2023])
  })
})

// ── 마스터의 `미지정` 과 사용자에게 보이는 `미지정` ──────────────────────────────
describe('splitUnspecifiedOption — 선택지 중복 제거', () => {
  const rows = [
    { id: 'c-quality', name: '품질' },
    { id: 'c-safety', name: '안전' },
    { id: 'c-unspec', name: UNSPECIFIED_NAME },
  ]

  it("마스터의 `미지정` 행은 선택지에서 뺀다 — 화면에는 `미지정`이 한 번만 보여야 한다", () => {
    const { options, unspecifiedId } = splitUnspecifiedOption(rows)
    expect(options.map(o => o.name)).toEqual(['품질', '안전'])
    expect(options.some(o => o.name === UNSPECIFIED_NAME)).toBe(false)
    expect(unspecifiedId).toBe('c-unspec')
  })

  it('마스터에 `미지정` 이 없으면 그대로 두고 id 는 null', () => {
    const { options, unspecifiedId } = splitUnspecifiedOption(rows.slice(0, 2))
    expect(options).toHaveLength(2)
    expect(unspecifiedId).toBeNull()
  })

  it('앞뒤 공백이 섞인 `미지정` 도 같은 값으로 본다', () => {
    expect(splitUnspecifiedOption([{ id: 'x', name: ' 미지정 ' }]).unspecifiedId).toBe('x')
  })

  it('원본 순서를 흐트러뜨리지 않는다', () => {
    const { options } = splitUnspecifiedOption([
      { id: 'a', name: '가' }, { id: 'u', name: UNSPECIFIED_NAME }, { id: 'b', name: '나' },
    ])
    expect(options.map(o => o.id)).toEqual(['a', 'b'])
  })

  it('resolveUnspecifiedIds 는 세 축을 각각 본다', () => {
    expect(resolveUnspecifiedIds(
      [{ id: 't-unspec', name: UNSPECIFIED_NAME }, { id: 't-soq', name: 'SOQ' }],
      [{ id: 'g-lead', name: '책임' }],
      [{ id: 'c-unspec', name: UNSPECIFIED_NAME }],
    )).toEqual({ evaluationTypeId: 't-unspec', groupId: null, categoryId: 'c-unspec' })
  })
})

describe("`미지정` 필터 = 마스터 미지정 행 + 값 없음", () => {
  const UNSPEC = { evaluationTypeId: 't-unspec', groupId: 'g-unspec', categoryId: 'c-unspec' }

  it('질의분류 — 마스터 미지정과 NULL 을 모두 찾는다', () => {
    const f = filter({ categoryId: UNSET })
    expect(matchesQuestionFilter(makeQuestion({ category_id: 'c-unspec' }), f, UNSPEC)).toBe(true)
    expect(matchesQuestionFilter(makeQuestion({ category_id: null }), f, UNSPEC)).toBe(true)
    expect(matchesQuestionFilter(makeQuestion({ category_id: 'cat-quality' }), f, UNSPEC)).toBe(false)
  })

  it('질의그룹 — 마스터 미지정과 NULL 을 모두 찾는다', () => {
    const f = filter({ groupId: UNSET })
    expect(matchesQuestionFilter(makeQuestion({ role_id: 'g-unspec' }), f, UNSPEC)).toBe(true)
    expect(matchesQuestionFilter(makeQuestion({ role_id: null }), f, UNSPEC)).toBe(true)
    expect(matchesQuestionFilter(makeQuestion({ role_id: 'group-lead' }), f, UNSPEC)).toBe(false)
  })

  it('평가유형 — 마스터 미지정과 NULL 을 모두 찾는다', () => {
    const f = filter({ evaluationTypeId: UNSET })
    expect(matchesQuestionFilter(makeQuestion({ evaluationTypeId: 't-unspec' }), f, UNSPEC)).toBe(true)
    expect(matchesQuestionFilter(makeQuestion({ evaluationTypeId: null }), f, UNSPEC)).toBe(true)
    expect(matchesQuestionFilter(makeQuestion({ evaluationTypeId: 'type-soq' }), f, UNSPEC)).toBe(false)
  })

  it('실제 마스터 항목을 고르면 미지정 행은 걸리지 않는다', () => {
    const f = filter({ categoryId: 'cat-quality' })
    expect(matchesQuestionFilter(makeQuestion({ category_id: 'cat-quality' }), f, UNSPEC)).toBe(true)
    expect(matchesQuestionFilter(makeQuestion({ category_id: 'c-unspec' }), f, UNSPEC)).toBe(false)
    expect(matchesQuestionFilter(makeQuestion({ category_id: null }), f, UNSPEC)).toBe(false)
  })

  it('`전체` 는 여전히 전부 포함', () => {
    const f = filter({ categoryId: ALL })
    expect(matchesQuestionFilter(makeQuestion({ category_id: 'c-unspec' }), f, UNSPEC)).toBe(true)
    expect(matchesQuestionFilter(makeQuestion({ category_id: null }), f, UNSPEC)).toBe(true)
  })

  it('마스터 id 를 넘기지 않으면 예전처럼 NULL 만 (회귀 방지 기준)', () => {
    const f = filter({ categoryId: UNSET })
    expect(matchesQuestionFilter(makeQuestion({ category_id: null }), f)).toBe(true)
    expect(matchesQuestionFilter(makeQuestion({ category_id: 'c-unspec' }), f)).toBe(false)
  })

  it('다른 축과 AND 로 묶인다', () => {
    const f = filter({ categoryId: UNSET, groupId: 'group-lead' })
    expect(matchesQuestionFilter(makeQuestion({ category_id: 'c-unspec', role_id: 'group-lead' }), f, UNSPEC)).toBe(true)
    expect(matchesQuestionFilter(makeQuestion({ category_id: 'c-unspec', role_id: 'group-safety' }), f, UNSPEC)).toBe(false)
  })

  it('filterQuestions 도 같은 의미로 거른다', () => {
    const list = [
      makeQuestion({ id: 'a', category_id: 'c-unspec' }),
      makeQuestion({ id: 'b', category_id: null }),
      makeQuestion({ id: 'c', category_id: 'cat-quality' }),
    ]
    expect(filterQuestions(list, filter({ categoryId: UNSET }), UNSPEC).map(q => q.id).sort())
      .toEqual(['a', 'b'])
  })
})
