/**
 * 숙박관리 화면 전용 최소 타입 — Project List/기술인 주소록/직원 목록의 전체 컬럼이 아니라
 * 이 화면이 실제로 쓰는 컬럼만 투영한다(기술인 출근부의 AttendanceProjectRow와 동일한 이유).
 */

export interface LodgingProjectRef {
  id: string
  name: string
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
