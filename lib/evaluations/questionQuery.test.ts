import { describe, expect, it } from 'vitest'
import {
  QUESTION_ORDER,
  QUESTION_PAGE_SIZE,
  QUESTION_SEARCH_COLUMNS,
  buildFilterOptionsFromFacets,
  buildQuestionQueryPlan,
  clampPage,
  ilikePattern,
  quoteOrValue,
  searchOrExpression,
  toQuestionWithReview,
  totalPages,
  type QuestionQueryFilter,
  type QuestionSearchRow,
} from './questionQuery'
import {
  ALL,
  EMPTY_FILTER,
  NO_UNSPECIFIED_IDS,
  UNSET,
  filterQuestions,
  type QuestionFilterState,
  type UnspecifiedIds,
} from './questionFilters'
import { PRIVATE_LEGACY_MAX_YEAR, isPrivateLegacyYear, publicOnlyOrExpression } from './privateLegacy'

function filter(overrides: Partial<QuestionFilterState> = {}): QuestionFilterState {
  return { ...EMPTY_FILTER, ...overrides }
}

/** 조건 하나를 찾기 쉽게 — 계획의 filters는 순서를 계약하지 않는다. */
function find(filters: QuestionQueryFilter[], column: string) {
  return filters.filter(f => f.column === column)
}

/**
 * 기본으로 항상 붙는 조건 — 2020년 이하 개인 비공개 자료를 뺀다.
 * 아래 테스트들이 "필터가 없으면 조건도 없다"를 확인할 때 이 한 칸은 남아 있어야 한다.
 */
const PUBLIC_ONLY: QuestionQueryFilter = {
  op: 'gtOrNull', column: 'evaluation_year_effective', value: 2020,
}

describe('ilikePattern — 사용자 입력을 리터럴 부분일치로', () => {
  it('앞뒤에 와일드카드를 붙인다', () => {
    expect(ilikePattern('민원')).toBe('%민원%')
  })

  it('ILIKE 와일드카드를 이스케이프해서 리터럴로 만든다', () => {
    // 사용자가 "50%"를 찾으면 "50" 뒤에 아무 문자열이 아니라 진짜 % 를 찾아야 한다.
    expect(ilikePattern('50%')).toBe('%50\\%%')
    expect(ilikePattern('a_b')).toBe('%a\\_b%')
    expect(ilikePattern('c\\d')).toBe('%c\\\\d%')
  })

  it('빈 문자열도 안전하다', () => {
    expect(ilikePattern('')).toBe('%%')
  })
})

describe('quoteOrValue — or=(...) 값 문법', () => {
  it('값을 큰따옴표로 감싼다(쉼표·괄호·점이 논리식 문법과 충돌하므로)', () => {
    expect(quoteOrValue('%민원%')).toBe('"%민원%"')
    expect(quoteOrValue('%a,b%')).toBe('"%a,b%"')
    expect(quoteOrValue('%(x).y%')).toBe('"%(x).y%"')
  })

  it('따옴표와 역슬래시를 이스케이프한다', () => {
    expect(quoteOrValue('%a"b%')).toBe('"%a\\"b%"')
    expect(quoteOrValue('%a\\b%')).toBe('"%a\\\\b%"')
  })
})

describe('searchOrExpression — 전체검색', () => {
  it('질문 본문·용역명·발주처·시설용도를 OR로 훑는다', () => {
    expect(QUESTION_SEARCH_COLUMNS).toEqual([
      'question_text', 'project_name_snapshot', 'client_snapshot', 'facility_type',
    ])
    expect(searchOrExpression('민원')).toBe(
      'question_text.ilike."%민원%",'
      + 'project_name_snapshot.ilike."%민원%",'
      + 'client_snapshot.ilike."%민원%",'
      + 'facility_type.ilike."%민원%"',
    )
  })

  it('특수문자가 든 검색어도 논리식을 깨지 않는다', () => {
    const expr = searchOrExpression('a,b')
    // 쉼표는 값 안에서 따옴표로 보호되고, 컬럼 구분 쉼표는 4개(=컬럼 4개) 그대로다.
    expect(expr.split('.ilike.').length - 1).toBe(4)
    expect(expr).toContain('"%a,b%"')
  })
})

