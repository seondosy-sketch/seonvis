/**
 * 연장근무 자동배정 엔진 — 입력·출력 타입.
 *
 * 순수 TypeScript다. DB·Supabase·React에 의존하지 않는다 — 호출부(Phase 4 API/화면)가 DB에서 읽은 값을
 * 이 형태로 넘기고, 결과(assignments)를 overtime_save_assignment_run의 p_drafts로 보낸다.
 * 필드명은 이 코드베이스 관례대로 DB 컬럼과 같은 snake_case.
 * 설계: docs/overtime-planning-db.md, 규칙: docs/overtime-assign-engine.md
 */

/** 배정 규칙 버전 — 실행 기록에 seed와 함께 남겨 재현 근거로 쓴다. 2: 왕복 금지·평일 우선·최소 2일을 정확 탐색(search.ts)으로 */
export const ASSIGNMENT_RULE_VERSION = 'overtime-assign/2'

/** 직원 1명의 주간(월~일) 연장근무 한도 — 잠금 기록 포함, 모든 프로젝트 합산 */
export const WEEKLY_CAP_HOURS = 12

/**
 * 주말·공휴일 배정 사유 — 최종 배치에서 그 프로젝트 기간의 다른 평일이 왜 안 됐는지로 정한다(엔진·검증 공통 문구).
 *   otherProject: 다른 프로젝트가 쓰고 있거나, 비어 있어도 옮기면 다른 프로젝트 블록과 순서가 섞인다(왕복)
 *   weeklyCap:    비어 있지만 그 주 합계가 12시간을 넘는다
 *   untilSubmit / periodShort: 그 프로젝트 기간 평일이 모두 이 프로젝트 배정·잠금일이다(종료일 = 제출일이면 untilSubmit)
 */
export const WEEKEND_REASONS = {
  otherProject: '같은 기간 다른 프로젝트 배정으로 평일 배정 불가',
  weeklyCap: '주간 12시간 제한으로 평일 배정 불가',
  untilSubmit: '제출일까지 평일 배정 가능시간 부족',
  periodShort: '프로젝트 유효기간 내 평일 부족',
} as const

/**
 * 1일 블록(SINGLE_DAY_PROJECT_BLOCK) 사유 — 확인 순서대로:
 *   PERIOD_TOO_SHORT      프로젝트 기간(급여기간 안) 평일이 1일 이하
 *   LOCKED_OR_WEEKLY_CAP  평일은 2일 이상이지만 잠금일·주 일수 한도를 빼면 1일 이하
 *   TARGET_TOO_SMALL      직원 전체 신규 배정이 하루뿐(남은 목표 2·3시간)
 *   NOT_ENOUGH_DAYS       배정 일수 < 2 × 배정받은 프로젝트 수 — 목표시간으로는 모든 프로젝트에 2일씩 줄 수 없다
 *                         (여력이 있으면 참여 프로젝트마다 최소 1일이 먼저라 우선순위가 낮은 프로젝트가 1일)
 *   OTHER_PROJECTS        그 밖 — 다른 프로젝트와 날짜·주 한도를 나눠 쓰느라 2일을 줄 수 없었다
 */
export type SingleDayReason = 'PERIOD_TOO_SHORT' | 'LOCKED_OR_WEEKLY_CAP' | 'TARGET_TOO_SMALL' | 'NOT_ENOUGH_DAYS' | 'OTHER_PROJECTS'

export interface AssignmentPeriod {
  label: string   // 'YYYY-MM' = 전월 21일 ~ 당월 20일
  start: string   // YYYY-MM-DD (포함)
  end: string     // YYYY-MM-DD (포함)
}

export interface EmployeeProjectInput {
  project_id: string
  /**
   * 이 프로젝트에서 쓸 업무 id. null = 직원×프로젝트 업무를 따로 지정하지 않음 → 그 직원의 기본업무 전체
   * (overtime_member_tasks 행이 0건인 경우). 빈 배열 = 지정했지만 쓸 업무가 없음 → 배정 차단.
   */
  task_ids: string[] | null
}

