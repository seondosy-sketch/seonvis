/**
 * 평가 DB — 후기 표시용 문자열 조립 및 목록 검색/정렬 순수 로직.
 *
 * 표기 방식은 참고자료 HWP 면접후기의 실제 표기를 따른다.
 *   일 시    → "2026-08-19 13:30~"   (날짜는 date 컬럼, 시각은 자유 텍스트)
 *   참석자   → "홍길동(단장), 김철수(안전), 이영희 차장(수행)"
 *   참가업체 → "7개 중 1번째 (A사, B사, C사, ...)"
 *   면접관   → "5인"
 * 값이 없는 항목은 억지로 채우지 않고 빈칸/'-'으로 둔다 — 원본에도 비어 있는 칸이 있다.
 *
 * 연도만 아는 legacy 기록은 날짜 자리에 "2015년"처럼 연도만 적는다. 없는 월/일을 만들어 붙이지
 * 않는 것이 이 기능의 원칙이다.
 *
 * 이 파일은 DB에 접근하지 않는다.
 */
import type { EvaluationAttendee, EvaluationReview, ReviewListItem } from './types'

const DASH = '-'

/**
 * "2026-08-19 13:30~" — 시각은 원본 표기를 그대로 덧붙인다.
 * 실제 날짜가 없고 연도만 아는 legacy 기록이면 "2015년"으로 적는다(가짜 월/일 생성 금지).
 */
export function formatEvaluationDateTime(
  review: Pick<EvaluationReview, 'evaluation_date' | 'evaluation_year' | 'evaluation_time'>,
): string {
  const date = (review.evaluation_date ?? '').trim()
  const time = review.evaluation_time.trim()
  const head = date || (review.evaluation_year !== null ? `${review.evaluation_year}년` : '')

  if (!head && !time) return DASH
  if (!head) return time
  return time ? `${head} ${time}` : head
}

/** "홍길동(단장), 김철수(안전)" — 역할이 비어 있으면 이름만. */
export function formatAttendees(attendees: readonly EvaluationAttendee[]): string {
  const parts = [...attendees]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(a => {
      const name = a.attendee_name_snapshot.trim()
      const role = a.attendee_role.trim()
      return role ? `${name}(${role})` : name
    })
    .filter(s => s.length > 0)
  return parts.length > 0 ? parts.join(', ') : DASH
}

/**
 * "7개 중 1번째 (A사, B사, ...)" — 개수/순서/업체명 중 있는 것만 조합한다.
 * 셋 다 없으면 '-'.
 */
export function formatParticipantCompanies(
  review: Pick<EvaluationReview, 'participant_company_count' | 'presentation_order' | 'participant_companies'>,
): string {
  const head: string[] = []
  if (review.participant_company_count !== null) head.push(`${review.participant_company_count}개`)
  if (review.presentation_order !== null) head.push(`${review.presentation_order}번째`)

  const names = review.participant_companies.trim()
  const headText = head.length === 2 ? `${head[0]} 중 ${head[1]}` : head.join('')

  if (headText && names) return `${headText} (${names})`
  if (headText) return headText
  return names || DASH
}

/** "5인" — 값이 없으면 '-'. */
export function formatEvaluatorCount(count: number | null): string {
  return count === null ? DASH : `${count}인`
}

/**
 * 평가유형 표시 이름. 마스터에 연결돼 있으면 그 이름, 표준 매핑이 안 된 legacy 원문만 있으면
 * 그 원문을, 둘 다 없으면 '미지정'. (원문을 임의로 표준값으로 바꿔 보여주지 않는다.)
 */
export function formatEvaluationType(
  review: Pick<EvaluationReview, 'evaluation_type_id' | 'evaluation_type_source'>,
  typeNameById: ReadonlyMap<string, string>,
): string {
  if (review.evaluation_type_id) {
    const name = typeNameById.get(review.evaluation_type_id)
    if (name) return name
  }
  const source = review.evaluation_type_source.trim()
  return source || '미지정'
}

/**
 * 후기 목록 검색 — 용역명·발주처·시설용도·참석자 이름을 한 검색칸으로 훑는다.
 * (프로젝트 List의 검색칸이 여러 열을 한꺼번에 훑는 방식과 같은 감각.)
 */
export function searchReviews(
  reviews: readonly ReviewListItem[],
  query: string,
): ReviewListItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...reviews]
  return reviews.filter(r => {
    if (r.project_name_snapshot.toLowerCase().includes(q)) return true
    if (r.client_snapshot.toLowerCase().includes(q)) return true
    if (r.facility_type.toLowerCase().includes(q)) return true
    return r.attendees.some(a => a.attendee_name_snapshot.toLowerCase().includes(q))
  })
}

/**
 * 목록 정렬 — 최근 평가가 먼저.
 * effective year를 1차 기준으로 써서, 연도만 아는 legacy 기록도 시간순 안에 자연스럽게 놓인다.
 * 같은 연도면 정확한 날짜가 있는 쪽이 먼저, 그다음 등록이 최근인 쪽이 먼저다.
 */
export function sortReviewsByDateDesc(reviews: readonly ReviewListItem[]): ReviewListItem[] {
  return [...reviews].sort((a, b) => {
    const ya = a.evaluation_year_effective
    const yb = b.evaluation_year_effective
    if (ya !== yb) {
      if (ya === null) return 1
      if (yb === null) return -1
      return yb - ya
    }
    const da = a.evaluation_date ?? ''
    const db = b.evaluation_date ?? ''
    if (da !== db) {
      if (!da) return 1
      if (!db) return -1
      return db.localeCompare(da)
    }
    return (b.created_at ?? '').localeCompare(a.created_at ?? '')
  })
}
