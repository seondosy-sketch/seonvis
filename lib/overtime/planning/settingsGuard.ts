import type { ActionToken } from './loadGate'

/**
 * 설정 화면(월 목표·참여 프로젝트·업무) 쓰기의 기간 소유권 확인 — 순수 함수(React·DB 없음).
 *
 * 설정 화면은 기간 세대(viewEpoch)마다 새로 그린다. 그 화면의 handler가 DB 쓰기를 시작하기 직전에 이 함수를 불러
 * "호출 시점의" 상태를 본다 — 렌더 때 받은 boolean이 아니라:
 *   화면이 살아 있고 그 화면의 세대가 지금 세대와 같음(beginAction) · 지금 기간 라벨이 그 화면의 기간과 같음 ·
 *   화면 자료가 지금 기간 소유 · 쓰기 권한.
 * A→B→A로 돌아와도 처음 A 화면의 handler는 세대가 달라 false다. 같은 기간 reload는 세대·자료 소유가 그대로라 막지 않는다.
 */
export interface SettingsGuardInput {
  /** PeriodLoader.beginAction — 화면이 살아 있고 viewEpoch가 지금 세대일 때만 token */
  beginAction: (viewEpoch: number) => ActionToken | null
  /** 설정 화면이 만들어진 기간 세대·라벨 */
  viewEpoch: number
  periodLabel: string
  /** 호출 시점의 자료 소유·쓰기 권한(렌더 뒤 갱신되는 값을 읽는다) */
  state: () => { owned: boolean; canWrite: boolean }
}

export function createSettingsActionGuard(input: SettingsGuardInput): () => boolean {
  return () => {
    const token = input.beginAction(input.viewEpoch)
    if (!token || token.periodLabel !== input.periodLabel) return false
    const { owned, canWrite } = input.state()
    return owned && canWrite
  }
}
