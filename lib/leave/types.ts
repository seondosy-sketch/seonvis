/**
 * 휴가관리 — 도메인 타입 정의 (docs/leave-management/03-data-model.md)
 *
 * 핵심 원칙 (연장근무와 동일):
 *   월별/연간 사용일수·잔여 연차는 저장하지 않고 항상 LeaveRecordDate(날짜별 전개)에서
 *   계산한다. 집계·중복 검증·월 셀 상세보기가 전부 이 전개 데이터를 기준으로 한다.
 *
 * 필드명은 Supabase 컬럼명과 1:1 (snake_case, 변환 레이어 없음) — 기존 컨벤션.
 * 직원은 overtime_employees를 공용으로 쓴다 — 연장근무의 Employee 타입을 수정하지 않기
 * 위해(연장근무 무영향 원칙) 휴가관리 쪽에서 hire_date/resign_date 포함 타입을 따로 정의한다.
 */

export interface LeaveEmployee {
  id: string
  name: string
  position: string
  is_active: boolean
  sort_order: number
  hire_date: string | null   // 입사일 YYYY-MM-DD. 휴가관리 연차 설정 모달에서 편집
  resign_date: string | null // 퇴사일. 재직 중이면 null
}

export interface LeaveType {
  id: string
  name: string
  deducts_annual_leave: boolean   // 연차 차감 여부
  default_deduction_unit: number  // 기본 차감 단위 (1 / 0.5 / 0)
  is_active: boolean              // 비활성 유형은 신규 등록 드롭다운에서 제외 (소프트 삭제)
  sort_order: number
}

export interface AnnualLeaveBalance {
  id: string
  employee_id: string
  year: number
  granted_days: number     // 기본 부여 연차 (0.5 단위 허용)
  adjustment_days: number  // 조정일수 (이월/추가부여/보정/차감, ± 허용)
  adjustment_reason: string
  updated_at: string
}
// 최종 사용 가능 연차 = granted_days + adjustment_days (저장하지 않고 항상 계산)

export interface BalanceHistory {
  id: string
  employee_id: string
  year: number
  previous_granted_days: number | null // 최초 부여면 null
  new_granted_days: number
  previous_adjustment_days: number | null
  new_adjustment_days: number
  reason: string
  changed_at: string
}

/** 날짜별 사용 단위 — 전일 / 오전 반차 / 오후 반차 */
export type DayUnit = 'full' | 'am' | 'pm'

export const DAY_UNIT_LABEL: Record<DayUnit, string> = {
  full: '전일',
  am: '오전 반차',
  pm: '오후 반차',
}

export interface LeaveRecord {
  id: string
  employee_id: string
  leave_type_id: string
  start_date: string
  end_date: string
  start_day_unit: DayUnit
  end_day_unit: DayUnit // 시작일=종료일이면 start와 동일하게 저장
  total_calendar_days: number // 전체 기간 = 종료-시작+1. "몇 박"은 -1로 파생
  deducted_days: number       // 실제 차감 합 — dates 재생성 때마다 함께 다시 계산
  memo: string
  created_at: string
}

export interface LeaveRecordDate {
  id: string
  leave_record_id: string
  leave_date: string
  day_unit: DayUnit
  deducted_days: number // 이 날짜의 차감 (1 / 0.5 / 0)
  is_weekend: boolean
  is_holiday: boolean
  holiday_name: string | null // 저장 시점 스냅샷
}

export interface Holiday {
  id: string
  holiday_date: string
  name: string
  holiday_type: '법정공휴일' | '회사휴무'
}