export interface AssignmentEmployeeInput {
  employee_id: string
  active: boolean
  /** 월 목표시간. null = 목표행 없음(미입력) → 자동배정 차단. 0 = 유효(신규 배정 0건). */
  target_hours: number | null
  projects: EmployeeProjectInput[]
}

export interface AssignmentProjectInput {
  project_id: string
  project_number: string | null
  announce_date: string | null
  submit_date: string | null
  /** 대상기간 시작(= 공고일) — lib/overtime/eligibility.ts의 start */
  period_start: string | null
  /** 대상기간 종료 = 실제 연장근무 적용 종료일 — eligibility.ts의 end */
  period_end: string | null
  /** eligibility.ts의 autoAssignable (needs_review·blocked·ineligible·종료면 false) */
  auto_assignable: boolean
}

export interface AssignmentTaskInput {
  task_id: string
  employee_id: string   // 소유 직원
  task_name: string
  /**
   * 업무 우선순위(작을수록 먼저). 없거나 null이면 입력 배열 순서를 쓴다 — 기존 입력과 호환.
   * 배정일이 업무 수보다 적을 때 어떤 업무를 쓸지, 하위 블록을 어떤 순서로 놓을지 정한다.
   */
  sort_order?: number | null
}

export type LockedSource = 'manual' | 'auto' | 'locked_draft'

/**
 * 자동배정이 바꾸지 않는 기존 시간. 급여기간 밖이라도 같은 주(월~일)에 걸친 기록은 주 12시간 계산에
 * 들어가므로 함께 넘긴다(급여기간 첫 주·마지막 주).
 */
export interface LockedRecordInput {
  employee_id: string
  project_id: string
  work_date: string
  hours: number
  task_name: string
  source: LockedSource
}

export interface HolidayInput {
  date: string
  name: string
}

export interface AssignmentInput {
  period: AssignmentPeriod
  as_of: string            // 배정 기준일(한국 날짜) — 실행 정보로 남긴다
  seed: number             // 결정적 난수 seed (같은 입력 + 같은 seed → 같은 결과)
  rule_version: string
  holidays: HolidayInput[]
  /** 공휴일 데이터가 등록된 연도. 급여기간이 걸친 연도가 하나라도 빠지면 전체 차단. */
  holiday_data_years: number[]
  employees: AssignmentEmployeeInput[]
  projects: AssignmentProjectInput[]
  tasks: AssignmentTaskInput[]
  locked_records: LockedRecordInput[]
}

export interface CalendarDay {
  date: string
  weekday: number        // 0=일 … 6=토
  week_start: string     // 그 주 월요일
  is_weekend: boolean
  is_holiday: boolean
  holiday_name: string | null
}

export type AssignmentTimeType = '2h' | '3h'

/** 생성된 배정 1건 — overtime_assignment_drafts 1행에 대응 */
export interface GeneratedAssignment {
  employee_id: string
  project_id: string
  task_id: string
  task_name: string
  work_date: string
  hours: 2 | 3
  time_type: AssignmentTimeType
  start_time: string
  end_time: string
  break_hours: number
  is_weekend: boolean
  is_holiday: boolean
  holiday_name: string | null
  exception_reason: string | null   // 주말·공휴일이면 필수, 평일이면 null
  seed: number
  rule_version: string
}

export interface WeeklyTotal {
  week_start: string
  locked_hours: number
  assigned_hours: number
  total_hours: number
}

export interface EmployeeSummary {
  employee_id: string
  target_hours: number | null
  locked_hours: number        // 급여기간 안 잠금 시간
  assigned_hours: number      // 신규 배정
  unassigned_hours: number    // 목표 - 잠금 - 신규 (음수면 0)
  weekly: WeeklyTotal[]
  /** 배정 가능했던 주들의 주별 신규 배정시간 표준편차 (distribution.ts weeklyLoadSpread) — 작을수록 고르게 분산 */
  weekly_stdev: number
  /** unused_task_ids: 일수가 업무 수보다 적어 쓰지 않은 허용 업무 (오류 아님) */
  by_project: Array<{ project_id: string; hours: number; days: number; unused_task_ids: string[] }>
  weekend_holiday_count: number
}

