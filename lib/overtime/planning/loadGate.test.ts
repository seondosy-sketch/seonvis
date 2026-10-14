import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createLoadGate, createPeriodLoader, periodDataOwned, periodDataReady, runPeriodAction, type LoadGate, type LoadTicket } from './loadGate'

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

// ── 화면 기간·reload 조율(createPeriodLoader) — page.tsx와 같은 모양의 가짜 sync·run ──
interface SyncReply { attention?: string[]; syncFailed?: boolean }
interface DataReply { data?: PeriodData; error?: string }
interface Pending { label: string; stage: 'sync' | 'data'; settle: (r: SyncReply & DataReply) => void; fail: (e: unknown) => void }
interface Screen {
  loading: boolean; dataLabel: string | null; dataEpoch: number | null; targets: string[]; records: string[]; runs: string[]
  attention: string[]; syncFailed: boolean; loadError: string | null
}

function harness(initial: string) {
  const screen: Screen = { loading: true, dataLabel: null, dataEpoch: null, targets: [], records: [], runs: [], attention: [], syncFailed: false, loadError: null }
  const pending: Pending[] = []
  const calls = { sync: [] as string[], data: [] as string[] }
  const ask = (label: string, stage: Pending['stage']) =>
    new Promise<SyncReply & DataReply>((settle, fail) => { pending.push({ label, stage, settle, fail }) })
  // page.tsx loadPeriod: 자료 → (최신이면) loadError 또는 자료·dataKey·loading
  async function run(label: string, ticket: LoadTicket) {
    calls.data.push(label)
    const r = await ask(label, 'data')
    if (!ticket.isCurrent()) return
    screen.loadError = null
    if (r.error) { screen.loadError = r.error; screen.loading = false; return }
    screen.targets = r.data!.targets
    screen.records = r.data!.records
    screen.runs = r.data!.runs
    screen.dataLabel = ticket.periodLabel
    screen.dataEpoch = ticket.epoch
    screen.loading = false
  }
  const loader = createPeriodLoader<string, SyncReply>({
    initial,
    label: p => p,
    sync: p => { calls.sync.push(p); return ask(p, 'sync') },
    // page.tsx onSync: attention·syncFailed
    onSync: s => { screen.attention = s.attention ?? []; screen.syncFailed = s.syncFailed ?? false },
    run: (p, ticket) => run(p, ticket),
    onReloadStart: () => { screen.loading = true },
    onPeriodChange: () => { screen.attention = []; screen.syncFailed = false; screen.loadError = null },
    onError: () => { screen.loadError = '예외'; screen.loading = false },
  })
  // page.tsx changePeriod + 기간 effect: 전환(새 세대) → loading 표시 → 새 기간 load(sync)
  let viewEpoch = 0
  const changePeriod = (p: string) => { viewEpoch = loader.changePeriod(p); screen.loading = true; return loader.load(p, true) }
  const next = (label: string, stage: Pending['stage']) => {
    const i = pending.findIndex(x => x.label === label && x.stage === stage)
    expect(i, `${label} ${stage} 요청 없음`).toBeGreaterThanOrEqual(0)
    return pending.splice(i, 1)[0]
  }
  const has = (label: string, stage: Pending['stage']) => pending.some(x => x.label === label && x.stage === stage)
  const flush = () => new Promise(r => setTimeout(r, 0))
  // page.tsx dataReady — 불러오기가 끝났고 자료가 지금 기간·세대의 것
  const ready = () => periodDataReady({
    label: loader.current(), viewEpoch, loading: screen.loading,
    data: screen.dataLabel === null ? null : { label: screen.dataLabel, epoch: screen.dataEpoch! },
  })
  return { screen, pending, calls, loader, changePeriod, next, has, flush, ready, viewEpoch: () => viewEpoch }
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
    // 5) reload는 A가 아니라 B를 다시 읽는다(B 동기화는 이미 끝났으므로 다시 하지 않는다)
    expect(h.pending.map(p => `${p.label}:${p.stage}`)).toEqual(['2026-11:data'])
    expect(h.screen.loading).toBe(true)
    h.next('2026-11', 'data').settle({ data: { targets: ['nov-2'], records: ['nov-2'], runs: ['nov-2'] } })
    await mutation
    // 6) loading 정상 종료, 7) A 자료는 반영되지 않음
    expect(h.screen).toMatchObject({ dataLabel: '2026-11', targets: ['nov-2'], records: ['nov-2'], runs: ['nov-2'], loading: false })
    expect(h.loader.current()).toBe('2026-11')
  })

  it('B 동기화가 끝나기 전에 A 수정의 reload가 와도 B로만 읽고, 진행 중인 B 동기화에 합류해 그 안내를 반영한다', async () => {
    const h = harness('2026-10')
    const toB = h.changePeriod('2026-11')
    const reload = h.loader.reload()          // 기간 전환 직후, B effect 불러오기가 동기화를 기다리는 중
    expect(h.pending.every(p => p.label === '2026-11')).toBe(true)
    // 합류: 동기화가 끝나기 전에는 자료를 읽지 않는다(동기화 전 목록으로 실행 가능 상태가 되지 않음)
    expect(h.has('2026-11', 'data')).toBe(false)
    expect(h.calls.sync).toEqual(['2026-11'])
    h.next('2026-11', 'sync').settle({ attention: ['B 안내'] })
    await h.flush()
    expect(h.screen.attention).toEqual(['B 안내'])
    h.next('2026-11', 'data').settle({ data: dataOf('2026-11') })   // reload(최신)의 자료 — 동기화 뒤에 읽음
    await Promise.all([reload, toB])
    expect(h.screen).toMatchObject({ dataLabel: '2026-11', loading: false, attention: ['B 안내'] })
    expect(h.pending).toEqual([])
    expect(h.calls.data).toEqual(['2026-11'])   // 낡은 effect 요청은 동기화 뒤 자료를 읽지 않는다
  })
})

