/**
 * DB 오류를 사용자에게 보여줄 문구로 바꾼다. 원문(SQL 메시지)은 화면에 그대로 내보내지 않는다.
 * 코드 접두어는 supabase/migration_overtime_planning_b_activate.sql의 raise exception과 맞춘다.
 * 순서가 중요하다 — 앞부분이 같은 코드(OVERTIME_MONTHLY_TARGET vs …_MISSING/_EXCEEDED)는 긴 쪽을 먼저 본다.
 * 월 목표 트리거(migration_overtime_monthly_target_guard.sql)의 메시지는 우리가 정한 형식이라 급여기간·숫자만 뽑아 보여준다
 * (직원 id 등 다른 원문은 내보내지 않는다).
 */
const RULES: Array<[string, string]> = [
  ['OVERTIME_WEEKLY_CAP', '주(월~일) 연장근무 합계가 12시간을 넘어 저장할 수 없습니다.'],
  ['OVERTIME_MONTHLY_TARGET_MISSING', '월 목표시간이 입력되지 않은 직원이 있어 저장하거나 확정할 수 없습니다. 자동배정 › 설정에서 목표시간을 넣으세요.'],
  ['OVERTIME_MONTHLY_TARGET_EXCEEDED', '급여기간 월 목표시간을 넘어 저장하거나 확정할 수 없습니다.'],
  ['OVERTIME_MONTHLY_TARGET', '월 목표시간을 넘어 저장하거나 확정할 수 없습니다. 초안에서 시간을 줄이거나 칸을 빼세요.'],
  ['OVERTIME_HOLIDAYS_MISSING', '이 급여기간의 공휴일 데이터가 없어 자동배정을 할 수 없습니다. 휴가관리에서 공휴일을 먼저 등록하세요.'],
  // 미리보기 뒤에 공휴일이 바뀌면 저장 함수가 초안의 is_holiday와 DB 공휴일을 비교해 거부한다
  ['OVERTIME_HOLIDAY_CHANGED', '공휴일 정보가 바뀌었습니다. 새로고침 후 다시 미리보기하세요.'],
  // 직원 동기화(sync_team_employees) — 주소록과 연결되지 않은 직원이 있어 명단을 맞출 수 없음
  ['OVERTIME_EMPLOYEE_LINK_REQUIRED', '주소록과 연결되지 않은 직원이 있어 직원 명단을 맞출 수 없습니다. 관리자가 먼저 직원을 기술인 주소록과 연결해야 합니다.'],
  ['OVERTIME_AUTO_RECORD_LOCKED', '자동배정으로 확정된 기록은 직접 고치거나 지울 수 없습니다. 관리자에게 확정 취소를 요청하세요.'],
  ['OVERTIME_DRAFT_INVALID', '초안 중 조건에 맞지 않는 항목이 있어 저장하지 않았습니다. 다시 배정해 주세요.'],
  ['OVERTIME_CONFIRM_INVALID', '확정 전에 조건이 바뀐 초안이 있습니다(프로젝트 기간·참여·재직 등). 다시 배정해 주세요.'],
  ['OVERTIME_RUN_NOT_CONFIRMABLE', '이미 확정됐거나 폐기·대체된 배정이라 확정할 수 없습니다.'],
  ['OVERTIME_RUN_NOT_DISCARDABLE', '이미 확정됐거나 폐기·대체된 배정이라 폐기할 수 없습니다.'],
  ['OVERTIME_CONFIRMED_RECORD_CHANGED', '확정 후 기록이 바뀌어 확정을 취소할 수 없습니다.'],
  ['OVERTIME_DRAFT_NOT_EDITABLE', '확정됐거나 폐기된 초안은 수정할 수 없습니다.'],
  ['OVERTIME_DRAFT_TASK_NOT_ALLOWED', '그 직원에게 지정되지 않은 업무입니다.'],
  ['OVERTIME_INVALID_PERIOD', '급여기간 형식이 올바르지 않습니다.'],
  ['admin only', '관리자만 할 수 있는 작업입니다.'],
  ['permission denied', '권한이 없습니다.'],
  ['row-level security', '권한이 없습니다.'],
  ['duplicate key', '같은 날짜에 이미 배정이 있습니다.'],
]

const MISSING_DETAIL = /OVERTIME_MONTHLY_TARGET_MISSING: (\d{4}-\d{2}) 급여기간 목표 없음 \(현재 ([\d.]+)시간 → ([\d.]+)시간\)/
const EXCEEDED_DETAIL = /OVERTIME_MONTHLY_TARGET_EXCEEDED: (\d{4}-\d{2}) 급여기간 목표 ([\d.]+)시간 \/ 현재 ([\d.]+)시간 → ([\d.]+)시간 \(([\d.]+)시간 초과\)/
const num = (s: string) => String(Number(s))

export function friendlyOvertimeError(raw: string | null | undefined): string {
  const text = raw ?? ''
  const missing = text.match(MISSING_DETAIL)
  if (missing) {
    return `${missing[1]} 급여기간의 월 목표시간이 없어 저장하거나 확정할 수 없습니다 — 현재 합계 ${num(missing[2])}시간, 입력 후 ${num(missing[3])}시간. 자동배정 › 설정에서 월 목표시간을 먼저 입력하세요.`
  }
  const exceeded = text.match(EXCEEDED_DETAIL)
  if (exceeded) {
    return `${exceeded[1]} 급여기간 월 목표 ${num(exceeded[2])}시간을 넘어 저장하거나 확정할 수 없습니다 — 현재 합계 ${num(exceeded[3])}시간, 입력 후 ${num(exceeded[4])}시간 (${num(exceeded[5])}시간 초과)`
  }
  for (const [code, message] of RULES) if (text.includes(code)) return message
  return '저장 중 문제가 생겼습니다. 다시 시도하고, 계속되면 관리자에게 알려주세요.'
}
