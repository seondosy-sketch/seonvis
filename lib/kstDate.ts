/**
 * KST 달력 날짜 공용 함수.
 *
 * 서버(Vercel)는 UTC로 돌기 때문에 `new Date()`를 그냥 쓰면 KST 자정 직후에 어제가 나온다.
 * 홈화면 위젯과 Google Calendar 연동이 같은 "오늘"을 봐야 하므로 계산을 여기 한 곳에 둔다
 * (lib/widget/summary.ts가 이 값을 재수출하고, lib/googleCalendar도 같은 함수를 쓴다).
 *
 * 날짜는 lib/weekSchedule.ts와 같은 규약 — 시:분이 없는 로컬 자정의 "달력 날짜" Date다.
 */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000

/** 기준 시각(기본 now)의 KST 달력 날짜 — 시:분 없는 로컬 자정 Date. */
export function kstToday(now: Date = new Date()): Date {
  const shifted = new Date(now.getTime() + KST_OFFSET_MS)
  return new Date(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate())
}

export function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** KST 기준 오늘의 `YYYY-MM-DD` */
export function kstTodayKey(now: Date = new Date()): string {
  return toDateKey(kstToday(now))
}

/** KST 시:분 (`14:05`) */
export function kstTimeLabel(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + KST_OFFSET_MS)
  const hh = String(shifted.getUTCHours()).padStart(2, '0')
  const mm = String(shifted.getUTCMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}
