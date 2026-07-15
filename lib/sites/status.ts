/**
 * 현장 현황 — 진행 상태 계산 (docs/site-status/02-requirements.md, 07 문서 ⑦⑧)
 *
 * manual_status가 있으면 그 값을 그대로 사용(자동 계산을 덮어씀).
 * 자동 계산은 착수일·준공예정일 중 하나라도 없으면 "일정 미등록".
 * 준공예정일 당일은 "준공 임박"에 포함, 다음 날부터 "준공 완료".
 */

import { SiteStatus } from './types'

function toLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function diffDays(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime()
  return Math.round(ms / 86400000)
}

export function computeSiteStatus(
  startDate: string | null,
  plannedCompletionDate: string | null,
  manualStatus: string | null,
  today: Date,
): SiteStatus {
  if (manualStatus) return manualStatus as SiteStatus
  if (!startDate || !plannedCompletionDate) return '일정 미등록'

  const start = toLocalDate(startDate)
  const planned = toLocalDate(plannedCompletionDate)
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate())

  if (todayMidnight < start) return '착수 전'

  const daysUntilCompletion = diffDays(todayMidnight, planned) // 음수면 이미 지남
  if (daysUntilCompletion < 0) return '준공 완료'
  if (daysUntilCompletion <= 90) return '준공 임박' // 당일(0)도 포함
  return '진행 중'
}

export function isManualOverride(manualStatus: string | null): boolean {
  return !!manualStatus
}
