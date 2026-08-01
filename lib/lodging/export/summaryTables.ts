/**
 * 숙박관리 월별 정산서 — 현황(occupancy)과 비용(financial) 집계를 프로젝트/업무/사람 기준으로
 * 나란히 보여주기 위한 조인 헬퍼. 두 집계는 대상 레코드 집합 자체가 다르므로(월경계 처리 원칙)
 * 각자 독립적으로 계산된 GroupedTotal[]을 key 기준으로만 합친다 — 집계 로직 자체를 섞지 않는다.
 */
import { GroupedTotal } from '@/lib/lodging/summary'

export interface JoinedGroupRow {
  key: string
  label: string
  nights: number   // occupancy 기준(총 숙박 박수)
  amount: number    // financial 기준(총금액, 체크인월 전액 귀속)
}

export function joinGroupTotals(occupancy: GroupedTotal[], financial: GroupedTotal[]): JoinedGroupRow[] {
  const rows = new Map<string, JoinedGroupRow>()
  for (const o of occupancy) rows.set(o.key, { key: o.key, label: o.label, nights: o.value, amount: 0 })
  for (const f of financial) {
    const existing = rows.get(f.key)
    if (existing) existing.amount = f.value
    else rows.set(f.key, { key: f.key, label: f.label, nights: 0, amount: f.value })
  }
  return [...rows.values()].sort((a, b) => b.amount - a.amount || b.nights - a.nights)
}
