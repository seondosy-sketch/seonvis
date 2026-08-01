/** 공통 Export 인프라 — 원화/날짜 포맷터. */

export function formatWon(amount: number): string {
  return `${amount.toLocaleString('ko-KR')}원`
}

/** YYYY-MM-DD는 이미 사람이 읽기 쉬운 형태라 그대로 반환 — 표시용 별칭(호출부 의도를 명확히 하기 위함). */
export function formatDateStr(dateStr: string): string {
  return dateStr
}
