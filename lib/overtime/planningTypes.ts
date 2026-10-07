/**
 * 연장근무 자동배정 DB 타입 — supabase/migration_overtime_planning_a_base.sql·_b_activate.sql(초안)과 1:1.
 *
 * ⚠ migration을 아직 적용하지 않았으므로 지금은 어떤 코드도 이 타입을 쓰지 않는다. Phase 4에서
 * migration 적용 후 사용한다. 필드명은 이 코드베이스 관례대로 DB 컬럼명 그대로(snake_case)다.
 * 계약 설명: docs/overtime-planning-db.md
 */

/** 급여기간 라벨 'YYYY-MM' = 전월 21일 ~ 당월 20일 (lib/overtime/summary.ts payPeriodRange와 같은 규칙) */
export type PayPeriodLabel = string

/** payPeriodDays(year, month0)의 인자 → 'YYYY-MM' 라벨 */
export function toPayPeriodLabel(year: number, month0: number): PayPeriodLabel {
  return `${year}-${String(month0 + 1).padStart(2, '0')}`
}

export interface MonthlyTarget {
  id: string
  employee_id: string
  period_label: PayPeriodLabel
  target_hours: number
  created_at: string
  updated_at: string
  created_by: string
  updated_by: string
}

/**
 * 직원×프로젝트에서 쓸 업무. 어떤 참여관계(member)에 행이 하나도 없으면 그 직원의
 * 기본업무(overtime_employee_tasks) 전체를 쓴다 — 애플리케이션 계약.
 */
export interface MemberTask {
  id: string
  member_id: string   // overtime_project_members.id
  task_id: string     // overtime_employee_tasks.id (같은 직원의 업무 — 복합 FK로 보장)
  employee_id: string
  created_at: string
  created_by: string
}

export type AssignmentScope = 'all' | 'employee' | 'project'
export type AssignmentRunStatus = 'draft' | 'partially_confirmed' | 'confirmed' | 'superseded' | 'discarded'

export interface AssignmentRun {
  id: string
  period_label: PayPeriodLabel
  seed: number
  scope: AssignmentScope
  scope_employee_id: string | null
  scope_project_id: string | null
  rule_version: string
  input_snapshot: Record<string, unknown>   // 내부 ID·기간·목표·프로젝트 날짜·업무 관계만 (개인정보 없음)
  result_summary: Record<string, unknown>
  status: AssignmentRunStatus
  created_by: string
  created_at: string
  updated_at: string
  confirmed_at: string | null
  discarded_at: string | null
}

/** 자동배정 시간 유형 — 기존 프리셋(lib/overtime/time.ts TIME_TYPE_PRESETS)과 같은 키 */
export type AssignmentTimeType = '2h' | '3h'
export type AssignmentDraftStatus = 'draft' | 'confirmed' | 'superseded' | 'discarded'

export interface AssignmentDraft {
  id: string
  run_id: string
  employee_id: string
  project_id: string
  work_date: string          // YYYY-MM-DD
  task_id: string | null     // 업무가 지워지면 null (task_name 스냅샷은 남음)
  task_name: string
  time_type: AssignmentTimeType
  start_time: string         // 프리셋에서 DB가 채움
  end_time: string
  break_hours: number
  hours: number              // 2 | 3
  is_weekend: boolean        // DB가 계산
  is_holiday: boolean        // DB가 holidays에서 계산
  exception_reason: string | null  // 주말·공휴일 배정 사유(필수), 평일은 null
  manually_edited: boolean
  locked: boolean
  status: AssignmentDraftStatus
  confirmed_at: string | null
  created_at: string
  updated_at: string
}

/** overtime_save_assignment_run의 p_drafts 원소 — 시간·업무명·주말/공휴일은 DB가 채운다 */
export interface AssignmentDraftInput {
  employee_id: string
  project_id: string
  work_date: string
  task_id: string
  time_type: AssignmentTimeType
  exception_reason?: string | null
}

/** overtime_save_assignment_run의 p_run */
export interface AssignmentRunInput {
  period_label: PayPeriodLabel
  seed: number
  scope: AssignmentScope
  scope_employee_id?: string | null
  scope_project_id?: string | null
  rule_version: string
  input_snapshot: Record<string, unknown>
  result_summary: Record<string, unknown>
}

/**
 * overtime_work_records에 추가되는 컬럼(전부 nullable). Phase 4에서 types.ts의 WorkRecord에 합친다.
 * source가 null이면 migration 이전부터 있던 기존 수동기록이다.
 */
export interface WorkRecordPlanningFields {
  source: 'manual' | 'auto' | null
  assignment_run_id: string | null
  assignment_draft_id: string | null
  employee_name_snapshot: string | null
  project_name_snapshot: string | null
  task_name_snapshot: string | null
  assignment_exception_reason: string | null  // 자동배정 주말·공휴일 사유 (수동 메모 note와 분리)
  confirmed_at: string | null
}

/** DB가 돌려주는 오류 메시지 접두어 — 화면이 사유를 안내할 때 쓴다 */
// monthlyTarget는 monthlyTargetMissing의 앞부분과 같다 — 접두어로 판별할 때는 Missing을 먼저 검사한다.
export const OVERTIME_DB_ERRORS = {
  weeklyCap: 'OVERTIME_WEEKLY_CAP',
  monthlyTarget: 'OVERTIME_MONTHLY_TARGET',
  monthlyTargetMissing: 'OVERTIME_MONTHLY_TARGET_MISSING',
  monthlyTargetExceeded: 'OVERTIME_MONTHLY_TARGET_EXCEEDED',  // 수동 입력 월 목표 트리거(migration_overtime_monthly_target_guard.sql)
  holidaysMissing: 'OVERTIME_HOLIDAYS_MISSING',
  draftInvalid: 'OVERTIME_DRAFT_INVALID',
  confirmInvalid: 'OVERTIME_CONFIRM_INVALID',
  autoRecordLocked: 'OVERTIME_AUTO_RECORD_LOCKED',
  runNotConfirmable: 'OVERTIME_RUN_NOT_CONFIRMABLE',
} as const
