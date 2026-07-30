import { describe, it, expect } from 'vitest'
import {
  buildCalendarDays, collectCalendarEntries, groupCalendarEntries,
  formatCalendarEntryText, CALENDAR_KINDS, CALENDAR_WEEK_COUNT, DAYS_PER_WEEK,
  ENTRY_PREFIX, ENTRY_SEPARATOR,
  estimateCalendarWeekHeights, estimateCalendarHeight, calendarTextWidth,
} from './monthlyCalendar'

// 기준값은 CM본부월업무계획(7.24).hwpx 실측이다:
//   기준일 2026-07-24(금) → 달력 첫 날 7/19(일), 3주(7/19~8/8)
//   일정 문구 "*프로젝트명-제출" (별표, 일반 하이픈 U+002D, 앞뒤 공백 없음)

describe('buildCalendarDays — 기준일 주의 일요일부터 3주', () => {
  it('7.24 기준 파일과 같은 범위를 만든다', () => {
    const days = buildCalendarDays({ year: 2026, month: 7, day: 24 })
    expect(days.length).toBe(CALENDAR_WEEK_COUNT * DAYS_PER_WEEK)
    expect(days.length).toBe(21)
    expect(days[0].iso).toBe('2026-07-19')
    expect(days[0].weekday).toBe(0) // 일요일
    expect(days[6].iso).toBe('2026-07-25')
    expect(days[20].iso).toBe('2026-08-08')
  })

  it('기준일이 주의 어디에 있어도 그 주 일요일부터 시작한다', () => {
    for (const day of [19, 20, 21, 22, 23, 24, 25]) {
      const days = buildCalendarDays({ year: 2026, month: 7, day })
      expect(days[0].iso).toBe('2026-07-19')
    }
    // 다음 주 일요일
    expect(buildCalendarDays({ year: 2026, month: 7, day: 26 })[0].iso).toBe('2026-07-26')
  })

  it('날짜 표기는 D, 매월 1일만 M/D', () => {
    const days = buildCalendarDays({ year: 2026, month: 7, day: 24 })
    expect(days[0].label).toBe('19')
    expect(days[6].label).toBe('25')
    const aug1 = days.find((d) => d.iso === '2026-08-01')
    expect(aug1?.label).toBe('8/1')
    const aug2 = days.find((d) => d.iso === '2026-08-02')
    expect(aug2?.label).toBe('2')
  })

  it('연도 경계도 이어진다', () => {
    const days = buildCalendarDays({ year: 2026, month: 12, day: 31 })
    expect(days[0].iso).toBe('2026-12-27')
    expect(days[20].iso).toBe('2027-01-16')
    expect(days.find((d) => d.iso === '2027-01-01')?.label).toBe('1/1')
  })

  it('요일이 일→토로 반복된다', () => {
    const days = buildCalendarDays({ year: 2026, month: 7, day: 24 })
    days.forEach((d, i) => expect(d.weekday).toBe(i % 7))
  })
})

describe('formatCalendarEntryText — 별표 + 일반 하이픈, 공백 없음', () => {
  it('기준 파일 형식과 일치한다', () => {
    expect(formatCalendarEntryText('26-A-00부대(A138)', '면접')).toBe('*26-A-00부대(A138)-면접')
    expect(formatCalendarEntryText('운정신도시 3지구 3BL', '개찰')).toBe('*운정신도시 3지구 3BL-개찰')
    expect(formatCalendarEntryText('26-U-왜관(E008)', '제출')).toBe('*26-U-왜관(E008)-제출')
  })
  it('구분자는 U+002D이고 EN DASH를 쓰지 않는다', () => {
    expect(ENTRY_PREFIX).toBe('*')
    expect(ENTRY_SEPARATOR).toBe('-')
    expect(ENTRY_SEPARATOR.charCodeAt(0)).toBe(0x2d)
    const text = formatCalendarEntryText('가나', '제출')
    expect(text).not.toContain('–')
    expect(text).not.toMatch(/[\s]-|-[\s]/) // 하이픈 앞뒤 공백 없음
  })
  it('도형 기호를 쓰지 않는다', () => {
    const text = formatCalendarEntryText('가나', '개찰')
    for (const sym of ['■', '▲', '◆', '▶', '●', '○']) expect(text).not.toContain(sym)
  })
})

