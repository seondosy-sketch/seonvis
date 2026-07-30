import { describe, it, expect } from 'vitest'
import {
  addDays,
  daysBetween,
  eachDate,
  mondayOf,
  monthGrid,
  sundayOf,
  weekKeysInRange,
  weekdayIndex,
} from './calendar'
import { kstToday, toDateKey } from './summary'

const d = (iso: string) => {
  const [y, m, day] = iso.split('-').map(Number)
  return new Date(y, m - 1, day)
}
const key = (x: Date) => toDateKey(x)

describe('mondayOf / sundayOf', () => {
  it('주 중간 날짜에서 그 주 월~일을 잡는다', () => {
    expect(key(mondayOf(d('2026-07-30')))).toBe('2026-07-27') // 목요일
    expect(key(sundayOf(d('2026-07-30')))).toBe('2026-08-02')
  })

  it('월요일·일요일 자신도 같은 주로 본다 (경계 포함)', () => {
    expect(key(mondayOf(d('2026-07-27')))).toBe('2026-07-27')
    expect(key(sundayOf(d('2026-07-27')))).toBe('2026-08-02')
    expect(key(mondayOf(d('2026-08-02')))).toBe('2026-07-27')
    expect(key(sundayOf(d('2026-08-02')))).toBe('2026-08-02')
  })

  it('연말·연초를 넘는 주도 정확하다', () => {
    // 2026-12-31(목)이 속한 주 = 12/28(월) ~ 1/3(일)
    expect(key(mondayOf(d('2026-12-31')))).toBe('2026-12-28')
    expect(key(sundayOf(d('2026-12-31')))).toBe('2027-01-03')
    // 2027-01-01(금)도 같은 주
    expect(key(mondayOf(d('2027-01-01')))).toBe('2026-12-28')
    expect(key(sundayOf(d('2027-01-01')))).toBe('2027-01-03')
  })
})

describe('weekdayIndex (월요일 시작)', () => {
  it('월=0 … 일=6', () => {
    expect(weekdayIndex(d('2026-07-27'))).toBe(0) // 월
    expect(weekdayIndex(d('2026-07-30'))).toBe(3) // 목
    expect(weekdayIndex(d('2026-08-01'))).toBe(5) // 토
    expect(weekdayIndex(d('2026-08-02'))).toBe(6) // 일
  })
})

/**
 * 월 그리드 — 4주/5주/6주, 월 시작 요일, 연 경계, 윤년을 모두 고정한다.
 * 렌더가 주 행 수에 따라 늘어나야 하므로 weeks 값이 계약이다.
 */
