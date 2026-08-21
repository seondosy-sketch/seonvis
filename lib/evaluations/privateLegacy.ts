/**
 * 면접 DB — 2020년 이하 개인 비공개 자료.
 *
 * 이 파일은 **보안 경계가 아니다.** 실제 차단은 DB의 RLS가 한다
 * (supabase/migration_interview_private_legacy.sql). 여기 있는 것은 두 가지 뿐이다.
 *
 *   1. 연도 경계 상수 — 화면과 DB가 같은 숫자를 써야 한다.
 *   2. 조회에 붙일 "공개분만" 조건 — 소유자가 토글을 끈 상태에서 자기 개인자료를 화면에서
 *      빼 두기 위한 편의 필터다. 일반 사용자에게는 있으나 없으나 결과가 같다(RLS가 이미 막는다).
 *
 * 그래서 이 파일에는 어떤 계정이 소유자인지가 없다. 권한은 allowed_users.can_view_private_legacy에
 * 데이터로 있고, 화면은 public.can_view_private_legacy() RPC로 "나에게 토글을 보여줄지"만 묻는다.
 */

/** 이 연도 이하가 개인 비공개 자료다. DB 쪽 private.evaluation_review_visible()과 같은 값. */
export const PRIVATE_LEGACY_MAX_YEAR = 2020

/** 연도 판정 기준 컬럼(generated: 평가일의 연도, 없으면 evaluation_year). */
export const YEAR_COLUMN = 'evaluation_year_effective'

/**
 * "공개분만" PostgREST or 표현식.
 *
 * NULL을 공개로 본다 — 평가일을 비운 채 저장한 **신규** 후기가 NULL이므로, 빼 버리면 방금 쓴
 * 후기가 화면에서 사라진다. 이관한 과거 자료에는 NULL이 없다(연도가 전부 있다).
 */
export function publicOnlyOrExpression(column: string = YEAR_COLUMN): string {
  return `${column}.gt.${PRIVATE_LEGACY_MAX_YEAR},${column}.is.null`
}

/** 이 연도가 개인 비공개 자료 범위인가. NULL(연도 미상)은 공개로 본다. */
export function isPrivateLegacyYear(year: number | null | undefined): boolean {
  return typeof year === 'number' && Number.isFinite(year) && year <= PRIVATE_LEGACY_MAX_YEAR
}