describe('buildQuestionQueryPlan — 필터를 DB 조건으로', () => {
  it('필터가 없으면 조건도 없다', () => {
    const plan = buildQuestionQueryPlan(EMPTY_FILTER, 1)
    expect(plan.or).toBeNull()
    expect(plan.filters).toEqual([PUBLIC_ONLY])
    expect(plan.from).toBe(0)
    expect(plan.to).toBe(QUESTION_PAGE_SIZE - 1)
  })

  it("'전체'는 조건을 만들지 않는다", () => {
    const plan = buildQuestionQueryPlan(
      filter({ evaluationTypeId: ALL, groupId: ALL, categoryId: ALL }), 1)
    expect(plan.filters).toEqual([PUBLIC_ONLY])
  })

  it("마스터에 '미지정' 행이 없으면 '미지정'은 IS NULL 로만 간다", () => {
    const plan = buildQuestionQueryPlan(
      filter({ evaluationTypeId: UNSET, groupId: UNSET, categoryId: UNSET }), 1)
    expect(find(plan.filters, 'evaluation_type_id')).toEqual([{ op: 'isNull', column: 'evaluation_type_id' }])
    expect(find(plan.filters, 'role_id')).toEqual([{ op: 'isNull', column: 'role_id' }])
    expect(find(plan.filters, 'category_id')).toEqual([{ op: 'isNull', column: 'category_id' }])
  })

  it("마스터 '미지정' id 를 주면 그 행과 NULL 을 함께 찾는다", () => {
    // 화면에는 `미지정`이 한 칸만 있고, 그 한 칸이 두 상태를 모두 가리켜야 한다.
    // 한쪽만 찾으면 나머지 데이터가 검색에서 사라진다(운영 DB는 대부분 마스터 미지정 쪽이다).
    const plan = buildQuestionQueryPlan(
      filter({ evaluationTypeId: UNSET, groupId: UNSET, categoryId: UNSET }), 1, QUESTION_PAGE_SIZE,
      { evaluationTypeId: 't-unspec', groupId: 'g-unspec', categoryId: 'c-unspec' })
    expect(find(plan.filters, 'evaluation_type_id')).toEqual([{ op: 'eqOrNull', column: 'evaluation_type_id', value: 't-unspec' }])
    expect(find(plan.filters, 'role_id')).toEqual([{ op: 'eqOrNull', column: 'role_id', value: 'g-unspec' }])
    expect(find(plan.filters, 'category_id')).toEqual([{ op: 'eqOrNull', column: 'category_id', value: 'c-unspec' }])
  })

  it("축마다 따로 판단한다 — 마스터 '미지정'이 있는 축만 eqOrNull", () => {
    const plan = buildQuestionQueryPlan(
      filter({ groupId: UNSET, categoryId: UNSET }), 1, QUESTION_PAGE_SIZE,
      { evaluationTypeId: null, groupId: 'g-unspec', categoryId: null })
    expect(find(plan.filters, 'role_id')).toEqual([{ op: 'eqOrNull', column: 'role_id', value: 'g-unspec' }])
    expect(find(plan.filters, 'category_id')).toEqual([{ op: 'isNull', column: 'category_id' }])
  })

  it("'미지정' 이 아닌 선택은 마스터 id 를 줘도 eq 그대로", () => {
    const plan = buildQuestionQueryPlan(
      filter({ categoryId: 'c-safety' }), 1, QUESTION_PAGE_SIZE,
      { evaluationTypeId: null, groupId: null, categoryId: 'c-unspec' })
    expect(find(plan.filters, 'category_id')).toEqual([{ op: 'eq', column: 'category_id', value: 'c-safety' }])
  })

  it('id 를 고르면 eq 조건', () => {
    const plan = buildQuestionQueryPlan(
      filter({ evaluationTypeId: 'type-tp', groupId: 'group-lead', categoryId: 'cat-safety' }), 1)
    expect(find(plan.filters, 'evaluation_type_id')).toEqual([{ op: 'eq', column: 'evaluation_type_id', value: 'type-tp' }])
    expect(find(plan.filters, 'role_id')).toEqual([{ op: 'eq', column: 'role_id', value: 'group-lead' }])
    expect(find(plan.filters, 'category_id')).toEqual([{ op: 'eq', column: 'category_id', value: 'cat-safety' }])
  })

  it('발주처·시설용도는 부분일치(ilike) — 계층 문자열을 앞부분만으로 잡기 위해', () => {
    const plan = buildQuestionQueryPlan(
      filter({ clientQuery: ' 한국전력공사 ', facilityQuery: '변전소' }), 1)
    expect(find(plan.filters, 'client_snapshot')).toEqual([
      { op: 'ilike', column: 'client_snapshot', pattern: '%한국전력공사%' },
    ])
    expect(find(plan.filters, 'facility_type')).toEqual([
      { op: 'ilike', column: 'facility_type', pattern: '%변전소%' },
    ])
  })

  it('공백만 입력한 칸은 조건이 되지 않는다', () => {
    const plan = buildQuestionQueryPlan(filter({ search: '   ', clientQuery: '  ', facilityQuery: ' ' }), 1)
    expect(plan.or).toBeNull()
    expect(plan.filters).toEqual([PUBLIC_ONLY])
  })

  it('연도 범위는 evaluation_year_effective 에만 걸린다', () => {
    const plan = buildQuestionQueryPlan(filter({ yearFrom: '2020', yearTo: '2026' }), 1)
    expect(plan.filters).toEqual([
      PUBLIC_ONLY,
      { op: 'gte', column: 'evaluation_year_effective', value: 2020 },
      { op: 'lte', column: 'evaluation_year_effective', value: 2026 },
    ])
  })

  it('연도는 한쪽만 지정할 수 있다', () => {
    expect(buildQuestionQueryPlan(filter({ yearFrom: '2024' }), 1).filters)
      .toEqual([PUBLIC_ONLY, { op: 'gte', column: 'evaluation_year_effective', value: 2024 }])
    expect(buildQuestionQueryPlan(filter({ yearTo: '2019' }), 1).filters)
      .toEqual([PUBLIC_ONLY, { op: 'lte', column: 'evaluation_year_effective', value: 2019 }])
  })

  it('복합필터를 모두 AND 로 싣는다 (발주처+시설용도+질의그룹+연도범위)', () => {
    const plan = buildQuestionQueryPlan(filter({
      clientQuery: '한국전력공사', facilityQuery: '변전소',
      groupId: 'group-lead', yearFrom: '2020', yearTo: '2026',
    }), 1)
    expect(plan.filters).toHaveLength(6)
    expect(plan.filters.map(f => f.op).sort())
      .toEqual(['eq', 'gtOrNull', 'gte', 'ilike', 'ilike', 'lte'])
  })

  it('전체검색은 or 표현식으로 간다', () => {
    const plan = buildQuestionQueryPlan(filter({ search: '민원' }), 1)
    expect(plan.or).toBe(searchOrExpression('민원'))
  })

  it('정렬은 항상 결정적이다 — 마지막 키가 유일값 id', () => {
    const plan = buildQuestionQueryPlan(EMPTY_FILTER, 3)
    expect(plan.order).toBe(QUESTION_ORDER)
    expect(plan.order.map(k => k.column)).toEqual([
      'evaluation_year_effective', 'evaluation_date', 'review_id',
      'group_order', 'question_order', 'id',
    ])
    // 연도·평가일이 없는 행은 뒤로 (기존 화면 정렬과 같다)
    expect(plan.order[0]).toEqual({ column: 'evaluation_year_effective', ascending: false, nullsFirst: false })
    expect(plan.order[5]).toEqual({ column: 'id', ascending: true, nullsFirst: false })
  })

  it('페이지 번호를 range 로 바꾼다', () => {
    expect(buildQuestionQueryPlan(EMPTY_FILTER, 1, 100)).toMatchObject({ from: 0, to: 99 })
    expect(buildQuestionQueryPlan(EMPTY_FILTER, 2, 100)).toMatchObject({ from: 100, to: 199 })
    expect(buildQuestionQueryPlan(EMPTY_FILTER, 12, 100)).toMatchObject({ from: 1100, to: 1199 })
  })

  it('잘못된 페이지 번호는 1페이지로 본다', () => {
    for (const page of [0, -3, Number.NaN]) {
      expect(buildQuestionQueryPlan(EMPTY_FILTER, page, 100)).toMatchObject({ from: 0, to: 99 })
    }
  })
})

