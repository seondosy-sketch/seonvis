import { describe, expect, it } from 'vitest'
import { addDays, buildCalendar, eachDate, missingHolidayYears, weekStartOf, weekdayOf, yearsInRange } from './calendar'
import { evaluateContinuity } from './continuity'
import { composeForDays, compositions, distributeWeekHours, isRepresentable, maxRepresentable, preferredCompositions, splitHours } from './hours'
import { createRng, deriveSeed, hashString } from './rng'
import { weeklyLoadSpread } from './distribution'

describe('rng — 결정적 난수', () => {
  it('같은 seed → 같은 수열, 다른 seed → 다른 수열', () => {
    const a = createRng(42), b = createRng(42), c = createRng(43)
    const seqA = Array.from({ length: 5 }, () => a.next())
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(seqA)
    expect(Array.from({ length: 5 }, () => c.next())).not.toEqual(seqA)
    for (const x of seqA) expect(x >= 0 && x < 1).toBe(true)
  })
  it('int 범위, shuffle은 원본을 바꾸지 않고 같은 원소를 유지', () => {
    const r = createRng(7)
    for (let i = 0; i < 100; i++) { const v = r.int(3); expect([0, 1, 2]).toContain(v) }
    const src = Object.freeze([1, 2, 3, 4, 5])
    const out = createRng(1).shuffle(src)
    expect([...out].sort()).toEqual([1, 2, 3, 4, 5])
    expect(createRng(1).shuffle(src)).toEqual(out)
    expect(() => r.int(0)).toThrow()
  })
  it('deriveSeed는 키마다 다르고 결정적이다', () => {
    expect(deriveSeed(42, 'e1')).toBe(deriveSeed(42, 'e1'))
    expect(deriveSeed(42, 'e1')).not.toBe(deriveSeed(42, 'e2'))
    expect(deriveSeed(42, 'e1', 'place')).not.toBe(deriveSeed(42, 'e1', 'hours'))
    expect(hashString('a')).not.toBe(hashString('b'))
  })
})

describe('calendar — 타임존 무관 날짜 계산', () => {
  it('요일과 월요일 시작 주', () => {
    expect(weekdayOf('2026-10-03')).toBe(6) // 토
    expect(weekdayOf('2026-10-05')).toBe(1) // 월
    expect(weekStartOf('2026-10-04')).toBe('2026-09-28') // 일요일은 그 주 월요일로
    expect(weekStartOf('2026-10-05')).toBe('2026-10-05')
    expect(weekStartOf('2027-01-01')).toBe('2026-12-28') // 연도 경계
  })
  it('기간 날짜·연도', () => {
    expect(eachDate('2026-09-29', '2026-10-02')).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'])
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(yearsInRange('2026-12-21', '2027-01-20')).toEqual([2026, 2027])
  })
  it('공휴일 데이터 누락 연도 — 두 연도에 걸치면 둘 다 필요', () => {
    expect(missingHolidayYears('2026-12-21', '2027-01-20', [2026])).toEqual([2027])
    expect(missingHolidayYears('2026-12-21', '2027-01-20', [2026, 2027])).toEqual([])
    expect(missingHolidayYears('2026-09-21', '2026-10-20', [])).toEqual([2026])
  })
  it('달력 — 주말·공휴일·공휴일명', () => {
    const cal = buildCalendar('2026-10-08', '2026-10-11', [{ date: '2026-10-09', name: '한글날' }])
    expect(cal.map(d => [d.date, d.is_weekend, d.is_holiday, d.holiday_name, d.week_start])).toEqual([
      ['2026-10-08', false, false, null, '2026-10-05'],
      ['2026-10-09', false, true, '한글날', '2026-10-05'],
      ['2026-10-10', true, false, null, '2026-10-05'],
      ['2026-10-11', true, false, null, '2026-10-05'],
    ])
  })
})

