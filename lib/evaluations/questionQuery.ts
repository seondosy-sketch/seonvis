/**
 * 평가 DB — 질의 탭 서버측 조회 계획(query plan).
 *
 * 왜 있는가
 *   질의 탭은 원래 질문 전체를 브라우저로 내려받아 questionFilters.ts로 걸렀다. PostgREST가 한
 *   응답에 최대 1,000행만 주기 때문에(요청 limit과 무관) 1,119건 중 119건은 화면에서 아예
 *   검색되지 않았다. 그래서 필터·정렬·페이지네이션을 전부 DB로 내린다.
 *
 *   조회 대상은 evaluation_question_search view다(supabase/migration_evaluation_question_search.sql).
 *   view가 필요한 이유는 딱 하나 — PostgREST의 or=(...)는 부모 테이블 컬럼과 임베드 리소스 컬럼을
 *   한 논리식에 섞을 수 없어서(PGRST100) "전체검색"(질문 본문 OR 용역명 OR 발주처 OR 시설용도)을
 *   중첩 select로는 표현할 수 없다. 나머지 필터·정렬·count는 임베드로도 가능하다(실측).
 *
 * 이 파일은 DB에 접근하지 않는다 — 필터 상태를 "어떤 조건으로 무엇을 몇 번째부터 몇 개" 라는
 * 계획으로만 바꾼다. 실제 supabase 호출은 화면 쪽에서 이 계획을 적용한다(테스트 가능성을 위해).
 *
 * 검색 의미는 questionFilters.ts(client-side 순수 필터)와 같아야 한다 — 그쪽은 이제 production
 * 조회 경로가 아니지만, 같은 데이터에 대해 두 결과가 일치하는지 확인하는 oracle로 쓴다.
 */
import { ALL, UNSET, type QuestionFilterOptions, type QuestionFilterState } from './questionFilters'
import type { QuestionWithReview } from './types'

/** 조회 대상 view (질문 + 그 질문이 나온 기록의 조회용 필드). */
export const QUESTION_SEARCH_VIEW = 'evaluation_question_search'
/** 필터 후보(발주처/시설용도/연도) 집계 view. */
export const QUESTION_FACETS_VIEW = 'evaluation_question_facets'

/** 한 페이지에 보여줄 질문 수. */
export const QUESTION_PAGE_SIZE = 100

/**
 * 전체검색이 훑는 컬럼. questionFilters.ts와 같은 범위를 유지한다.
 * (시설용도는 필터 칸이 따로 있지만, 전체검색으로도 잡히는 편이 사용자 기대에 맞다.)
 */
export const QUESTION_SEARCH_COLUMNS = [
  'question_text',
  'project_name_snapshot',
  'client_snapshot',
  'facility_type',
] as const

/** view 한 행 — 컬럼이 평평하다(질문 컬럼 + 기록 컬럼). */
export interface QuestionSearchRow {
  id: string
  review_id: string
  question_text: string
  role_id: string | null
  category_id: string | null
  specialty_id: string | null
  group_order: number
  question_order: number
  created_at: string
  updated_at: string
  evaluation_type_id: string | null
  client_snapshot: string
  project_name_snapshot: string
  facility_type: string
  evaluation_date: string | null
  evaluation_year_effective: number | null
}

/** view의 평평한 행을 화면/oracle이 쓰는 중첩 모양으로 되돌린다. */
export function toQuestionWithReview(row: QuestionSearchRow): QuestionWithReview {
  return {
    id: row.id,
    review_id: row.review_id,
    question_text: row.question_text,
    role_id: row.role_id,
    category_id: row.category_id,
    specialty_id: row.specialty_id,
    group_order: row.group_order,
    question_order: row.question_order,
    created_at: row.created_at,
    updated_at: row.updated_at,
    review: {
      id: row.review_id,
      evaluation_type_id: row.evaluation_type_id,
      client_snapshot: row.client_snapshot,
      project_name_snapshot: row.project_name_snapshot,
      facility_type: row.facility_type,
      evaluation_date: row.evaluation_date,
      evaluation_year_effective: row.evaluation_year_effective,
    },
  }
}

