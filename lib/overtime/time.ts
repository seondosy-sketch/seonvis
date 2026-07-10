/**
 * "HH:mm" 형태의 시작/종료 시간 문자열을 다룬다.
 *
 * <input type="time">이나 Postgres time 타입은 00:00~23:59로 제한되지만,
 * 연장근무는 자정을 넘기는 경우(예: 21:00~24:00)가 흔하다. 그래서 시간은
 * 일반 텍스트 입력으로 받고, 24시간을 넘는 표기("24:00", "25:30")를 그대로 허용한다.
 * (저장 방식 이유는 docs/overtime.md, docs/database.md 참고)
 */

const TIME_PATTERN = /^(\d{1,2}):([0-5]\d)$/

export function isValidTimeText(value: string): boolean {
  return TIME_PATTERN.test(value.trim())
}

function toMinutes(value: string): number {
  const m = value.trim().match(TIME_PATTERN)
  if (!m) return NaN
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10)
}

/** 시작시간이 이 시각(정오/저녁 정시)이면 그 안에 낀 식사시간 1시간을 자동으로 뺀다. */
const MEAL_BREAK_TRIGGER_HOURS = [12, 18]
const MEAL_BREAK_HOURS = 1

/**
 * 시작~종료 시간으로 연장시간(시간 단위, 소수 둘째자리까지)을 계산한다.
 * 종료시간은 항상 시작시간보다 늦어야 한다 — 자정을 넘기면 "24:00" 이상으로 입력해야 하기 때문에
 * (예: 21:00~24:00) 별도의 "다음날로 넘어감" 처리는 하지 않는다.
 * 형식이 잘못됐거나 종료 ≤ 시작이면 null을 반환한다 — 호출부(폼)에서 에러로 보여준다.
 *
 * 식사시간 규칙: 12시 또는 18시부터 시작한 업무는 그 구간에 점심/저녁 식사시간이 포함된 것으로 보고
 * 1시간을 뺀다 (예: 18:00~21:00 → 3시간이 아니라 2시간). 원래 계산된 시간이 식사시간(1시간)보다
 * 길지 않으면(1시간 이하면, 즉 18:00~19:00처럼 딱 1시간인 경우까지 포함) 식사시간을 빼지 않고
 * 원래 시간을 그대로 쓴다 — 식사시간만큼 일했다고 0시간으로 만들지 않기 위함.
 */
export function calculateHours(startTime: string, endTime: string): number | null {
  const start = toMinutes(startTime)
  const end = toMinutes(endTime)
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null

  const rawHours = (end - start) / 60
  const startHour = Math.floor(start / 60)
  const hasMealBreak = rawHours > MEAL_BREAK_HOURS && MEAL_BREAK_TRIGGER_HOURS.includes(startHour)
  const hours = hasMealBreak ? rawHours - MEAL_BREAK_HOURS : rawHours
  return Math.round(hours * 100) / 100
}