describe('hours — 2·3시간 조합', () => {
  it.each([
    [0, true], [1, false], [2, true], [3, true], [4, true], [2.5, false], [-2, false],
  ])('isRepresentable(%s) = %s', (h, ok) => { expect(isRepresentable(h)).toBe(ok) })

  it.each([
    [0, 0], [1, 0], [1.9, 0], [2, 2], [7.5, 7], [12.99, 12], [-3, 0],
  ])('maxRepresentable(%s) = %s', (r, m) => { expect(maxRepresentable(r)).toBe(m) })

  it.each([
    [0, []], [2, [2]], [3, [3]], [4, [2, 2]], [5, [2, 3]], [6, [3, 3]], [7, [2, 2, 3]], [8, [2, 3, 3]],
    [9, [2, 2, 2, 3]], [10, [2, 2, 3, 3]], [11, [2, 3, 3, 3]], [12, [2, 2, 2, 3, 3]],
  ])('splitHours(%s) — 혼합 우선, 1이 남지 않는다', (h, parts) => {
    expect(splitHours(h)).toEqual(parts)
    expect((splitHours(h) ?? []).reduce((a, b) => a + b, 0)).toBe(h)
  })

  it('1·소수는 조합 없음', () => {
    expect(splitHours(1)).toBeNull()
    expect(splitHours(4.5)).toBeNull()
  })

  it('greedy라면 1이 남는 4·7도 조정해서 정확히 맞춘다', () => {
    // 3시간 우선: 4 = 3 + 1(불가), 7 = 3 + 3 + 1(불가)
    expect(composeForDays(4, 2)).toEqual({ threes: 0, twos: 2 })
    expect(composeForDays(7, 3)).toEqual({ threes: 1, twos: 2 })
    expect(composeForDays(7, 2)).toBeNull()
  })

  it('preferredCompositions — 혼합 → 개수 차이 최소 → 일수 적음 (6은 결정적으로 3+3 다음 2+2+2)', () => {
    expect(preferredCompositions(12).map(c => [c.threes, c.twos])).toEqual([[2, 3], [4, 0], [0, 6]])
    expect(preferredCompositions(6).map(c => [c.threes, c.twos])).toEqual([[2, 0], [0, 3]])
    expect(preferredCompositions(11).map(c => [c.threes, c.twos])).toEqual([[3, 1], [1, 4]])
    expect(preferredCompositions(24)[0]).toEqual({ threes: 4, twos: 6, days: 10 })
    for (const h of [5, 7, 8, 9, 10, 11, 12]) {
      const c = preferredCompositions(h)[0]
      expect(c.threes > 0 && c.twos > 0).toBe(true)
    }
  })

  it('compositions — 가능한 모든 조합', () => {
    expect(compositions(12)).toEqual([{ threes: 0, twos: 6 }, { threes: 2, twos: 3 }, { threes: 4, twos: 0 }])
    expect(compositions(1)).toEqual([])
  })

  it('주별 배분 — 정확한 합계, 기본은 주별 합계를 고르게(balanced), front는 앞 주부터', () => {
    const weeks = [{ key: 'w1', days: 5, cap: 12 }, { key: 'w2', days: 2, cap: 12 }]
    expect(Object.fromEntries(distributeWeekHours(weeks, 16)!)).toEqual({ w1: 10, w2: 6 })
    expect(Object.fromEntries(distributeWeekHours(weeks, 16, 'front')!)).toEqual({ w1: 12, w2: 4 })
    // 잠금 시간(load)까지 합쳐 고르게: w1에 잠금 4h가 있으면 남는 1시간은 w2로 먼저
    expect(Object.fromEntries(distributeWeekHours([{ key: 'w1', days: 2, cap: 8, load: 4 }, { key: 'w2', days: 2, cap: 12 }], 9)!)).toEqual({ w1: 4, w2: 5 })
    expect(Object.fromEntries(distributeWeekHours(weeks, 14)!)).toEqual({ w1: 10, w2: 4 }) // 최소치 그대로
    expect(distributeWeekHours(weeks, 19)).toBeNull() // 최대 12 + 6 = 18
    expect(distributeWeekHours(weeks, 13)).toBeNull() // 최소 10 + 4 = 14
    expect(distributeWeekHours([{ key: 'w', days: 3, cap: 5 }], 6)).toBeNull() // 2일×2h=6 > 한도 5
  })
})

describe('continuity — 블록·전환·왕복', () => {
  const cal = buildCalendar('2026-10-05', '2026-10-18', [{ date: '2026-10-09', name: '한글날' }])
  const isWorkday = (d: string) => { const c = cal.find(x => x.date === d); return !!c && !c.is_weekend && !c.is_holiday }
  const between = (a: string, b: string) => eachDate(a, b).slice(1, -1)

  it('금요일 다음 월요일, 공휴일 다음 날은 같은 블록', () => {
    const r = evaluateContinuity([
      { date: '2026-10-08', project_id: 'A' }, // 목
      { date: '2026-10-12', project_id: 'A' }, // 월 (사이: 금=공휴일, 토, 일)
      { date: '2026-10-13', project_id: 'A' },
    ], isWorkday, between)
    expect(r.blocks).toBe(1)
    expect(r.switches).toBe(0)
  })
  it('사이에 쓰지 않은 평일이 있으면 블록이 끊긴다', () => {
    const r = evaluateContinuity([{ date: '2026-10-05', project_id: 'A' }, { date: '2026-10-07', project_id: 'A' }], isWorkday, between)
    expect(r.blocks).toBe(2)
  })
  it('A→B→A는 왕복 1회', () => {
    const r = evaluateContinuity([
      { date: '2026-10-05', project_id: 'A' }, { date: '2026-10-06', project_id: 'B' }, { date: '2026-10-07', project_id: 'A' },
    ], isWorkday, between)
    expect(r).toMatchObject({ blocks: 3, switches: 2, revisits: 1 })
    expect(r.blocksByProject.get('A')).toBe(2)
  })
  it('같은 블록 안 업무 전환 횟수', () => {
    const r = evaluateContinuity([
      { date: '2026-10-05', project_id: 'A', task_id: 't1' }, { date: '2026-10-06', project_id: 'A', task_id: 't1' },
      { date: '2026-10-07', project_id: 'A', task_id: 't2' },
    ], isWorkday, between)
    expect(r.taskSwitches).toBe(1)
  })
})

describe('distribution — 주간 분산 평가', () => {
  it('고르면 표준편차 0, 몰리면 커진다', () => {
    expect(weeklyLoadSpread([6, 6, 6, 6])).toMatchObject({ weeks: 4, activeWeeks: 4, mean: 6, stdev: 0, range: 0 })
    expect(weeklyLoadSpread([12, 12, 0, 0])).toMatchObject({ mean: 6, stdev: 6, max: 12, min: 0, range: 12, activeWeeks: 2 })
    expect(weeklyLoadSpread([0, 8, 10, 6]).stdev).toBeLessThan(weeklyLoadSpread([12, 12, 0, 0]).stdev)
    expect(weeklyLoadSpread([])).toMatchObject({ weeks: 0, stdev: 0 })
  })
})
