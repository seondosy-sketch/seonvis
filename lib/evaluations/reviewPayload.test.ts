import { describe, expect, it } from 'vitest'
import { legacyYearFor } from './reviewPayload'

describe('legacyYearFor', () => {
  it('평가일이 없으면 연도를 그대로 남긴다', () => {
    expect(legacyYearFor('', 2015)).toBe(2015)
  })

  it('평가일과 연도가 같으면 그대로 남긴다', () => {
    expect(legacyYearFor('2015-03-04', 2015)).toBe(2015)
  })

  it('평가일과 연도가 어긋나면 연도를 버린다(DB CHECK 위반 방지)', () => {
    expect(legacyYearFor('2016-03-04', 2015)).toBeNull()
  })

  it('연도가 없으면 그대로 null이다', () => {
    expect(legacyYearFor('2015-03-04', null)).toBeNull()
  })
})
