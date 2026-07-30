import { describe, it, expect } from 'vitest'
import { hueGap, matchColorId, resolveColorMap, rgbToHsv, type EventColorPalette } from './colors'

/**
 * 2026-07-30에 실제 colors.get으로 받은 event 팔레트(11색).
 * 응답의 updated가 2012-02-14라 팔레트는 사실상 고정이지만, 코드는 여전히 런타임에 조회한 값을
 * 쓴다 — 이 픽스처는 "그때 이런 값이었고 매칭 결과가 이랬다"를 고정하기 위한 것이다.
 */
const PALETTE: EventColorPalette = {
  '1': { background: '#a4bdfc', foreground: '#1d1d1d' },
  '2': { background: '#7ae7bf', foreground: '#1d1d1d' },
  '3': { background: '#dbadff', foreground: '#1d1d1d' },
  '4': { background: '#ff887c', foreground: '#1d1d1d' },
  '5': { background: '#fbd75b', foreground: '#1d1d1d' },
  '6': { background: '#ffb878', foreground: '#1d1d1d' },
  '7': { background: '#46d6db', foreground: '#1d1d1d' },
  '8': { background: '#e1e1e1', foreground: '#1d1d1d' },
  '9': { background: '#5484ed', foreground: '#1d1d1d' },
  '10': { background: '#51b749', foreground: '#1d1d1d' },
  '11': { background: '#dc2127', foreground: '#1d1d1d' },
}

describe('rgbToHsv', () => {
  it('무채색은 채도 0', () => {
    expect(rgbToHsv('#e1e1e1').s).toBe(0)
    expect(rgbToHsv('#616161').s).toBe(0)
  })

  it('기본 색상의 hue', () => {
    expect(Math.round(rgbToHsv('#ff0000').h)).toBe(0)
    expect(Math.round(rgbToHsv('#00ff00').h)).toBe(120)
    expect(Math.round(rgbToHsv('#0000ff').h)).toBe(240)
  })

  it('3자리 단축 표기도 읽는다', () => {
    expect(rgbToHsv('#fff').v).toBe(1)
    expect(rgbToHsv('#fff').s).toBe(0)
  })
})

describe('hueGap', () => {
  it('원형 거리 — 0도와 358도는 2도 차이', () => {
    expect(hueGap(0, 358)).toBe(2)
    expect(hueGap(358, 0)).toBe(2)
    expect(hueGap(10, 190)).toBe(180)
  })
})

/**
 * 확정 사양의 5색이 실제 팔레트에서 어디로 가는지 고정한다.
 * RGB 유클리드 거리로 고르면 보라→파랑, 회색→초록으로 잘못 잡히는 것을 실측으로 확인해
 * HSV 기준으로 바꿨다 — 이 테스트가 그 회귀를 막는다.
 */
describe('matchColorId — 확정 색상 매핑', () => {
  const cases: [string, string, string][] = [
    ['공고 보라', '#8e24aa', '3'],
    ['제출 노랑', '#f6bf26', '5'],
    ['면접 빨강', '#d50000', '11'],
    ['개찰 회색', '#616161', '8'],
    ['평가결과 통보 파랑', '#3f51b5', '9'],
  ]

  for (const [label, target, expected] of cases) {
    it(`${label} → colorId ${expected}`, () => {
      expect(matchColorId(target, PALETTE)).toBe(expected)
    })
  }

  it('5종이 서로 다른 ID로 배정된다 (색이 겹치면 구분이 안 된다)', () => {
    const ids = cases.map(([, target]) => matchColorId(target, PALETTE))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('회색 목표는 채도가 가장 낮은 항목을 고른다 (hue 비교로는 초록이 뽑혔다)', () => {
    expect(matchColorId('#616161', PALETTE)).toBe('8')
    expect(matchColorId('#000000', PALETTE)).toBe('8')
    expect(matchColorId('#ffffff', PALETTE)).toBe('8')
  })

  it('파랑은 채도가 맞는 진한 파랑(9)을 고른다 — 연한 라벤더(1)가 아니다', () => {
    expect(matchColorId('#3f51b5', PALETTE)).toBe('9')
  })

  it('팔레트가 비면 null (캘린더 기본색)', () => {
    expect(matchColorId('#8e24aa', {})).toBeNull()
  })
})

describe('resolveColorMap', () => {
  it('행위 7종 전부에 colorId가 배정된다', () => {
    const map = resolveColorMap(PALETTE)
    expect(map).toEqual({
      announce: '3',
      pq: '5',
      soq: '5',
      submit: '5',
      interview: '11',
      bid: '8',
      notify: '9',
    })
  })

  it('제출·PQ제출·SOQ제출은 같은 노란색을 쓴다', () => {
    const map = resolveColorMap(PALETTE)
    expect(map.pq).toBe(map.submit)
    expect(map.soq).toBe(map.submit)
  })
})
