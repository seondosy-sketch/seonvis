/**
 * 기술인 출근부 — attendance_reassign_engineer / attendance_confirm_participant_link RPC 관련
 * 순수 로직. directorReplace.ts와 동일한 이유로 분리한다: 실제 DB 호출은 ParticipantManagerModal.tsx
 * 에서 하고, 이 파일은 그 결과(에러 코드/메시지)를 화면 문구로 바꾸는 부분만 테스트한다.
 */

export interface RpcErrorLike {
  code?: string
  message?: string
}

/**
 * attendance_reassign_engineer가 던지는 예외를 화면 문구로 바꾼다.
 *   - "director reassignment must use attendance_replace_director"
 *     → 단장은 이 경로로 바꿀 수 없음(단장교체 기능을 쓰도록 안내).
 *   - "new engineer is already assigned to this participant" → 재지정 차단.
 *   - "new engineer already an active participant in this project" → 이미 다른 슬롯으로 참여 중.
 *   - "participant is not active" / "participant not found" → 화면이 최신 상태가 아님.
 */
export function reassignEngineerErrorMessage(error: RpcErrorLike | null | undefined): string {
  if (!error) return ''
  const msg = error.message ?? ''
  if (msg.includes('director reassignment must use attendance_replace_director')) {
    return '단장은 이 방법으로 바꿀 수 없습니다. 단장교체 기능을 사용하세요.'
  }
  if (msg.includes('new engineer is already assigned to this participant')) {
    return '이미 이 참여자로 지정된 기술인입니다.'
  }
  if (msg.includes('new engineer already an active participant in this project')) {
    return '선택한 기술인이 이미 이 프로젝트에 다른 역할로 참여 중입니다.'
  }
  if (msg.includes('participant is not active') || msg.includes('participant not found')) {
    return '참여자 정보가 이미 변경되었습니다. 최신 상태를 다시 불러온 뒤 시도하세요.'
  }
  if (error.code === '23505') {
    return '이미 처리되었거나 중복된 참여로 등록되어 있습니다. 최신 상태를 다시 불러온 뒤 시도하세요.'
  }
  return '기술인 재배정에 실패했습니다.'
}

/**
 * attendance_confirm_participant_link가 던지는 예외를 화면 문구로 바꾼다.
 *   - "slot already linked; use attendance_reassign_engineer instead" → 이미 확정된 슬롯(재확인 필요).
 */
export function confirmParticipantLinkErrorMessage(error: RpcErrorLike | null | undefined): string {
  if (!error) return ''
  const msg = error.message ?? ''
  if (msg.includes('slot already linked')) {
    return '이미 연결이 확정된 슬롯입니다. 화면을 새로고침한 뒤 다시 시도하세요.'
  }
  if (error.code === '23505') {
    return '이미 처리되었거나 중복된 참여로 등록되어 있습니다. 최신 상태를 다시 불러온 뒤 시도하세요.'
  }
  return '연결 확정에 실패했습니다.'
}