// ── 검색어 이스케이프 ──────────────────────────────────────────────────────────
// 두 겹을 지나간다: PostgREST의 or=(...) 값 문법 → Postgres ILIKE 패턴.
// 사용자가 치는 검색어는 "부분일치 문자열"이어야 하므로 ILIKE 와일드카드를 리터럴로 만든다.

/** 사용자 입력을 리터럴 부분일치 ILIKE 패턴으로 (`%`, `_`, `\`를 이스케이프). */
export function ilikePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, m => `\\${m}`)}%`
}

/**
 * or=(...) 안에 들어갈 값 — 쉼표·괄호·점이 논리식 문법과 충돌하므로 큰따옴표로 감싼다.
 * 따옴표와 역슬래시는 역슬래시로 이스케이프한다(PostgREST 값 문법).
 *
 * ⚠ 알려진 한계: PostgREST는 like/ilike 값의 `*`를 `%`로 치환하므로 `*`는 리터럴로 검색할 수
 * 없고 와일드카드로 동작한다. 이스케이프로 우회할 수 없는 PostgREST 동작이라 그대로 둔다
 * (질의 검색에서 `*`를 찾는 경우가 사실상 없다).
 */
export function quoteOrValue(value: string): string {
  return `"${value.replace(/["\\]/g, m => `\\${m}`)}"`
}

/** 전체검색 or 표현식 — 컬럼 여러 개를 OR로 훑는다. */
export function searchOrExpression(
  term: string,
  columns: readonly string[] = QUESTION_SEARCH_COLUMNS,
): string {
  const value = quoteOrValue(ilikePattern(term))
  return columns.map(c => `${c}.ilike.${value}`).join(',')
}

// ── 조회 계획 ─────────────────────────────────────────────────────────────────

export type QuestionQueryFilter =
  | { op: 'eq'; column: string; value: string }
  | { op: 'isNull'; column: string }
  | { op: 'ilike'; column: string; pattern: string }
  | { op: 'gte'; column: string; value: number }
  | { op: 'lte'; column: string; value: number }

export interface QuestionOrderKey {
  column: string
  ascending: boolean
  nullsFirst: boolean
}

/**
 * 결정적 정렬 — 페이지를 넘길 때 행이 빠지거나 겹치지 않게 하려면 정렬이 완전해야 한다
 * (마지막 키가 유일값 id다). 기존 화면 정렬(최신 평가 먼저, 같은 기록 안에서는 입력 순서)을
 * 그대로 유지한다: 연도 desc → 평가일 desc → 기록 → 그룹 순서 → 질문 순서 → id.
 * 연도·평가일이 없는 행은 뒤로 보낸다(nullsFirst: false).
 */
export const QUESTION_ORDER: readonly QuestionOrderKey[] = [
  { column: 'evaluation_year_effective', ascending: false, nullsFirst: false },
  { column: 'evaluation_date', ascending: false, nullsFirst: false },
  { column: 'review_id', ascending: true, nullsFirst: false },
  { column: 'group_order', ascending: true, nullsFirst: false },
  { column: 'question_order', ascending: true, nullsFirst: false },
  { column: 'id', ascending: true, nullsFirst: false },
]

export interface QuestionQueryPlan {
  /** 전체검색 or 표현식. 검색어가 없으면 null. */
  or: string | null
  /** AND로 묶이는 단순 조건들. */
  filters: QuestionQueryFilter[]
  order: readonly QuestionOrderKey[]
  /** range(from, to) — 둘 다 0-based 포함. */
  from: number
  to: number
}

/** id 기준 필터 한 칸(전체/미지정/특정 id)을 DB 조건으로. */
function idFilter(column: string, value: string): QuestionQueryFilter | null {
  if (value === ALL) return null
  if (value === UNSET) return { op: 'isNull', column }
  return { op: 'eq', column, value }
}

