import { describe, expect, it } from 'vitest'
import { buildFinancialSummary, buildOccupancySummary } from './summary'
import type { LodgingRecord } from './types'

function makeRecord(overrides: Partial<LodgingRecord> = {}): LodgingRecord {
  return {
    id: 'rec-1',
    guest_source: 'engineer_contact',
    engineer_contact_id: 'eng-1',
    overtime_employee_id: null,
    guest_name_snapshot: '홍길동',
    actual_guest_count: 1,
    companion_names: '',
    project_id: 'proj-1',
    project_name_snapshot: '화성여자교도소',
    purpose: '면접 준비',
    work_date: null,
    work_date_type: null,
    hotel_id: null,
    hotel_name_snapshot: '신라스테이',
    room_type: 'Standard',
    check_in: '2026-08-15',
    check_out: '2026-08-17',
    room_count: 1,
    price_per_night: 88000,
    total_price: 176000,
    memo: '',
    created_by: 'a@seon.co.kr',
    updated_by: 'a@seon.co.kr',
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    ...overrides,
  }
}

describe('buildOccupancySummary — 동반자 있는 예약', () => {
  // 대표 이용자 1명, 실제 숙박인원 2명(동반자 1명), 객실 1실, 2박(8/15~8/17)
  const records = [
    makeRecord({ actual_guest_count: 2, companion_names: '김철수', check_in: '2026-08-15', check_out: '2026-08-17' }),
  ]

  it('예약 건수/대표 이용자 수는 1', () => {
    const s = buildOccupancySummary(records, 2026, 8)
    expect(s.bookingCount).toBe(1)
    expect(s.uniqueGuestCount).toBe(1)
  })
  it('실제 숙박인원 단순합계는 2, 연인원은 2명×2박=4', () => {
    const s = buildOccupancySummary(records, 2026, 8)
    expect(s.actualGuestSimpleSum).toBe(2)
    expect(s.actualGuestPersonNights).toBe(4)
  })
  it('총 숙박 박수 2, 총 객실박수(1실×2박)는 2', () => {
    const s = buildOccupancySummary(records, 2026, 8)
    expect(s.totalNights).toBe(2)
    expect(s.totalRoomNights).toBe(2)
  })
})

describe('월 경계 숙박(1/31 체크인 ~ 2/2 체크아웃)의 현황/비용 분리', () => {
  const records = [
    makeRecord({
      id: 'boundary-1',
      check_in: '2026-01-31',
      check_out: '2026-02-02',
      room_count: 1,
      price_per_night: 100000,
      total_price: 200000, // 100000 * 2박 * 1실
    }),
  ]

  it('현황: 1월과 2월 양쪽에 겹치는 박수(각 1박)만큼 나타난다', () => {
    const jan = buildOccupancySummary(records, 2026, 1)
    const feb = buildOccupancySummary(records, 2026, 2)
    expect(jan.bookingCount).toBe(1)
    expect(feb.bookingCount).toBe(1)
    expect(jan.totalNights).toBe(1)
    expect(feb.totalNights).toBe(1)
    expect(jan.totalRoomNights).toBe(1)
    expect(feb.totalRoomNights).toBe(1)
  })

  it('비용: 체크인월(1월)에만 전액 귀속되고 2월은 0', () => {
    const jan = buildFinancialSummary(records, 2026, 1)
    const feb = buildFinancialSummary(records, 2026, 2)
    expect(jan.recordCount).toBe(1)
    expect(jan.totalAmount).toBe(200000)
    expect(feb.recordCount).toBe(0)
    expect(feb.totalAmount).toBe(0)
  })

  it('3월에는 현황·비용 모두 나타나지 않는다', () => {
    expect(buildOccupancySummary(records, 2026, 3).bookingCount).toBe(0)
    expect(buildFinancialSummary(records, 2026, 3).recordCount).toBe(0)
  })
})

describe('프로젝트별/업무별/사람별 그룹핑', () => {
  const records = [
    makeRecord({ id: 'r1', project_id: 'proj-1', project_name_snapshot: 'A현장', purpose: '면접 준비', check_in: '2026-08-01', check_out: '2026-08-03' }),
    makeRecord({ id: 'r2', project_id: 'proj-2', project_name_snapshot: 'B현장', purpose: '출장', check_in: '2026-08-05', check_out: '2026-08-06' }),
  ]

  it('occupancy byProject는 프로젝트별 박수 합계', () => {
    const s = buildOccupancySummary(records, 2026, 8)
    const a = s.byProject.find(g => g.label === 'A현장')
    const b = s.byProject.find(g => g.label === 'B현장')
    expect(a?.value).toBe(2)
    expect(b?.value).toBe(1)
  })

  it('financial byPurpose는 업무별 금액 합계', () => {
    const s = buildFinancialSummary(records, 2026, 8)
    const total = s.byPurpose.reduce((sum, g) => sum + g.value, 0)
    expect(total).toBe(s.totalAmount)
  })
})
