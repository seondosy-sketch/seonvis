/**
 * 기술인 출근부 — 단장 교체/승격 RPC(attendance_replace_director) 관련 순수 로직.
 * 실제 DB 호출은 ParticipantManagerModal.tsx에서 `supabase.rpc(...)`로 하고,
 * 이 파일은 그 결과(에러 코드/메시지)를 화면 문구로 바꾸는 부분만 분리해 테스트한다.
 */

export interface RpcErrorLike {
  code?: string
  message?: string
}

/**
 * RPC가 던지는 예외 메시지(영문, `raise exception` 원문)를 사용자 문구로 바꾼다:
 *   - "old director row not found" / "old director is not currently active"
 *     → 동시에 다른 요청이 먼저 처리했거나(중복/재시도), 화면이 최신 상태가 아님.
 *   - "new director candidate is already the current director"
 *     → 이미 그 사람이 단장으로 지정돼 있음(재지정 차단).
 *   - 그 외(예: partial unique index 위반 23505) → 일반 실패 문구.
 */
export function directorReplaceErrorMessage(error: RpcErrorLike | null | undefined): string {
  if (!error) return ''
  if (error.message?.includes('new director candidate is already the current director')) {
    return '이미 이 프로젝트의 단장으로 지정되어 있습니다.'
  }
  if (
    error.message?.includes('old director is not currently active') ||
    error.message?.includes('old director row not found')
  ) {
    return '기존 단장 정보가 이미 변경되었습니다. 최신 상태를 다시 불러온 뒤 시도하세요.'
  }
  if (error.code === '23505') {
    return '이미 처리되었거나 중복된 참여로 등록되어 있습니다. 최신 상태를 다시 불러온 뒤 시도하세요.'
  }
  return '단장 교체에 실패했습니다.'
}
