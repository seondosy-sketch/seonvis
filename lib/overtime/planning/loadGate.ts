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
