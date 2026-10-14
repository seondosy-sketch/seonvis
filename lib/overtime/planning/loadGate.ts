/**
 * 급여기간 자료 불러오기의 응답 세대(generation) 판정 — 순수 함수(React·DB 없음).
 *
 * 기간을 빠르게 넘기면 이전 기간 요청이 나중에 끝날 수 있다. 요청마다 단조 증가하는 번호를 붙이고,
 * 가장 최근 요청(그리고 화면이 살아 있을 때)만 상태에 반영한다 — 늦게 온 이전 기간 응답·오류는 버린다.
 *   begin(label)  새 요청 번호를 받는다. 이전 요청은 모두 낡은 것이 된다.
 *   invalidate()  요청 없이 지금까지의 요청을 모두 낡게 만든다(기간을 바꾸는 순간 — 새 요청이 시작되기 전).
 *   dispose()     화면이 사라짐 → 어떤 응답도 반영하지 않는다. activate()로 다시 살린다(React 개발 모드의 재마운트).
 */
export interface LoadTicket {
  readonly id: number
  /** 이 요청이 불러오는 급여기간 라벨('YYYY-MM') — 반영할 때 화면 자료의 기간으로 함께 기록한다 */
  readonly periodLabel: string
  /** 요청을 시작할 때의 기간 세대(PeriodLoader.changePeriod마다 1씩 증가) — 같은 라벨로 돌아와도(A→B→A) 다르다 */
  readonly epoch: number
  /** 아직 가장 최근 요청이고 화면이 살아 있으면 true — false면 응답·오류를 상태에 반영하지 않는다 */
  isCurrent(): boolean
}

export interface LoadGate {
  begin(periodLabel: string, epoch?: number): LoadTicket
  invalidate(): void
  activate(): void
  dispose(): void
  isAlive(): boolean
}

export function createLoadGate(): LoadGate {
  let latest = 0
  let alive = true
  return {
    begin(periodLabel, epoch = 0) {
      const id = ++latest
      return { id, periodLabel, epoch, isCurrent: () => alive && id === latest }
    },
    invalidate() { latest++ },
    activate() { alive = true },
    dispose() { alive = false },
    isAlive: () => alive,
  }
}

/**
 * 화면의 "지금 보는 급여기간"과 불러오기를 묶는다 — 순수 함수(React·DB 없음, 세대 판정은 LoadGate).
 *
 * reload()는 만들어질 때의 기간이 아니라 호출 시점의 최신 기간(current())을 읽는다. 저장·수정 RPC를 기다리는 동안
 * 기간이 바뀌어도, 끝난 뒤의 reload가 이전 기간을 다시 불러와 최신 기간 요청을 무효로 만들지 않는다.
 * changePeriod()는 기간 세대(epoch)를 올리고 지금까지의 요청을 모두 낡게 만들며(invalidate), 기간별 안내·오류
 * (onPeriodChange)를 그 자리에서 지운다 — 이전 기간의 늦은 응답은 이미 낡은 요청이라 지운 상태를 다시 덮지 못한다.
 *
 * 동기화(sync)는 기간 세대마다 하나만 진행한다. 같은 세대에서 동기화가 끝나기 전에 load·reload가 새 최신 요청이 되면
 * 진행 중인 동기화에 합류해 그 결과(onSync)를 반영하고, 동기화가 끝난 뒤에 자료를 읽는다 — 동기화 안내가 버려지거나
 * 동기화 전 목록으로 실행 가능 상태가 되지 않는다. 다른 기간(세대)으로 바뀌면 이전 동기화에는 합류하지 않는다.
 */
export interface PeriodLoaderOptions<P, S> {
  initial: P
  /** 기간 → 급여기간 라벨('YYYY-MM') */
  label: (period: P) => string
  /** 한 기간 동기화(서버 호출). 예외를 던지면 그 동기화를 기다린 요청은 onError로 끝난다 */
  sync: (period: P) => Promise<S>
  /** 동기화 결과 반영 — 그 결과를 기다린 요청이 아직 최신일 때만 */
  onSync: (result: S, ticket: LoadTicket) => void
  /** 한 기간 자료 불러오기. await 뒤마다 ticket.isCurrent()를 확인하고 아니면 상태를 바꾸지 않는다. 예외는 던져도 된다 */
  run: (period: P, ticket: LoadTicket) => Promise<void>
  /** reload 시작 시 동기 처리(예: loading 표시) */
  onReloadStart: () => void
  /** 기간 전환 순간 — 이전 기간의 안내·오류(attention·syncFailed·loadError)를 지운다 */
  onPeriodChange: () => void
  /** run이 예외로 끝났고 그 요청이 아직 최신일 때만 */
  onError: (ticket: LoadTicket) => void
}

/**
 * 저장·확정·폐기 같은 작업의 기간 소유권 — 시작할 때의 기간 라벨과 세대를 고정한다.
 * 끝났을 때 isCurrent()가 false면(기간이 바뀌었거나 A→B→A로 돌아왔거나 화면이 사라짐) 메시지·미리보기 등 화면 상태를 바꾸지 않는다.
 */