describe('monthGrid', () => {
  const cases: { label: string; base: string; grid: [string, string]; weeks: number; month: [string, string] }[] = [
    { label: '5주 (수요일 시작)', base: '2026-07-15', grid: ['2026-06-29', '2026-08-02'], weeks: 5, month: ['2026-07-01', '2026-07-31'] },
    { label: '6주 (토요일 시작 31일)', base: '2026-08-10', grid: ['2026-07-27', '2026-09-06'], weeks: 6, month: ['2026-08-01', '2026-08-31'] },
    { label: '4주 (월요일 시작 28일 = 앞뒤 여백 없음)', base: '2021-02-10', grid: ['2021-02-01', '2021-02-28'], weeks: 4, month: ['2021-02-01', '2021-02-28'] },
    { label: '일요일 시작', base: '2026-02-10', grid: ['2026-01-26', '2026-03-01'], weeks: 5, month: ['2026-02-01', '2026-02-28'] },
    { label: '월요일 시작', base: '2026-06-10', grid: ['2026-06-01', '2026-07-05'], weeks: 5, month: ['2026-06-01', '2026-06-30'] },
    { label: '12월 → 다음 해 1월', base: '2026-12-10', grid: ['2026-11-30', '2027-01-03'], weeks: 5, month: ['2026-12-01', '2026-12-31'] },
    { label: '1월 → 지난 해 12월', base: '2027-01-10', grid: ['2026-12-28', '2027-01-31'], weeks: 5, month: ['2027-01-01', '2027-01-31'] },
    { label: '윤년 2월 (29일)', base: '2028-02-10', grid: ['2028-01-31', '2028-03-05'], weeks: 5, month: ['2028-02-01', '2028-02-29'] },
  ]

  for (const c of cases) {
    it(c.label, () => {
      const g = monthGrid(d(c.base))
      expect([key(g.gridStart), key(g.gridEnd)]).toEqual(c.grid)
      expect([key(g.monthStart), key(g.monthEnd)]).toEqual(c.month)
      expect(g.weeks).toBe(c.weeks)
      // 그리드는 항상 월요일에 시작하고 일요일에 끝나며 7의 배수 칸이다
      expect(weekdayIndex(g.gridStart)).toBe(0)
      expect(weekdayIndex(g.gridEnd)).toBe(6)
      expect((daysBetween(g.gridStart, g.gridEnd) + 1) % 7).toBe(0)
      expect(eachDate(g.gridStart, g.gridEnd)).toHaveLength(c.weeks * 7)
    })
  }

  it('모든 달에서 weeks는 4~6이고 그리드가 그 달 전체를 덮는다', () => {
    for (let year = 2024; year <= 2030; year++) {
      for (let month = 0; month < 12; month++) {
        const g = monthGrid(new Date(year, month, 15))
        expect(g.weeks).toBeGreaterThanOrEqual(4)
        expect(g.weeks).toBeLessThanOrEqual(6)
        expect(g.gridStart <= g.monthStart).toBe(true)
        expect(g.gridEnd >= g.monthEnd).toBe(true)
      }
    }
  })

  it('월 라벨', () => {
    expect(monthGrid(d('2026-07-30')).monthLabel).toBe('2026년 7월')
    expect(monthGrid(d('2027-01-01')).monthLabel).toBe('2027년 1월')
  })

  /**
   * 월 경계는 KST 기준이어야 한다 — UTC로 아직 7/31 밤이어도 KST로 8/1이면 8월 달력을 그려야
   * 한다. monthGrid 자체는 이미 KST로 보정된 날짜를 받으므로 kstToday와 함께 검증한다.
   */
  it('KST 자정 직후에는 다음 달 달력이 된다', () => {
    // 2026-08-01 00:30 KST = 2026-07-31 15:30 UTC
    expect(monthGrid(kstToday(new Date('2026-07-31T15:30:00Z'))).monthLabel).toBe('2026년 8월')
    // 2026-07-31 23:30 KST = 2026-07-31 14:30 UTC → 아직 7월
    expect(monthGrid(kstToday(new Date('2026-07-31T14:30:00Z'))).monthLabel).toBe('2026년 7월')
    // 해가 바뀌는 경계: 2027-01-01 00:10 KST = 2026-12-31 15:10 UTC
    expect(monthGrid(kstToday(new Date('2026-12-31T15:10:00Z'))).monthLabel).toBe('2027년 1월')
  })
})

describe('weekKeysInRange', () => {
  it('범위가 걸치는 주를 빠짐없이, 중복 없이 낸다', () => {
    const g = monthGrid(d('2026-08-10')) // 6주
    const keys = weekKeysInRange(g.gridStart, g.gridEnd)
    expect(keys).toHaveLength(6)
    expect(new Set(keys).size).toBe(6)
    expect(keys[0]).toBe('2026-W30') // 7/27 월요일이 속한 주차
  })

  it('하루 범위도 그 주 1개를 낸다', () => {
    expect(weekKeysInRange(d('2026-07-30'), d('2026-07-30'))).toEqual(['2026-W30'])
  })

  it('연 경계에서도 주차 키가 이어진다', () => {
    const keys = weekKeysInRange(d('2026-12-20'), d('2027-01-10'))
    expect(keys).toHaveLength(4)
    expect(new Set(keys).size).toBe(4)
  })
})

describe('addDays / eachDate', () => {
  it('월 경계를 넘어간다', () => {
    expect(key(addDays(d('2026-07-31'), 1))).toBe('2026-08-01')
    expect(key(addDays(d('2027-01-01'), -1))).toBe('2026-12-31')
    expect(key(addDays(d('2028-02-28'), 1))).toBe('2028-02-29') // 윤년
  })

  it('eachDate는 양 끝을 포함한다', () => {
    const list = eachDate(d('2026-07-30'), d('2026-08-02'))
    expect(list.map(key)).toEqual(['2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02'])
  })
})
