import { describe, expect, it } from 'vitest'
import { BidSyncPlan, planBidProjectSync } from './sync'
import type { BidProjectSource } from './eligibility'
import type { Project } from './types'

const ASOF = '2026-10-03'
const PERIOD = { start: '2026-09-21', end: '2026-10-20' }

const src = (id: string, over: Partial<BidProjectSource> = {}): BidProjectSource => ({
  id, project_number: id, name: `사업 ${id}`,
  announce_date: '2026-09-15', submit_date: '2026-10-10', interview_date: '2026-10-20',
  interview_written: false, bid_date: '2026-10-30', status: '진행중',
  ...over,
})

/** 계획을 메모리 상태에 반영한다 — 실제 syncBidProjects가 DB에 하는 일과 같다(삭제 없음). */
function apply(rows: Project[], plan: BidSyncPlan): Project[] {
  const next = rows.map(r => {
    const u = plan.updates.find(x => x.id === r.id)
    return u ? { ...r, ...u.patch } : r
  })
  plan.inserts.forEach((ins, i) => next.push({ id: `new-${next.length}-${i}`, ...ins }))
  return next
}

const run = (sources: BidProjectSource[], rows: Project[], asOf = ASOF, period = PERIOD) => {
  const plan = planBidProjectSync(sources, rows, period, asOf)
  return { plan, rows: apply(rows, plan) }
}

describe('planBidProjectSync — 생성·갱신', () => {
  it('대상 사업을 새 행으로 만든다 (기간·상태는 판정 결과)', () => {
    const { plan } = run([src('a'), src('w', { interview_written: true, interview_date: null })], [])
    expect(plan.updates).toEqual([])
    expect(plan.inserts).toEqual([
      { name: '사업 a', start_date: '2026-09-15', end_date: '2026-10-20', status: '진행중', source_project_id: 'a', sort_order: 10 },
      // 서면평가 → 종료일은 제출일 (예전 동기화는 면접일 null이라 종료일 없이 계속 표시됐다)
      { name: '사업 w', start_date: '2026-09-15', end_date: '2026-10-10', status: '진행중', source_project_id: 'w', sort_order: 20 },
    ])
  })

  it('면접일 미정 사업의 종료일은 개찰일', () => {
    const { plan } = run([src('b', { interview_date: null, bid_date: '2026-10-26' })], [])
    expect(plan.inserts[0]).toMatchObject({ end_date: '2026-10-26', status: '진행중' })
  })

  it('대상이 아니거나 조회 기간과 겹치지 않는 사업은 새로 만들지 않는다', () => {
    const { plan } = run([
      src('lost', { status: '탈락' }),
      src('review', { interview_date: null, bid_date: '2026-10-01' }),
      src('blocked', { announce_date: null }),
      src('later', { announce_date: '2026-10-21', submit_date: '2026-11-01', interview_date: '2026-11-05', bid_date: null }),
    ], [])
    expect(plan.inserts).toEqual([])
  })

  it('조회 기간 경계 당일에 걸치는 사업은 만든다', () => {
    const { plan } = run([
      src('end-on-start', { announce_date: '2026-09-01', submit_date: '2026-09-10', interview_date: '2026-09-21' }),
      src('start-on-end', { announce_date: '2026-10-20', submit_date: '2026-10-25', interview_date: '2026-10-28' }),
    ], [], '2026-09-01')
    expect(plan.inserts.map(i => i.source_project_id)).toEqual(['end-on-start', 'start-on-end'])
  })

  it('조회 기간과 무관하게 이미 연계된 행은 전부 최신 원본으로 갱신 (지난 사업의 탈락 반영)', () => {
    const rows: Project[] = [
      { id: 'o1', name: '사업 old', status: '진행중', sort_order: 10, start_date: '2026-07-14', end_date: '2026-08-13', source_project_id: 'old' },
    ]
    const { plan } = run([src('old', { status: '탈락', announce_date: '2026-07-14', submit_date: '2026-08-05', interview_date: '2026-08-13', bid_date: '2026-08-19' })], rows)
    expect(plan.updates).toEqual([{ id: 'o1', patch: { status: '종료' } }])
  })

  it('면접일이 나중에 생기면 종료일을 갱신', () => {
    const rows: Project[] = [
      { id: 'o1', name: '사업 a', status: '진행중', sort_order: 10, start_date: '2026-08-20', end_date: null, source_project_id: 'a' },
    ]
    const { plan } = run([src('a', { announce_date: '2026-08-20', interview_date: '2026-10-16' })], rows)
    expect(plan.updates).toEqual([{ id: 'o1', patch: { end_date: '2026-10-16' } }])
  })

  it('프로젝트명이 바뀌면 같은 연계행의 이름만 갱신 (새 행 없음)', () => {
    const rows: Project[] = [
      { id: 'o1', name: '옛 이름', status: '진행중', sort_order: 10, start_date: '2026-09-15', end_date: '2026-10-20', source_project_id: 'a' },
    ]
    const { plan } = run([src('a', { name: '새 이름' })], rows)
    expect(plan.inserts).toEqual([])
    expect(plan.updates).toEqual([{ id: 'o1', patch: { name: '새 이름' } }])
  })

  it('같은 이름의 수동 행이 있으면 새로 만들지 않고 그 행을 연계 행으로 전환 (기존 동작)', () => {
    const rows: Project[] = [
      { id: 'm1', name: '사업 a', status: '진행중', sort_order: 30, start_date: null, end_date: null, source_project_id: null },
    ]
    const { plan } = run([src('a')], rows)
    expect(plan.inserts).toEqual([])
    expect(plan.updates).toEqual([{ id: 'm1', patch: { name: '사업 a', start_date: '2026-09-15', end_date: '2026-10-20', status: '진행중', source_project_id: 'a' } }])
  })

  it('수동 행(source_project_id null)은 그 외에는 건드리지 않는다 — 원본이 지워져 연계가 끊긴 행 포함', () => {
    const rows: Project[] = [
      { id: 'm1', name: '내부 업무', status: '진행중', sort_order: 30, start_date: null, end_date: null, source_project_id: null },
    ]
    expect(run([], rows).plan).toEqual({ inserts: [], updates: [], attention: [] })
  })

  it('연계된 원본이 projects 조회 결과에 없으면(삭제 직전·권한 등) 그 행을 건드리지 않는다', () => {
    const rows: Project[] = [
      { id: 'o1', name: '사업 gone', status: '진행중', sort_order: 10, start_date: '2026-09-15', end_date: '2026-10-20', source_project_id: 'gone' },
    ]
    expect(run([src('a', { status: '탈락' })], rows).plan.updates).toEqual([])
  })
})

