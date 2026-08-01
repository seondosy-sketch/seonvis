/**
 * 숙박관리 — 중복 숙박 경고.
 *
 * 동일 대표 이용자의 숙박기간이 겹치면 저장 전에 경고하되 차단하지 않는다(정정 전 임시 중복,
 * 여러 객실 사용, 별도 예약 분리 등 실제 업무상 예외가 있을 수 있음 — 사용자 확정).
 * 겹침 판정: existing.check_in < new.check_out AND existing.check_out > new.check_in.
 */
import { LodgingRecord } from './types'

export interface DuplicateWarning {
  record: LodgingRecord
  hotel_name_snapshot: string
  check_in: string
  check_out: string
  project_name_snapshot: string
}

function isSameGuest(a: Pick<LodgingRecord, 'guest_source' | 'engineer_contact_id' | 'overtime_employee_id'>, b: typeof a): boolean {
  if (a.guest_source !== b.guest_source) return false
  return a.guest_source === 'engineer_contact'
    ? a.engineer_contact_id === b.engineer_contact_id
    : a.overtime_employee_id === b.overtime_employee_id
}

/** 같은 대표 이용자의 기존 레코드 중 [checkIn, checkOut)과 겹치는 것을 찾는다(자기 자신은 제외). */
export function findOverlappingStays(
  existingRecords: LodgingRecord[],
  guest: Pick<LodgingRecord, 'guest_source' | 'engineer_contact_id' | 'overtime_employee_id'>,
  checkIn: string,
  checkOut: string,
  excludeRecordId?: string,
): DuplicateWarning[] {
  return existingRecords
    .filter(r => r.id !== excludeRecordId)
    .filter(r => isSameGuest(r, guest))
    .filter(r => r.check_in < checkOut && r.check_out > checkIn)
    .map(r => ({
      record: r,
      hotel_name_snapshot: r.hotel_name_snapshot,
      check_in: r.check_in,
      check_out: r.check_out,
      project_name_snapshot: r.project_name_snapshot,
    }))
}
