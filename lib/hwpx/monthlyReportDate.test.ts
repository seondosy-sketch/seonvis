import { describe, it, expect } from 'vitest'
import {
  parseMonthlyReportDate,
  formatMonthlyTitle,
  formatMonthlyAsOfCaption,
  formatMonthlyFilename,
  InvalidMonthlyReportDateError,
} from './monthlyReportDate'

describe('parseMonthlyReportDate', () => {
  it('reportYear/reportMonth만 있으면 asOfDate는 Asia/Seoul 기준 오늘로 채워진다', () => {
    const date = parseMonthlyReportDate({ reportYear: 2026, reportMonth: 7 })
    expect(date.reportYear).toBe(2026)
    expect(date.reportMonth).toBe(7)
    expect(date.asOf.year).toBeGreaterThanOrEqual(2000)
    expect(date.asOf.month).toBeGreaterThanOrEqual(1)
    expect(date.asOf.day).toBeGreaterThanOrEqual(1)
  })

  it('asOfDate가 명시되면 그 값을 그대로 쓴다(서버 시각 무관)', () => {
    const date = parseMonthlyReportDate({ reportYear: 2026, reportMonth: 8, asOfDate: '2026-07-31' })
    expect(date.asOf).toEqual({ year: 2026, month: 7, day: 31 })
  })

  it('요청 연·월이 서버 실행 시점과 달라도 요청값 그대로 유지된다', () => {
    // "서버 시각과 다른 연·월 요청" — 서버가 지금 몇 년/몇 월이든 이 값은 그대로 반환돼야 한다.
    const date = parseMonthlyReportDate({ reportYear: 2031, reportMonth: 1 })
    expect(date.reportYear).toBe(2031)
    expect(date.reportMonth).toBe(1)
  })

  it('1월/12월 경계를 정상 처리한다', () => {
    expect(parseMonthlyReportDate({ reportYear: 2026, reportMonth: 1 }).reportMonth).toBe(1)
    expect(parseMonthlyReportDate({ reportYear: 2026, reportMonth: 12 }).reportMonth).toBe(12)
    const jan1 = parseMonthlyReportDate({ reportYear: 2026, reportMonth: 1, asOfDate: '2026-01-01' })
    expect(jan1.asOf).toEqual({ year: 2026, month: 1, day: 1 })
    const dec31 = parseMonthlyReportDate({ reportYear: 2025, reportMonth: 12, asOfDate: '2025-12-31' })
    expect(dec31.asOf).toEqual({ year: 2025, month: 12, day: 31 })
  })

  it('reportMonth가 0 또는 13이면 실패한다', () => {
    expect(() => parseMonthlyReportDate({ reportYear: 2026, reportMonth: 0 }))
      .toThrow(InvalidMonthlyReportDateError)
    expect(() => parseMonthlyReportDate({ reportYear: 2026, reportMonth: 13 }))
      .toThrow(InvalidMonthlyReportDateError)
    try {
      parseMonthlyReportDate({ reportYear: 2026, reportMonth: 13 })
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidMonthlyReportDateError)
      expect((e as InvalidMonthlyReportDateError).code).toBe('INVALID_REPORT_MONTH')
    }
  })

  it('reportYear/reportMonth 누락 시 명확히 실패한다', () => {
    expect(() => parseMonthlyReportDate({ reportYear: undefined, reportMonth: 7 }))
      .toThrow(InvalidMonthlyReportDateError)
    expect(() => parseMonthlyReportDate({ reportYear: 2026, reportMonth: undefined }))
      .toThrow(InvalidMonthlyReportDateError)
    expect(() => parseMonthlyReportDate({ reportYear: null, reportMonth: null }))
      .toThrow(InvalidMonthlyReportDateError)
  })

  it('reportYear 범위 밖이면 실패한다', () => {
    expect(() => parseMonthlyReportDate({ reportYear: 1999, reportMonth: 1 }))
      .toThrow(InvalidMonthlyReportDateError)
    expect(() => parseMonthlyReportDate({ reportYear: 2101, reportMonth: 1 }))
      .toThrow(InvalidMonthlyReportDateError)
  })

  it('asOfDate 형식이 잘못되면 실패한다', () => {
    expect(() => parseMonthlyReportDate({ reportYear: 2026, reportMonth: 7, asOfDate: '2026/07/24' }))
      .toThrow(InvalidMonthlyReportDateError)
    expect(() => parseMonthlyReportDate({ reportYear: 2026, reportMonth: 7, asOfDate: '2026-02-30' }))
      .toThrow(InvalidMonthlyReportDateError)
    expect(() => parseMonthlyReportDate({ reportYear: 2026, reportMonth: 7, asOfDate: 'not-a-date' }))
      .toThrow(InvalidMonthlyReportDateError)
  })

  it('제목·기준일 캡션·파일명이 하나의 기준 날짜 계약에서 일관되게 파생된다', () => {
    const date = parseMonthlyReportDate({ reportYear: 2026, reportMonth: 8, asOfDate: '2026-07-31' })
    expect(formatMonthlyTitle(date)).toBe('2026년 8월 업무계획')
    expect(formatMonthlyAsOfCaption(date)).toBe('7월 31일 현재') // asOfDate 기준 — reportMonth(8)와 달라도 정상
    expect(formatMonthlyFilename(date)).toBe('미래사업팀_월간업무_202608.hwpx') // reportYear/reportMonth 기준(제목과 동일)
  })
})