describe('collectCalendarEntries', () => {
  const days = buildCalendarDays({ year: 2026, month: 7, day: 24 })

  it('제출·면접·개찰을 ISO 날짜로만 모은다', () => {
    const entries = collectCalendarEntries([{
      name: '안산 성포지구 주상복합 개발사업',
      submitDate: '2026-07-21', interviewDate: '2026-07-24', bidDate: '2026-07-30',
    }], days)
    expect(entries).toEqual([
      { iso: '2026-07-21', kind: '제출', text: '*안산 성포지구 주상복합 개발사업-제출' },
      { iso: '2026-07-24', kind: '면접', text: '*안산 성포지구 주상복합 개발사업-면접' },
      { iso: '2026-07-30', kind: '개찰', text: '*안산 성포지구 주상복합 개발사업-개찰' },
    ])
  })

  it('서면평가·추후·빈 값은 달력에 넣지 않는다', () => {
    const entries = collectCalendarEntries([{
      name: '진주시 보건소', submitDate: '2026-07-24',
      interviewDate: '서면평가', bidDate: '',
    }, {
      name: '당수변전소', submitDate: null, interviewDate: '추후', bidDate: undefined,
    }], days)
    expect(entries).toEqual([
      { iso: '2026-07-24', kind: '제출', text: '*진주시 보건소-제출' },
    ])
  })

  it('달력 범위 밖 날짜는 제외한다', () => {
    const entries = collectCalendarEntries([{
      name: '범위밖', submitDate: '2026-07-18', interviewDate: '2026-08-09', bidDate: '2026-08-08',
    }], days)
    expect(entries.map((e) => e.iso)).toEqual(['2026-08-08'])
  })

  it('이름이 비면 제외한다', () => {
    expect(collectCalendarEntries([{ name: '  ', submitDate: '2026-07-21' }], days)).toEqual([])
  })

  it('같은 날은 제출 → 면접 → 개찰 순으로 정렬된다', () => {
    const entries = collectCalendarEntries([
      { name: 'A', bidDate: '2026-07-22' },
      { name: 'B', interviewDate: '2026-07-22' },
      { name: 'C', submitDate: '2026-07-22' },
    ], days)
    expect(entries.map((e) => e.kind)).toEqual(['제출', '면접', '개찰'])
    expect(entries.map((e) => e.text)).toEqual(['*C-제출', '*B-면접', '*A-개찰'])
  })

  it('같은 날 같은 종류는 입력 순서를 유지한다', () => {
    const entries = collectCalendarEntries([
      { name: '첫째', submitDate: '2026-07-22' },
      { name: '둘째', submitDate: '2026-07-22' },
      { name: '셋째', submitDate: '2026-07-22' },
    ], days)
    expect(entries.map((e) => e.text)).toEqual(['*첫째-제출', '*둘째-제출', '*셋째-제출'])
  })

  it('날짜순으로 먼저 정렬된다', () => {
    const entries = collectCalendarEntries([
      { name: 'A', bidDate: '2026-07-20' },
      { name: 'B', submitDate: '2026-07-30' },
    ], days)
    expect(entries.map((e) => e.iso)).toEqual(['2026-07-20', '2026-07-30'])
  })

  it('정렬 우선순위 상수가 제출·면접·개찰 순서다', () => {
    expect(CALENDAR_KINDS).toEqual(['제출', '면접', '개찰'])
  })
})

describe('groupCalendarEntries', () => {
  it('날짜별로 묶고 순서를 유지한다', () => {
    const days = buildCalendarDays({ year: 2026, month: 7, day: 24 })
    const entries = collectCalendarEntries([
      { name: 'A', submitDate: '2026-07-22', bidDate: '2026-07-22' },
      { name: 'B', submitDate: '2026-07-23' },
    ], days)
    const grouped = groupCalendarEntries(entries)
    expect(grouped.get('2026-07-22')?.map((e) => e.text)).toEqual(['*A-제출', '*A-개찰'])
    expect(grouped.get('2026-07-23')?.map((e) => e.text)).toEqual(['*B-제출'])
    expect(grouped.get('2026-07-24')).toBeUndefined()
  })
})

