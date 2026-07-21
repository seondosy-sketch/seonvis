/**
 * 기술인 출퇴근부 — 도메인 타입 정의 (Phase 1)
 *
 * 핵심 불변 원칙 (연장근무 WorkRecord와 동일한 사상):
 *   attendance_records 1행 = "기술인 1명 + 날짜 1개 + 프로젝트 1개".
 *   미출근 날짜는 행을 만들지 않는다 — "레코드 존재 = 출근".
 *
 * 필드명은 이 코드베이스의 다른 타입들과 동일하게 Supabase 컬럼명과 1:1 대응한다
 * (camelCase 변환 레이어 없음). 실제 테이블 정의는 supabase/migration_attendance.sql,
 * 설계 근거는 docs/attendance/03-data-model.md 참고.
 */

export type ParticipantStatus = '진행중' | '종료'

/**
 * 프로젝트 참여기술인 — Project List(projects)와 기술인 주소록(engineer_contacts)의 연결.
 * 직책·분야·단장여부·참여기간처럼 과거 화면에 영향을 주는 값이 바뀌면 기존 행을 종료(status='종료' +
 * participation_end 설정)하고 새 행을 추가한다 — 절대 덮어쓰지 않는다(첨부 엑셀의 단장 교체 실측 관행과 동일).
 */
export interface ProjectParticipant {
  id: string
  project_id: string
  engineer_id: string
  role: string                     // 참여직책 (예: '단장'). 자유 텍스트
  specialty_id: string | null      // 분야 — engineer_specialties 참조
  is_director: boolean             // 단장 여부. 교체 이력이 있으면 같은 프로젝트에 여러 행이 true일 수 있음
  participation_start: string | null // YYYY-MM-DD
  participation_end: string | null   // YYYY-MM-DD. null = 계속 참여 중
  status: ParticipantStatus
  sort_order: number
  created_at: string
  updated_at: string
}

/**
 * 출근기록 — 시스템의 최소 저장 단위. "기술인 1명 + 날짜 1개 + 프로젝트 1개"가 그대로 레코드 1건이 된다.
 * status는 이번 1차 구현에서 'present'만 쓰인다(레코드가 있다는 것 자체가 출근을 의미) — 향후
 * absent/leave/business_trip/excluded 등으로 확장될 수 있어 boolean이 아닌 문자열 상태값으로 설계했다.
 */
export interface AttendanceRecord {
  id: string
  project_id: string
  engineer_id: string
  participant_id: string   // 이 출근이 어느 참여 구간에 속하는지 명시
  work_date: string         // YYYY-MM-DD
  status: 'present'
  created_by: string        // 입력자 이메일
  updated_by: string
  created_at: string
  updated_at: string
  note: string               // 수정사유(마감 후 예외 수정 시 필수)
  // closure_id 컬럼은 두지 않는다(재검토 후 제거 — docs/attendance/03-data-model.md §0 "closure_id 제거" 참고).
  // 이 기록이 잠겨 있는지는 work_date로 회계기간 라벨을 역산해(lib/attendance/closureLifecycle.ts의
  // periodLabelForDate) attendance_month_closures를 조회하면 항상 정확히 판단할 수 있어,
  // 마감취소→재마감을 반복할 때마다 이 컬럼을 새 버전으로 다시 써야 하는 위험을 원천적으로 없앴다.
}

export type MonthClosureEpisodeStatus = 'closed' | 'reopened'

/**
 * 월 마감 — "기간(period_year, period_month)당 1행"이 아니라 "마감 시도(버전)당 1행"인
 * append-only 버전 이력이다(재검토 후 변경 — docs/attendance/03-data-model.md §0 참고).
 * 같은 기간을 마감→마감취소→재마감하면 version이 1, 2, 3...으로 늘어나는 새 행이 생기고,
 * 이전 버전 행은 절대 지우거나 덮어쓰지 않는다 — 그래야 attendance_closure_snapshot_rows가
 * 버전별로 온전히 보존된다. 그 기간의 "현재" 상태는 version이 가장 큰 행의 status로 판단한다
 * (행이 아예 없으면 = 한 번도 마감한 적 없음 = 열려있음). lib/attendance/closureLifecycle.ts 참고.
 *
 * period_year/period_month는 "사람이 읽는 1~12월 라벨"이다.
 * lib/overtime/summary.ts의 payPeriodDays(year, month)는 month가 0-indexed라
 * DB에 그대로 저장하면 헷갈리므로, 변환은 반드시 lib/attendance/period.ts를 거친다.
 */
export interface AttendanceMonthClosure {
  id: string
  period_year: number
  period_month: number // 1-12
  version: number       // 같은 기간의 몇 번째 마감 시도인지(1부터)
  status: MonthClosureEpisodeStatus // 이 버전(마감 시도) 자체가 지금 유효한지(closed) 취소됐는지(reopened)
  closed_by: string   // 이 버전이 생성된(마감된) 시점의 입력자 — 행 생성 시 항상 채워짐
  closed_at: string
  reopened_by: string | null
  reopened_at: string | null
  reopen_reason: string | null
  created_at: string
}

/**
 * 마감 스냅샷 1행 = 마감 시점 그리드의 참여기술인 1명. Project List가 나중에 바뀌어도
 * 이 행의 *_snapshot 값은 절대 변하지 않는다 — 과거 출력물 재현의 핵심 근거.
 */
export interface AttendanceClosureSnapshotRow {
  id: string
  closure_id: string
  project_id: string
  project_name_snapshot: string
  participant_id: string
  engineer_id: string
  name_snapshot: string
  role_snapshot: string
  specialty_snapshot: string
  is_director_snapshot: boolean
  sort_order: number
  attendance_dates: string[] // YYYY-MM-DD 배열
  present_count: number
  note_snapshot: string
}

export type ChangeType =
  | 'director_change'
  | 'participant_change'
  | 'cancelled'
  | 'reannounced'
  | 'amended'
  | 'announce_date_change'
  | 'interview_date_change'
  | 'field_change'
  | 'other'

/**
 * 프로젝트 변경이력 — 재공고/변경공고/공고취소 여부의 공식 원본(사용자 확정).
 * projects 테이블에는 이런 boolean 컬럼을 두지 않는다 — 필요하면 이 이력에서 파생 조회한다.
 */
export interface ProjectChangeHistory {
  id: string
  project_id: string
  change_type: ChangeType
  change_date: string // YYYY-MM-DD, 발생일자
  before_value: string | null
  after_value: string | null
  memo: string
  created_by: string
  created_at: string
}

export type AuditActionType = 'closure_reopen' | 'past_record_edit' | 'out_of_period_check' | 'other'

/** 감사이력 — 마감취소·과거기록수정·기간외 출근입력 전용 범용 로그. */
export interface AttendanceAuditLog {
  id: string
  action_type: AuditActionType
  table_name: string
  record_id: string | null
  actor: string
  reason: string
  before_data: unknown | null
  after_data: unknown | null
  created_at: string
}
