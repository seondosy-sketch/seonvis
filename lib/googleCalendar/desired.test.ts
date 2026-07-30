import { describe, it, expect } from 'vitest'
import {
  buildDesiredEvents,
  exclusiveEndDate,
  isExcludedProject,
  makeFingerprint,
  parseIsoDate,
  type CalendarProjectRow,
  type CalendarTooltipRow,
} from './desired'

const TODAY = '2026-07-30'
const COLORS = { announce: '3', pq: '5', soq: '5', submit: '5', interview: '11', bid: '8', notify: '9' } as const

function project(over: Partial<CalendarProjectRow> = {}): CalendarProjectRow {
  return {
    id: 'p1',
    project_number: '2645',
    name: '345kV 신석문 변전소 신축공사',
    announce_date: null,
    submit_date: null,
    interview_date: null,
    bid_date: null,
    status_override: null,
    participants: null,
    evaluation: null,
    ...over,
  }
}

function tooltip(over: Partial<CalendarTooltipRow> = {}): CalendarTooltipRow {
  return { project_number: '2645', pq_date: null, soq_date: null, notify_date: null, ...over }
}

describe('parseIsoDate', () => {
  it('YYYY-MM-DD만 통과한다', () => {
    expect(parseIsoDate('2026-07-30')).toBe('2026-07-30')
  })

  it('실제 데이터에 있는 비날짜 값은 전부 거른다', () => {
    for (const raw of ['', '  ', null, undefined, '추후', '서면', '미정', '-', '2/25', '1/28', '2026.07.30', '26-07-30']) {
      expect(parseIsoDate(raw)).toBeNull()
    }
  })

  it('존재하지 않는 날짜는 거른다', () => {
    expect(parseIsoDate('2026-02-30')).toBeNull()
    expect(parseIsoDate('2026-13-01')).toBeNull()
    expect(parseIsoDate('2028-02-29')).toBe('2028-02-29') // 윤년은 통과
  })
})

describe('exclusiveEndDate', () => {
  it('종일 일정의 end는 다음 날', () => {
    expect(exclusiveEndDate('2026-07-30')).toBe('2026-07-31')
  })

  it('월·연 경계와 윤년', () => {
    expect(exclusiveEndDate('2026-07-31')).toBe('2026-08-01')
    expect(exclusiveEndDate('2026-12-31')).toBe('2027-01-01')
    expect(exclusiveEndDate('2028-02-28')).toBe('2028-02-29')
    expect(exclusiveEndDate('2028-02-29')).toBe('2028-03-01')
  })
})

describe('isExcludedProject — 대시보드와 같은 기준', () => {
  it('취소·드랍·드롭·자사 수주를 제외한다', () => {
    expect(isExcludedProject(project({ status_override: '취소' }))).toBe(true)
    expect(isExcludedProject(project({ participants: '9개사(드랍)' }))).toBe(true)
    expect(isExcludedProject(project({ participants: '드롭' }))).toBe(true)
    expect(isExcludedProject(project({ evaluation: '선' }))).toBe(true)
  })

  it('일반 프로젝트는 포함한다', () => {
    expect(isExcludedProject(project({ participants: '9개사', evaluation: '타사' }))).toBe(false)
  })
})

