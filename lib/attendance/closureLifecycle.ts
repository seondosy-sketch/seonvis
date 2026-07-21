/**
 * 기술인 출퇴근부 — 월 마감의 버전(반복 마감/마감취소) 관리 순수 로직.
 *
 * attendance_month_closures는 "기간당 1행"이 아니라 "마감 시도(버전)당 1행"이다
 * (사용자 검토 지시 #3 반영, docs/attendance/03-data-model.md §0 참고). 이 파일은
 * 그 버전 목록에서 "지금 이 기간이 잠겨 있는지"와 "다음 마감은 몇 번째 버전인지"를
 * 판단하는 로직, 그리고 attendance_records.closure_id를 컬럼으로 두지 않기로 한
 * 결정(§0 "closure_id 제거")을 뒷받침하는 날짜→회계기간 라벨 역산 로직을 담는다.
 */
import type { AttendanceMonthClosure } from './types'

/**
 * 임의의 날짜(work_date)가 속하는 회계기간 라벨(1~12월)을 역산한다.
 * currentPayPeriod()(lib/overtime/summary.ts)와 완전히 동일한 규칙을 "오늘"이 아니라
 * 임의의 날짜에 적용한 것뿐이다 — 21일 이후면 다음 달 라벨로 넘어간다.
 * attendance_records는 closure_id를 저장하지 않으므로, "이 기록의 날짜가 마감된
 * 기간에 속하는지"를 판단할 때는 항상 이 함수로 라벨을 구한 뒤 attendance_month_closures를 조회한다.
 */
export function periodLabelForDate(workDate: string): { year: number; periodMonth: number } {
  const m = workDate.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) throw new Error(`잘못된 날짜 형식입니다: ${workDate}`)
  let year = parseInt(m[1], 10)
  let month0 = parseInt(m[2], 10) - 1 // 0-indexed 달력월
  const day = parseInt(m[3], 10)
  if (day >= 21) {
    month0 += 1
    if (month0 > 11) {
      month0 = 0
      year += 1
    }
  }
  return { year, periodMonth: month0 + 1 }
}

/**
 * 한 기간(같은 period_year/period_month)에 속하는 마감 버전 행들 중 "현재" 상태를 판단한다.
 * version이 가장 큰 행의 status로 결정하고, 행이 하나도 없으면 한 번도 마감한 적 없는
 * 것이므로 'open'이다. 호출부가 이미 특정 기간으로 필터링한 배열을 넘긴다고 가정한다.
 */
export function currentClosureStatus(closuresForOnePeriod: AttendanceMonthClosure[]): 'open' | 'closed' {
  const latest = latestVersion(closuresForOnePeriod)
  if (!latest) return 'open'
  return latest.status === 'closed' ? 'closed' : 'open'
}

/** 한 기간의 마감 버전 행들 중 version이 가장 큰(최신) 행. 없으면 null. */
export function latestVersion(closuresForOnePeriod: AttendanceMonthClosure[]): AttendanceMonthClosure | null {
  if (closuresForOnePeriod.length === 0) return null
  return closuresForOnePeriod.reduce((max, c) => (c.version > max.version ? c : max))
}

/** 다음 마감(재마감 포함) 시 사용할 버전 번호 — 기존 최대 버전 + 1, 없으면 1. */
export function nextClosureVersion(closuresForOnePeriod: AttendanceMonthClosure[]): number {
  const latest = latestVersion(closuresForOnePeriod)
  return latest ? latest.version + 1 : 1
}

/**
 * 재마감(새 버전 생성)이 허용되는 상태인지 — 아직 한 번도 마감하지 않았거나(open),
 * 최신 버전이 마감취소(reopened)된 상태여야 한다. 최신 버전이 이미 'closed'인데 또
 * 마감을 시도하면 잘못된 흐름(먼저 마감취소부터 해야 함)이다.
 */
export function canClose(closuresForOnePeriod: AttendanceMonthClosure[]): boolean {
  return currentClosureStatus(closuresForOnePeriod) === 'open'
}

/** 마감취소가 허용되는 상태인지 — 최신 버전이 'closed'여야 한다. */
export function canReopen(closuresForOnePeriod: AttendanceMonthClosure[]): boolean {
  return currentClosureStatus(closuresForOnePeriod) === 'closed'
}
