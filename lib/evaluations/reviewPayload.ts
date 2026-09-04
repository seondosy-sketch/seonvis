/**
 * 평가 DB — 저장 페이로드 조립 규칙 중 화면 값만으로는 정할 수 없는 것들.
 *
 * (참석자는 attendees.ts, 질문은 questionGroups.ts가 각각 페이로드를 만든다. 이 파일은 그 둘에
 * 속하지 않는 기록 자체의 규칙을 담는다.)
 *
 * 이 파일은 DB에 접근하지 않는다.
 */

/**
 * 저장할 legacy 연도(evaluation_year).
 *
 * 연도만 아는 과거 자료는 evaluation_year로 남는다. 하지만 정확한 평가일이 입력되면 연도는 그
 * 날짜에서 도출되고(evaluation_year_effective), 두 값의 연도가 어긋나면 DB CHECK가 저장을 막는다.
 * 그래서 날짜와 어긋나는 연도는 버린다 — 사용자가 고친 날짜가 더 정확한 정보이기 때문이다.
 *
 * HWP 초안(문서에 연도만 있는 후기)에 사용자가 실제 평가일을 채워 넣는 경우가 이 규칙이 필요한
 * 대표적인 상황이다.
 */
export function legacyYearFor(evaluationDate: string, currentYear: number | null): number | null {
  if (currentYear === null) return null
  if (!evaluationDate) return currentYear
  return Number(evaluationDate.slice(0, 4)) === currentYear ? currentYear : null
}
