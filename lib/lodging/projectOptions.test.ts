import { describe, it, expect } from 'vitest'
import { buildProjectOptions, projectFilterPeriod, type LodgingProjectOption } from './projectOptions'

function project(over: Partial<LodgingProjectOption> & { id: string }): LodgingProjectOption {
  return {
    project_number: '2600',
    name: '테스트 용역',
    announce_date: '2026-07-01',
    interview_date: '2026-08-31',
    bid_date: null,
    status: '진행중',
    ...over,
  }
}

const PERIOD = { periodStart: '2026-08-01', periodEnd: '2026-08-31' }

describe('buildProjectOptions — 검색어가 없을 때', () => {
  it('공고일~발표일이 숙박 기간과 겹치는 프로젝트만 보여준다', () => {
    const rows = buildProjectOptions({
      projects: [
        project({ id: 'in', name: '겹침', announce_date: '2026-07-01', interview_date: '2026-08-20' }),
        project({ id: 'past', name: '지난 건', announce_date: '2026-03-01', interview_date: '2026-05-10' }),
        project({ id: 'future', name: '아직 공고 전', announce_date: '2026-10-01', interview_date: null }),
      ],
      ...PERIOD,
      query: '',
    })
    expect(rows.map(r => r.project.id)).toEqual(['in'])
    expect(rows[0].inPeriod).toBe(true)
  })

  it('발표일이 없으면 계속 겹치는 것으로 본다 — 개찰이 끝났으면 제외(출근부와 동일)', () => {
    const rows = buildProjectOptions({
      projects: [
        project({ id: 'open', announce_date: '2026-06-01', interview_date: null, bid_date: null }),
        project({ id: 'bid-done', announce_date: '2026-06-01', interview_date: null, bid_date: '2026-07-15' }),
      ],
      ...PERIOD,
      query: '',
    })
    expect(rows.map(r => r.project.id)).toEqual(['open'])
  })

  it('취소된 프로젝트는 검색해도 나오지 않는다', () => {
    const projects = [project({ id: 'cancelled', name: '취소된 용역', status: '취소' })]
    expect(buildProjectOptions({ projects, ...PERIOD, query: '' })).toEqual([])
    expect(buildProjectOptions({ projects, ...PERIOD, query: '취소된' })).toEqual([])
  })

  it('넘겨받은 순서(공사번호 순)를 유지한다', () => {
    const rows = buildProjectOptions({
      projects: [
        project({ id: 'a', project_number: '2585' }),
        project({ id: 'b', project_number: '2601' }),
      ],
      ...PERIOD,
      query: '',
    })
    expect(rows.map(r => r.project.project_number)).toEqual(['2585', '2601'])
  })
})

describe('buildProjectOptions — 검색할 때', () => {
  it('기간 밖 프로젝트도 찾아주되 inPeriod=false로 표시하고 뒤에 놓는다', () => {
    const rows = buildProjectOptions({
      projects: [
        project({ id: 'past', name: '금산 문화원', announce_date: '2026-01-01', interview_date: '2026-02-01' }),
        project({ id: 'now', name: '금산 체육관', announce_date: '2026-07-01', interview_date: '2026-08-20' }),
      ],
      ...PERIOD,
      query: '금산',
    })
    expect(rows.map(r => [r.project.id, r.inPeriod])).toEqual([['now', true], ['past', false]])
  })

  it('공사번호로도 찾을 수 있다', () => {
    const rows = buildProjectOptions({
      projects: [project({ id: 'x', project_number: '2647', name: '아무 용역' })],
      ...PERIOD,
      query: '2647',
    })
    expect(rows.map(r => r.project.id)).toEqual(['x'])
  })

  it('limit을 넘지 않는다', () => {
    const projects = Array.from({ length: 50 }, (_, i) => project({ id: `p${i}`, name: `용역 ${i}` }))
    expect(buildProjectOptions({ projects, ...PERIOD, query: '용역', limit: 5 })).toHaveLength(5)
  })
})

describe('projectFilterPeriod', () => {
  const fallback = { start: '2026-08-01', end: '2026-08-31' }

  it('체크인·체크아웃이 있으면 그 숙박 기간을 쓴다', () => {
    expect(projectFilterPeriod('2026-08-10', '2026-08-12', fallback)).toEqual({ start: '2026-08-10', end: '2026-08-12' })
  })
  it('체크인만 있으면 그 하루를 쓴다', () => {
    expect(projectFilterPeriod('2026-08-10', '', fallback)).toEqual({ start: '2026-08-10', end: '2026-08-10' })
  })
  it('날짜를 아직 안 넣었으면 보고 있는 달을 쓴다', () => {
    expect(projectFilterPeriod('', '', fallback)).toEqual(fallback)
  })
  it('체크아웃이 체크인보다 앞서는 잘못된 입력이면 보고 있는 달로 되돌린다', () => {
    expect(projectFilterPeriod('2026-08-20', '2026-08-10', fallback)).toEqual({ start: '2026-08-20', end: '2026-08-20' })
  })
})
