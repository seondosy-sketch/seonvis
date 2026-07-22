/**
 * 기술인 출근부 화면 전용 — Project List(`projects` 테이블)에서 이 화면이 쓰는 컬럼만 뽑은 최소 형태.
 * `lib/projectStatus.ts`의 `ProjectRef`(주간보고용, id/announce_date/status 없음)와는 용도가 달라
 * 별도로 정의한다 — 필드명은 컬럼명과 1:1(기존 컨벤션).
 */
export interface AttendanceProjectRow {
  id: string
  project_number: string
  name: string
  announce_date: string | null
  interview_date: string | null
  bid_date: string | null
  status: string
  director: string
  staff_arch: string
  staff_civil: string
  staff_mech: string
  staff_safety: string
}
