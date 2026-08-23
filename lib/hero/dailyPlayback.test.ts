import { describe, it, expect } from 'vitest'
import { kstTodayKey } from '@/lib/kstDate'
import { HERO_STORAGE_KEY, shouldAutoplay, type AutoplayInput } from '@/lib/hero/dailyPlayback'

const TODAY = '2026-08-22'

/** 기본은 "재생해야 하는" 상태 — 각 테스트는 바꿀 조건만 덮어쓴다. */
const input = (over: Partial<AutoplayInput> = {}): AutoplayInput => ({
  lastPlayed: null,
  todayKey: TODAY,
  reducedMotion: false,
  saveData: false,
  ...over,
})

describe('HERO_STORAGE_KEY', () => {
  it('키가 고정돼 있다 — 바뀌면 이미 오늘 본 사용자에게 영상이 다시 뜬다', () => {
    expect(HERO_STORAGE_KEY).toBe('futurehub:hero:last-played')
  })
})

describe('shouldAutoplay — 날짜', () => {
  it('저장된 기록이 없으면 재생한다', () => {
    expect(shouldAutoplay(input({ lastPlayed: null }))).toBe(true)
  })

  it('오늘 이미 봤으면 재생하지 않는다', () => {
    expect(shouldAutoplay(input({ lastPlayed: TODAY }))).toBe(false)
  })

  it('어제가 마지막이면 다시 재생한다', () => {
    expect(shouldAutoplay(input({ lastPlayed: '2026-08-21' }))).toBe(true)
  })

  it('미래 날짜(기기 시계 변경 등)도 오늘과 다르면 재생한다', () => {
    expect(shouldAutoplay(input({ lastPlayed: '2026-08-23' }))).toBe(true)
  })

  it('손상된 저장값은 "안 본 것"으로 보고 재생한다', () => {
    for (const bad of ['', 'abc', '2026-8-22', '20260822', 'null', '2026-08-22T00:00:00Z']) {
      expect(shouldAutoplay(input({ lastPlayed: bad }))).toBe(true)
    }
  })
})

describe('shouldAutoplay — 사용자 환경 설정', () => {
  it('prefers-reduced-motion이면 재생하지 않는다', () => {
    expect(shouldAutoplay(input({ reducedMotion: true }))).toBe(false)
  })

  it('save-data이면 재생하지 않는다', () => {
    expect(shouldAutoplay(input({ saveData: true }))).toBe(false)
  })

  it('환경 설정은 날짜보다 우선한다 — 아직 안 본 날이어도 막는다', () => {
    expect(shouldAutoplay(input({ lastPlayed: null, reducedMotion: true }))).toBe(false)
    expect(shouldAutoplay(input({ lastPlayed: '2026-08-21', saveData: true }))).toBe(false)
  })
})

describe('KST 날짜 경계', () => {
  // 자정 경계에서 날짜가 넘어가야 "다음 날 다시 1회"가 성립한다. 서버(UTC)와 무관하게
  // KST 기준이어야 하므로 lib/kstDate.ts의 규약을 그대로 검증한다.
  const beforeMidnightKst = new Date('2026-08-22T14:59:59Z') // KST 2026-08-22 23:59:59
  const afterMidnightKst = new Date('2026-08-22T15:00:00Z')  // KST 2026-08-23 00:00:00

  it('KST 자정을 넘기면 오늘 키가 바뀐다', () => {
    expect(kstTodayKey(beforeMidnightKst)).toBe('2026-08-22')
    expect(kstTodayKey(afterMidnightKst)).toBe('2026-08-23')
  })

  it('자정 직전에 본 사용자는 자정 직후에 다시 재생된다', () => {
    const lastPlayed = kstTodayKey(beforeMidnightKst)
    expect(shouldAutoplay(input({ lastPlayed, todayKey: kstTodayKey(beforeMidnightKst) }))).toBe(false)
    expect(shouldAutoplay(input({ lastPlayed, todayKey: kstTodayKey(afterMidnightKst) }))).toBe(true)
  })
})
