import { describe, expect, it } from 'vitest'
import { currentlyStayingRecords, isCurrentlyStaying } from './status'
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

describe('isCurrentlyStaying / currentlyStayingRecords', () => {
  it('체크인일~체크아웃일 사이(체크아웃일 제외)면 투숙 중', () => {
    const record = makeRecord({ check_in: '2026-08-15', check_out: '2026-08-17' })
    expect(isCurrentlyStaying(record, '2026-08-16')).toBe(true)
    expect(isCurrentlyStaying(record, '2026-08-17')).toBe(false)
  })

  it('여러 레코드 중 오늘 투숙 중인 것만 걸러낸다', () => {
    const records = [
      makeRecord({ id: 'rec-1', check_in: '2026-08-15', check_out: '2026-08-17' }),
      makeRecord({ id: 'rec-2', check_in: '2026-08-20', check_out: '2026-08-22' }),
    ]
    expect(currentlyStayingRecords(records, '2026-08-16').map(r => r.id)).toEqual(['rec-1'])
  })
})
