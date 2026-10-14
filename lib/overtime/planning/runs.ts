import type { AssignmentRun } from '../planningTypes'

/**
 * 실행(run) 폐기 버튼을 보일지 — 남은 초안 수가 아니라 실행 상태로 정한다. 순수 함수.
 * 초안 칸을 하나씩 모두 빼도 실행은 'draft'로 남는다. overtime_discard_run은 남은 초안이 0건이어도
 * 확정분이 없으면 실행을 'discarded'로, 있으면 상태를 다시 계산하므로 draft·partially_confirmed면 항상 부를 수 있다.
 */
export function canDiscardRun(run: Pick<AssignmentRun, 'status'>): boolean {
  return run.status === 'draft' || run.status === 'partially_confirmed'
}