describe('buildDesiredEvents', () => {
  it('행위 7종을 각각 뽑고 제목·색을 채운다', () => {
    const r = buildDesiredEvents(
      [project({
        announce_date: '2026-08-01',
        submit_date: '2026-08-10',
        interview_date: '2026-08-20',
        bid_date: '2026-08-25',
      })],
      [tooltip({ pq_date: '2026-08-05', soq_date: '2026-08-07', notify_date: '2026-08-28' })],
      TODAY, COLORS,
    )
    expect(r.events).toHaveLength(7)
    const byAction = Object.fromEntries(r.events.map(e => [e.action, e]))
    // 프로젝트명은 정제된 값 — '신축공사'가 빠진다
    expect(byAction.announce.title).toBe('[345kV 신석문 변전소] 공고')
    expect(byAction.pq.title).toBe('[345kV 신석문 변전소] PQ제출')
    expect(byAction.soq.title).toBe('[345kV 신석문 변전소] SOQ제출')
    expect(byAction.submit.title).toBe('[345kV 신석문 변전소] 제출')
    expect(byAction.interview.title).toBe('[345kV 신석문 변전소] 면접')
    expect(byAction.bid.title).toBe('[345kV 신석문 변전소] 개찰')
    expect(byAction.notify.title).toBe('[345kV 신석문 변전소] 평가결과 통보')
    expect(byAction.bid.colorId).toBe('8')
    expect(byAction.interview.colorId).toBe('11')
  })

  it('제출·PQ제출·SOQ제출을 하나로 합치지 않는다', () => {
    const r = buildDesiredEvents(
      [project({ submit_date: '2026-08-10' })],
      [tooltip({ pq_date: '2026-08-05', soq_date: '2026-08-07' })],
      TODAY, COLORS,
    )
    expect(r.events.map(e => e.action).sort()).toEqual(['pq', 'soq', 'submit'])
    expect(new Set(r.events.map(e => e.title)).size).toBe(3)
  })

  it('오늘 일정은 포함하고 어제 일정은 제외한다', () => {
    const r = buildDesiredEvents(
      [
        project({ id: 'today', submit_date: TODAY }),
        project({ id: 'past', project_number: 'x', submit_date: '2026-07-29' }),
      ],
      [], TODAY, COLORS,
    )
    expect(r.events.map(e => e.projectId)).toEqual(['today'])
  })

  it('이미 동기화한 일정은 과거가 되어도 유지한다 (시간이 지났다는 이유로 지우지 않는다)', () => {
    const r = buildDesiredEvents(
      [project({ id: 'p1', submit_date: '2026-07-20' })],
      [], TODAY, COLORS,
      new Set(['p1:submit']),
    )
    expect(r.events).toHaveLength(1)
    expect(r.events[0].date).toBe('2026-07-20')
  })

  /**
   * 소급(backfill) — 지난 공고일을 한 번 채워 넣기 위한 예외 경로.
   * 잘못 동작하면 캘린더가 옛 일정으로 오염되므로 경계를 고정한다.
   */
  describe('backfillFromKey', () => {
    const past = (id: string, date: string) => project({ id, project_number: id, announce_date: date })

    it('기준일을 주면 그 날짜부터의 과거 일정도 만든다', () => {
      const r = buildDesiredEvents(
        [past('a', '2026-07-10'), past('b', '2026-07-28')],
        [], TODAY, COLORS, new Set(), '2026-07-09',
      )
      expect(r.events.map(e => e.date).sort()).toEqual(['2026-07-10', '2026-07-28'])
      expect(r.events.every(e => e.action === 'announce')).toBe(true)
    })

    it('기준일보다 더 과거는 여전히 만들지 않는다', () => {
      const r = buildDesiredEvents(
        [past('old', '2026-07-08'), past('in', '2026-07-09')],
        [], TODAY, COLORS, new Set(), '2026-07-09',
      )
      expect(r.events.map(e => e.projectId)).toEqual(['in'])
    })

    it('기준일을 주지 않으면 기존대로 오늘 이후만 (기본 동작 불변)', () => {
      const r = buildDesiredEvents([past('a', '2026-07-10')], [], TODAY, COLORS)
      expect(r.events).toHaveLength(0)
    })

    it('기준일이 오늘보다 미래여도 오늘 기준으로 동작한다 (잘못된 입력 방어)', () => {
      const r = buildDesiredEvents(
        [past('a', TODAY), past('b', '2026-08-05')],
        [], TODAY, COLORS, new Set(), '2026-12-31',
      )
      expect(r.events.map(e => e.projectId).sort()).toEqual(['a', 'b'])
    })

    it('소급으로 만든 일정은 이후 일반 동기화에서 유지된다 (삭제되지 않는다)', () => {
      // 1회차: 소급으로 생성
      const first = buildDesiredEvents([past('a', '2026-07-10')], [], TODAY, COLORS, new Set(), '2026-07-09')
      expect(first.events).toHaveLength(1)
      // 2회차: 소급 없이 실행 — 이미 동기화된 키라서 계속 대상으로 남는다
      const second = buildDesiredEvents([past('a', '2026-07-10')], [], TODAY, COLORS, new Set(['a:announce']))
      expect(second.events).toHaveLength(1)
      expect(second.events[0].date).toBe('2026-07-10')
    })

    it('소급이어도 취소·드랍 프로젝트는 제외한다', () => {
      const r = buildDesiredEvents(
        [project({ id: 'x', announce_date: '2026-07-10', status_override: '취소' })],
        [], TODAY, COLORS, new Set(), '2026-07-09',
      )
      expect(r.events).toHaveLength(0)
      expect(r.excludedProjects).toBe(1)
    })
  })

  it('날짜가 없으면 아무 일정도 만들지 않는다', () => {
    const r = buildDesiredEvents([project()], [tooltip()], TODAY, COLORS)
    expect(r.events).toHaveLength(0)
    expect(r.skipped).toHaveLength(0)
  })

  it('날짜 형식이 아닌 값은 건너뛰고 원본과 함께 보고한다', () => {
    const r = buildDesiredEvents(
      [project({ announce_date: '2/25' })],
      [tooltip({ notify_date: '추후', pq_date: '' })],
      TODAY, COLORS,
    )
    expect(r.events).toHaveLength(0)
    expect(r.skipped.map(s => [s.action, s.raw])).toEqual([
      ['announce', '2/25'],
      ['notify', '추후'],
    ])
    // 빈 문자열은 "건너뛴 값"으로 보고하지 않는다 — 입력이 없는 것과 같다
    expect(r.skipped.some(s => s.action === 'pq')).toBe(false)
  })

  it('취소·드랍·수주 프로젝트는 일정을 만들지 않고 제외 수를 센다', () => {
    const r = buildDesiredEvents(
      [
        project({ id: 'a', status_override: '취소', submit_date: '2026-08-10' }),
        project({ id: 'b', project_number: 'b', participants: '드랍', submit_date: '2026-08-10' }),
        project({ id: 'c', project_number: 'c', evaluation: '선', submit_date: '2026-08-10' }),
        project({ id: 'd', project_number: 'd', submit_date: '2026-08-10' }),
      ],
      [], TODAY, COLORS,
    )
    expect(r.events.map(e => e.projectId)).toEqual(['d'])
    expect(r.excludedProjects).toBe(3)
  })

  it('툴팁은 project_number로 맞춘다 (번호가 다르면 붙지 않는다)', () => {
    const r = buildDesiredEvents(
      [project({ project_number: '111' })],
      [tooltip({ project_number: '999', pq_date: '2026-08-05' })],
      TODAY, COLORS,
    )
    expect(r.events).toHaveLength(0)
  })

  it('용역명이 비면 건너뛴다', () => {
    const r = buildDesiredEvents([project({ name: '   ', submit_date: '2026-08-10' })], [], TODAY, COLORS)
    expect(r.events).toHaveLength(0)
  })

  it('색 매핑이 없는 행위는 colorId가 null (캘린더 기본색)', () => {
    const r = buildDesiredEvents([project({ submit_date: '2026-08-10' })], [], TODAY, {})
    expect(r.events[0].colorId).toBeNull()
    expect(r.events[0].fingerprint.endsWith('|')).toBe(true)
  })
})

describe('makeFingerprint', () => {
  it('날짜·제목·색이 모두 같을 때만 같다', () => {
    const base = makeFingerprint('2026-08-10', '[A] 제출', '5')
    expect(makeFingerprint('2026-08-10', '[A] 제출', '5')).toBe(base)
    expect(makeFingerprint('2026-08-11', '[A] 제출', '5')).not.toBe(base)
    expect(makeFingerprint('2026-08-10', '[B] 제출', '5')).not.toBe(base)
    expect(makeFingerprint('2026-08-10', '[A] 제출', '8')).not.toBe(base)
    expect(makeFingerprint('2026-08-10', '[A] 제출', null)).not.toBe(base)
  })
})