export interface ProjectSummary {
  project_id: string
  employee_ids: string[]
  total_hours: number
  first_date: string | null
  last_date: string | null
  block_count: number
  unassigned_employees: Array<{ employee_id: string; code: AssignmentIssueCode; message: string }>
}

export type AssignmentIssueCode =
  | 'INVALID_INPUT'
  | 'OVERTIME_HOLIDAYS_MISSING'
  | 'OVERTIME_MONTHLY_TARGET_MISSING'
  | 'EMPLOYEE_INACTIVE'
  | 'TARGET_BELOW_LOCKED_HOURS'
  | 'UNREPRESENTABLE_REMAINING_HOURS'
  | 'NO_ELIGIBLE_PROJECT'
  | 'UNKNOWN_PROJECT'
  | 'PROJECT_NOT_ASSIGNABLE'
  | 'NO_ALLOWED_TASK'
  | 'NO_VALID_DATE'
  | 'WEEKLY_CAPACITY_EXHAUSTED'
  | 'TARGET_EXHAUSTED'
  | 'PROJECT_UNASSIGNED'
  | 'WEEKEND_OR_HOLIDAY_USED'
  | 'TASKS_PARTIALLY_USED'
  | 'SINGLE_DAY_PROJECT_BLOCK'
  | 'TOO_MANY_PROJECTS'
  | 'VALIDATION_FAILED'

export type IssueSeverity = 'error' | 'warning' | 'info'

/** 기계 판별용 code와 사용자용 message를 분리한다 */
export interface AssignmentIssue {
  code: AssignmentIssueCode
  severity: IssueSeverity
  message: string
  employee_id?: string
  project_id?: string
  date?: string
  detail?: Record<string, unknown>
}

export type ViolationCode =
  | 'HOLIDAYS_MISSING'
  | 'UNKNOWN_EMPLOYEE'
  | 'EMPLOYEE_INACTIVE'
  | 'TARGET_MISSING'
  | 'NOT_A_MEMBER'
  | 'PROJECT_NOT_ASSIGNABLE'
  | 'TASK_NOT_ALLOWED'
  | 'OUTSIDE_PROJECT_PERIOD'
  | 'OUTSIDE_PAY_PERIOD'
  | 'DUPLICATE_DAY'
  | 'LOCKED_DAY_CONFLICT'
  | 'INVALID_HOURS'
  | 'PRESET_MISMATCH'
  | 'WEEKLY_CAP_EXCEEDED'
  | 'MONTHLY_TARGET_EXCEEDED'
  | 'CALENDAR_FLAG_MISMATCH'
  | 'EXCEPTION_REASON_MISSING'
  | 'EXCEPTION_REASON_UNEXPECTED'
  | 'UNNECESSARY_WEEKEND'
  | 'EXCEPTION_REASON_MISMATCH'
  | 'PROJECT_REVISIT'
  | 'PROJECT_BLOCK_SPLIT'
  | 'AVOIDABLE_SINGLE_DAY'

/** validateSchedule 결과 1건 — 어떤 규칙을 누가 어디서 얼마나 어겼는지 */
export interface ScheduleViolation {
  code: ViolationCode
  message: string
  employee_id?: string
  project_id?: string
  date?: string
  actual?: number | string
  limit?: number | string
}

export interface AssignmentResult {
  /** 전체 차단(공휴일 누락·입력 오류) 또는 검증 실패면 false */
  ok: boolean
  run: { period_label: string; seed: number; rule_version: string; as_of: string }
  assignments: GeneratedAssignment[]
  employees: EmployeeSummary[]
  projects: ProjectSummary[]
  issues: AssignmentIssue[]
  /** 엔진이 만든 결과를 validateSchedule로 다시 검사한 결과 — 정상이면 빈 배열 */
  violations: ScheduleViolation[]
}