describe('planBidProjectSync — 확인 필요 사업 안내', () => {
  it('진행중인 needs_review·blocked 사업을 attention으로 돌려주고 연계행은 종료로 둔다', () => {
    const rows: Project[] = [
      { id: 'o1', name: '사업 r', status: '진행중', sort_order: 10, start_date: '2026-09-15', end_date: null, source_project_id: 'r' },
    ]
    const { plan } = run([
      src('r', { interview_date: null, bid_date: '2026-10-01' }),
      src('n', { interview_date: null, bid_date: null, submit_date: null }),
      src('lost', { status: '탈락', announce_date: null }),
    ], rows)
    expect(plan.attention).toEqual([
      { sourceProjectId: 'r', overtimeProjectId: 'o1', kind: 'needs_review', reason: '면접일 미정 및 개찰일 경과' },
      { sourceProjectId: 'n', overtimeProjectId: null, kind: 'blocked', reason: '면접일·개찰일·제출일 미정' },
    ])
    expect(plan.updates).toEqual([{ id: 'o1', patch: { status: '종료' } }])
  })
})

describe('planBidProjectSync — 멱등성·보존', () => {
  const sources = [
    src('a'),
    src('w', { interview_written: true, interview_date: null }),
    src('b', { interview_date: null, bid_date: '2026-10-26' }),
    src('s', { interview_date: null, bid_date: null, submit_date: '2026-11-02' }),
    src('lost', { status: '탈락' }),
    src('review', { interview_date: null, bid_date: '2026-10-01' }),
  ]
  const initial: Project[] = [
    { id: 'o-lost', name: '사업 lost', status: '진행중', sort_order: 5, start_date: '2026-09-15', end_date: '2026-10-20', source_project_id: 'lost' },
    { id: 'o-review', name: '사업 review', status: '진행중', sort_order: 6, start_date: '2026-09-15', end_date: null, source_project_id: 'review' },
    { id: 'm-internal', name: '내부 업무', status: '진행중', sort_order: 7, start_date: null, end_date: null, source_project_id: null },
  ]

  it('두 번째 실행은 insert·update가 없다', () => {
    const first = run(sources, initial)
    expect(first.plan.inserts.length).toBe(4)
    expect(first.plan.updates.length).toBe(2)
    const second = run(sources, first.rows)
    expect(second.plan.inserts).toEqual([])
    expect(second.plan.updates).toEqual([])
    expect(second.rows).toEqual(first.rows)
  })

  it('같은 사업이 중복 생성되지 않는다 (source_project_id당 1행)', () => {
    let rows = initial
    for (let i = 0; i < 3; i++) rows = run(sources, rows).rows
    const ids = rows.map(r => r.source_project_id).filter(Boolean)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('대상에서 빠져도 행은 남는다 — 계획에는 삭제가 없고 행 수는 줄지 않는다', () => {
    const { plan, rows } = run(sources, initial)
    expect(Object.keys(plan).sort()).toEqual(['attention', 'inserts', 'updates'])
    expect(rows.length).toBeGreaterThanOrEqual(initial.length)
    for (const r of initial) expect(rows.some(x => x.id === r.id)).toBe(true)
    expect(rows.find(r => r.id === 'o-lost')?.status).toBe('종료')
  })

  it('다시 대상이 되면 같은 연계행을 진행중으로 되돌린다 (새 행 없음)', () => {
    const excluded = run([src('x', { interview_date: null, bid_date: '2026-10-01' })], []).rows
    expect(excluded).toEqual([]) // 대상이 아니면 처음부터 만들지 않음
    const created = run([src('x')], []).rows
    const out = run([src('x', { interview_date: null, bid_date: '2026-10-01' })], created).rows
    expect(out[0].status).toBe('종료')
    const back = run([src('x', { interview_date: '2026-10-15' })], out)
    expect(back.plan.inserts).toEqual([])
    expect(back.rows).toHaveLength(1)
    expect(back.rows[0]).toMatchObject({ id: created[0].id, status: '진행중', end_date: '2026-10-15' })
  })

  it('기준일이 바뀌면 그날 기준으로 다시 판정한다 (개찰일 경과)', () => {
    const rows = run([src('b', { interview_date: null, bid_date: '2026-10-26' })], []).rows
    const later = run([src('b', { interview_date: null, bid_date: '2026-10-26' })], rows, '2026-10-27')
    expect(later.plan.updates).toEqual([{ id: rows[0].id, patch: { end_date: null, status: '종료' } }])
  })
})
