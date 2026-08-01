/**
 * 숙박관리 — 도메인 타입 정의
 *
 * 핵심 불변 원칙: lodging_records 1행 = "대표 이용자가 지정된 객실 예약 및 정산 1건".
 * 한 객실에 여러 명이 묵어도 장부에는 대표 이용자 1명만 등록하고, 동반자는 companion_names
 * 자유 텍스트로만 보조 기록한다(인력 테이블과 연결하지 않음) — supabase/migration_lodging.sql 참고.
 *
 * 필드명은 이 코드베이스의 다른 타입들과 동일하게 Supabase 컬럼명과 1:1 대응한다.
 */

export type GuestSource = 'engineer_contact' | 'overtime_employee'
export type WorkDateType = 'interview' | 'proposal_submission' | 'other'

export interface LodgingHotel {
  id: string
  name: string
  default_price_per_night: number
  address: string
  phone: string
  memo: string
  is_active: boolean
  created_at: string
  updated_at: string
}

/**
 * total_price는 Postgres generated column(단가×박수×객실수)이라 이 타입에는 포함하지만,
 * insert/update 페이로드를 만들 때는 절대 이 필드를 넣지 않는다(넣으면 Postgres 에러).
 * 실제 값은 항상 select() 응답에서 받은 값을 신뢰한다 — lib/lodging/period.ts의
 * previewTotalPrice()는 저장 전 폼 미리보기 전용이다.
 */
export interface LodgingRecord {
  id: string

  guest_source: GuestSource
  engineer_contact_id: string | null
  overtime_employee_id: string | null
  guest_name_snapshot: string

  actual_guest_count: number
  companion_names: string

  project_id: string | null
  project_name_snapshot: string

  purpose: string

  work_date: string | null       // YYYY-MM-DD, 면접일시/제안서작성일 등 — nullable
  work_date_type: WorkDateType | null

  hotel_id: string | null
  hotel_name_snapshot: string
  room_type: string

  check_in: string   // YYYY-MM-DD
  check_out: string  // YYYY-MM-DD, 체크인일 <= 재실일 < 체크아웃일 기준으로 항상 판정(체크아웃일 자체는 미포함)
  room_count: number
  price_per_night: number
  total_price: number  // generated column — 읽기 전용

  memo: string

  created_by: string
  updated_by: string
  created_at: string
  updated_at: string
}

/** insert 시 사용하는 페이로드 — id/total_price/created_at/updated_at은 서버가 채운다. */
export type LodgingRecordInsert = Omit<
  LodgingRecord,
  'id' | 'total_price' | 'created_at' | 'updated_at'
>

/** update 시 사용하는 페이로드 — updated_at은 호출부가 매번 명시적으로 세팅한다(§ projects/trip 관례). */
export type LodgingRecordUpdate = Partial<LodgingRecordInsert> & { updated_at: string }

/** 통합 검색(engineer_contacts + overtime_employees) 후보 1건 — guestDirectory.ts 참고. */
export interface GuestCandidate {
  source: GuestSource
  id: string
  name: string
  subLabel: string  // 기술인: 분야·소속 / 직원: 직급
}