export interface ActionToken {
  readonly periodLabel: string
  readonly epoch: number
  isCurrent(): boolean
}

export interface PeriodLoader<P> {
  current(): P
  /** 지금 기간 세대 */
  epoch(): number
  /** 이 기간 불러오기(기간 전환 effect가 부른다). sync=true면 이 세대의 동기화를 시작하거나 진행 중인 것에 합류한다 */
  load(period: P, sync: boolean): Promise<void>
  /** 호출 시점의 최신 기간으로 다시 불러오기(같은 세대의 진행 중 동기화에는 합류) */
  reload(): Promise<void>
  /** 기간을 바꾸고 새 세대 번호를 돌려준다 */
  changePeriod(period: P): number
  /** viewEpoch(화면이 그린 기간 세대)가 지금 세대와 같고 화면이 살아 있을 때만 작업 소유권을 준다 — 아니면 null */
  beginAction(viewEpoch: number): ActionToken | null
  activate(): void
  dispose(): void
}

export function createPeriodLoader<P, S>(opts: PeriodLoaderOptions<P, S>): PeriodLoader<P> {
  const gate = createLoadGate()
  let current = opts.initial
  let epoch = 0
  // 이 세대에서 진행 중인 동기화 — 끝나면(성공·실패) 비운다. 기간이 바뀌면 버린다(이전 세대 결과에는 합류하지 않음)
  let inflight: { epoch: number; promise: Promise<S> } | null = null

  function syncFor(period: P, start: boolean): Promise<S> | null {
    if (inflight && inflight.epoch === epoch) return inflight.promise
    if (!start) return null
    const entry = { epoch, promise: opts.sync(period) }
    inflight = entry
    const clear = () => { if (inflight === entry) inflight = null }
    entry.promise.then(clear, clear)
    return entry.promise
  }

  async function load(period: P, sync: boolean) {
    const ticket = gate.begin(opts.label(period), epoch)
    try {
      const pending = syncFor(period, sync)
      if (pending) {
        const result = await pending
        if (!ticket.isCurrent()) return
        opts.onSync(result, ticket)
      }
      await opts.run(period, ticket)
    } catch {
      if (ticket.isCurrent()) opts.onError(ticket)
    }
  }
  return {
    current: () => current,
    epoch: () => epoch,
    load,
    reload() {
      opts.onReloadStart()
      return load(current, false)
    },
    changePeriod(period) {
      current = period
      epoch++
      inflight = null
      gate.invalidate()
      opts.onPeriodChange()
      return epoch
    },
    beginAction(viewEpoch) {
      if (!gate.isAlive() || viewEpoch !== epoch) return null
      const e = epoch
      const periodLabel = opts.label(current)
      return { periodLabel, epoch: e, isCurrent: () => gate.isAlive() && e === epoch && opts.label(current) === periodLabel }
    },
    activate: () => gate.activate(),
    dispose: () => gate.dispose(),
  }
}

/** 화면 자료가 지금 보는 기간·세대의 것인지 — 불러오는 중이어도(같은 기간 reload) 자료의 기간 소유는 유지된다 */
export interface PeriodDataState {
  label: string
  viewEpoch: number
  data: { label: string; epoch: number } | null
  loading: boolean
}

export function periodDataOwned(s: PeriodDataState): boolean {
  return s.data !== null && s.data.label === s.label && s.data.epoch === s.viewEpoch
}

/** 실행·저장·확정·폐기·확정 취소 가능 — 불러오기가 끝났고 화면 자료가 지금 기간·세대의 것일 때만 */
export function periodDataReady(s: PeriodDataState): boolean {
  return !s.loading && periodDataOwned(s)
}

/**
 * 기간 소유권을 가진 작업 실행 — 시작 기간이 끝날 때까지 화면 기간이면(owned) onDone으로 메시지·미리보기 등을 반영한다.
 * 기간이 바뀌었으면 화면 상태는 건드리지 않는다. 성공했으면 DB가 바뀌었으므로 소유와 상관없이 reload(호출 시점의 최신 기간)한다.
 * reload 뒤에도 여전히 소유하고 있을 때만 afterReload(탭 이동 등). 돌려주는 값: reload 뒤까지 소유한 채로 성공했는지.
 */
export async function runPeriodAction<R extends { error: unknown }>(a: {
  token: ActionToken
  work: () => PromiseLike<R>
  onDone: (result: R) => void
  reload: () => Promise<void>
  afterReload?: () => void
}): Promise<boolean> {
  const result = await a.work()
  const owned = a.token.isCurrent()
  if (owned) a.onDone(result)
  if (result.error) return false
  await a.reload()
  const stillOwned = owned && a.token.isCurrent()
  if (stillOwned) a.afterReload?.()
  return stillOwned
}
