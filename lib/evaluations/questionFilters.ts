/**
 * 평가 DB — 질의 탭 검색/필터 순수 로직.
 *
 * 질의 화면은 별도의 질문 복제본을 보지 않는다. evaluation_questions를 review와 조인해서 읽고
 * (QuestionWithReview), 그 결과를 이 파일의 함수들로 거른다. 즉 후기 화면에 입력한 질문이 곧
 * 이 화면의 데이터다.
 *
 * 발주처·시설용도를 "부분일치"로 거르는 이유:
 *   실제 값이 "한국전력공사 경인건설본부 경기건설지사"처럼 계층이 한 문자열에 들어 있고
 *   ("업무시설/노유자시설"처럼 복수 용도를 한 칸에 적은 경우도 있다), 이번 작업 범위에서
 *   발주처/시설용도 마스터를 새로 설계하지 않기로 했다. 부분일치로 두면 "한국전력공사"만 입력해도
 *   산하 본부·지사 건이 모두 잡히고, 나중에 마스터를 도입할 때 이 함수만 바꾸면 된다.
 *
 * 연도는 review.evaluation_year_effective(DB generated column)만 본다 — 실제 평가일이 있는 신규
 * 기록과 연도만 아는 legacy 기록을 같은 필터로 다루기 위함이다. 화면이 coalesce를 다시 계산하지
 * 않는다.
 *
 * 이 파일은 DB에 접근하지 않는다.
 */
import type { QuestionWithReview } from './types'

export const ALL = '전체'
export const UNSET = '미지정'

export interface QuestionFilterState {
  /** 전체검색 — 질문 본문 + 용역명 + 발주처를 함께 훑는다. */
  search: string
  /** 평가유형(evaluation_types.id) 또는 '전체' / '미지정'. */
  evaluationTypeId: string | typeof ALL | typeof UNSET
  /**
   * 질의그룹(evaluation_roles.id) 또는 '전체' / '미지정' — 누구에게 나온 질문인가.
   * 전문분야(engineer_specialties) 필터는 두지 않는다: 질의그룹이 분야 의미를 이미 담고 있어
   * 사용자에게 뜻이 겹치는 필터를 두 개 보여주지 않는다(전문분야는 legacy 전용 컬럼으로만 남는다).
   */
  groupId: string | typeof ALL | typeof UNSET
  /** 질의분류(evaluation_question_categories.id) 또는 '전체' / '미지정' — 질문의 주제. */
  categoryId: string | typeof ALL | typeof UNSET
  /** 발주처 — 부분일치. 빈 문자열이면 제한 없음. */
  clientQuery: string
  /** 시설용도 — 부분일치. 빈 문자열이면 제한 없음. */
  facilityQuery: string
  /** 연도 범위(effective year 기준). 빈 문자열이면 그 방향 제한 없음. */
  yearFrom: string
  yearTo: string
}

export const EMPTY_FILTER: QuestionFilterState = {
  search: '',
  evaluationTypeId: ALL,
  groupId: ALL,
  categoryId: ALL,
  clientQuery: '',
  facilityQuery: '',
  yearFrom: '',
  yearTo: '',
}

function includesFold(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase())
}

/**
 * 질문이 속한 평가의 연도. 실제 평가일이 있으면 그 연도, 연도만 아는 legacy 자료면 그 연도,
 * 둘 다 없으면 null(연도 필터를 걸면 제외된다).
 */
export function questionYear(q: QuestionWithReview): number | null {
  return q.review.evaluation_year_effective ?? null
}

/** id 기준 필터 한 칸(전체/미지정/특정 id) 판정 — 평가유형·질의그룹·질의분류가 같은 규칙을 쓴다. */
function matchesIdFilter(value: string | null, filter: string): boolean {
  if (filter === ALL) return true
  if (filter === UNSET) return !value
  return value === filter
}

/**
 * 필터 여러 개를 동시에 적용한다(모두 AND).
 * 예) 평가유형 TP + 질의그룹 '책임' + 질의분류 '공정' + 발주처 "한국전력공사" + 시설용도 "변전소"
 *     + 2022~2026.
 */
