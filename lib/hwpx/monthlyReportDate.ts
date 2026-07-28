// 월간 HWPX의 "기준 날짜" 계약 — 순수 함수, XML을 다루지 않는다.
//
// 문제(Codex P1-4): 기존 generateMonthly()는 요청받은 week를 쓰지 않고, 제목·기준일 캡션·
// 파일명이 전부 서버의 암묵적 new Date()(서버 로컬 타임존)에서 파생됐다. 요청 시점과 서버
// 실행 시점의 월이 다르면 어긋나고, 서버 타임존이 UTC이면 자정 근처에서 한국 날짜와도 어긋난다.
//
// 해결: 요청 바디에 reportYear/reportMonth를 명시적으로 받는다(제목·파일명의 기준).
// asOfDate는 선택 — 있으면 기준일 캡션이 이 날짜를 쓰고, 없으면 "오늘"을 Asia/Seoul 기준으로
// 명시적으로 계산해서 쓴다(서버 로컬 타임존에 의존하지 않음).

export class InvalidMonthlyReportDateError extends Error {
  code: string
  constructor(message: string, code: string) {
    super(message)
    this.code = code
  }
}

export interface MonthlyReportDateInput {
  reportYear: unknown
  reportMonth: unknown
  asOfDate?: unknown
}

export interface MonthlyReportDate {
  reportYear: number
  reportMonth: number
  /** 기준일 캡션에 쓸 날짜 — asOfDate가 있으면 그 값, 없으면 Asia/Seoul 기준 "오늘". */
  asOf: { year: number; month: number; day: number }
}

const MIN_YEAR = 2000
const MAX_YEAR = 2100
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12) return false
  const daysInMonth = new Date(year, month, 0).getDate() // month(1-based)+0 = 이전달 말일 트릭
  return day >= 1 && day <= daysInMonth
}

// Asia/Seoul 기준 "오늘"을 서버 로컬 타임존과 무관하게 계산한다. Intl.DateTimeFormat의
// timeZone 옵션은 서버 프로세스의 TZ 설정을 우회해 항상 지정한 타임존으로 값을 낸다.
function seoulToday(): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value)
  return { year: get('year'), month: get('month'), day: get('day') }
}

/** 요청 바디에서 월간 기준 날짜 계약을 검증·해석한다. 실패 시 InvalidMonthlyReportDateError. */
export function parseMonthlyReportDate(input: MonthlyReportDateInput): MonthlyReportDate {
  const { reportYear, reportMonth, asOfDate } = input

  if (reportYear == null || typeof reportYear !== 'number' || !Number.isInteger(reportYear)) {
    throw new InvalidMonthlyReportDateError(
      'reportYear는 정수여야 합니다.', 'INVALID_REPORT_YEAR'
    )
  }
  if (reportYear < MIN_YEAR || reportYear > MAX_YEAR) {
    throw new InvalidMonthlyReportDateError(
      `reportYear는 ${MIN_YEAR}~${MAX_YEAR} 범위여야 합니다 (입력: ${reportYear}).`, 'INVALID_REPORT_YEAR'
    )
  }

  if (reportMonth == null || typeof reportMonth !== 'number' || !Number.isInteger(reportMonth)) {
    throw new InvalidMonthlyReportDateError(
      'reportMonth는 정수여야 합니다.', 'INVALID_REPORT_MONTH'
    )
  }
  if (reportMonth < 1 || reportMonth > 12) {
    throw new InvalidMonthlyReportDateError(
      `reportMonth는 1~12 범위여야 합니다 (입력: ${reportMonth}).`, 'INVALID_REPORT_MONTH'
    )
  }

  let asOf: { year: number; month: number; day: number }
  if (asOfDate != null) {
    if (typeof asOfDate !== 'string' || !ISO_DATE_RE.test(asOfDate)) {
      throw new InvalidMonthlyReportDateError(
        `asOfDate는 'YYYY-MM-DD' 형식의 문자열이어야 합니다 (입력: ${String(asOfDate)}).`, 'INVALID_AS_OF_DATE'
      )
    }
    const m = ISO_DATE_RE.exec(asOfDate)!
    const year = Number(m[1]), month = Number(m[2]), day = Number(m[3])
    if (!isValidCalendarDate(year, month, day)) {
      throw new InvalidMonthlyReportDateError(
        `asOfDate가 유효한 날짜가 아닙니다 (입력: ${asOfDate}).`, 'INVALID_AS_OF_DATE'
      )
    }
    asOf = { year, month, day }
  } else {
    asOf = seoulToday()
  }

  return { reportYear, reportMonth, asOf }
}

/** "2026년 7월 업무계획" — reportYear/reportMonth에서만 파생(서버 시각과 무관). */
export function formatMonthlyTitle(date: MonthlyReportDate): string {
  return `${date.reportYear}년 ${date.reportMonth}월 업무계획`
}

/** "7월 24일 현재" — asOf(요청의 asOfDate 또는 Asia/Seoul 기준 오늘)에서 파생. */
export function formatMonthlyAsOfCaption(date: MonthlyReportDate): string {
  return `${date.asOf.month}월 ${date.asOf.day}일 현재`
}

/** "미래사업팀_월간업무_202607.hwpx" — reportYear/reportMonth에서만 파생(제목과 동일 기준). */
export function formatMonthlyFilename(date: MonthlyReportDate): string {
  return `미래사업팀_월간업무_${date.reportYear}${String(date.reportMonth).padStart(2, '0')}.hwpx`
}
