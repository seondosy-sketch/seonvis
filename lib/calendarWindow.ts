/**
 * 메인 대시보드 달력(app/components/WeeklyCalendar.tsx)의 "보이는 주 창(window)" 계산.
 *
 * 달력은 달 단위 격자가 아니라 항상 VISIBLE_WEEKS주를 보여주는 창이다. 휠을 굴리면 이 창이
 * 한 주씩 위아래로 흐르고(마지막 주가 올라오고 첫 주가 사라짐), 이번주를 나타내는 음영은
 * 실제 날짜에 붙어 있어 같이 움직이지 않는다 — 과거·미래로 많이 옮기면 화면 밖으로 나간다.
 * "이번주" 버튼은 창을 첫 화면(이번주가 HOME_ROW 행)으로 되돌린다.
 *
 * 날짜는 전부 "달력 날짜"(시:분 없는 로컬 자정 Date)로만 다룬다 — lib/weekSchedule.ts와 같은 규칙.
 */

/** 한 화면에 보여주는 주 수 */
export const VISIBLE_WEEKS = 6
/** 첫 화면에서 이번주가 놓이는 행 (0-based → 3번째 줄 = 정중앙) */
export const HOME_ROW = 2

/** 달력 격자의 한 행은 일요일에 시작한다(일~토) — 주어진 날짜가 속한 행의 일요일. */
export function gridWeekStart(d: Date): Date {
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  s.setDate(s.getDate() - s.getDay())
  return s
}

/**
 * 음영으로 강조할 "이번주"(일~토)의 시작 일요일.
 *
 * 달력의 주는 일~토인데 다른 화면(주간보고·금주 일정, lib/weekSchedule.ts)의 주는 월~일이다.
 * 그래서 주간 범위를 그대로 음영으로 쓰면 "월~토 한 행 + 다음 행의 일요일"로 쪼개져
 * 한 줄로 강조할 수 없다. 대신 기준일이 속한 격자 행(일~토) 하나를 강조한다.
 *
 * 기준일은 today가 weekStart~weekEnd 안에 있으면 today —— 이러면 음영에 항상 오늘이 들어간다.
 * 과거·미래 주를 보여주는 호출자를 위해, 그 밖이면 주의 첫날을 기준일로 쓴다.
 */
export function highlightWeekStart(weekStart: Date, weekEnd: Date, today: Date): Date {
  const td = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  return gridWeekStart(td >= weekStart && td <= weekEnd ? td : weekStart)
}

/**
 * 첫 화면의 창 첫 행. thisWeekStart가 속한 행이 homeRow에 오도록 잡는다.
 */
export function homeWindowTop(thisWeekStart: Date, homeRow: number = HOME_ROW): Date {
  const t = gridWeekStart(thisWeekStart)
  t.setDate(t.getDate() - homeRow * 7)
  return t
}

/** 창을 delta주만큼 옮긴 새 첫 행 (양수=미래, 음수=과거). */
export function shiftWindow(topStart: Date, deltaWeeks: number): Date {
  const next = new Date(topStart)
  next.setDate(next.getDate() + deltaWeeks * 7)
  return next
}

/**
 * 두 행 시작일 사이의 주 수 (to가 미래면 양수). 절대 날짜로 목표 위치를 잡았을 때
 * (예: ‹ › 로 특정 달로 건너뛸 때) 그것을 창 오프셋으로 되돌리는 데 쓴다.
 * 로컬 자정 Date를 y/m/d로 정규화해 빼므로 서머타임 유무와 무관하게 정확한 정수가 나온다.
 */
export function weeksBetween(from: Date, to: Date): number {
  const utc = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
  return Math.round((utc(to) - utc(from)) / (7 * 86400000))
}

/** topStart부터 visibleWeeks주 × 7일의 날짜 격자. */
export function buildWeekRows(topStart: Date, visibleWeeks: number = VISIBLE_WEEKS): Date[][] {
  const out: Date[][] = []
  for (let r = 0; r < visibleWeeks; r++) {
    const row: Date[] = []
    for (let c = 0; c < 7; c++) {
      const d = new Date(topStart)
      d.setDate(d.getDate() + r * 7 + c)
      row.push(d)
    }
    out.push(row)
  }
  return out
}
