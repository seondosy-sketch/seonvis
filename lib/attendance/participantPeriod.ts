/**
 * 기술인 출근부 — 출근 체크 가능기간 계산 (사용자 확정사항 #3 반영).
 *
 * 기본기간 = 프로젝트 공고일 ~ 면접일. 관리자가 project_participants.participation_start/end로
 * 예외 조정하면 그 값이 우선한다(둘 다 date 타입 — "서면"/"추후"/"미정" 같은 비날짜 텍스트를
 * 이 컬럼에 저장하지 않는다. 그런 값은 projects.interview_date에 원래도 텍스트로 들어있을 수 있고
 * (docs/attendance/01-current-analysis.md §2.1), 여기서는 문자열째로 다루되 날짜 컬럼에는 절대 쓰지 않는다).
 *
 * 면접일이 없거나 날짜로 해석되지 않으면(미입력/서면/추후/미정 등) 종료일을 열어두지 않고,
 * "지금 조회 중인 회계월의 종료일(20일)까지만" 허용한다 — 사용자 확정사항 그대로.
 * 날짜 비교는 전부 YYYY-MM-DD 문자열 사전순 비교로 처리한다(docs/conventions.md가 경고하는
 * new Date("YYYY-MM-DD") UTC 파싱 버그를 피하기 위해 Date 객체를 아예 쓰지 않는다).
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function isIsoDate(value: string | null | undefined): boolean {
  return typeof value === 'string' && ISO_DATE.test(value.trim())
}

export interface AttendancePeriodInput {
  announceDate: string | null       // projects.announce_date
  interviewDate: string | null      // projects.interview_date (날짜이거나 "서면"/"추후" 등 자유 텍스트일 수 있음)
  participationStart: string | null // project_participants.participation_start (관리자 예외 조정)
  participationEnd: string | null   // project_participants.participation_end
  viewedPeriodEnd: string           // 지금 조회 중인 회계월의 종료일(YYYY-MM-DD, 대개 20일)
}

export interface AttendancePeriodResult {
  effectiveStart: string | null
  effectiveEnd: string | null
  warnings: string[]
}

export const ATTENDANCE_PERIOD_WARNINGS = {
  ANNOUNCE_DATE_MISSING: '공고일 미입력',
  INTERVIEW_DATE_MISSING: '면접일 미입력',
  SCHEDULE_UNCONFIRMED: '일정 미확정',
  CONFIRM_BEFORE_CLOSE: '월 마감 전 확인 필요',
} as const

/** 이 프로젝트·참여자 조합의 출근 체크 가능 기간(경계 포함)과 경고 목록을 계산한다. */
export function computeAttendancePeriod(input: AttendancePeriodInput): AttendancePeriodResult {
  const warnings: string[] = []

  const effectiveStart = input.participationStart ?? input.announceDate ?? null
  if (!effectiveStart) warnings.push(ATTENDANCE_PERIOD_WARNINGS.ANNOUNCE_DATE_MISSING)

  let effectiveEnd: string | null
  if (input.participationEnd) {
    // 관리자가 명시적으로 조정한 종료일이 항상 최우선
    effectiveEnd = input.participationEnd
  } else if (isIsoDate(input.interviewDate)) {
    effectiveEnd = input.interviewDate
  } else {
    // 면접일이 없거나(null/빈문자열) 비날짜 텍스트("서면"/"추후"/"미정" 등) — 종료일 없이 계속 열어두지 않고
    // 지금 조회 중인 회계월 말일까지만 허용한다.
    effectiveEnd = input.viewedPeriodEnd
    if (!input.interviewDate || !input.interviewDate.trim()) {
      warnings.push(ATTENDANCE_PERIOD_WARNINGS.INTERVIEW_DATE_MISSING)
    } else {
      warnings.push(ATTENDANCE_PERIOD_WARNINGS.SCHEDULE_UNCONFIRMED)
    }
    warnings.push(ATTENDANCE_PERIOD_WARNINGS.CONFIRM_BEFORE_CLOSE)
  }

  return { effectiveStart, effectiveEnd, warnings }
}

/** 특정 날짜가 체크 가능 기간(경계 포함) 안에 있는지. */
export function isDateWithinAttendancePeriod(result: AttendancePeriodResult, workDate: string): boolean {
  if (!result.effectiveStart || !result.effectiveEnd) return false
  return workDate >= result.effectiveStart && workDate <= result.effectiveEnd
}
