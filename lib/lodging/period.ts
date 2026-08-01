/**
 * 숙박관리 — 체크인/체크아웃 기반 기간 계산.
 * "숙박기간(2박3일)"과 총금액은 DB에 저장하지 않고(총금액은 generated column, 기간은 아예 컬럼 없음)
 * 항상 check_in/check_out에서 파생 계산한다. 날짜 파싱은 lib/projectStatus.ts의 parseLocalDate를
 * 재사용해 UTC 오프셋 버그(docs/conventions.md)를 피한다.
 */
import { parseLocalDate } from '@/lib/projectStatus'

/** 박수 — 체크아웃일 - 체크인일 (일 단위). */
export function nightsBetween(checkIn: string, checkOut: string): number {
  const inDate = parseLocalDate(checkIn)
  const outDate = parseLocalDate(checkOut)
  if (!inDate || !outDate) return 0
  return Math.round((outDate.getTime() - inDate.getTime()) / 86400000)
}

/** "2박3일" 형식 — 박수 n → n박(n+1)일. */
export function formatStayPeriod(checkIn: string, checkOut: string): string {
  const nights = nightsBetween(checkIn, checkOut)
  if (nights <= 0) return ''
  return `${nights}박${nights + 1}일`
}

/**
 * 폼 저장 전 미리보기 전용 계산 — 실제 저장값은 항상 DB generated column(total_price)이 확정한다.
 * 이 함수의 결과를 insert/update 페이로드에 넣지 않는다.
 */
export function previewTotalPrice(pricePerNight: number, nights: number, roomCount: number): number {
  if (nights <= 0 || roomCount <= 0) return 0
  return pricePerNight * nights * roomCount
}
