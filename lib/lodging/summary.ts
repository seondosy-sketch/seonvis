/**
 * 숙박관리 — 월별 집계.
 *
 * 숙박현황(occupancy)과 비용정산(financial)은 입력 필터셋 자체가 다르므로 절대 하나로 합치지 않는다
 * (사용자 확정 원칙):
 *   - 현황: 그 달과 "겹치는" 모든 레코드 대상(monthRange.ts의 nightsOverlappingMonth > 0).
 *     걸치는 예약(예: 1/31~2/2)은 1월/2월 양쪽 현황에 모두 나타난다.
 *   - 비용: check_in이 그 달에 "속하는" 레코드만 대상 — 총금액은 체크인월에 전액 귀속.
 * 동반자는 자유 텍스트라 정확한 고유 인원 식별이 불가능하므로, v1은 "실제 숙박 연인원"(박수 가중)과
 * "실제 숙박인원 단순 합계"(박수 가중 없음) 두 지표만 제공한다 — 고유 실제 인원은 계산하지 않는다.
 */
import { LodgingRecord } from './types'
import { checkInIsInMonth, nightsOverlappingMonth } from './monthRange'

export interface GroupedTotal {
  key: string
  label: string
  value: number
}

export interface OccupancySummary {
  bookingCount: number              // 그 달과 겹치는 레코드 수 (걸치는 예약은 양쪽 달 모두 카운트)
  uniqueGuestCount: number          // distinct 대표 이용자 수
  actualGuestPersonNights: number   // Σ actual_guest_count × 그 달에 겹치는 박수 (연인원)
  actualGuestSimpleSum: number      // Σ actual_guest_count (박수 가중 없음, 겹치는 레코드 기준)
  totalNights: number               // Σ 그 달에 겹치는 박수
  totalRoomNights: number           // Σ room_count × 그 달에 겹치는 박수 — 정산 화면에서 우선 표시
  byProject: GroupedTotal[]         // value = 그 프로젝트의 totalNights
  byPurpose: GroupedTotal[]
  byGuest: GroupedTotal[]
}

export interface FinancialSummary {
  recordCount: number   // check_in이 그 달에 속하는 레코드 수
  totalAmount: number    // Σ total_price (체크인월 전액 귀속)
  byProject: GroupedTotal[]
  byPurpose: GroupedTotal[]
  byGuest: GroupedTotal[]
}

function guestKey(r: Pick<LodgingRecord, 'guest_source' | 'engineer_contact_id' | 'overtime_employee_id'>): string {
  return r.guest_source === 'engineer_contact'
    ? `engineer_contact:${r.engineer_contact_id}`
    : `overtime_employee:${r.overtime_employee_id}`
}

function groupBy(records: LodgingRecord[], keyOf: (r: LodgingRecord) => { key: string; label: string }, valueOf: (r: LodgingRecord) => number): GroupedTotal[] {
  const totals = new Map<string, GroupedTotal>()
  for (const r of records) {
    const { key, label } = keyOf(r)
    const existing = totals.get(key)
    const value = valueOf(r)
    if (existing) existing.value += value
    else totals.set(key, { key, label, value })
  }
  return [...totals.values()].sort((a, b) => b.value - a.value)
}

export function buildOccupancySummary(records: LodgingRecord[], year: number, month: number): OccupancySummary {
  const overlapping = records.filter(r => nightsOverlappingMonth(r, year, month) > 0)
  const nightsOf = (r: LodgingRecord) => nightsOverlappingMonth(r, year, month)

  return {
    bookingCount: overlapping.length,
    uniqueGuestCount: new Set(overlapping.map(guestKey)).size,
    actualGuestPersonNights: overlapping.reduce((sum, r) => sum + r.actual_guest_count * nightsOf(r), 0),
    actualGuestSimpleSum: overlapping.reduce((sum, r) => sum + r.actual_guest_count, 0),
    totalNights: overlapping.reduce((sum, r) => sum + nightsOf(r), 0),
    totalRoomNights: overlapping.reduce((sum, r) => sum + r.room_count * nightsOf(r), 0),
    byProject: groupBy(
      overlapping,
      r => ({ key: r.project_id ?? '(비프로젝트)', label: r.project_name_snapshot || '(비프로젝트)' }),
      nightsOf,
    ),
    byPurpose: groupBy(overlapping, r => ({ key: r.purpose || '(미지정)', label: r.purpose || '(미지정)' }), nightsOf),
    byGuest: groupBy(overlapping, r => ({ key: guestKey(r), label: r.guest_name_snapshot }), nightsOf),
  }
}

export function buildFinancialSummary(records: LodgingRecord[], year: number, month: number): FinancialSummary {
  const financialRecords = records.filter(r => checkInIsInMonth(r, year, month))
  const amountOf = (r: LodgingRecord) => r.total_price

  return {
    recordCount: financialRecords.length,
    totalAmount: financialRecords.reduce((sum, r) => sum + r.total_price, 0),
    byProject: groupBy(
      financialRecords,
      r => ({ key: r.project_id ?? '(비프로젝트)', label: r.project_name_snapshot || '(비프로젝트)' }),
      amountOf,
    ),
    byPurpose: groupBy(financialRecords, r => ({ key: r.purpose || '(미지정)', label: r.purpose || '(미지정)' }), amountOf),
    byGuest: groupBy(financialRecords, r => ({ key: guestKey(r), label: r.guest_name_snapshot }), amountOf),
  }
}
