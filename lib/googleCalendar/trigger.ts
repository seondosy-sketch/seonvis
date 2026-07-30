/**
 * 프로젝트 저장·삭제 직후 Google Calendar 동기화를 부르는 클라이언트 헬퍼.
 *
 * **Hub 저장을 절대 방해하지 않는다** — 결과를 기다리지 않고(await 없이) 보내고, 실패는 조용히
 * 삼킨다. Google 호출이 실패해도 원본은 이미 저장된 상태이며, 실패 건은 서버가 표에 기록해
 * 관리자 화면의 "실패 일정 다시 동기화"로 복구할 수 있다.
 *
 * 연결 전(캘린더 미연결) 상태에서도 서버가 200으로 조용히 넘기므로 화면에 오류가 뜨지 않는다.
 */
export function syncProjectCalendar(projectId: string): void {
  // 저장 흐름을 막지 않기 위해 의도적으로 await하지 않는다.
  void fetch('/api/calendar/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId }),
    keepalive: true, // 화면을 바로 닫아도 요청이 끊기지 않게
  }).catch(() => {})
}
