import { describe, it, expect } from 'vitest'
import { getCurrentWeek, getWeekBounds } from '@/lib/weekSchedule'
import {
  VISIBLE_WEEKS,
  HOME_ROW,
  gridWeekStart,
  highlightWeekStart,
  homeWindowTop,
  shiftWindow,
  buildWeekRows,
  weeksBetween,
} from '@/lib/calendarWindow'

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** 강조 주(일~토)의 끝 토요일 */
const endOf = (start: Date) => {
  const e = new Date(start)
  e.setDate(e.getDate() + 6)
  return e
}

/** 음영이 걸린 행 번호들 — WeeklyCalendar의 isInWeek과 같은 규칙 */
const shadedRows = (rows: Date[][], start: Date, end: Date) =>
  rows.flatMap((row, i) => (row.some(d => d >= start && d <= end) ? [i] : []))

// 2026-W30 = 2026-07-27(월) ~ 2026-08-02(일). 그 안의 오늘을 2026-07-31(금)로 잡는다.
const WEEK = '2026-W30'
const TODAY = new Date(2026, 6, 31)
const { start: PROP_START, end: PROP_END } = getWeekBounds(WEEK)
const HL_START = highlightWeekStart(PROP_START, PROP_END, TODAY)
const HL_END = endOf(HL_START)

describe('gridWeekStart', () => {
  it('행의 시작을 일요일로 맞춘다', () => {
    expect(ymd(gridWeekStart(new Date(2026, 6, 29)))).toBe('2026-07-26') // 수 → 직전 일요일
    expect(ymd(gridWeekStart(new Date(2026, 6, 26)))).toBe('2026-07-26') // 이미 일요일
    expect(ymd(gridWeekStart(new Date(2026, 7, 1)))).toBe('2026-07-26')  // 토 → 같은 행의 일요일
    expect(ymd(gridWeekStart(new Date(2026, 7, 2)))).toBe('2026-08-02')  // 다음 일요일
  })
})

describe('highlightWeekStart — 음영은 일~토 한 줄', () => {
  it('오늘이 속한 일~토 주를 강조한다', () => {
    expect(ymd(HL_START)).toBe('2026-07-26')
    expect(ymd(HL_END)).toBe('2026-08-01')
  })

  it('week 범위 안의 어떤 날이 오늘이어도 그날이 음영에 들어간다', () => {
    // 월~일 주(7/27~8/2)의 각 날을 오늘로 놓고 확인
    for (let i = 0; i < 7; i++) {
      const today = new Date(2026, 6, 27 + i)
      const s = highlightWeekStart(PROP_START, PROP_END, today)
      expect(today >= s && today <= endOf(s)).toBe(true)
      expect(s.getDay()).toBe(0) // 항상 일요일 시작
    }
  })

  it('오늘이 그 주 밖이면(과거·미래 주 조회) 주의 첫날 기준으로 강조한다', () => {
    const far = new Date(2027, 0, 15)
    expect(ymd(highlightWeekStart(PROP_START, PROP_END, far))).toBe(ymd(gridWeekStart(PROP_START)))
  })
})

describe('첫 화면', () => {
  const rows = buildWeekRows(homeWindowTop(HL_START))

  it('이번주가 정중앙(3번째 줄) 한 줄에만 음영으로 표시된다', () => {
    expect(rows).toHaveLength(VISIBLE_WEEKS)
    expect(shadedRows(rows, HL_START, HL_END)).toEqual([HOME_ROW])
  })

  it('음영 줄은 일요일~토요일이다', () => {
    expect(rows[HOME_ROW].map(ymd)).toEqual([
      '2026-07-26', '2026-07-27', '2026-07-28',
      '2026-07-29', '2026-07-30', '2026-07-31', '2026-08-01',
    ])
    expect(rows[HOME_ROW][0].getDay()).toBe(0) // 일요일이 맨 좌측
    expect(rows[HOME_ROW][6].getDay()).toBe(6) // 토요일이 맨 우측
  })

  it('오늘이 음영 줄 안에 있다', () => {
    expect(rows[HOME_ROW].map(ymd)).toContain(ymd(TODAY))
  })

  it('위로 2주(과거), 아래로 3주(미래)를 함께 보여준다', () => {
    expect(ymd(rows[0][0])).toBe('2026-07-12')
    expect(ymd(rows[VISIBLE_WEEKS - 1][6])).toBe('2026-08-22')
  })
})

