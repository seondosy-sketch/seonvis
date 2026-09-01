import { describe, it, expect } from 'vitest'
import { buildSchedule, fmtDate, getCurrentWeek, getWeekBounds, parseDate } from '@/lib/weekSchedule'
import type { PerformingProject } from '@/lib/supabase'

/**
 * 회귀 테스트: 연도 없는 "M/D" 날짜가 달력·금주 일정에 흘러 들어가면
 * 지난해 일정이 올해로 옮겨 붙는다.
 *
 * 실제로 겪은 증상 — 2025년 11~12월 프로젝트(잠실5단지, 765kV 신가평, 25-A-00부대,
 * 창원 주상복합)가 2026년 11~12월 달력에 찍혔다. 원인은 데이터를 넘기기 전에 fmtDate로
 * "M/D"까지 줄여 연도를 버린 것이었다(app/(dashboard)/page.tsx, lib/widget/summary.ts).
 */

const row = (over: Partial<PerformingProject>): PerformingProject => ({
  status: '진행중', name: '테스트', director: '',
  submit_date: '', interview_date: '', result_date: '',
  fee: null, note: '', sort_order: 0, week: '2026-W30',
  ...over,
})

describe('parseDate — 연도 처리', () => {
  it('ISO 날짜는 연도를 그대로 지킨다 (refYear를 무시)', () => {
    const d = parseDate('2025-11-25', 2026)!
    expect(d.getFullYear()).toBe(2025)
    expect(d.getMonth()).toBe(10) // 11월
    expect(d.getDate()).toBe(25)
  })

  it('"M/D"는 연도 정보가 없어 refYear가 붙는다 — 그래서 이 형식을 넘기면 안 된다', () => {
    // 이 동작 자체가 버그의 원인이었다. 계약을 못 박아 둔다.
    expect(parseDate('11/25', 2026)!.getFullYear()).toBe(2026)
    expect(parseDate('11/25', 2025)!.getFullYear()).toBe(2025)
  })

  it('미정 표기는 날짜가 없는 것으로 본다', () => {
    for (const v of ['', '추후', '-', null, undefined]) {
      expect(parseDate(v, 2026)).toBeNull()
    }
  })
})

describe('fmtDate — 표시용 축약', () => {
  it('ISO를 "M/D"로 줄인다 (표시 전용 — 저장·전달에 쓰면 연도가 사라진다)', () => {
    expect(fmtDate('2026-08-05')).toBe('8/5')
    expect(fmtDate('2025-11-25')).toBe('11/25')
  })

  it('연도를 버리므로 서로 다른 해의 같은 월·일이 구분되지 않는다', () => {
    expect(fmtDate('2025-12-24')).toBe(fmtDate('2026-12-24'))
  })
})

describe('buildSchedule — 금주 일정 추출', () => {
  const { start, end } = getWeekBounds('2026-W30') // 2026-07-27 ~ 08-02

  it('ISO로 넘기면 2025년 일정이 2026년 주에 섞이지 않는다', () => {
    const s = buildSchedule([
      row({ name: '잠실5단지', submit_date: '2025-11-25', interview_date: '2025-11-26' }),
      row({ name: '765kV 신가평', submit_date: '2025-12-04', result_date: '2025-12-24' }),
    ], start, end)
    expect(s.submit).toEqual([])
    expect(s.interview).toEqual([])
    expect(s.result).toEqual([])
  })

  it('그 주에 실제로 걸리는 ISO 일정만 뽑고, 표시는 "M/D"로 준다', () => {
    const s = buildSchedule([
      row({ name: '금주 제출', submit_date: '2026-07-29' }),
      row({ name: '다음주 제출', submit_date: '2026-08-05' }),
      row({ name: '경계 시작', submit_date: '2026-07-27' }),
      row({ name: '경계 끝', submit_date: '2026-08-02' }),
    ], start, end)
    expect(s.submit).toEqual([
      { name: '금주 제출', date: '7/29' },
      { name: '경계 시작', date: '7/27' },
      { name: '경계 끝', date: '8/2' },
    ])
  })

  it('연도 없는 "M/D"를 넘기면 지난해 일정이 이번 주로 잘못 들어온다 (넘기지 말아야 하는 이유)', () => {
    // 2025-07-29 일정을 "7/29"로 줄여서 넘긴 상황
    const s = buildSchedule([row({ name: '작년 제출', submit_date: '7/29' })], start, end)
    expect(s.submit).toHaveLength(1) // 2026년 주에 잘못 포함된다
  })

  it('이름이 없는 행은 무시한다', () => {
    expect(buildSchedule([row({ name: '', submit_date: '2026-07-29' })], start, end).submit).toEqual([])
  })
})


