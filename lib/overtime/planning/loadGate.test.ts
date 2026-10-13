import { describe, expect, it } from 'vitest'
import { createLoadGate, createPeriodLoader, type LoadGate, type LoadTicket } from './loadGate'

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

// ── 화면 기간·reload 조율(createPeriodLoader) — page.tsx의 loadPeriod와 같은 모양의 가짜 run ──
interface Reply { attention?: string[]; syncFailed?: boolean; data?: PeriodData; error?: string }
interface Pending { label: string; sync: boolean; stage: 'sync' | 'data'; settle: (r: Reply) => void; fail: (e: unknown) => void }
interface Screen {
  loading: boolean; dataLabel: string | null; targets: string[]; records: string[]; runs: string[]
  attention: string[]; syncFailed: boolean; loadError: string | null
}

function harness(initial: string) {
  const screen: Screen = { loading: true, dataLabel: null, targets: [], records: [], runs: [], attention: [], syncFailed: false, loadError: null }
  const pending: Pending[] = []
  const ask = (label: string, sync: boolean, stage: Pending['stage']) =>
    new Promise<Reply>((settle, fail) => { pending.push({ label, sync, stage, settle, fail }) })
  // page.tsx loadPeriod: sync면 동기화 → (최신이면) attention·syncFailed, 자료 → (최신이면) loadError 또는 자료·dataLabel·loading
  async function run(label: string, sync: boolean, ticket: LoadTicket) {
    if (sync) {
      const s = await ask(label, sync, 'sync')
      if (!ticket.isCurrent()) return
      screen.attention = s.attention ?? []
      screen.syncFailed = s.syncFailed ?? false
    }
    const r = await ask(label, sync, 'data')
    if (!ticket.isCurrent()) return
    screen.loadError = null
    if (r.error) { screen.loadError = r.error; screen.loading = false; return }
    screen.targets = r.data!.targets
    screen.records = r.data!.records
    screen.runs = r.data!.runs
    screen.dataLabel = ticket.periodLabel
    screen.loading = false
  }
  const loader = createPeriodLoader<string>({
    initial,
    label: p => p,
    run: (p, sync, ticket) => run(p, sync, ticket),
    onReloadStart: () => { screen.loading = true },
    onPeriodChange: () => { screen.attention = []; screen.syncFailed = false; screen.loadError = null },
    onError: () => { screen.loadError = '예외'; screen.loading = false },
  })
  // page.tsx changePeriod + 기간 effect: 전환 → loading 표시 → 새 기간 load(sync)
  const changePeriod = (p: string) => { loader.changePeriod(p); screen.loading = true; return loader.load(p, true) }
  const next = (label: string, stage: Pending['stage']) => {
    const i = pending.findIndex(x => x.label === label && x.stage === stage)
    expect(i, `${label} ${stage} 요청 없음`).toBeGreaterThanOrEqual(0)
    return pending.splice(i, 1)[0]
  }
  const flush = () => new Promise(r => setTimeout(r, 0))
  return { screen, pending, loader, changePeriod, next, flush }
}

const dataOf = (label: string): PeriodData => ({ targets: [`${label}-target`], records: [`${label}-record`], runs: [`${label}-run`] })