export function matchesQuestionFilter(q: QuestionWithReview, f: QuestionFilterState): boolean {
  const search = f.search.trim()
  if (search) {
    const hit =
      includesFold(q.question_text, search) ||
      includesFold(q.review.project_name_snapshot, search) ||
      includesFold(q.review.client_snapshot, search)
    if (!hit) return false
  }

  if (!matchesIdFilter(q.review.evaluation_type_id, f.evaluationTypeId)) return false
  if (!matchesIdFilter(q.role_id, f.groupId)) return false
  if (!matchesIdFilter(q.category_id, f.categoryId)) return false

  const client = f.clientQuery.trim()
  if (client && !includesFold(q.review.client_snapshot, client)) return false

  const facility = f.facilityQuery.trim()
  if (facility && !includesFold(q.review.facility_type, facility)) return false

  if (f.yearFrom || f.yearTo) {
    const year = questionYear(q)
    if (year === null) return false
    if (f.yearFrom && year < parseInt(f.yearFrom, 10)) return false
    if (f.yearTo && year > parseInt(f.yearTo, 10)) return false
  }

  return true
}

/**
 * 최신 평가가 먼저 오도록 정렬한 필터 결과.
 * 연도를 알 수 없는 질문은 맨 뒤로 보낸다. 같은 기록 안에서는 입력 순서를 유지해 "평가에서 나온
 * 순서"를 흐트러뜨리지 않는다. 정렬 기준을 effective year로 두면 실제 평가일이 있는 기록과
 * 연도만 아는 legacy 기록이 한 줄로 섞여도 시간순이 유지된다.
 */
export function filterQuestions(
  questions: readonly QuestionWithReview[],
  f: QuestionFilterState,
): QuestionWithReview[] {
  return questions
    .filter(q => matchesQuestionFilter(q, f))
    .sort((a, b) => {
      const ya = questionYear(a)
      const yb = questionYear(b)
      if (ya !== yb) {
        if (ya === null) return 1
        if (yb === null) return -1
        return yb - ya
      }
      // 같은 연도 안에서는 정확한 날짜가 있는 쪽을 먼저(더 구체적인 정보가 위로).
      const da = a.review.evaluation_date ?? ''
      const db = b.review.evaluation_date ?? ''
      if (da !== db) {
        if (!da) return 1
        if (!db) return -1
        return db.localeCompare(da)
      }
      if (a.review_id !== b.review_id) return a.review_id.localeCompare(b.review_id)
      return a.group_order - b.group_order || a.question_order - b.question_order
    })
}

/** 필터가 하나라도 걸려 있는지 — "필터 초기화" 버튼 표시 여부에 쓴다. */
export function hasActiveFilter(f: QuestionFilterState): boolean {
  return (
    f.search.trim() !== '' ||
    f.evaluationTypeId !== ALL ||
    f.groupId !== ALL ||
    f.categoryId !== ALL ||
    f.clientQuery.trim() !== '' ||
    f.facilityQuery.trim() !== '' ||
    f.yearFrom !== '' ||
    f.yearTo !== ''
  )
}

export interface QuestionFilterOptions {
  /** 실제 데이터에 존재하는 발주처 목록(빈도 내림차순) — 입력칸 추천 목록용. */
  clients: string[]
  /** 실제 데이터에 존재하는 시설용도 목록(빈도 내림차순). */
  facilities: string[]
  /** 실제 데이터에 존재하는 연도 목록(내림차순). */
  years: number[]
}

/**
 * 필터 UI의 선택 후보를 데이터에서 뽑는다 — 목록을 코드에 하드코딩하지 않기 위함이다
 * (발주처·시설용도는 자유 입력이라 애초에 고정 목록을 만들 수 없다).
 * 평가유형·질의그룹·질의분류는 마스터 테이블에서 오므로 여기서 뽑지 않는다.
 */
export function buildFilterOptions(questions: readonly QuestionWithReview[]): QuestionFilterOptions {
  const clientCount = new Map<string, number>()
  const facilityCount = new Map<string, number>()
  const years = new Set<number>()

  for (const q of questions) {
    const client = q.review.client_snapshot.trim()
    if (client) clientCount.set(client, (clientCount.get(client) ?? 0) + 1)

    const facility = q.review.facility_type.trim()
    if (facility) facilityCount.set(facility, (facilityCount.get(facility) ?? 0) + 1)

    const year = questionYear(q)
    if (year !== null) years.add(year)
  }

  const byCountThenName = (a: [string, number], b: [string, number]) =>
    b[1] - a[1] || a[0].localeCompare(b[0])

  return {
    clients: [...clientCount.entries()].sort(byCountThenName).map(([name]) => name),
    facilities: [...facilityCount.entries()].sort(byCountThenName).map(([name]) => name),
    years: [...years].sort((a, b) => b - a),
  }
}
