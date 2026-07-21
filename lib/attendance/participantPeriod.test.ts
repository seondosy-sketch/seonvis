import { describe, expect, it } from 'vitest'
import {
  ATTENDANCE_PERIOD_WARNINGS,
  computeAttendancePeriod,
  isDateWithinAttendancePeriod,
} from './participantPeriod'

const base = {
  announceDate: '2026-06-01',
  interviewDate: '2026-07-15',
  participationStart: null,
  participationEnd: null,
  viewedPeriodEnd: '2026-08-20',
}

describe('computeAttendancePeriod', () => {
  it('면접일이 정상 날짜면 그 날짜가 종료일이 되고 경고가 없다', () => {
    const result = computeAttendancePeriod(base)
    expect(result).toEqual({ effectiveStart: '2026-06-01', effectiveEnd: '2026-07-15', warnings: [] })
  })

  it('면접일이 없으면(null) 조회 중인 기준월 20일까지만 허용 + 경고 2건', () => {
    const result = computeAttendancePeriod({ ...base, interviewDate: null })
    expect(result.effectiveEnd).toBe('2026-08-20')
    expect(result.warnings).toEqual([
      ATTENDANCE_PERIOD_WARNINGS.INTERVIEW_DATE_MISSING,
      ATTENDANCE_PERIOD_WARNINGS.CONFIRM_BEFORE_CLOSE,
    ])
  })

  it('면접일이 "서면"/"추후" 같은 비날짜 텍스트면 일정 미확정 경고 + 기준월 20일까지 허용', () => {
    const result = computeAttendancePeriod({ ...base, interviewDate: '추후' })
    expect(result.effectiveEnd).toBe('2026-08-20')
    expect(result.warnings).toEqual([
      ATTENDANCE_PERIOD_WARNINGS.SCHEDULE_UNCONFIRMED,
      ATTENDANCE_PERIOD_WARNINGS.CONFIRM_BEFORE_CLOSE,
    ])
  })

  it('"서면"/"추후" 값을 effectiveEnd(날짜 컬럼)에 절대 그대로 넣지 않는다', () => {
    const result = computeAttendancePeriod({ ...base, interviewDate: '서면' })
    expect(result.effectiveEnd).not.toBe('서면')
    expect(result.effectiveEnd).toBe('2026-08-20')
  })

  it('participationEnd(관리자 예외조정)가 있으면 면접일보다 우선한다', () => {
    const result = computeAttendancePeriod({ ...base, participationEnd: '2026-09-01' })
    expect(result.effectiveEnd).toBe('2026-09-01')
    expect(result.warnings).toEqual([])
  })

  it('participationStart(관리자 예외조정)가 있으면 공고일보다 우선한다', () => {
    const result = computeAttendancePeriod({ ...base, participationStart: '2026-06-10' })
    expect(result.effectiveStart).toBe('2026-06-10')
  })

  it('공고일이 없으면 시작일 미확정 경고', () => {
    const result = computeAttendancePeriod({ ...base, announceDate: null })
    expect(result.effectiveStart).toBeNull()
    expect(result.warnings).toContain(ATTENDANCE_PERIOD_WARNINGS.ANNOUNCE_DATE_MISSING)
  })
})

describe('isDateWithinAttendancePeriod', () => {
  it('경계값(시작일·종료일 자체)을 포함한다', () => {
    const result = computeAttendancePeriod(base)
    expect(isDateWithinAttendancePeriod(result, '2026-06-01')).toBe(true)
    expect(isDateWithinAttendancePeriod(result, '2026-07-15')).toBe(true)
  })

  it('공고일 이전 날짜는 체크 불가', () => {
    const result = computeAttendancePeriod(base)
    expect(isDateWithinAttendancePeriod(result, '2026-05-31')).toBe(false)
  })

  it('면접일 이후 날짜는 체크 불가', () => {
    const result = computeAttendancePeriod(base)
    expect(isDateWithinAttendancePeriod(result, '2026-07-16')).toBe(false)
  })

  it('시작/종료일이 확정되지 않으면(공고일 없음) 어떤 날짜도 체크 불가', () => {
    const result = computeAttendancePeriod({ ...base, announceDate: null })
    expect(isDateWithinAttendancePeriod(result, '2026-06-01')).toBe(false)
  })
})
