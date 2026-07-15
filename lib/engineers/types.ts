/**
 * 기술인 주소록 — 도메인 타입 (docs/engineer-address-book/03-data-model.md)
 * 필드명은 Supabase 컬럼명과 1:1 (snake_case) — 기존 컨벤션.
 */

export type EmploymentStatus = '재직' | '퇴직' | '비활성'

export interface EngineerContact {
  id: string
  engineer_no: number        // 자동 발급 고유번호 — 추후 Excel 내보내기/동기화의 1순위 매칭 키
  employee_id: string | null // 내부 직원 연결 (MVP 미사용, 확장 예약)
  name: string
  rank: string               // 직위 (상무·이사 등 — 필수)
  position: string           // 직책 (팀장·본부장 등 — 선택)
  company: string
  mobile_phone: string       // 하이픈 포함 표시 형식 그대로 저장·복사
  office_phone: string
  email: string
  region: string             // 시·도 — 주소에서 자동 추출 (수정 가능)
  address: string
  employment_status: EmploymentStatus
  joined_date: string | null
  retired_date: string | null
  memo: string
  is_favorite: boolean
  created_at: string
  updated_at: string
}

export interface EngineerSpecialty {
  id: string
  name: string
  is_active: boolean
  sort_order: number
}

export interface ContactSpecialty {
  id: string
  contact_id: string
  specialty_id: string
}

/**
 * 직위 정렬 서열 — 667건 실데이터의 16종 반영 (06 문서 ③: MVP는 코드 상수).
 * 목록에 없는 새 직위는 오류 없이 표시되고 정렬만 맨 뒤로 간다.
 * 순서 변경 요구가 생기면 설정 테이블로 승격한다.
 */
export const RANK_ORDER = [
  '사원', '대리', '과장', '차장', '부팀장', '팀장', '부장', '소장',
  '이사', '상무이사', '상무', '전무', '부사장', '사장', '총괄사장', '고문',
]

export function rankSortKey(rank: string): number {
  const i = RANK_ORDER.indexOf(rank)
  return i === -1 ? RANK_ORDER.length : i
}

export const REGIONS = [
  '서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종',
  '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주',
]