describe('N-1 — 저장·수정 RPC를 기다리는 동안 기간이 바뀌어도 reload는 최신 기간만', () => {
  it('A에서 수정 시작 → 완료 전 B로 전환 → B 완료 → A 수정 완료 후 reload: B 기준으로만 다시 읽고 loading이 끝난다', async () => {
    const h = harness('2026-10')
    // 처음 A 불러오기
    const first = h.loader.load('2026-10', true)
    h.next('2026-10', 'sync').settle({})
    await h.flush()
    h.next('2026-10', 'data').settle({ data: dataOf('2026-10') })
    await first
    expect(h.screen).toMatchObject({ dataLabel: '2026-10', loading: false })

    // 1) A에서 수정 RPC 시작(아직 끝나지 않음)
    let finishMutation!: () => void
    const mutation = new Promise<void>(r => { finishMutation = r }).then(() => h.loader.reload())   // page.tsx: await rpc → await reload()

    // 2) 완료 전 B로 전환, 3) B 불러오기 완료
    const toB = h.changePeriod('2026-11')
    h.next('2026-11', 'sync').settle({})
    await h.flush()
    h.next('2026-11', 'data').settle({ data: dataOf('2026-11') })
    await toB
    expect(h.screen).toMatchObject({ dataLabel: '2026-11', ...dataOf('2026-11'), loading: false })

    // 4) A 수정 완료 → reload
    finishMutation()
    await h.flush()
    // 5) reload는 A가 아니라 B를 다시 읽는다
    expect(h.pending.map(p => `${p.label}:${p.stage}`)).toEqual(['2026-11:data'])
    expect(h.screen.loading).toBe(true)
    h.next('2026-11', 'data').settle({ data: { targets: ['nov-2'], records: ['nov-2'], runs: ['nov-2'] } })
    await mutation
    // 6) loading 정상 종료, 7) A 자료는 반영되지 않음
    expect(h.screen).toMatchObject({ dataLabel: '2026-11', targets: ['nov-2'], records: ['nov-2'], runs: ['nov-2'], loading: false })
    expect(h.loader.current()).toBe('2026-11')
  })

  it('B 불러오기가 끝나기 전에 A 수정의 reload가 와도 B로만 읽고, 마지막(최신) 응답이 반영되어 loading이 끝난다', async () => {
    const h = harness('2026-10')
    const toB = h.changePeriod('2026-11')
    const reload = h.loader.reload()          // 기간 전환 직후, B effect 불러오기가 진행 중일 때
    expect(h.pending.every(p => p.label === '2026-11')).toBe(true)
    h.next('2026-11', 'data').settle({ data: dataOf('2026-11') })   // reload(최신)
    await reload
    h.next('2026-11', 'sync').settle({ attention: ['낡은 안내'] })      // 낡은 B effect 요청
    await toB
    expect(h.screen).toMatchObject({ dataLabel: '2026-11', loading: false, attention: [] })
    expect(h.pending).toEqual([])
  })
})

describe('N-2 — 기간 전환 순간 이전 기간의 안내·오류를 지우고, 늦은 결과가 다시 덮지 못한다', () => {
  it('A의 attention·syncFailed·loadError → B 전환 즉시 제거 → B의 새 안내·오류는 표시 → A의 늦은 결과는 B를 덮지 않음', async () => {
    const h = harness('2026-10')
    // A: 안내와 오류가 남아 있는 상태
    const a1 = h.loader.load('2026-10', true)
    h.next('2026-10', 'sync').settle({ attention: ['A 안내'], syncFailed: true })
    await h.flush()
    h.next('2026-10', 'data').settle({ error: 'A 오류' })
    await a1
    expect(h.screen).toMatchObject({ attention: ['A 안내'], syncFailed: true, loadError: 'A 오류' })

    // A를 다시 읽는 중(늦게 끝날 요청)
    const aLate = h.loader.reload()

    // B로 전환 — 즉시 이전 상태 제거
    const toB = h.changePeriod('2026-11')
    expect(h.screen).toMatchObject({ attention: [], syncFailed: false, loadError: null })

    // B 최신 요청의 새 안내·오류는 표시
    h.next('2026-11', 'sync').settle({ attention: ['B 안내'], syncFailed: true })
    await h.flush()
    expect(h.screen).toMatchObject({ attention: ['B 안내'], syncFailed: true })
    h.next('2026-11', 'data').settle({ error: 'B 오류' })
    await toB
    expect(h.screen).toMatchObject({ loadError: 'B 오류', loading: false })

    // A의 늦은 결과(성공)는 B 상태를 덮지 않는다
    h.next('2026-10', 'data').settle({ data: dataOf('2026-10') })
    await aLate
    expect(h.screen).toMatchObject({ attention: ['B 안내'], syncFailed: true, loadError: 'B 오류', dataLabel: null, targets: [] })
  })

  it('A의 늦은 예외(onError)도 B 상태를 덮지 않는다', async () => {
    const h = harness('2026-10')
    const aLate = h.loader.load('2026-10', false)
    const toB = h.changePeriod('2026-11')
    h.next('2026-11', 'sync').settle({})
    await h.flush()
    h.next('2026-11', 'data').settle({ data: dataOf('2026-11') })
    await toB
    h.next('2026-10', 'data').fail(new Error('network'))
    await aLate
    expect(h.screen).toMatchObject({ dataLabel: '2026-11', loadError: null, loading: false })
  })

  it('화면이 사라진 뒤에는 reload 결과도 반영하지 않는다', async () => {
    const h = harness('2026-10')
    const r = h.loader.reload()
    h.loader.dispose()
    h.next('2026-10', 'data').settle({ data: dataOf('2026-10') })
    await r
    expect(h.screen.dataLabel).toBeNull()
  })
})
