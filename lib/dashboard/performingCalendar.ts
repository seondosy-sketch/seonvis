/**
 * 메인 대시보드 달력에 그릴 프로젝트 일정 행을 만드는 순수 로직.
 *
 * 달력은 6주를 한 화면에 보여주고 휠로 과거·미래까지 흐른다(lib/calendarWindow.ts). 그런데
 * 일정의 출처인 performing_projects는 "주차별 스냅샷"이라, 이번주 것만 읽으면 지난주 칸에
 * 있어야 할 일정이 통째로 비어 보인다 — 지난주 주간보고에는 있었지만 이번주 목록에서 빠진
 * 프로젝트, 그리고 Project List에 없는 수동 추가 행이 그렇다(사용자 지적).
 *
 * 그래서 달력은 보이는 범위를 덮는 주차를 전부 읽는다. 홈화면 위젯이 같은 문제를 먼저 풀어
 * `lib/widget/calendar.ts`의 weekKeysInRange + `lib/widget/summary.ts`의 loadPerformingByWeek로
 * 처리해뒀고(그 파일 주석도 "웹 대시보드도 같은 규칙"이라고 못 박아 뒀다), 이 파일은 웹 쪽에서
 * 같은 일을 하는 조각이다 — 여러 주차를 합칠 때 같은 프로젝트가 주차 수만큼 중복되지 않도록
 * 이름으로 접는 것이 핵심이다.
 *
 * 날짜 자체는 주차 스냅샷이 아니라 Project List(projects)를 우선한다 — 주간보고 화면
 * (app/dashboard.tsx)과 같은 규칙이다. 스냅샷 날짜는 Project List에 없는 수동 추가 행에만 쓴다.
 */
import type { PerformingProject } from '@/lib/supabase'

/** Project List에서 날짜만 가져올 때 쓰는 최소 모양. */
export interface ProjectDateSource {
  submit_date?: string | null
  interview_date?: string | null
  bid_date?: string | null
}

/**
 * 빈 날짜는 '추후'로 두되, 값이 있으면 연도가 살아 있는 ISO 문자열을 그대로 넘긴다.
 * 예전에 "M/D"로 줄여 넘겼다가 받는 쪽이 현재 주의 연도를 다시 붙여, 2025년 일정이 2026년
 * 같은 월·일에 찍힌 적이 있다(app/(dashboard)/page.tsx 주석 참고).
 */
export function keepYear(raw: string | null | undefined): string {
  return raw?.trim() ? raw : '추후'
}

/**
 * 스냅샷 행의 날짜를 Project List 값으로 덮어쓴다. Project List에 없는 이름(수동 추가 행)은
 * 저장된 값을 그대로 둔다 — 애초에 연도 정보가 없는 "M/D"라 달리 채울 것이 없다.
 */
export function applyProjectDates(
  rows: readonly PerformingProject[],
  projByName: ReadonlyMap<string, ProjectDateSource>,
): PerformingProject[] {
  return rows.map(p => {
    const src = projByName.get(p.name)
    return {
      ...p,
      submit_date: keepYear(src?.submit_date ?? p.submit_date),
      interview_date: keepYear(src?.interview_date ?? p.interview_date),
      result_date: keepYear(src?.bid_date ?? p.result_date),
    }
  })
}

/**
 * 여러 주차의 스냅샷 행을 프로젝트 이름 하나당 한 행으로 접는다.
 *
 * 달력은 절대 날짜에 일정을 찍으므로, 같은 프로젝트가 6개 주차에 걸쳐 들어 있으면 같은 칸에
 * 똑같은 표시가 6번 쌓인다. 이름이 같으면 같은 사업으로 보고 가장 최근 주차의 행을 남긴다 —
 * 수동 추가 행의 날짜·비고가 주차마다 다를 수 있는데, 그럴 땐 최신 것이 맞다.
 *
 * week 문자열('2026-W35')은 연도가 앞이고 주차가 0으로 채워져 있어 사전순 비교가 곧 시간순이다.
 * 처음 나온 순서를 유지해 스크롤할 때 달력 안에서 항목 순서가 흔들리지 않게 한다.
 */
export function dedupePerformingByName(rows: readonly PerformingProject[]): PerformingProject[] {
  const byName = new Map<string, PerformingProject>()
  for (const row of rows) {
    if (!row.name) continue
    const seen = byName.get(row.name)
    if (!seen || row.week > seen.week) byName.set(row.name, row)
  }
  return [...byName.values()]
}
