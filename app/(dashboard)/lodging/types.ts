/**
 * 숙박관리 화면 전용 최소 타입 — Project List/기술인 주소록/직원 목록의 전체 컬럼이 아니라
 * 이 화면이 실제로 쓰는 컬럼만 투영한다(기술인 출근부의 AttendanceProjectRow와 동일한 이유).
 */

/**
 * 프로젝트 선택 목록용. 기술인 출근부와 같은 일정 기준(공고일~발표일이 숙박 기간과 겹치는가)으로
 * 거르므로 날짜·상태 컬럼까지 함께 읽는다 — `lib/lodging/projectOptions.ts` 참고.
 */
export interface LodgingProjectRef {
  id: string
  name: string
  project_number: string
  announce_date: string | null
  interview_date: string | null
  bid_date: string | null
  status: string
}

export interface LodgingEngineerRef {
  id: string
  name: string
  rank: string
  company: string
}

export interface LodgingEmployeeRef {
  id: string
  name: string
  position: string
  is_active: boolean
}