describe('NOTE-1 — 같은 기간 동기화 중 reload가 와도 동기화 결과·실패 안내를 잃지 않는다', () => {
  it('A 동기화 중 A reload → 동기화 실패 안내(attention·syncFailed)가 남고, 자료는 동기화 뒤에 읽는다', async () => {
    const h = harness('2026-10')
    const first = h.loader.load('2026-10', true)
    const r = h.loader.reload()                 // 설정 변경 등 — 동기화가 아직 끝나지 않음
    expect(h.has('2026-10', 'data')).toBe(false)
    expect(h.ready()).toBe(false)
    h.next('2026-10', 'sync').settle({ syncFailed: true, attention: ['p1 확인 필요'] })
    await h.flush()
    expect(h.screen).toMatchObject({ syncFailed: true, attention: ['p1 확인 필요'] })
    h.next('2026-10', 'data').settle({ data: dataOf('2026-10') })   // 실패해도 기존 목록으로 계속(설계 유지)
    await Promise.all([first, r])
    expect(h.screen).toMatchObject({ syncFailed: true, attention: ['p1 확인 필요'], dataLabel: '2026-10', loading: false })
    expect(h.ready()).toBe(true)
    expect(h.calls).toEqual({ sync: ['2026-10'], data: ['2026-10'] })
  })

  it('A 동기화 중 A reload → 동기화 성공 뒤의 자료(동기화된 프로젝트)가 최종 자료로 반영된다', async () => {
    const h = harness('2026-10')
    const first = h.loader.load('2026-10', true)
    const r = h.loader.reload()
    h.next('2026-10', 'sync').settle({})        // 동기화 성공 — 서버의 프로젝트 목록이 바뀜
    await h.flush()
    // 자료 요청은 동기화가 끝난 뒤에 처음 나간다 → 동기화 뒤 목록
    h.next('2026-10', 'data').settle({ data: { targets: ['t'], records: ['r'], runs: ['synced'] } })
    await Promise.all([first, r])
    expect(h.screen).toMatchObject({ runs: ['synced'], syncFailed: false, attention: [], loading: false })
    expect(h.pending).toEqual([])
  })

  it('A 동기화 중 B로 전환 → A 동기화 결과·안내는 B에 반영되지 않고, B는 자기 동기화를 한다', async () => {
    const h = harness('2026-10')
    const a = h.loader.load('2026-10', true)
    const toB = h.changePeriod('2026-11')
    const rB = h.loader.reload()               // B에서 reload — A 동기화에 합류하지 않는다
    expect(h.calls.sync).toEqual(['2026-10', '2026-11'])
    h.next('2026-10', 'sync').settle({ syncFailed: true, attention: ['A 안내'] })
    await a
    expect(h.screen).toMatchObject({ syncFailed: false, attention: [] })
    h.next('2026-11', 'sync').settle({ attention: ['B 안내'] })
    await h.flush()
    h.next('2026-11', 'data').settle({ data: dataOf('2026-11') })
    await Promise.all([toB, rB])
    expect(h.screen).toMatchObject({ dataLabel: '2026-11', attention: ['B 안내'], syncFailed: false, loading: false })
    expect(h.calls.data).toEqual(['2026-11'])   // A 자료는 읽지 않음
  })

  it('같은 기간 reload가 여러 번 겹쳐도 동기화는 한 번, 마지막 reload만 반영되고 loading이 끝난다', async () => {
    const h = harness('2026-10')
    const first = h.loader.load('2026-10', true)
    const rs = [h.loader.reload(), h.loader.reload(), h.loader.reload()]
    h.next('2026-10', 'sync').settle({ syncFailed: true })
    await h.flush()
    expect(h.calls.sync).toEqual(['2026-10'])
    expect(h.pending.map(p => `${p.label}:${p.stage}`)).toEqual(['2026-10:data'])   // 최신 reload 하나만 자료를 읽음
    // 동기화가 끝난 뒤의 reload는 새 동기화 없이 자료만 다시 읽는다
    const late = h.loader.reload()
    h.next('2026-10', 'data').settle({ data: dataOf('old') })
    await h.flush()
    h.next('2026-10', 'data').settle({ data: dataOf('2026-10') })
    await Promise.all([first, ...rs, late])
    expect(h.screen).toMatchObject({ ...dataOf('2026-10'), syncFailed: true, loading: false })
    expect(h.calls.sync).toEqual(['2026-10'])
    expect(h.pending).toEqual([])
  })

  it('동기화 호출 수: 개발 모드 이중 effect는 합류(1회), A→B→A는 세대마다 1회(3회)', async () => {
    const h = harness('2026-10')
    // React 개발 모드: activate → load → dispose → activate → load
    h.loader.activate()
    const l1 = h.loader.load('2026-10', true)
    h.loader.dispose()
    h.loader.activate()
    const l2 = h.loader.load('2026-10', true)
    expect(h.calls.sync).toEqual(['2026-10'])
    h.next('2026-10', 'sync').settle({ attention: ['개발 모드'] })
    await h.flush()
    h.next('2026-10', 'data').settle({ data: dataOf('2026-10') })
    await Promise.all([l1, l2])
    expect(h.screen).toMatchObject({ attention: ['개발 모드'], loading: false })

    const toB = h.changePeriod('2026-11')
    const toA = h.changePeriod('2026-10')
    expect(h.calls.sync).toEqual(['2026-10', '2026-11', '2026-10'])
    h.next('2026-11', 'sync').settle({})
    await toB
    h.next('2026-10', 'sync').settle({ attention: ['새 A'] })
    await h.flush()
    h.next('2026-10', 'data').settle({ data: dataOf('2026-10') })
    await toA
    expect(h.screen).toMatchObject({ attention: ['새 A'], loading: false, dataEpoch: h.viewEpoch() })
  })

  it('동기화 예외는 기다린 최신 요청의 오류로 끝나고 loading이 끝난다(낡은 요청은 무시)', async () => {
    const h = harness('2026-10')
    const first = h.loader.load('2026-10', true)
    const r = h.loader.reload()
    h.next('2026-10', 'sync').fail(new Error('network'))
    await Promise.all([first, r])
    expect(h.screen).toMatchObject({ loadError: '예외', loading: false })
    // 실패한 동기화는 비워져 다음 reload가 다시 합류하지 않는다
    const again = h.loader.reload()
    h.next('2026-10', 'data').settle({ data: dataOf('2026-10') })
    await again
    expect(h.screen).toMatchObject({ loadError: null, dataLabel: '2026-10', loading: false })
    expect(h.calls.sync).toEqual(['2026-10'])
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

// ── NOTE-2 — 기간 종속 작업의 소유권(beginAction·runPeriodAction·periodDataReady) ──
// page.tsx의 saveDraft·callRpc와 같은 모양: 시작 때 소유권(token), 끝날 때 소유할 때만 busy·메시지·미리보기, 성공이면 최신 기간 reload
interface Ui { message: string | null; preview: string | null; busy: boolean; tab: string; editing: string | null }

function page(initial: string) {
  const h = harness(initial)
  const ui: Ui = { message: null, preview: null, busy: false, tab: 'run', editing: null }
  const works: string[] = []
  // 처음 기간 불러오기 완료까지
  async function boot() {
    const p = h.loader.load(initial, true)
    h.next(initial, 'sync').settle({})
    await h.flush()
    h.next(initial, 'data').settle({ data: dataOf(initial) })
    await p
  }
  // page.tsx changePeriod: 소유권 세대 변경 + 화면 상태 초기화(busy·메시지·미리보기·편집창)
  const changePeriod = (p: string) => { ui.busy = false; ui.message = null; ui.preview = null; ui.editing = null; return h.changePeriod(p) }
  // page.tsx beginPeriodAction — 렌더 시점의 dataReady와 viewEpoch(handler 클로저가 본 값)
  const beginPeriodAction = (render: { ready: boolean; viewEpoch: number }) => (render.ready ? h.loader.beginAction(render.viewEpoch) : null)
  const render = () => ({ ready: h.ready(), viewEpoch: h.viewEpoch() })
  // page.tsx callRpc / saveDraft 축약
  async function mutate(r: { ready: boolean; viewEpoch: number }, name: string, rpc: Promise<{ error: { message: string } | null }>, kind: 'save' | 'rpc') {
    const token = beginPeriodAction(r)
    if (!token) return false
    works.push(name)
    ui.busy = true
    ui.message = null
    return runPeriodAction({
      token,
      work: () => rpc,
      onDone: ({ error }) => {
        ui.busy = false
        if (error) { ui.message = `오류:${name}`; return }
        if (kind === 'save') ui.preview = null
        ui.message = `완료:${name}`
      },
      reload: () => h.loader.reload(),
      afterReload: kind === 'save' ? () => { ui.tab = 'drafts' } : undefined,
    })
  }
  return { h, ui, works, boot, changePeriod, beginPeriodAction, render, mutate }
}

describe('NOTE-2 — 기간 전환·비동기 작업 중 이전 기간 조작과 화면 상태 덮어쓰기를 막는다', () => {
  it('A 자료가 보이는 상태에서 B로 전환 즉시: 확정·폐기·확정 취소 handler가 실행되지 않는다(이전 렌더의 클로저로 눌러도)', async () => {
    const p = page('2026-10')
    await p.boot()
    const renderA = p.render()
    expect(renderA.ready).toBe(true)
    const toB = p.changePeriod('2026-11')
    // 전환 뒤 렌더 — 자료는 아직 A(라벨·세대 불일치) → 버튼 disabled 조건
    expect(p.render().ready).toBe(false)
    // 전환 뒤 렌더의 handler, 그리고 전환 전 렌더(A)의 낡은 클로저 모두 소유권을 얻지 못한다
    for (const r of [p.render(), renderA]) {
      expect(await p.mutate(r, 'confirm', Promise.resolve({ error: null }), 'rpc')).toBe(false)
      expect(await p.mutate(r, 'discard', Promise.resolve({ error: null }), 'rpc')).toBe(false)
      expect(await p.mutate(r, 'unconfirm', Promise.resolve({ error: null }), 'rpc')).toBe(false)
    }
    expect(p.works).toEqual([])
    expect(p.ui).toMatchObject({ busy: false, message: null })
    p.h.next('2026-11', 'sync').settle({})
    await p.h.flush()
    p.h.next('2026-11', 'data').settle({ data: dataOf('2026-11') })
    await toB
    expect(p.render().ready).toBe(true)
  })

  it('A 저장 시작 → B 전환 → B 미리보기 생성 → A 저장 완료: B 미리보기 유지, A 메시지 미표시, reload는 B만', async () => {
    const p = page('2026-10')
    await p.boot()
    let finishSave!: (r: { error: null }) => void
    const save = p.mutate(p.render(), 'save-A', new Promise(r => { finishSave = r }), 'save')
    expect(p.ui.busy).toBe(true)

    const toB = p.changePeriod('2026-11')
    expect(p.ui.busy).toBe(false)              // 이전 기간 작업의 busy는 새 기간을 막지 않는다
    p.h.next('2026-11', 'sync').settle({})
    await p.h.flush()
    p.h.next('2026-11', 'data').settle({ data: dataOf('2026-11') })
    await toB
    p.ui.preview = 'B 미리보기'                 // B에서 자동배정 실행

    finishSave({ error: null })
    await p.h.flush()
    expect(p.h.pending.map(x => `${x.label}:${x.stage}`)).toEqual(['2026-11:data'])   // reload는 B만
    p.h.next('2026-11', 'data').settle({ data: dataOf('2026-11') })
    expect(await save).toBe(false)
    expect(p.ui).toMatchObject({ preview: 'B 미리보기', message: null, busy: false, tab: 'run' })
    expect(p.h.calls.data).toEqual(['2026-10', '2026-11', '2026-11'])   // 처음 A, B 전환, A 저장 뒤 reload(B)
    expect(p.h.screen).toMatchObject({ dataLabel: '2026-11', loading: false })
  })

  it('A 작업 실패 → 그 사이 B로 전환: A 오류는 B에 표시되지 않고 reload도 하지 않는다', async () => {
    const p = page('2026-10')
    await p.boot()
    let fail!: (r: { error: { message: string } }) => void
    const op = p.mutate(p.render(), 'confirm-A', new Promise(r => { fail = r }), 'rpc')
    const toB = p.changePeriod('2026-11')
    p.h.next('2026-11', 'sync').settle({})
    await p.h.flush()
    p.h.next('2026-11', 'data').settle({ data: dataOf('2026-11') })
    await toB
    const dataCalls = p.h.calls.data.length
    fail({ error: { message: 'OVERTIME_RUN_NOT_DRAFT' } })
    expect(await op).toBe(false)
    expect(p.ui).toMatchObject({ message: null, busy: false })
    expect(p.h.calls.data.length).toBe(dataCalls)
    expect(p.h.pending).toEqual([])
  })

  it('현재 기간에서 끝난 작업은 기존처럼 메시지·미리보기 정리·reload·탭 이동을 한다', async () => {
    const p = page('2026-10')
    await p.boot()
    p.ui.preview = 'A 미리보기'
    const save = p.mutate(p.render(), 'save-A', Promise.resolve({ error: null }), 'save')
    await p.h.flush()
    expect(p.ui).toMatchObject({ preview: null, message: '완료:save-A', busy: false })
    expect(p.h.screen.loading).toBe(true)
    p.h.next('2026-10', 'data').settle({ data: dataOf('2026-10') })
    expect(await save).toBe(true)
    expect(p.ui.tab).toBe('drafts')
    expect(p.h.screen).toMatchObject({ dataLabel: '2026-10', loading: false })

    // 현재 기간 작업의 실패는 오류 메시지를 보이고 reload하지 않는다
    const before = p.h.calls.data.length
    expect(await p.mutate(p.render(), 'discard-A', Promise.resolve({ error: { message: 'x' } }), 'rpc')).toBe(false)
    expect(p.ui).toMatchObject({ message: '오류:discard-A', busy: false })
    expect(p.h.calls.data.length).toBe(before)
  })

  it('빠른 A→B→A: 처음 A에서 시작한 작업의 token은 라벨이 같아도 새 A 상태(메시지·미리보기·busy)를 덮지 못한다', async () => {
    const p = page('2026-10')
    await p.boot()
    let finishOld!: (r: { error: null }) => void
    const old = p.mutate(p.render(), 'save-oldA', new Promise(r => { finishOld = r }), 'save')
    const toB = p.changePeriod('2026-11')
    const toA = p.changePeriod('2026-10')
    p.h.next('2026-11', 'sync').settle({})
    await toB
    p.h.next('2026-10', 'sync').settle({})
    await p.h.flush()
    p.h.next('2026-10', 'data').settle({ data: dataOf('2026-10') })
    await toA
    expect(p.render().ready).toBe(true)
    // 새 A에서 미리보기를 만들고 작업을 진행 중
    p.ui.preview = '새 A 미리보기'
    let finishNew!: (r: { error: null }) => void
    const fresh = p.mutate(p.render(), 'confirm-newA', new Promise(r => { finishNew = r }), 'rpc')
    expect(p.ui.busy).toBe(true)

    finishOld({ error: null })                  // 낡은 A 작업 완료 — 라벨은 같은 '2026-10'
    await p.h.flush()
    expect(p.ui).toMatchObject({ preview: '새 A 미리보기', busy: true, message: null, tab: 'run' })
    p.h.next('2026-10', 'data').settle({ data: dataOf('2026-10') })
    expect(await old).toBe(false)

    finishNew({ error: null })
    await p.h.flush()
    expect(p.ui).toMatchObject({ busy: false, message: '완료:confirm-newA', preview: '새 A 미리보기' })
    p.h.next('2026-10', 'data').settle({ data: dataOf('2026-10') })
    expect(await fresh).toBe(true)
  })

  it('beginAction: 세대가 다르거나 화면이 사라지면 null, 진행 중 token은 기간 전환·dispose 뒤 낡음', () => {
    const loader = createPeriodLoader<string, null>({
      initial: 'A', label: p => p, sync: async () => null, onSync: () => {}, run: async () => {},
      onReloadStart: () => {}, onPeriodChange: () => {}, onError: () => {},
    })
    const t0 = loader.beginAction(0)!
    expect(t0).toMatchObject({ periodLabel: 'A', epoch: 0 })
    expect(t0.isCurrent()).toBe(true)
    expect(loader.beginAction(1)).toBeNull()
    const e1 = loader.changePeriod('B')
    expect(e1).toBe(1)
    expect(t0.isCurrent()).toBe(false)
    expect(loader.beginAction(0)).toBeNull()
    const t1 = loader.beginAction(e1)!
    expect(loader.changePeriod('A')).toBe(2)
    expect([t1.isCurrent(), loader.beginAction(2)!.isCurrent()]).toEqual([false, true])
    const t2 = loader.beginAction(2)!
    loader.dispose()
    expect([t2.isCurrent(), loader.beginAction(2)]).toEqual([false, null])
  })

  it('periodDataReady·periodDataOwned: 라벨·세대·loading 조합', () => {
    const base = { label: '2026-10', viewEpoch: 2, data: { label: '2026-10', epoch: 2 }, loading: false }
    expect([periodDataReady(base), periodDataOwned(base)]).toEqual([true, true])
    // 같은 기간 reload 중 — 실행·확정은 막고, 설정 수정(자료 소유)은 유지
    expect([periodDataReady({ ...base, loading: true }), periodDataOwned({ ...base, loading: true })]).toEqual([false, true])
    // A→B→A로 돌아왔지만 자료는 처음 A(세대 0)의 것
    expect(periodDataOwned({ ...base, data: { label: '2026-10', epoch: 0 } })).toBe(false)
    expect(periodDataReady({ ...base, label: '2026-11' })).toBe(false)
    expect(periodDataReady({ ...base, data: null })).toBe(false)
  })
})

describe('NOTE-2 — page.tsx: 버튼 disabled 조건과 handler 안의 소유권 확인이 모두 있다', () => {
  const src = readFileSync(path.resolve(__dirname, '../../../app/(dashboard)/overtime/plan/page.tsx'), 'utf8').replace(/\r\n/g, '\n')
  const body = (name: string) => {
    const i = src.indexOf(`async function ${name}(`)
    expect(i, name).toBeGreaterThan(0)
    return src.slice(i, src.indexOf('\n  }\n', i))
  }

  it('확정·폐기·확정 취소 버튼(6곳)과 편집창은 busy || !dataReady로 막힌다', () => {
    for (const label of ['이 직원만 확정', '이 직원 확정 취소']) {
      expect(src).toMatch(new RegExp(`disabled=\\{busy \\|\\| !dataReady\\}\\s*\\n\\s*label="${label}"`))
    }
    for (const confirmText of ["'이 실행의 초안을 모두 확정할까요?", "'남은 초안을 모두 버릴까요?", "'남은 초안이 없는 실행입니다.", "'이 실행의 확정을 모두 취소할까요?"]) {
      expect(src).toContain(`<button disabled={busy || !dataReady} onClick={() => { if (confirm(${confirmText}`)
    }
    // 화면 본문(작은 부품 DraftEditor 위)에는 busy만으로 막는 버튼이 남지 않는다 — DraftEditor는 busy || !dataReady를 busy로 받는다
    expect(src.slice(0, src.indexOf('// ── 작은 부품들 ──'))).not.toMatch(/disabled=\{busy\}/)
    expect(src).toContain('busy={busy || !dataReady}')
  })

  it('saveDraft·callRpc·updateDraft는 시작할 때 소유권(beginPeriodAction)을 받고, 끝은 runPeriodAction으로만 반영한다', () => {
    for (const name of ['saveDraft', 'callRpc', 'updateDraft']) {
      const b = body(name)
      expect(b, name).toMatch(/const token = beginPeriodAction\(\)\n\s*if \(!token\) return/)
      expect(b, name).toContain('runPeriodAction({')
      // 소유 확인 없이 await 뒤에 화면 상태를 바꾸지 않는다
      expect(b, name).not.toMatch(/await supabase/)
      expect(b, name).not.toMatch(/await reload\(\)/)
    }
    expect(src).toContain('return dataReady ? loaderRef.current!.beginAction(viewEpoch) : null')
  })

  it('설정 화면은 기간 세대마다 새로 그리고(key), 자료가 지금 기간 것일 때만 수정할 수 있다', () => {
    expect(src).toMatch(/<PlanSettings\n\s*key=\{viewEpoch\}/)
    expect(src).toContain('canWrite={canWrite && dataOwned}')
    expect(src).toContain('if (loaderRef.current!.beginAction(viewEpoch) && preview)')
  })

  it('기간 전환은 새 세대를 화면에 기록하고 이전 작업의 busy를 푼다', () => {
    expect(src).toContain('setViewEpoch(loaderRef.current!.changePeriod(next))')
    const i = src.indexOf('const changePeriod = (delta: number)')
    expect(src.slice(i, src.indexOf('\n  }\n', i))).toContain('setBusy(false)')
  })
})
