import { describe, it, expect } from 'vitest'
import { formatMonthlyClient, MONTHLY_CLIENT_MAPPINGS } from './monthlyClient'

describe('formatMonthlyClient — 월간 표 발주처 표시명', () => {
  it('7.24 기준 파일에서 확인한 표기를 그대로 쓴다', () => {
    expect(formatMonthlyClient('국군재정관리단')).toBe('국군재정')
    expect(formatMonthlyClient('한국전력공사 중부건설본부')).toBe('한전(중부)')
    expect(formatMonthlyClient('수자원공사 금강유역본부')).toBe('한국수자원')
  })

  it('사용자 확정 매핑', () => {
    expect(formatMonthlyClient('한국토지주택공사')).toBe('LH')
    expect(formatMonthlyClient('한국수자원공사')).toBe('한국수자원')
  })

  it('같은 계열로 확장한 매핑', () => {
    expect(formatMonthlyClient('한국전력공사 경인건설본부 경기건설지사')).toBe('한전(경인)')
    expect(formatMonthlyClient('한국전력공사')).toBe('한전')
  })

  it('매핑에 없는 기관은 원문을 그대로 돌려준다', () => {
    for (const raw of ['안산시', '화성시', '진주시', '음성군', '파주시', '충주시',
      '국립한국교통대학교', '잠실5구역주택재건축정비조합', '현대건설컨소시엄PFV', '조달청(LH)']) {
      expect(formatMonthlyClient(raw)).toBe(raw)
    }
  })

  it('앞 N자 자동 절단을 하지 않는다', () => {
    const long = '한국토지주택공사 경기지역본부 주택사업처'
    expect(formatMonthlyClient(long)).toBe(long)
    expect(formatMonthlyClient(long).length).toBe(long.length)
  })

  it('부분 문자열로 추정하지 않는다 — 완전 일치만 치환한다', () => {
    // "한국전력공사"를 포함하지만 등록되지 않은 원문은 그대로 남는다.
    expect(formatMonthlyClient('한국전력공사 남부건설본부')).toBe('한국전력공사 남부건설본부')
    expect(formatMonthlyClient('국군재정관리단 제1지원팀')).toBe('국군재정관리단 제1지원팀')
  })

  it('앞뒤 공백만 정리하고, 빈 값은 빈 문자열이다', () => {
    expect(formatMonthlyClient('  국군재정관리단 ')).toBe('국군재정')
    expect(formatMonthlyClient('')).toBe('')
    expect(formatMonthlyClient(null)).toBe('')
    expect(formatMonthlyClient(undefined)).toBe('')
  })

  it('서로 다른 기관이 같은 표시명으로 충돌하지 않는다', () => {
    const displays = MONTHLY_CLIENT_MAPPINGS.map((m) => m.display)
    expect(new Set(displays).size).toBe(displays.length)
  })

  it('한 원문이 두 표시명에 중복 등록되지 않는다', () => {
    const seen = new Map<string, string>()
    for (const m of MONTHLY_CLIENT_MAPPINGS) {
      for (const s of m.sources) {
        const prev = seen.get(s)
        expect(prev == null || prev === m.display, `원문 중복: ${s}`).toBe(true)
        seen.set(s, m.display)
      }
    }
  })

  it('모든 매핑에 근거가 적혀 있다', () => {
    for (const m of MONTHLY_CLIENT_MAPPINGS) {
      expect(m.basis.trim().length).toBeGreaterThan(0)
      expect(m.sources.length).toBeGreaterThan(0)
    }
  })

  it('표시명은 발주처 열(텍스트 폭 4,276 / 8pt)에서 2줄 이내다', () => {
    // 8pt 한글 1자 = 800, ASCII 1자 = 400 → 한 줄에 한글 5자 정도.
    for (const m of MONTHLY_CLIENT_MAPPINGS) {
      let width = 0
      for (const ch of m.display) width += (ch.codePointAt(0) ?? 0) < 0x1100 ? 400 : 800
      expect(Math.ceil(width / 4276), m.display).toBeLessThanOrEqual(2)
    }
  })
})