describe('개인 비공개 자료(2020년 이하) 가리기', () => {
  it('기본은 가리는 쪽이다 — 아무 것도 안 넘기면 공개분 조건이 붙는다', () => {
    // 기본값이 "포함"이면 실수로 켜졌을 때 개인자료가 화면에 뜬다. 안전한 쪽을 기본으로 둔다.
    expect(buildQuestionQueryPlan(EMPTY_FILTER, 1).filters).toContainEqual(PUBLIC_ONLY)
  })

  it('포함으로 켜면 그 조건이 사라진다', () => {
    const plan = buildQuestionQueryPlan(EMPTY_FILTER, 1, QUESTION_PAGE_SIZE, NO_UNSPECIFIED_IDS, true)
    expect(plan.filters).toEqual([])
  })

  it('경계는 2020/2021 — 2020은 비공개, 2021은 공개', () => {
    expect(PRIVATE_LEGACY_MAX_YEAR).toBe(2020)
    expect(isPrivateLegacyYear(2020)).toBe(true)
    expect(isPrivateLegacyYear(2021)).toBe(false)
    expect(isPrivateLegacyYear(1999)).toBe(true)
  })

  it('연도 미상(NULL)은 공개로 본다 — 평가일 없이 저장한 신규 후기가 여기 들어온다', () => {
    // 비공개로 두면 사용자가 방금 쓴 자기 후기를 못 보게 된다. 이관 자료에는 NULL이 없다.
    expect(isPrivateLegacyYear(null)).toBe(false)
    expect(isPrivateLegacyYear(undefined)).toBe(false)
    expect(publicOnlyOrExpression()).toBe(
      'evaluation_year_effective.gt.2020,evaluation_year_effective.is.null')
  })

  it('사용자가 고른 연도 범위와 함께 걸려도 서로 지우지 않는다 (AND)', () => {
    // 소유자가 토글을 끈 채 2015~2026을 고르면 결과는 2021~2026이어야 한다.
    const plan = buildQuestionQueryPlan(filter({ yearFrom: '2015', yearTo: '2026' }), 1)
    expect(plan.filters).toContainEqual(PUBLIC_ONLY)
    expect(plan.filters).toContainEqual({ op: 'gte', column: 'evaluation_year_effective', value: 2015 })
  })

  it('연도 후보에서도 비공개 연도를 뺀다 — 고를 수 없는 연도가 목록에 남으면 안 된다', () => {
    const facets = [
      { facet: 'year', value: '2026', question_count: 10 },
      { facet: 'year', value: '2021', question_count: 5 },
      { facet: 'year', value: '2020', question_count: 7 },
      { facet: 'year', value: '2015', question_count: 3 },
    ]
    expect(buildFilterOptionsFromFacets(facets).years).toEqual([2026, 2021])
    expect(buildFilterOptionsFromFacets(facets, true).years).toEqual([2026, 2021, 2020, 2015])
  })
})

