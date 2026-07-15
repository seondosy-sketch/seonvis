/**
 * 현장 현황 — 도메인 타입 (docs/site-status/04-data-model.md)
 * 필드명은 Supabase 컬럼명과 1:1 (snake_case) — 기존 컨벤션.
 * 월별 배치/스냅샷은 다루지 않는다 — 현재 현장 기본정보 대장.
 */

export type SourceCategory = '건진법' | '주택법' | '건축법' | '전통소'
export type LegalCategory = '건설기술진흥법' | '주택법' | '건축법' | '분리발주(전기·통신·소방)'

/** 원본 시트명 → 화면 표준 표시값 (04 문서 매핑표) */
export const LEGAL_CATEGORY_BY_SOURCE: Record<SourceCategory, LegalCategory> = {
  건진법: '건설기술진흥법',
  주택법: '주택법',
  건축법: '건축법',
  전통소: '분리발주(전기·통신·소방)',
}

export const LEGAL_CATEGORIES: LegalCategory[] = [
  '건설기술진흥법', '주택법', '건축법', '분리발주(전기·통신·소방)',
]

/** 자동 계산 상태 4종 + 일정 미등록. manual_status가 있으면 이 값들 중 하나로 고정 표시된다 */
export type SiteStatus = '착수 전' | '진행 중' | '준공 임박' | '준공 완료' | '중지' | '일정 미등록'

/** 수동 지정 선택지 — "자동"을 고르면 manual_status를 null로 저장한다 */
export const MANUAL_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '자동' },
  { value: '착수 전', label: '착수 전' },
  { value: '진행 중', label: '진행 중' },
  { value: '준공 임박', label: '준공 임박' },
  { value: '준공 완료', label: '준공 완료' },
  { value: '중지', label: '중지' },
]

export interface Site {
  id: string
  site_code: number          // 자동 발급 고유번호 — 향후 엑셀 동기화 1순위 매칭 키
  original_site_name: string // 엑셀 원본 (줄바꿈 포함)
  site_name: string          // 정규화 표시명
  source_category: SourceCategory // 원본 시트명 — 동기화 매칭 기준
  legal_category: LegalCategory   // 화면 표시·필터용 표준값
  manager_name: string
  contractor: string
  site_phone_raw: string     // 원본 연락처 텍스트 그대로 (정보 손실 없음)
  site_landline: string      // 추출된 유선전화 (여러 개면 "; " 연결)
  manager_mobile: string     // 추출된 책임자 핸드폰 (원본 괄호 안 첫 010 — 추정치)
  phone_uncertain: boolean   // 번호가 여럿/모호해 자동추출을 확신할 수 없음
  site_address: string
  office_address: string
  region: string
  start_date: string | null
  planned_completion_date: string | null
  manual_status: string | null // null = 자동 계산
  memo: string
  is_favorite: boolean
  active: boolean            // false = 비활성 (소프트 삭제 역할, deleted_at 없음)
  created_at: string
  updated_at: string
}

export const REGIONS = [
  '서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종',
  '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주',
]
