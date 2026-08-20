/**
 * 평가 DB — Postgres 에러 코드를 한글 메시지로 매핑
 * (lodging의 lodgingRecordErrorMessage, attendance의 attendanceRecordErrorMessage와 동일 패턴).
 */
export function evaluationReviewErrorMessage(
  action: 'save' | 'delete',
  errorCode: string | undefined,
): string {
  if (action === 'delete') {
    // 기록을 지우면 질문·참석자는 on delete cascade로 함께 지워지므로 FK 위반은 나지 않는다.
    // 남는 실패 사유는 사실상 권한(RLS)뿐이다.
    if (errorCode === '42501') return '삭제 권한이 없습니다. 관리자에게 문의하세요.'
    return '후기 삭제에 실패했습니다.'
  }
  // P0001 = 저장 RPC가 직접 올린 예외(수정 대상 기록이 없거나 쓰기 권한이 없는 경우).
  if (errorCode === 'P0001') return '수정할 후기를 찾을 수 없거나 쓰기 권한이 없습니다.'
  if (errorCode === '23514') {
    // CHECK 위반 — 빈 질문, 또는 실제 평가일과 legacy 연도가 어긋난 경우.
    return '입력값을 확인해주세요(질문은 공백만으로 저장할 수 없고, 평가일과 연도가 어긋나면 안 됩니다).'
  }
  if (errorCode === '23503') return '선택한 평가유형 또는 프로젝트를 찾을 수 없습니다. 목록을 새로고침한 뒤 다시 시도하세요.'
  if (errorCode === '42501') return '저장 권한이 없습니다. 관리자에게 문의하세요.'
  if (errorCode === '42883' || errorCode === 'PGRST202') {
    // 함수를 못 찾는 경우 — migration 미적용이 원인이라 그대로 안내한다(lodging의 recordsError와 같은 방식).
    return '저장 함수를 찾을 수 없습니다. supabase/migration_evaluation_db.sql이 적용되었는지 확인하세요.'
  }
  return '후기 저장에 실패했습니다.'
}