describe('totalPages / clampPage', () => {
  it('1,119건을 100개씩 나누면 12페이지', () => {
    expect(totalPages(1119, 100)).toBe(12)
  })

  it('딱 나누어떨어지면 페이지를 더 만들지 않는다', () => {
    expect(totalPages(1000, 100)).toBe(10)
    expect(totalPages(1100, 100)).toBe(11)
  })

  it('결과가 0건이어도 1페이지 (화면에 "1 / 1"을 보여준다)', () => {
    expect(totalPages(0, 100)).toBe(1)
  })

  it('범위를 벗어난 페이지는 마지막 페이지로 당긴다', () => {
    expect(clampPage(12, 1119, 100)).toBe(12)
    expect(clampPage(13, 1119, 100)).toBe(12)
    expect(clampPage(99, 250, 100)).toBe(3)
    expect(clampPage(5, 0, 100)).toBe(1)
    expect(clampPage(0, 1119, 100)).toBe(1)
  })
})

describe('buildFilterOptionsFromFacets — 후보는 전체 데이터 기준', () => {
  const facets = [
    { facet: 'client', value: '한국전력공사', question_count: 120 },
    { facet: 'client', value: 'LH공사', question_count: 300 },
    { facet: 'client', value: '가나시청', question_count: 120 },
    { facet: 'facility', value: '변전소', question_count: 88 },
    { facet: 'facility', value: '공동주택', question_count: 275 },
    { facet: 'year', value: '2015', question_count: 40 },
    { facet: 'year', value: '2026', question_count: 10 },
    { facet: 'year', value: '2020', question_count: 90 },
  ]

  it('발주처·시설용도는 빈도 내림차순(동수면 이름순)', () => {
    const options = buildFilterOptionsFromFacets(facets)
    expect(options.clients).toEqual(['LH공사', '가나시청', '한국전력공사'])
    expect(options.facilities).toEqual(['공동주택', '변전소'])
  })

  it('연도는 숫자 내림차순', () => {
    // 정렬만 보는 테스트라 개인 비공개 연도까지 포함해서 확인한다(가리기는 전용 테스트에서).
    expect(buildFilterOptionsFromFacets(facets, true).years).toEqual([2026, 2020, 2015])
  })

  it('빈 값은 후보에서 뺀다', () => {
    const options = buildFilterOptionsFromFacets([
      { facet: 'client', value: '   ', question_count: 5 },
      { facet: 'facility', value: '', question_count: 3 },
    ])
    expect(options.clients).toEqual([])
    expect(options.facilities).toEqual([])
  })

  it('결과가 없어도 빈 목록을 준다', () => {
    expect(buildFilterOptionsFromFacets([])).toEqual({ clients: [], facilities: [], years: [] })
  })

  it('앞뒤 공백만 다른 값은 하나로 합친다(실제 데이터에 그런 값이 있다)', () => {
    const options = buildFilterOptionsFromFacets([
      { facet: 'facility', value: ' 교육연구시설', question_count: 1 },
      { facet: 'facility', value: '교육연구시설', question_count: 4 },
      { facet: 'facility', value: '변전소', question_count: 3 },
    ])
    // 1 + 4 = 5 로 합쳐져 변전소(3)보다 앞선다.
    expect(options.facilities).toEqual(['교육연구시설', '변전소'])
  })
})

