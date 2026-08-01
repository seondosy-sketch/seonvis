import { describe, expect, it } from 'vitest'
import { findOverlappingStays } from './duplicateCheck'
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
    project_id: null,
    project_name_snapshot: '',
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

const guest = { guest_source: 'engineer_contact' as const, engineer_contact_id: 'eng-1', overtime_employee_id: null }

describe('findOverlappingStays', () => {
  it('겹치는 기간이면 경고 대상에 포함된다', () => {
    const existing = [makeRecord({ check_in: '2026-08-15', check_out: '2026-08-17' })]
    const result = findOverlappingStays(existing, guest, '2026-08-16', '2026-08-18')
    expect(result).toHaveLength(1)
  })

  it('맞닿기만 하고 겹치지 않으면 대상이 아니다(체크아웃일 = 체크인일)', () => {
    const existing = [makeRecord({ check_in: '2026-08-15', check_out: '2026-08-17' })]
    const result = findOverlappingStays(existing, guest, '2026-08-17', '2026-08-19')
    expect(result).toHaveLength(0)
  })

  it('다른 대표 이용자의 겹치는 기록은 대상이 아니다', () => {
    const existing = [makeRecord({ engineer_contact_id: 'eng-2', check_in: '2026-08-15', check_out: '2026-08-17' })]
    const result = findOverlappingStays(existing, guest, '2026-08-16', '2026-08-18')
    expect(result).toHaveLength(0)
  })

  it('자기 자신(수정 중인 레코드)은 제외한다', () => {
    const existing = [makeRecord({ id: 'rec-1', check_in: '2026-08-15', check_out: '2026-08-17' })]
    const result = findOverlappingStays(existing, guest, '2026-08-16', '2026-08-18', 'rec-1')
    expect(result).toHaveLength(0)
  })
})