/**
 * 필터 상태 + 페이지 번호 → 조회 계획.
 *
 * 연도 범위는 evaluation_year_effective(generated column)에만 걸린다. 연도를 모르는 행은
 * SQL 비교에서 자동으로 빠진다(NULL 비교는 참이 아니다) — client-side 필터와 같은 결과다.
 */
export function buildQuestionQueryPlan(
  f: QuestionFilterState,
  page: number,
  pageSize: number = QUESTION_PAGE_SIZE,
): QuestionQueryPlan {
  const filters: QuestionQueryFilter[] = []

  for (const [column, value] of [
    ['evaluation_type_id', f.evaluationTypeId],
    ['role_id', f.groupId],
    ['category_id', f.categoryId],
  ] as const) {
    const filter = idFilter(column, value)
    if (filter) filters.push(filter)
  }

  const client = f.clientQuery.trim()
  if (client) filters.push({ op: 'ilike', column: 'client_snapshot', pattern: ilikePattern(client) })

  const facility = f.facilityQuery.trim()
  if (facility) filters.push({ op: 'ilike', column: 'facility_type', pattern: ilikePattern(facility) })

  const from = parseInt(f.yearFrom, 10)
  if (Number.isFinite(from)) filters.push({ op: 'gte', column: 'evaluation_year_effective', value: from })
  const to = parseInt(f.yearTo, 10)
  if (Number.isFinite(to)) filters.push({ op: 'lte', column: 'evaluation_year_effective', value: to })

  const search = f.search.trim()
  const safePage = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1
  const offset = (safePage - 1) * pageSize

  return {
    or: search ? searchOrExpression(search) : null,
    filters,
    order: QUESTION_ORDER,
    from: offset,
    to: offset + pageSize - 1,
  }
}

// ── 페이지 계산 ───────────────────────────────────────────────────────────────

/** 총 결과 수 → 총 페이지 수. 결과가 0건이어도 1페이지로 본다(화면에 "1 / 1"을 보여준다). */
export function totalPages(total: number, pageSize: number = QUESTION_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize))
}

/** 현재 페이지를 유효 범위로 자른다 — 필터를 좁혀 결과가 줄었을 때 빈 페이지에 남지 않게. */
export function clampPage(page: number, total: number, pageSize: number = QUESTION_PAGE_SIZE): number {
  const last = totalPages(total, pageSize)
  if (!Number.isFinite(page) || page < 1) return 1
  return Math.min(Math.floor(page), last)
}

// ── 필터 후보 목록 ────────────────────────────────────────────────────────────

/** evaluation_question_facets view 한 행. */
export interface QuestionFacetRow {
  facet: string
  value: string
  question_count: number
}

/**
 * 필터 후보를 facets view 결과에서 만든다.
 * 현재 페이지 100건이 아니라 **전체 데이터** 기준이어야 한다 — 페이지를 넘길 때마다 후보 목록이
 * 달라지면 필터를 쓸 수 없다. 정렬은 기존 화면과 같게 빈도 내림차순(동수면 이름순), 연도는
 * 숫자 내림차순.
 */
export function buildFilterOptionsFromFacets(
  rows: readonly QuestionFacetRow[],
): QuestionFilterOptions {
  // 값은 다듬어서 합친다 — 실제 데이터에 앞뒤 공백이 섞인 값이 있어(예: ' 교육연구시설(...)')
  // 그대로 두면 같은 값이 후보에 두 번 나온다. view도 btrim하지만 여기서도 한 번 더 막는다.
  const pick = (facet: string) => {
    const merged = new Map<string, number>()
    for (const row of rows) {
      if (row.facet !== facet) continue
      const value = row.value.trim()
      if (!value) continue
      merged.set(value, (merged.get(value) ?? 0) + row.question_count)
    }
    return [...merged.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([value]) => value)
  }

  const years = rows
    .filter(r => r.facet === 'year')
    .map(r => parseInt(r.value, 10))
    .filter(y => Number.isFinite(y))
    .sort((a, b) => b - a)

  return {
    clients: pick('client'),
    facilities: pick('facility'),
    years: [...new Set(years)],
  }
}