describe('휠 스크롤', () => {
  const home = homeWindowTop(HL_START)

  it('미래로 옮기면 이번주 음영이 한 줄씩 위로 올라간다', () => {
    expect(shadedRows(buildWeekRows(shiftWindow(home, 1)), HL_START, HL_END)).toEqual([HOME_ROW - 1])
    expect(shadedRows(buildWeekRows(shiftWindow(home, 2)), HL_START, HL_END)).toEqual([HOME_ROW - 2])
  })

  it('과거로 옮기면 이번주 음영이 한 줄씩 아래로 내려간다', () => {
    expect(shadedRows(buildWeekRows(shiftWindow(home, -1)), HL_START, HL_END)).toEqual([HOME_ROW + 1])
    expect(shadedRows(buildWeekRows(shiftWindow(home, -3)), HL_START, HL_END)).toEqual([HOME_ROW + 3])
  })

  it('첫 주가 사라지고 마지막에 새 주가 올라온다', () => {
    const before = buildWeekRows(home)
    const after = buildWeekRows(shiftWindow(home, 1))
    // 이전 창의 2번째 행 이후 == 새 창의 1번째 행 이후 → 딱 한 주만 흘렀다
    expect(after.slice(0, VISIBLE_WEEKS - 1).map(r => r.map(ymd)))
      .toEqual(before.slice(1).map(r => r.map(ymd)))
    expect(ymd(before[0][0])).toBe('2026-07-12')          // 사라진 주
    expect(ymd(after[VISIBLE_WEEKS - 1][0])).toBe('2026-08-23') // 새로 올라온 주
  })

  it('과거·미래로 많이 옮기면 이번주 음영이 화면에서 사라진다', () => {
    expect(shadedRows(buildWeekRows(shiftWindow(home, 3)), HL_START, HL_END)).toEqual([])
    expect(shadedRows(buildWeekRows(shiftWindow(home, -4)), HL_START, HL_END)).toEqual([])
    expect(shadedRows(buildWeekRows(shiftWindow(home, 20)), HL_START, HL_END)).toEqual([])
    expect(shadedRows(buildWeekRows(shiftWindow(home, -20)), HL_START, HL_END)).toEqual([])
  })
})

describe('weeksBetween — 절대 위치를 창 오프셋으로 되돌린다', () => {
  const home = homeWindowTop(HL_START)

  it('shiftWindow의 역함수다', () => {
    for (const n of [-30, -7, -1, 0, 1, 5, 26, 60]) {
      expect(weeksBetween(home, shiftWindow(home, n))).toBe(n)
    }
  })

  it('‹ › 로 달을 건너뛰면 그 달 1일이 첫 행에 들어온다', () => {
    // WeeklyCalendar의 jumpMonth와 같은 계산: 목표 행 → 오프셋 → 창
    const jump = (year: number, month: number) => {
      const target = gridWeekStart(new Date(year, month, 1))
      return buildWeekRows(shiftWindow(home, weeksBetween(home, target)))
    }
    expect(jump(2026, 8)[0].map(ymd)).toContain('2026-09-01')
    expect(jump(2026, 5)[0].map(ymd)).toContain('2026-06-01')
  })
})

describe('이번주 버튼', () => {
  it('아무리 멀리 옮겼어도 첫 화면과 같은 창으로 돌아온다', () => {
    const home = homeWindowTop(HL_START)
    expect(shiftWindow(home, 17).getTime()).not.toBe(home.getTime())
    // 버튼은 오프셋을 0으로 되돌린다 — 몇 번 눌러도 같은 결과(멱등)
    expect(homeWindowTop(HL_START).getTime()).toBe(home.getTime())
    expect(shadedRows(buildWeekRows(homeWindowTop(HL_START)), HL_START, HL_END)).toEqual([HOME_ROW])
  })
})

describe('달·연 경계', () => {
  it('달 경계에서 끊기지 않고 하루도 빠짐없이 이어진다', () => {
    const flat = buildWeekRows(homeWindowTop(HL_START)).flat()
    expect(new Set(flat.map(d => d.getMonth())).size).toBeGreaterThan(1) // 7월+8월이 한 화면에
    for (let i = 1; i < flat.length; i++) {
      expect((flat[i].getTime() - flat[i - 1].getTime()) / 86400000).toBe(1)
    }
  })

  it('연말을 넘어가도 이어진다', () => {
    const { start, end } = getWeekBounds('2026-W52')
    const flat = buildWeekRows(homeWindowTop(highlightWeekStart(start, end, start))).flat()
    for (let i = 1; i < flat.length; i++) {
      expect((flat[i].getTime() - flat[i - 1].getTime()) / 86400000).toBe(1)
    }
    expect(new Set(flat.map(d => d.getFullYear())).size).toBe(2)
  })

  it('1년치 모든 주 × 그 주의 모든 날을 오늘로 놓아도 음영은 항상 3번째 줄 한 줄', () => {
    for (let w = 1; w <= 52; w++) {
      const { start, end } = getWeekBounds(`2026-W${String(w).padStart(2, '0')}`)
      for (let i = 0; i < 7; i++) {
        const today = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
        const hs = highlightWeekStart(start, end, today)
        const rows = buildWeekRows(homeWindowTop(hs))
        expect(shadedRows(rows, hs, endOf(hs))).toEqual([HOME_ROW])
        // 오늘이 항상 음영 줄에 들어간다
        expect(rows[HOME_ROW].map(ymd)).toContain(ymd(today))
      }
    }
  })

  it('오늘 기준 현재 주에도 성립한다', () => {
    const { start, end } = getWeekBounds(getCurrentWeek())
    const hs = highlightWeekStart(start, end, new Date())
    expect(shadedRows(buildWeekRows(homeWindowTop(hs)), hs, endOf(hs))).toEqual([HOME_ROW])
  })
})
