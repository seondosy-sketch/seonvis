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

export type ProjectStatus = '진행중' | '종료'

export interface Project {
  id: string
  name: string
  status: ProjectStatus // 종료된 프로젝트는 신규 업무 등록 시 선택 목록에서 제외
  sort_order: number
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
  hours: number              // 저장 시점에 (end_time - start_time)으로 자동 계산해 저장
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
