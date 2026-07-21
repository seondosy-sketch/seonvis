/**
 * 기술인 출근부 — 출근일수 집계 (Phase 2).
 *
 * attendance_records가 유일한 원본이다 — 합계는 항상 이 배열에서 계산하고 별도 컬럼에
 * 저장하지 않는다(연장근무 DailySummary와 동일 원칙, docs/attendance/03-data-model.md §0).
 */
import type { AttendanceRecord } from './types'

/** 참여자(participant_id)별 출근일수. */
export function presentCountByParticipant(records: AttendanceRecord[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const r of records) map.set(r.participant_id, (map.get(r.participant_id) ?? 0) + 1)
  return map
}

/** 참여자(participant_id)별 출근 처리된 날짜 집합 — 그리드 셀 표시(YYYY-MM-DD 포함 여부 조회)에 사용. */
export function presentDatesByParticipant(records: AttendanceRecord[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>()
  for (const r of records) {
    const set = map.get(r.participant_id) ?? new Set<string>()
    set.add(r.work_date)
    map.set(r.participant_id, set)
  }
  return map
}

/** 참여자 하나의 특정 날짜 출근 여부 — records 원본에서 그때그때 계산(파생 상태를 별도 보관하지 않음). */
export function isPresent(records: AttendanceRecord[], participantId: string, workDate: string): boolean {
  return records.some(r => r.participant_id === participantId && r.work_date === workDate)
}

/** 참여자 하나의 특정 날짜 출근기록(있으면 id 등을 포함) — 삭제(체크 해제) 시 정확한 행을 지목하기 위함. */
export function findRecord(
  records: AttendanceRecord[],
  participantId: string,
  workDate: string,
): AttendanceRecord | undefined {
  return records.find(r => r.participant_id === participantId && r.work_date === workDate)
}
