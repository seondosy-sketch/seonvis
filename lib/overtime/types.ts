/**
 * 제안서팀 연장근무 관리 — 도메인 타입 정의
 *
 * 핵심 불변 원칙 (절대 변경하지 않음):
 *   직원 1명 + 날짜 1개 + 프로젝트 1개 + 업무 1개 = WorkRecord 1건
 *
 * 화면(월간 그리드 셀)에는 "6h (3)"처럼 합산된 값만 보이지만,
 * 실제 저장 단위는 항상 이 최소 단위(WorkRecord)이다.
 * 총 시간·건수는 별도 컬럼에 저장하지 않고, 항상 그 날짜에 속한
 * WorkRecord 목록으로부터 계산한다 (DailySummary는 파생 데이터).
 *
 * 필드명은 (이 코드베이스의 다른 타입들과 동일하게) Supabase 컬럼명과
 * 1:1로 그대로 대응한다 — camelCase 변환 레이어를 두지 않는다.
 * 실제 테이블 정의는 supabase/migration_overtime.sql, docs/database.md 참고.
 */

export interface Employee {
  id: string
  name: string
  position: string    // 직급
  is_active: boolean  // 재직여부 — 퇴사자는 목록에서 숨기되 과거 레코드는 보존
  sort_order: number   // 좌측 직원 목록 정렬순서
}

/**
 * 직원별 기본업무내용 — 직원 관리 화면에서 미리 등록해두는 "자주 쓰는 업무" 목록.
 * WorkRecord.task_description은 여전히 자유 텍스트이지만, 이 목록이 향후 근무입력 화면에서
 * 드롭박스 선택지로 쓰일 기초자료가 된다 (드롭박스 연동 자체는 별도 단계).
 */
export interface EmployeeTask {
  id: string
  employee_id: string
  task_name: string
  sort_order: number
}

export type ProjectStatus = '진행중' | '종료'

export interface Project {
  id: string
  name: string
  status: ProjectStatus // 종료된 프로젝트는 신규 업무 등록 시 선택 목록에서 제외
  sort_order: number
  start_date: string | null // YYYY-MM-DD. 아직 기간을 정하지 않은 프로젝트는 null
  end_date: string | null   // YYYY-MM-DD
  // 입찰 현황 "프로젝트 List"(projects 테이블)와의 연계. null이면 수동 등록 프로젝트.
  // 연계된 프로젝트는 이름·기간(공고일~발표일)·상태가 lib/overtime/sync.ts에서
  // 단방향(projects → overtime_projects)으로 덮어써지므로 이 화면에서 직접 수정하지 않는다.
  source_project_id: string | null
}

/**
 * 프로젝트별 담당직원 배정 — 프로젝트 관리 화면에서 체크로 지정한다.
 * 실제 근무 이력(WorkRecord)과 별개의 "배정" 정보로, 향후 프로젝트별 인원을
 * 나열해 근무일을 표기하는 화면의 기초자료가 된다.
 */
export interface ProjectMember {
  id: string
  project_id: string
  employee_id: string
}

/**
 * 업무 1건 — 시스템의 최소 저장 단위.
 * "직원 1명 + 날짜 1개 + 프로젝트 1개 + 업무 1개" 조합이 그대로 레코드 1건이 된다.
 * 하루에 여러 프로젝트를 수행했다면, 프로젝트 수만큼 WorkRecord가 생긴다.
 */
export interface WorkRecord {
  id: string
  employee_id: string
  project_id: string
  work_date: string        // YYYY-MM-DD
  task_description: string // 업무내용
  start_time: string        // "HH:mm"
  end_time: string           // "HH:mm". 자정을 넘기면 "24:00" 이상으로 표기 (예: 21:00~24:00)
  hours: number              // 인정시간. 저장 시점에 계산해 저장 (아래 break_hours 참고)
  break_hours: number | null // 휴게시간. 팝오버 입력은 명시값(인정 = 종료-시작-휴게, 1시간 절삭),
                             // null은 기존 방식 레코드(식사시간 1시간 자동 차감, time.ts calculateHours)
  note: string                // 비고
  created_at: string          // 대시보드 "최근 입력 내역" 정렬 기준 (7단계)
}

/**
 * 특정 직원의 특정 날짜에 대한 집계.
 * DB에 별도 저장하지 않고, 항상 해당 날짜의 WorkRecord[]로부터 계산한다.
 * 월간 그리드 셀 표시("6h", 건수 "(3)")와 셀 클릭 모달에 그대로 사용된다.
 */
export interface DailySummary {
  employee_id: string
  work_date: string
  total_hours: number  // records의 hours 합계 → 그리드 셀 "6h"
  record_count: number // records.length → 2건 이상일 때 "(3)" 배지
  records: WorkRecord[]
}
