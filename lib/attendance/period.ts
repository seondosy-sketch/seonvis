/**
 * 기술인 출근부 — 기간 계산.
 *
 * "전월 21일~당월 20일" 회계기간 계산은 연장근무(lib/overtime/summary.ts)에 이미 구현돼
 * 있고 순수 함수라 그대로 재사용한다 — 복제하지 않는다(마스터 프롬프트 지시).
 * 이 파일은 그 함수들을 출근부 쪽 명명 규약(1~12월 라벨)으로 얇게 감싸고,
 * 연간 통합 기간(전년도 12/21~해당연도 12/20, 사용자 확정 — 12/31까지 확장하지 않음)만 새로 추가한다.
 *
 * ── 주의: payPeriodDays(year, month)의 month는 1~12가 아니라 0-indexed다 ──
 * `docs/overtime.md`의 예시: payPeriodDays(2026, 6) → 2026-06-21~2026-07-20 ("7월"분).
 * 즉 함수의 month 매개변수는 "라벨 월(1~12)에서 1을 뺀 값"과 같다(JS Date의 0-indexed 월과 동일한 수).
 * DB(attendance_month_closures.period_month)에는 사람이 읽는 1~12 라벨을 그대로 저장하기로
 * 했으므로(supabase/migration_attendance.sql 주석 참고), 그 값을 이 함수에 넘기려면 반드시
 * 아래 헬퍼(getPayPeriodForLabel 등)를 거쳐 -1 변환을 해야 한다 — 여기서 실수하면 모든 기간 계산이
 * 한 달씩 밀리므로 직접 payPeriodDays를 호출하지 말고 이 파일의 함수만 쓴다.
 */
import { payPeriodDays, payPeriodRange, currentPayPeriod, type PayPeriodDay } from '@/lib/overtime/summary'

export type { PayPeriodDay }
export { payPeriodDays, payPeriodRange, currentPayPeriod }

/** 라벨 월(1~12) → payPeriodDays/payPeriodRange가 요구하는 0-indexed 값으로 변환. */
export function labelMonthToFnParam(periodMonth1to12: number): number {
  return periodMonth1to12 - 1
}

/** period_year/period_month(1~12 라벨) 기준 그 회계월의 날짜 배열. */
export function getPayPeriodForLabel(year: number, periodMonth1to12: number): PayPeriodDay[] {
  return payPeriodDays(year, labelMonthToFnParam(periodMonth1to12))
}

/** period_year/period_month(1~12 라벨) 기준 DB 조회용 [시작일, 종료일] 문자열. */
export function getPayPeriodRangeForLabel(
  year: number,
  periodMonth1to12: number,
): { start: string; end: string } {
  return payPeriodRange(year, labelMonthToFnParam(periodMonth1to12))
}

/** 오늘 기준 "이번 기간"을 1~12 라벨로 반환(마감 화면의 기본 선택값 등에 사용). */
export function currentPayPeriodLabel(): { year: number; periodMonth: number } {
  const { year, month } = currentPayPeriod()
  return { year, periodMonth: month + 1 }
}

/**
 * 연간 통합 기간 — 전년도 12월 21일 ~ 해당 연도 12월 20일(사용자 확정, 12/31까지 확장하지 않음).
 * 하드코딩하지 않고 payPeriodDays를 재사용해 도출한다: 라벨 "1월"(param 0)의 첫날과
 * 라벨 "12월"(param 11)의 마지막날이 곧 연간 범위의 시작/끝이다.
 *   payPeriodDays(year, 0)  → new Date(year, -1, 21) = 전년도 12/21 (JS Date가 음수 월을 자동 이월)
 *   payPeriodDays(year, 11) → new Date(year, 10, 21) ~ new Date(year, 11, 20) = 그 해 11/21~12/20
 */
export function annualPeriodRange(year: number): { start: string; end: string } {
  const jan = payPeriodDays(year, 0)
  const dec = payPeriodDays(year, 11)
  return { start: jan[0].dateStr, end: dec[dec.length - 1].dateStr }
}

/**
 * 해당 연도 라벨의 12개 회계월을 (year, periodMonth) 쌍으로 반환 — 연간 화면/출력이
 * 마감 회차(attendance_month_closures)를 12번 순회 조회할 때 사용.
 */
export function annualMonthLabels(year: number): Array<{ year: number; periodMonth: number }> {
  return Array.from({ length: 12 }, (_, i) => ({ year, periodMonth: i + 1 }))
}
