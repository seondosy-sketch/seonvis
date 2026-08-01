/**
 * 숙박관리 — "체크인 중(현재 투숙)" 판정. isDateOccupied와 동일 기준(체크인일 포함, 체크아웃일 미포함).
 */
import { LodgingRecord } from './types'
import { isDateOccupied } from './monthRange'

export function isCurrentlyStaying(record: Pick<LodgingRecord, 'check_in' | 'check_out'>, todayStr: string): boolean {
  return isDateOccupied(record, todayStr)
}

export function currentlyStayingRecords(records: LodgingRecord[], todayStr: string): LodgingRecord[] {
  return records.filter(r => isCurrentlyStaying(r, todayStr))
}
