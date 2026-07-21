/**
 * 기술인 출퇴근부 — 프로젝트 변경이력을 화면/출력용 비고 텍스트로 조립.
 *
 * 마스터 프롬프트가 제시한 출력 예시를 그대로 재현한다:
 *   03.14 단장 홍길동 → 김철수 변경
 *   05.02 공고 취소
 *   05.20 재공고
 *   06.04 면접일 06.10 → 06.17 변경
 *
 * 월별 화면의 "비고"와 프로젝트 변경이력은 데이터로는 분리하되(project_change_history 단일 원본,
 * 사용자 확정 #2/#5) 화면·출력에서는 이 함수로 항상 합쳐서 보여준다 — 별도의 "월별 비고" 테이블을
 * 새로 두지 않는다.
 */
import type { ChangeType, ProjectChangeHistory } from './types'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function toMMDD(value: string | null): string {
  if (!value || !ISO_DATE.test(value.trim())) return value ?? ''
  const [, m, d] = value.trim().split('-')
  return `${m}.${d}`
}

/** change_type별 템플릿. before/after가 날짜 형식(YYYY-MM-DD)이면 MM.DD로 축약해 표시한다. */
function formatLine(record: ProjectChangeHistory): string {
  const date = toMMDD(record.change_date)
  const before = ISO_DATE.test(record.before_value?.trim() ?? '') ? toMMDD(record.before_value) : record.before_value
  const after = ISO_DATE.test(record.after_value?.trim() ?? '') ? toMMDD(record.after_value) : record.after_value

  const templates: Record<ChangeType, () => string> = {
    director_change: () => `단장 ${before} → ${after} 변경`,
    participant_change: () => `참여기술인 ${before} → ${after} 변경`,
    cancelled: () => '공고 취소',
    reannounced: () => '재공고',
    amended: () => '공고 내용 변경',
    announce_date_change: () => `공고일 ${before} → ${after} 변경`,
    interview_date_change: () => `면접일 ${before} → ${after} 변경`,
    field_change: () => `참여분야 ${before} → ${after} 변경`,
    other: () => record.memo || '기타 변경사항',
  }

  return `${date} ${templates[record.change_type]()}`
}

/**
 * 주어진 기간(경계 포함)에 속하는 변경이력을 발생일자순으로 정렬해 텍스트 줄 배열로 반환한다.
 * projectId를 넘기면 그 프로젝트로 한정, 생략하면 전달된 records 전부를 대상으로 한다
 * (호출부가 이미 프로젝트별로 필터링해 넘기는 경우를 위함).
 */
export function formatChangeHistoryForPeriod(
  records: ProjectChangeHistory[],
  periodStart: string,
  periodEnd: string,
  projectId?: string,
): string[] {
  return records
    .filter(r => (projectId ? r.project_id === projectId : true))
    .filter(r => r.change_date >= periodStart && r.change_date <= periodEnd)
    .sort((a, b) => a.change_date.localeCompare(b.change_date))
    .map(formatLine)
}
