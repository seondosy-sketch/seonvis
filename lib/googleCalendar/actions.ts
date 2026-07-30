/**
 * Hub 일정 유형(행위) 정의 — Google Calendar 연동의 기준표.
 *
 * Hub에는 일정 테이블이 없고 프로젝트 행에 날짜 컬럼이 흩어져 있다. 그 컬럼 하나하나를
 * "행위(action)"로 이름 붙여 (projects.id, action)을 안정적인 일정 식별자로 쓴다.
 *
 * 제목은 `[정제된 프로젝트명] 행위명` 형식이고, 행위명은 통합하지 않는다 —
 * PQ제출·SOQ제출을 그냥 '제출'로 합치면 캘린더에서 무슨 제출인지 알 수 없다.
 *
 * `수행계획서 제출`은 Hub에 입력 필드가 없어 v1에서 제외했다. 나중에 컬럼이 생기면
 * 여기에 항목 하나를 추가하고 desired.ts의 추출부에 한 줄을 더하면 된다.
 */

export type CalendarAction = 'announce' | 'pq' | 'soq' | 'submit' | 'interview' | 'bid' | 'notify'

/** 캘린더 제목에 쓰는 행위명 */
export const ACTION_LABEL: Record<CalendarAction, string> = {
  announce: '공고',
  pq: 'PQ제출',
  soq: 'SOQ제출',
  submit: '제출',
  interview: '면접',
  bid: '개찰',
  notify: '평가결과 통보',
}

/** 행위가 어느 컬럼에서 오는지 — 화면 안내·문서용 */
export const ACTION_SOURCE: Record<CalendarAction, string> = {
  announce: 'projects.announce_date',
  pq: 'project_tooltips.pq_date',
  soq: 'project_tooltips.soq_date',
  submit: 'projects.submit_date',
  interview: 'projects.interview_date',
  bid: 'projects.bid_date',
  notify: 'project_tooltips.notify_date',
}

/**
 * 행위별 목표 색(HEX). Google 이벤트 팔레트는 파스텔 톤 11색으로 고정돼 있어 이 값과 정확히
 * 같은 색은 없다 — 연결 시점에 colors.get으로 실제 팔레트를 받아 가장 가까운 ID를 고른다
 * (lib/googleCalendar/colors.ts). null이면 colorId를 지정하지 않아 캘린더 기본색이 된다.
 */
export const ACTION_TARGET_COLOR: Record<CalendarAction, string | null> = {
  announce: '#8e24aa',   // 보라
  pq: '#f6bf26',         // 노랑
  soq: '#f6bf26',        // 노랑
  submit: '#f6bf26',     // 노랑
  interview: '#d50000',  // 빨강
  bid: '#616161',        // 회색
  notify: '#3f51b5',     // 파랑
}

export const ALL_ACTIONS: CalendarAction[] = ['announce', 'pq', 'soq', 'submit', 'interview', 'bid', 'notify']

/** Google 이벤트에 심는 식별자 — 연결 표가 유실돼도 이 값으로 기존 이벤트를 되찾는다. */
export function hubKey(projectId: string, action: CalendarAction): string {
  return `${projectId}:${action}`
}

/** 제목 조립 — 프로젝트명은 이미 정제된 값을 받는다(formatProjectNameForReport 결과). */
export function eventTitle(cleanProjectName: string, action: CalendarAction): string {
  return `[${cleanProjectName}] ${ACTION_LABEL[action]}`
}
