import { describe, it, expect } from 'vitest'
import { dayLabel, inWeek, kstToday, kstTimeLabel, toDateKey } from './summary'
import { isStale } from './token'
import { getCurrentWeek, getWeekBounds } from '@/lib/weekSchedule'

/**
 * 위젯은 UTC 서버에서 렌더되므로 "KST 기준 오늘/이번 주"를 정확히 잡는 게 핵심이다.
 * 아래 테스트는 실행 환경의 시간대와 무관하게 성립해야 한다 — kstToday()가 UTC 게터로만
 * 계산하기 때문. (CI/로컬 시간대가 달라도 같은 결과)
 */
describe('kstToday', () => {
  it('UTC로는 아직 전날인 KST 이른 아침을 KST 날짜로 잡는다', () => {
    // 2026-07-30 08:00 KST = 2026-07-29 23:00 UTC
    const d = kstToday(new Date('2026-07-29T23:00:00Z'))
    expect(toDateKey(d)).toBe('2026-07-30')
  })

  it('KST 자정 직전은 아직 같은 날이다', () => {
    // 2026-07-30 23:59 KST = 2026-07-30 14:59 UTC
    const d = kstToday(new Date('2026-07-30T14:59:00Z'))
    expect(toDateKey(d)).toBe('2026-07-30')
  })

  it('KST 자정을 넘기면 다음 날로 넘어간다', () => {
    // 2026-07-31 00:00 KST = 2026-07-30 15:00 UTC
    const d = kstToday(new Date('2026-07-30T15:00:00Z'))
    expect(toDateKey(d)).toBe('2026-07-31')
  })

  it('시:분이 없는 자정 Date를 돌려준다 (달력 날짜 비교 규약)', () => {
    const d = kstToday(new Date('2026-07-29T23:00:00Z'))
    expect([d.getHours(), d.getMinutes(), d.getSeconds()]).toEqual([0, 0, 0])
  })
})

describe('kstTimeLabel', () => {
  it('UTC 시각을 KST 시:분으로 찍는다', () => {
    expect(kstTimeLabel(new Date('2026-07-29T23:05:00Z'))).toBe('08:05')
    expect(kstTimeLabel(new Date('2026-07-30T15:00:00Z'))).toBe('00:00')
  })
})

describe('주차 경계 (KST 월요일 오전)', () => {
  it('KST 월요일 오전이면 UTC로 일요일이어도 그 주(월~일)를 고른다', () => {
    // 2026-08-03(월) 08:00 KST = 2026-08-02(일) 23:00 UTC
    const today = kstToday(new Date('2026-08-02T23:00:00Z'))
    const { start, end } = getWeekBounds(getCurrentWeek(today))
    expect(toDateKey(start)).toBe('2026-08-03')
    expect(toDateKey(end)).toBe('2026-08-09')
  })

  it('일요일은 그 주의 마지막 날로 남는다', () => {
    // 2026-08-02(일) 12:00 KST = 2026-08-02 03:00 UTC
    const today = kstToday(new Date('2026-08-02T03:00:00Z'))
    const { start, end } = getWeekBounds(getCurrentWeek(today))
    expect(toDateKey(start)).toBe('2026-07-27')
    expect(toDateKey(end)).toBe('2026-08-02')
  })
})

describe('inWeek', () => {
  const start = new Date(2026, 6, 27) // 2026-07-27(월)
  const end = new Date(2026, 7, 2)    // 2026-08-02(일)

  it('주 경계 날짜를 포함하고 밖은 버린다', () => {
    const rows = [
      { date: '2026-07-26' }, // 밖(전주 일요일)
      { date: '2026-07-27' }, // 경계 시작
      { date: '2026-08-02' }, // 경계 끝
      { date: '2026-08-03' }, // 밖(다음주 월요일)
    ]
    expect(inWeek(rows, start, end).map(r => r.date)).toEqual(['2026-07-27', '2026-08-02'])
  })
})

describe('dayLabel', () => {
  it('M/D(요일) 형식으로 만든다', () => {
    expect(dayLabel(new Date(2026, 6, 30))).toBe('7/30(목)')
    expect(dayLabel(new Date(2026, 7, 2))).toBe('8/2(일)')
  })
})

describe('isStale (last_used_at 쓰기 스로틀)', () => {
  const now = new Date('2026-07-30T05:00:00Z')

  it('기록이 없으면 갱신 대상', () => {
    expect(isStale(null, now)).toBe(true)
    expect(isStale(undefined, now)).toBe(true)
  })

  it('1시간이 지나지 않았으면 DB를 쓰지 않는다', () => {
    expect(isStale('2026-07-30T04:59:00Z', now)).toBe(false)
    expect(isStale('2026-07-30T04:00:01Z', now)).toBe(false)
  })

  it('1시간 이상 지났으면 갱신한다', () => {
    expect(isStale('2026-07-30T04:00:00Z', now)).toBe(true)
    expect(isStale('2026-07-29T05:00:00Z', now)).toBe(true)
  })

  it('깨진 값은 갱신 대상으로 본다', () => {
    expect(isStale('not-a-date', now)).toBe(true)
  })
})
