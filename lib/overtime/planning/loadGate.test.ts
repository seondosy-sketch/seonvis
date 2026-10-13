import { describe, expect, it } from 'vitest'
import { createLoadGate, type LoadGate } from './loadGate'

// 화면(app/(dashboard)/overtime/plan/page.tsx)의 load와 같은 모양: 요청 번호를 받고, await 뒤 isCurrent()일 때만 반영
interface ViewState { periodLabel: string | null; targets: string[]; records: string[]; runs: string[]; error: string | null; writes: number }
interface PeriodData { targets: string[]; records: string[]; runs: string[] }

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function newView(): ViewState {
  return { periodLabel: null, targets: [], records: [], runs: [], error: null, writes: 0 }
}

async function load(gate: LoadGate, view: ViewState, periodLabel: string, fetch: Promise<PeriodData>) {
  const ticket = gate.begin(periodLabel)
  try {
    const data = await fetch
    if (!ticket.isCurrent()) return
    view.periodLabel = ticket.periodLabel
    view.targets = data.targets
    view.records = data.records
    view.runs = data.runs
    view.error = null
    view.writes++
  } catch {
    if (!ticket.isCurrent()) return
    view.error = `${ticket.periodLabel} 불러오기 실패`
    view.writes++
  }
}

const OCT: PeriodData = { targets: ['oct-target'], records: ['oct-record'], runs: ['oct-run'] }
const NOV: PeriodData = { targets: ['nov-target'], records: ['nov-record'], runs: ['nov-run'] }

describe('기간 불러오기 응답 세대 판정(loadGate)', () => {
  it('첫 요청(10월)이 두 번째 요청(11월)보다 늦게 끝나도 최신(11월) 응답만 targets·records·runs에 반영', async () => {
    const gate = createLoadGate()
    const view = newView()
    const first = deferred<PeriodData>()
    const second = deferred<PeriodData>()
    const p1 = load(gate, view, '2026-10', first.promise)
    const p2 = load(gate, view, '2026-11', second.promise)

    second.resolve(NOV)
    await p2
    expect(view).toMatchObject({ periodLabel: '2026-11', ...NOV, error: null, writes: 1 })

    first.resolve(OCT)   // 늦게 도착한 이전 기간 응답
    await p1
    expect(view).toMatchObject({ periodLabel: '2026-11', ...NOV, error: null, writes: 1 })
  })

  it('늦게 온 이전 요청의 오류는 최신 성공 상태를 덮지 않는다', async () => {
    const gate = createLoadGate()
    const view = newView()
    const first = deferred<PeriodData>()
    const second = deferred<PeriodData>()
    const p1 = load(gate, view, '2026-10', first.promise)
    const p2 = load(gate, view, '2026-11', second.promise)
    second.resolve(NOV)
    await p2
    first.reject(new Error('network'))
    await p1
    expect(view).toMatchObject({ periodLabel: '2026-11', ...NOV, error: null, writes: 1 })
  })

  it('최신 요청의 오류는 반영된다', async () => {
    const gate = createLoadGate()
    const view = newView()
    const only = deferred<PeriodData>()
    const p = load(gate, view, '2026-11', only.promise)
    only.reject(new Error('network'))
    await p
    expect(view.error).toBe('2026-11 불러오기 실패')
  })

  it('화면이 사라진(dispose) 뒤 도착한 응답·오류는 상태를 바꾸지 않는다', async () => {
    const gate = createLoadGate()
    const view = newView()
    const ok = deferred<PeriodData>()
    const bad = deferred<PeriodData>()
    const p1 = load(gate, view, '2026-10', ok.promise)
    gate.dispose()
    ok.resolve(OCT)
    await p1
    const p2 = load(gate, view, '2026-11', bad.promise)
    bad.reject(new Error('network'))
    await p2
    expect(view).toEqual(newView())
  })

  it('invalidate(기간 전환 순간)는 새 요청이 시작되기 전의 응답도 버린다', async () => {
    const gate = createLoadGate()
    const view = newView()
    const old = deferred<PeriodData>()
    const p = load(gate, view, '2026-10', old.promise)
    gate.invalidate()
    old.resolve(OCT)
    await p
    expect(view.writes).toBe(0)
  })

  it('React 개발 모드 재마운트: dispose 뒤 activate하면 이전 마운트의 요청은 버리고 새 요청은 반영', async () => {
    const gate = createLoadGate()
    const view = newView()
    const before = deferred<PeriodData>()
    const after = deferred<PeriodData>()
    const p1 = load(gate, view, '2026-11', before.promise)
    gate.dispose()
    gate.activate()
    const p2 = load(gate, view, '2026-11', after.promise)
    before.resolve(OCT)
    await p1
    after.resolve(NOV)
    await p2
    expect(view).toMatchObject({ periodLabel: '2026-11', ...NOV, writes: 1 })
  })

  it('요청 번호는 단조 증가하고, 반영된 자료의 기간 라벨은 요청한 라벨과 같다', () => {
    const gate = createLoadGate()
    const a = gate.begin('2026-10')
    gate.invalidate()
    const b = gate.begin('2026-11')
    expect(b.id).toBeGreaterThan(a.id)
    expect([a.isCurrent(), b.isCurrent()]).toEqual([false, true])
    expect(b.periodLabel).toBe('2026-11')
  })
})