// ── 달력 예상 높이 (한글 렌더 실측 대조) ────────────────────────────────────────
describe('estimateCalendarWeekHeights / estimateCalendarHeight', () => {
  const days = buildCalendarDays({ year: 2026, month: 7, day: 24 })
  const DECLARED_WEEK = 7778
  const HEADER = 1680
  const at = (iso: string, n: number, name = '가나다') =>
    Array.from({ length: n }, (_, i) => ({
      iso, kind: '제출' as const, text: formatCalendarEntryText(`${name}${i + 1}`, '제출'),
    }))

  it('일정이 없으면 선언 주 행 높이를 그대로 쓴다', () => {
    const weeks = estimateCalendarWeekHeights(days, [], DECLARED_WEEK)
    expect(weeks.map((w) => w.height)).toEqual([DECLARED_WEEK, DECLARED_WEEK, DECLARED_WEEK])
    expect(estimateCalendarHeight(days, [], HEADER, DECLARED_WEEK)).toBe(HEADER + DECLARED_WEEK * 3)
    expect(estimateCalendarHeight(days, [], HEADER, DECLARED_WEEK)).toBe(25014)
  })

  // 실측(수요일=넓은 열, 짧은 이름 1줄): 6건 → 7,770(선언 유지) / 7건 → 8,840 / 8건 → 9,880
  it('넓은 열은 6건까지 선언 높이, 7건부터 늘어난다(실측 대조)', () => {
    const h = (n: number) => estimateCalendarWeekHeights(days, at('2026-07-22', n), DECLARED_WEEK)[0].height
    expect(h(6)).toBe(DECLARED_WEEK)          // 계산 7,772 ≤ 7,778
    expect(h(7)).toBe(8842)                   // 실측 8,840
    expect(h(8)).toBe(9912)                   // 실측 9,880
    // 계산값은 실측보다 작지 않아야 한다(예산을 느슨하게 만들면 안 된다).
    expect(h(7)).toBeGreaterThanOrEqual(8840)
    expect(h(8)).toBeGreaterThanOrEqual(9880)
  })

  // 실측(토요일=좁은 열, 각 항목 2줄): 3건 → 7,770(선언 유지) / 4건 → 8,890 / 5건 → 10,760
  it('좁은 열(토)은 프로젝트명이 접혀 더 빨리 늘어난다(실측 대조)', () => {
    const h = (n: number) => estimateCalendarWeekHeights(days, at('2026-07-25', n, '가나다라마'), DECLARED_WEEK)[0].height
    expect(h(3)).toBe(DECLARED_WEEK)
    expect(h(4)).toBeGreaterThanOrEqual(8890)
    expect(h(5)).toBeGreaterThanOrEqual(10760)
  })

  it('한 주에서 가장 높은 셀이 그 주 행 높이를 결정한다', () => {
    const entries = [...at('2026-07-20', 1), ...at('2026-07-22', 8)]
    const weeks = estimateCalendarWeekHeights(days, entries, DECLARED_WEEK)
    expect(weeks[0].tallestIso).toBe('2026-07-22')
    expect(weeks[0].entryCount).toBe(9)
    expect(weeks[0].height).toBe(9912)
    expect(weeks[1].height).toBe(DECLARED_WEEK)
  })

  it('일정이 몰린 주만 늘어나고 달력 전체 높이에 반영된다', () => {
    const entries = at('2026-07-22', 8)
    const total = estimateCalendarHeight(days, entries, HEADER, DECLARED_WEEK)
    expect(total).toBe(HEADER + 9912 + DECLARED_WEEK * 2)
    expect(total).toBeGreaterThan(25014)
  })

  it('일요일도 좁은 열이라 같은 방식으로 반영된다', () => {
    expect(calendarTextWidth(0)).toBe(6368 - 682)
    expect(calendarTextWidth(6)).toBe(5804 - 682)
    expect(calendarTextWidth(3)).toBe(13249 - 682)
    const h = estimateCalendarWeekHeights(days, at('2026-07-19', 4, '가나다라마'), DECLARED_WEEK)[0].height
    expect(h).toBeGreaterThan(DECLARED_WEEK)
  })
})