// ── view 행 ↔ 화면 모양 ────────────────────────────────────────────────────────

function row(overrides: Partial<QuestionSearchRow> = {}): QuestionSearchRow {
  return {
    id: 'q1',
    review_id: 'r1',
    question_text: '민원 관리방안을 설명하시오',
    role_id: 'group-lead',
    category_id: 'cat-complaint',
    specialty_id: null,
    group_order: 0,
    question_order: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    evaluation_type_id: 'type-interview',
    client_snapshot: '한국전력공사 경인건설본부',
    project_name_snapshot: '당수변전소 건설공사',
    facility_type: '변전소',
    evaluation_date: '2026-03-04',
    evaluation_year_effective: 2026,
    ...overrides,
  }
}

describe('toQuestionWithReview — 평평한 view 행을 화면 모양으로', () => {
  it('질문 컬럼과 기록 컬럼을 나눈다', () => {
    const q = toQuestionWithReview(row())
    expect(q.id).toBe('q1')
    expect(q.role_id).toBe('group-lead')
    expect(q.review).toEqual({
      id: 'r1',
      evaluation_type_id: 'type-interview',
      client_snapshot: '한국전력공사 경인건설본부',
      project_name_snapshot: '당수변전소 건설공사',
      facility_type: '변전소',
      evaluation_date: '2026-03-04',
      evaluation_year_effective: 2026,
    })
  })

  it('review.id 는 review_id 와 같다', () => {
    const q = toQuestionWithReview(row({ review_id: 'r-legacy' }))
    expect(q.review.id).toBe(q.review_id)
  })

  it('연도만 아는 legacy 행도 그대로 옮긴다', () => {
    const q = toQuestionWithReview(row({ evaluation_date: null, evaluation_year_effective: 2015 }))
    expect(q.review.evaluation_date).toBeNull()
    expect(q.review.evaluation_year_effective).toBe(2015)
  })
})