/**
 * 회귀 테스트: 주차 계산이 일요일에 한 주 밀리던 버그.
 *
 * 예전 식은 now.getTime()에서 주 시작을 그대로 빼서 diff가 시각을 포함한 소수였다. 주의
 * 마지막 날인 일요일은 자정을 조금만 넘겨도 (days+1)/7이 정수를 넘어 ceil이 다음 주로
 * 올라갔다 — 일요일 낮에 대시보드를 열면 없는 주차를 읽고, 그날 주간보고를 저장하면
 * performing_projects가 다음 주 칸에 들어갔다.
 */
describe('getCurrentWeek — 일요일 경계', () => {
  // 2026-08-31(월) ~ 2026-09-06(일)이 2026-W35다.
  const W35 = '2026-W35'

  it('주의 첫날인 월요일은 자정이든 낮이든 같은 주차다', () => {
    expect(getCurrentWeek(new Date(2026, 7, 31, 0, 0))).toBe(W35)
    expect(getCurrentWeek(new Date(2026, 7, 31, 12, 0))).toBe(W35)
  })

  it('주 중간(수요일)도 같은 주차다', () => {
    expect(getCurrentWeek(new Date(2026, 8, 2, 12, 0))).toBe(W35)
  })

  it('토요일 밤 늦게도 아직 같은 주차다', () => {
    expect(getCurrentWeek(new Date(2026, 8, 5, 23, 59))).toBe(W35)
  })

  it('주의 마지막 날인 일요일은 시각과 무관하게 같은 주차다(회귀)', () => {
    expect(getCurrentWeek(new Date(2026, 8, 6, 0, 0))).toBe(W35)
    expect(getCurrentWeek(new Date(2026, 8, 6, 9, 30))).toBe(W35)
    expect(getCurrentWeek(new Date(2026, 8, 6, 12, 0))).toBe(W35)
    expect(getCurrentWeek(new Date(2026, 8, 6, 23, 59))).toBe(W35)
  })

  it('다음 월요일이 되어야 다음 주차로 넘어간다', () => {
    expect(getCurrentWeek(new Date(2026, 8, 7, 0, 0))).toBe('2026-W36')
    expect(getCurrentWeek(new Date(2026, 8, 7, 12, 0))).toBe('2026-W36')
  })

  it('주차 문자열이 getWeekBounds와 앞뒤가 맞는다 — 일요일 낮 기준', () => {
    const sundayNoon = new Date(2026, 8, 6, 12, 0)
    const { start, end } = getWeekBounds(getCurrentWeek(sundayNoon))
    expect(start.getDate()).toBe(31) // 8/31 월
    expect(end.getDate()).toBe(6)    // 9/6 일
    // getWeekBounds의 start/end는 시:분 없는 "달력 날짜"다 — 시각이 붙은 값과 직접 부등호로
    // 비교하면 일요일 낮이 end(일요일 자정)보다 커서 범위 밖으로 나온다. 날짜끼리 비교한다.
    const sundayDate = new Date(2026, 8, 6)
    expect(sundayDate >= start && sundayDate <= end).toBe(true)
  })
})
