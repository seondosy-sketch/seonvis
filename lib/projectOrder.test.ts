import { describe, it, expect } from 'vitest'
import { compareProjectNumber, byProjectNumber } from './projectOrder'

const sortNumbers = (list: (string | null)[]) => [...list].sort(compareProjectNumber)

describe('compareProjectNumber', () => {
  it('공사번호 오름차순 — 프로젝트 List 화면과 같은 순서', () => {
    expect(sortNumbers(['2647', '2585', '2601'])).toEqual(['2585', '2601', '2647'])
  })

  it('자릿수가 달라도 숫자 크기로 비교한다', () => {
    expect(sortNumbers(['1000', '999', '2585'])).toEqual(['999', '1000', '2585'])
  })

  it('번호 없는 행(주간보고 수동 추가)은 항상 맨 뒤', () => {
    expect(sortNumbers(['2601', '', null, '2585'])).toEqual(['2585', '2601', '', null])
  })

  it('접두어가 붙은 번호도 사람이 기대하는 순서로 나온다', () => {
    expect(sortNumbers(['A10', 'A2', 'A1'])).toEqual(['A1', 'A2', 'A10'])
  })
})

describe('byProjectNumber', () => {
  const rows = [
    { num: '2647', name: '나 용역' },
    { num: '', name: '수동 추가 행' },
    { num: '2585', name: '가 용역' },
    { num: '2585', name: '가 용역(2공구)' },
  ]

  it('공사번호 → 용역명 순으로 정렬한다', () => {
    const sorted = [...rows].sort(byProjectNumber(r => r.num, r => r.name))
    expect(sorted.map(r => r.name)).toEqual(['가 용역', '가 용역(2공구)', '나 용역', '수동 추가 행'])
  })

  it('용역명 비교 인자를 생략하면 공사번호만 본다', () => {
    const sorted = [...rows].sort(byProjectNumber(r => r.num))
    expect(sorted[0].num).toBe('2585')
    expect(sorted[sorted.length - 1].num).toBe('')
  })
})
