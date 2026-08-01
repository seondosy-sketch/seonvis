/**
 * 숙박관리 — Postgres 에러 코드를 한글 메시지로 매핑 (attendance의 attendanceRecordErrorMessage와 동일 패턴).
 */
export function lodgingRecordErrorMessage(action: 'insert' | 'update' | 'delete', errorCode: string | undefined): string {
  if (action === 'delete') return '숙박 기록 삭제에 실패했습니다.'
  if (errorCode === '23514') return '입력값을 확인해주세요(체크아웃일은 체크인일 이후여야 합니다).'
  return action === 'insert' ? '숙박 등록에 실패했습니다.' : '숙박 정보 수정에 실패했습니다.'
}

export function lodgingHotelErrorMessage(action: 'insert' | 'update' | 'delete', errorCode: string | undefined): string {
  if (action === 'delete') return '숙소 삭제에 실패했습니다.'
  if (errorCode === '23505') return '이미 등록된 숙소 이름입니다.'
  return action === 'insert' ? '숙소 등록에 실패했습니다.' : '숙소 정보 수정에 실패했습니다.'
}
