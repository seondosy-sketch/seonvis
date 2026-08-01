import { describe, expect, it } from 'vitest'
import { checkInIsInMonth, isDateOccupied, monthBounds, monthRangeInclusive, nightsOverlappingMonth } from './monthRange'

describe('monthBounds', () => {
  it('일반적인 달', () => {
    expect(monthBounds(2026, 8)).toEqual({ monthStart: '2026-08-01', nextMonthStart: '2026-09-01' })
  })
  it('12월은 다음해 1월로 넘어간다', () => {
    expect(monthBounds(2026, 12)).toEqual({ monthStart: '2026-12-01', nextMonthStart: '2027-01-01' })
  })
})

describe('isDateOccupied', () => {
  const stay = { check_in: '2026-08-15', check_out: '2026-08-17' }
  it('체크인일은 포함', () => {
    expect(isDateOccupied(stay, '2026-08-15')).toBe(true)
  })
  it('중간일은 포함', () => {
    expect(isDateOccupied(stay, '2026-08-16')).toBe(true)
  })
  it('체크아웃일은 미포함', () => {
    expect(isDateOccupied(stay, '2026-08-17')).toBe(false)
  })
  it('범위 밖은 미포함', () => {
    expect(isDateOccupied(stay, '2026-08-14')).toBe(false)
  })
})

describe('월 경계를 걸치는 숙박 (1/31 체크인 ~ 2/2 체크아웃)', () => {
  const stay = { check_in: '2026-01-31', check_out: '2026-02-02' }

  it('1월에 겹치는 박수는 1박(1/31 하루)', () => {
    expect(nightsOverlappingMonth(stay, 2026, 1)).toBe(1)
  })
  it('2월에 겹치는 박수는 1박(2/1 하루, 2/2는 체크아웃일이라 미포함)', () => {
    expect(nightsOverlappingMonth(stay, 2026, 2)).toBe(1)
  })
  it('전체 박수(2박)와 월별 겹침의 합이 같다', () => {
    const jan = nightsOverlappingMonth(stay, 2026, 1)
    const feb = nightsOverlappingMonth(stay, 2026, 2)
    expect(jan + feb).toBe(2)
  })
  it('3월과는 겹치지 않는다', () => {
    expect(nightsOverlappingMonth(stay, 2026, 3)).toBe(0)
  })

  it('체크인월(1월)에만 재무 귀속 대상', () => {
    expect(checkInIsInMonth(stay, 2026, 1)).toBe(true)
    expect(checkInIsInMonth(stay, 2026, 2)).toBe(false)
  })
})

describe('monthRangeInclusive', () => {
  it('말일을 포함하는 범위를 준다', () => {
    expect(monthRangeInclusive(2026, 8)).toEqual({ start: '2026-08-01', end: '2026-08-31' })
    expect(monthRangeInclusive(2026, 4)).toEqual({ start: '2026-04-01', end: '2026-04-30' })
  })
  it('2월 말일은 윤년 여부를 따른다', () => {
    expect(monthRangeInclusive(2026, 2).end).toBe('2026-02-28')
    expect(monthRangeInclusive(2028, 2).end).toBe('2028-02-29')
  })
})

describe('월 안에 완전히 포함되는 숙박', () => {
  const stay = { check_in: '2026-08-10', check_out: '2026-08-12' }
  it('그 달에 겹치는 박수는 전체 박수와 같다', () => {
    expect(nightsOverlappingMonth(stay, 2026, 8)).toBe(2)
  })
  it('다른 달과는 겹치지 않는다', () => {
    expect(nightsOverlappingMonth(stay, 2026, 7)).toBe(0)
    expect(nightsOverlappingMonth(stay, 2026, 9)).toBe(0)
  })
})
