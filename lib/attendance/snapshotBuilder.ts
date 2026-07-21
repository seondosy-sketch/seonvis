/**
 * 기술인 출퇴근부 — 마감 스냅샷(attendance_closure_snapshot_rows) 생성 로직.
 *
 * 이 파일의 함수들은 마감 시점에 attendance_records를 통째로 얼리는 규칙을 강제한다
 * (사용자 검토 지시 #5, docs/attendance/03-data-model.md §4/§5 참고):
 *   - attendance_dates는 반드시 그 마감기간(periodStart~periodEnd) 안의 날짜만 포함해야 한다
 *     — 벗어난 날짜가 있으면 조용히 걸러내지 않고 예외를 던진다(버그를 숨기지 않기 위함).
 *   - 중복 날짜는 조용히 제거한다.
 *   - present_count는 항상 attendance_dates 배열 길이와 같다.
 *   - 같은 마감 버전(closure_id) 안에서 같은 참여자(participant_id)의 스냅샷 행은 1개뿐이어야
 *     하지만, 참여자가 다르면(예: 단장 교체로 생긴 별도 행) 같은 프로젝트라도 여러 행이 정상이다.
 */
import type { AttendanceClosureSnapshotRow, ProjectParticipant } from './types'

/**
 * 원본 출근일자 배열을 스냅샷용으로 정리한다: 마감기간(경계 포함) 밖의 날짜가 하나라도
 * 있으면 예외를 던지고(조용히 버리지 않음), 중복은 제거한 뒤 날짜순으로 정렬해 반환한다.
 */
export function buildAttendanceDatesForSnapshot(
  rawDates: string[],
  periodStart: string,
  periodEnd: string,
): string[] {
  const outOfRange = rawDates.filter(d => d < periodStart || d > periodEnd)
  if (outOfRange.length > 0) {
    throw new Error(
      `마감기간(${periodStart}~${periodEnd}) 밖의 출근일자가 포함되어 있습니다: ${outOfRange.join(', ')}`,
    )
  }
  return Array.from(new Set(rawDates)).sort()
}

export interface SnapshotRowInput {
  closureId: string
  projectId: string
  projectName: string
  participant: ProjectParticipant
  engineerName: string
  specialtyName: string
  rawAttendanceDates: string[]
  periodStart: string
  periodEnd: string
  noteSnapshot: string
}

/**
 * 참여자 1명의 마감 스냅샷 행을 만든다. 프로젝트명·성명·직책·분야를 전부 값으로 복사해
 * 넣는다(참조가 아님) — Project List나 project_participants가 나중에 바뀌어도 이 행은
 * 절대 따라 바뀌지 않는다(과거 출력물 재현의 핵심, docs/attendance/03-data-model.md §0).
 */
export function buildSnapshotRow(input: SnapshotRowInput): Omit<AttendanceClosureSnapshotRow, 'id'> {
  const attendanceDates = buildAttendanceDatesForSnapshot(
    input.rawAttendanceDates,
    input.periodStart,
    input.periodEnd,
  )
  return {
    closure_id: input.closureId,
    project_id: input.projectId,
    project_name_snapshot: input.projectName,
    participant_id: input.participant.id,
    engineer_id: input.participant.engineer_id,
    name_snapshot: input.engineerName,
    role_snapshot: input.participant.role,
    specialty_snapshot: input.specialtyName,
    is_director_snapshot: input.participant.is_director,
    sort_order: input.participant.sort_order,
    attendance_dates: attendanceDates,
    present_count: attendanceDates.length,
    note_snapshot: input.noteSnapshot,
  }
}

/**
 * DB의 UNIQUE(closure_id, participant_id) 제약을 애플리케이션 레이어에서도 미리 검증한다
 * (같은 마감에서 같은 참여자 행이 두 번 만들어지면 insert 시점에야 실패하는 대신 여기서 먼저 잡는다).
 * 서로 다른 participant_id는(단장 교체로 생긴 신/구 참여자 등) 몇 개가 있어도 문제없다.
 */
export function assertNoDuplicateSnapshotKeys(
  rows: Array<Pick<AttendanceClosureSnapshotRow, 'closure_id' | 'participant_id'>>,
): void {
  const seen = new Set<string>()
  for (const row of rows) {
    const key = `${row.closure_id}__${row.participant_id}`
    if (seen.has(key)) {
      throw new Error(`같은 마감(${row.closure_id})에 참여자(${row.participant_id})의 스냅샷 행이 중복됩니다.`)
    }
    seen.add(key)
  }
}
