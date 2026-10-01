/**
 * 연장근무 (실무자) — 도메인 타입.
 * 제안서팀 연장근무(lib/overtime)와 달리 프로젝트/업무내용 없이 "직원 + 날짜 + 종료시간"만 저장한다.
 * 직원은 공용 overtime_employees(기술인 주소록 '미래사업팀'에서 동기화, lib/overtime/teamSync.ts)를 쓴다.
 * 필드명은 DB 컬럼명과 1:1 (supabase/migration_field_overtime.sql).
 */

/** 직원 1명의 하루 연장근무 1건 — (employee_id, work_date) UNIQUE */
export interface FieldOvertimeRecord {
  id: string
  employee_id: string
  work_date: string // YYYY-MM-DD
  end_time: string  // "HH:mm". 자정을 넘기면 "24:00" 이상
  hours: number     // 인정시간 — 저장 시점에 lib/field-overtime/calc.ts로 계산
  note: string
}