// ── oracle 교차검증 ───────────────────────────────────────────────────────────
// questionFilters.ts(순수 client-side 필터)는 이제 조회 경로가 아니지만 "검색 의미의 기준"으로
// 남겨 두었다. 여기서는 계획(plan)을 Postgres 의미대로 메모리에서 해석해 두 결과가 같은지 본다.
// 조건 번역이 틀리면(컬럼 오타, 누락, IS NULL 대신 eq 등) 여기서 걸린다.
// ⚠ 전체검색 or 문자열 자체는 위에서 따로 단위검증했다 — 여기서는 같은 의미(4컬럼 부분일치)로 본다.

function ilikeToRegExp(pattern: string): RegExp {
  let out = ''
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i]
    if (ch === '\\') { out += pattern[i + 1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); i += 1; continue }
    if (ch === '%') { out += '.*'; continue }
    if (ch === '_') { out += '.'; continue }
    out += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${out}$`, 'i')
}

function applyPlanInMemory(
  rows: QuestionSearchRow[],
  f: QuestionFilterState,
  unspecified: UnspecifiedIds = NO_UNSPECIFIED_IDS,
): QuestionSearchRow[] {
  // includePrivateLegacy = true — 개인자료 가리기는 questionFilters.ts 의 검색 의미가 아니므로
  // oracle 비교에서는 빼 둔다(그 조건은 privateLegacy 전용 테스트에서 따로 확인한다).
  const plan = buildQuestionQueryPlan(f, 1, rows.length || 1, unspecified, true)
  const search = f.search.trim()

  const kept = rows.filter(r => {
    if (search) {
      const hit = QUESTION_SEARCH_COLUMNS.some(c =>
        ilikeToRegExp(ilikePattern(search)).test(String(r[c as keyof QuestionSearchRow] ?? '')))
      if (!hit) return false
    }
    return plan.filters.every(filterItem => {
      const value = r[filterItem.column as keyof QuestionSearchRow]
      switch (filterItem.op) {
        case 'isNull': return value === null
        case 'eq': return value === filterItem.value
        // or=(col.eq.<id>,col.is.null) — 마스터 미지정 행 또는 값 없음
        case 'eqOrNull': return value === null || value === filterItem.value
        // or=(col.gt.N,col.is.null) — 공개분만(연도 미상 포함)
        case 'gtOrNull': return value === null || (typeof value === 'number' && value > filterItem.value)
        case 'ilike': return value !== null && ilikeToRegExp(filterItem.pattern).test(String(value))
        // SQL 은 NULL 비교가 참이 되지 않는다 — 연도를 모르는 행은 자동으로 빠진다.
        case 'gte': return typeof value === 'number' && value >= filterItem.value
        case 'lte': return typeof value === 'number' && value <= filterItem.value
      }
    })
  })

  const nullsLast = (a: number | string | null, b: number | string | null, desc: boolean) => {
    if (a === null && b === null) return 0
    if (a === null) return 1
    if (b === null) return -1
    if (a === b) return 0
    return (a < b ? -1 : 1) * (desc ? -1 : 1)
  }
  return kept.sort((a, b) =>
    nullsLast(a.evaluation_year_effective, b.evaluation_year_effective, true)
    || nullsLast(a.evaluation_date, b.evaluation_date, true)
    || nullsLast(a.review_id, b.review_id, false)
    || a.group_order - b.group_order
    || a.question_order - b.question_order
    || nullsLast(a.id, b.id, false))
}

describe('서버측 계획 ↔ client-side 필터(oracle) 결과 일치', () => {
  const rows: QuestionSearchRow[] = [
    row({ id: 'a', review_id: 'r1', question_text: '민원 관리방안', role_id: 'g-lead', category_id: 'c-complaint', evaluation_type_id: 't-interview', client_snapshot: '한국전력공사 경인건설본부', facility_type: '변전소', evaluation_date: '2026-03-04', evaluation_year_effective: 2026, group_order: 0, question_order: 0 }),
    row({ id: 'b', review_id: 'r1', question_text: '안전관리 중점사항', role_id: 'g-safety', category_id: 'c-safety', evaluation_type_id: 't-interview', client_snapshot: '한국전력공사 경인건설본부', facility_type: '변전소', evaluation_date: '2026-03-04', evaluation_year_effective: 2026, group_order: 1, question_order: 0 }),
    row({ id: 'c', review_id: 'r2', question_text: '공정관리 방안', role_id: null, category_id: null, evaluation_type_id: null, client_snapshot: 'LH공사', facility_type: '공동주택', evaluation_date: null, evaluation_year_effective: 2015, group_order: 0, question_order: 0 }),
    row({ id: 'd', review_id: 'r3', question_text: '탑다운공법 중점관리', role_id: 'g-arch', category_id: 'c-quality', evaluation_type_id: 't-tp', client_snapshot: '가나시청', facility_type: '업무시설/노유자시설', evaluation_date: '2020-06-01', evaluation_year_effective: 2020, group_order: 0, question_order: 1 }),
    row({ id: 'e', review_id: 'r4', question_text: '연도를 모르는 질문', role_id: 'g-lead', category_id: 'c-etc', evaluation_type_id: 't-soq', client_snapshot: '', facility_type: '', evaluation_date: null, evaluation_year_effective: null, group_order: 0, question_order: 0 }),
    row({ id: 'f', review_id: 'r5', question_text: '50% 이상 진행된 현장', role_id: 'g-lead', category_id: 'c-etc', evaluation_type_id: 't-interview', client_snapshot: '한국전력공사', facility_type: '변전소', evaluation_date: '2026-01-02', evaluation_year_effective: 2026, group_order: 0, question_order: 0 }),
  ]
  const oracleRows = rows.map(toQuestionWithReview)

  const cases: Array<[string, QuestionFilterState]> = [
    ['필터 없음', EMPTY_FILTER],
    ['전체검색 — 질문 본문', filter({ search: '관리' })],
    ['전체검색 — 발주처', filter({ search: '한국전력' })],
    ['전체검색 — 용역명', filter({ search: '당수변전소' })],
    ['전체검색 — 시설용도', filter({ search: '공동주택' })],
    ['전체검색 — % 리터럴', filter({ search: '50%' })],
    ['전체검색 — 대소문자 무시', filter({ search: 'lh공사' })],
    ['평가유형 지정', filter({ evaluationTypeId: 't-interview' })],
    ['평가유형 미지정', filter({ evaluationTypeId: UNSET })],
    ['질의그룹 지정', filter({ groupId: 'g-lead' })],
    ['질의그룹 미지정', filter({ groupId: UNSET })],
    ['질의분류 미지정', filter({ categoryId: UNSET })],
    ['발주처 부분일치', filter({ clientQuery: '한국전력공사' })],
    ['시설용도 부분일치', filter({ facilityQuery: '노유자시설' })],
    ['연도 하한', filter({ yearFrom: '2020' })],
    ['연도 상한', filter({ yearTo: '2019' })],
    ['연도 범위', filter({ yearFrom: '2020', yearTo: '2026' })],
    ['복합 4축', filter({ clientQuery: '한국전력공사', facilityQuery: '변전소', groupId: 'g-lead', yearFrom: '2020', yearTo: '2026' })],
    ['복합 — 결과 없음', filter({ groupId: 'g-arch', facilityQuery: '변전소' })],
    ['전체검색 + 평가유형', filter({ search: '관리', evaluationTypeId: 't-interview' })],
  ]

  for (const [label, f] of cases) {
    it(`${label}`, () => {
      const server = applyPlanInMemory(rows, f).map(r => r.id)
      const oracle = filterQuestions(oracleRows, f).map(q => q.id)
      expect(server).toEqual(oracle)
    })
  }
})

// ── `미지정` 한 칸이 마스터 미지정 + NULL 을 모두 찾는가 ─────────────────────────
// 운영 DB에는 마스터 `미지정` 행을 가리키는 질문이 대부분이고 NULL 행은 지금 0건이지만, 컬럼이
// nullable 이라 앞으로도 생길 수 있다. 화면의 `미지정` 한 칸이 둘 다 찾아야 어느 쪽도 검색에서
// 사라지지 않는다. 서버측 계획과 oracle 이 같은 답을 내는지 함께 본다.
describe("'미지정' 한 칸 = 마스터 미지정 + NULL", () => {
  const UNSPEC: UnspecifiedIds = { evaluationTypeId: 't-unspec', groupId: 'g-unspec', categoryId: 'c-unspec' }
  const rows: QuestionSearchRow[] = [
    // 마스터 `미지정`을 가리키는 행(legacy import 가 만드는 실제 모양)
    row({ id: 'm1', review_id: 'r1', question_text: '분류 없는 질문', role_id: 'g-unspec', category_id: 'c-unspec', evaluation_type_id: 't-unspec', evaluation_year_effective: 2024 }),
    // 값이 아예 비어 있는 행
    row({ id: 'n1', review_id: 'r2', question_text: '값이 비어 있는 질문', role_id: null, category_id: null, evaluation_type_id: null, evaluation_year_effective: 2023 }),
    // 실제 분류가 있는 행
    row({ id: 's1', review_id: 'r3', question_text: '안전 질문', role_id: 'g-lead', category_id: 'c-safety', evaluation_type_id: 't-soq', evaluation_year_effective: 2022 }),
  ]
  const oracleRows = rows.map(toQuestionWithReview)

  const cases: Array<[string, QuestionFilterState, string[]]> = [
    ['질의분류 미지정', filter({ categoryId: UNSET }), ['m1', 'n1']],
    ['질의그룹 미지정', filter({ groupId: UNSET }), ['m1', 'n1']],
    ['평가유형 미지정', filter({ evaluationTypeId: UNSET }), ['m1', 'n1']],
    ['세 축 동시 미지정', filter({ evaluationTypeId: UNSET, groupId: UNSET, categoryId: UNSET }), ['m1', 'n1']],
    ['실제 마스터 선택은 그 행만', filter({ categoryId: 'c-safety' }), ['s1']],
    ['전체는 전부', filter(), ['m1', 'n1', 's1']],
    ['미지정 + 다른 축 AND', filter({ categoryId: UNSET, yearFrom: '2024' }), ['m1']],
    ['미지정 + 전체검색 AND', filter({ categoryId: UNSET, search: '비어 있는' }), ['n1']],
  ]

  for (const [label, f, expected] of cases) {
    it(`${label}`, () => {
      expect(applyPlanInMemory(rows, f, UNSPEC).map(r => r.id)).toEqual(expected)
      expect(filterQuestions(oracleRows, f, UNSPEC).map(q => q.id)).toEqual(expected)
    })
  }

  it('마스터 미지정 id 를 모르면 NULL 행만 찾는다(회귀 방지 기준)', () => {
    const f = filter({ categoryId: UNSET })
    expect(applyPlanInMemory(rows, f).map(r => r.id)).toEqual(['n1'])
    expect(filterQuestions(oracleRows, f).map(q => q.id)).toEqual(['n1'])
  })
})
