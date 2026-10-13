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
  /** 아직 가장 최근 요청이고 화면이 살아 있으면 true — false면 응답·오류를 상태에 반영하지 않는다 */
  isCurrent(): boolean
}

export interface LoadGate {
  begin(periodLabel: string): LoadTicket
  invalidate(): void
  activate(): void
  dispose(): void
}

export function createLoadGate(): LoadGate {
  let latest = 0
  let alive = true
  return {
    begin(periodLabel) {
      const id = ++latest
      return { id, periodLabel, isCurrent: () => alive && id === latest }
    },
    invalidate() { latest++ },
    activate() { alive = true },
    dispose() { alive = false },
  }
}

/**
 * 화면의 "지금 보는 급여기간"과 불러오기를 묶는다 — 순수 함수(React·DB 없음, 세대 판정은 LoadGate).
 *
 * reload()는 만들어질 때의 기간이 아니라 호출 시점의 최신 기간(current())을 읽는다. 저장·수정 RPC를 기다리는 동안
 * 기간이 바뀌어도, 끝난 뒤의 reload가 이전 기간을 다시 불러와 최신 기간 요청을 무효로 만들지 않는다.
 * changePeriod()는 지금까지의 요청을 모두 낡게 만들고(invalidate), 기간별 안내·오류(onPeriodChange)를 그 자리에서 지운다
 * — 이전 기간의 늦은 응답은 이미 낡은 요청이라 지운 상태를 다시 덮지 못한다.
 */
export interface PeriodLoaderOptions<P> {
  initial: P
  /** 기간 → 급여기간 라벨('YYYY-MM') */
  label: (period: P) => string
  /** 한 기간 불러오기. await 뒤마다 ticket.isCurrent()를 확인하고 아니면 상태를 바꾸지 않는다. 예외는 던져도 된다 */
  run: (period: P, sync: boolean, ticket: LoadTicket) => Promise<void>
  /** reload 시작 시 동기 처리(예: loading 표시) */
  onReloadStart: () => void
  /** 기간 전환 순간 — 이전 기간의 안내·오류(attention·syncFailed·loadError)를 지운다 */
  onPeriodChange: () => void
  /** run이 예외로 끝났고 그 요청이 아직 최신일 때만 */
  onError: (ticket: LoadTicket) => void
}

export interface PeriodLoader<P> {
  current(): P
  /** 이 기간 불러오기(기간 전환 effect가 부른다) */
  load(period: P, sync: boolean): Promise<void>
  /** 호출 시점의 최신 기간으로 다시 불러오기 */
  reload(): Promise<void>
  changePeriod(period: P): void
  activate(): void
  dispose(): void
}

export function createPeriodLoader<P>(opts: PeriodLoaderOptions<P>): PeriodLoader<P> {
  const gate = createLoadGate()
  let current = opts.initial
  async function load(period: P, sync: boolean) {
    const ticket = gate.begin(opts.label(period))
    try {
      await opts.run(period, sync, ticket)
    } catch {
      if (ticket.isCurrent()) opts.onError(ticket)
    }
  }
  return {
    current: () => current,
    load,
    reload() {
      opts.onReloadStart()
      return load(current, false)
    },
    changePeriod(period) {
      current = period
      gate.invalidate()
      opts.onPeriodChange()
    },
    activate: () => gate.activate(),
    dispose: () => gate.dispose(),
  }
}
