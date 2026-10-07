/**
 * 2시간·3시간 조합 — 자동배정은 기존 프리셋(lib/overtime/time.ts TIME_TYPE_PRESETS) 두 가지만 쓴다.
 *
 * 하루 2 또는 3시간이므로 만들 수 있는 합계는 0과 2 이상의 정수뿐이다(1은 불가, 소수 불가).
 * 3시간 우선으로 채우면 4 = 3 + 1처럼 1이 남는 경우가 생기므로, 일수를 정한 뒤 조합을 직접 계산한다:
 *   일수 D, 합계 H → 3시간 a = H − 2D, 2시간 b = 3D − H  (a, b ≥ 0 일 때만 가능)
 *   가능한 D의 범위 = ceil(H/3) ~ floor(H/2)
 * 조합 선호 순서(preferredCompositions): 2·3시간 혼합 → 두 개수 차이 최소 → 일수 적은 쪽.
 *   5 → 2+3, 7 → 2+2+3, 8 → 2+3+3, 9 → 2+2+2+3, 10 → 2+2+3+3, 12 → 2+2+2+3+3, 6 → 3+3(다음 2+2+2)
 * 엔진은 이 순서로 후보를 보되, 날짜가 모자라거나 주말·공휴일을 더 써야 하면 다음 후보로 넘어간다.
 * 주간 한도가 걸리면 distributeWeekHours가 주별 [2n, min(3n, 한도)] 구간을 이어 붙여 정확한 합계를 만든다.
 */

export const ASSIGNABLE_HOURS = [2, 3] as const

/** 2·3시간 조합으로 정확히 만들 수 있는 합계인가 */
export function isRepresentable(hours: number): boolean {
  return Number.isInteger(hours) && (hours === 0 || hours >= 2)
}

/** r 이하에서 만들 수 있는 가장 큰 합계 (1.x → 0, 7.5 → 7, 음수 → 0) */
export function maxRepresentable(remaining: number): number {
  if (!(remaining >= 2)) return 0
  const floor = Math.floor(remaining + 1e-9)
  return floor >= 2 ? floor : 0
}

/** 합계 H를 만드는 모든 (3시간 개수, 2시간 개수) */
export function compositions(hours: number): Array<{ threes: number; twos: number }> {
  if (!isRepresentable(hours)) return []
  const out: Array<{ threes: number; twos: number }> = []
  for (let threes = hours % 2; threes * 3 <= hours; threes += 2) out.push({ threes, twos: (hours - threes * 3) / 2 })
  return out
}

/** 정확히 D일로 합계 H를 만드는 조합 (없으면 null) */
export function composeForDays(hours: number, days: number): { threes: number; twos: number } | null {
  const threes = hours - 2 * days
  const twos = 3 * days - hours
  return threes >= 0 && twos >= 0 && Number.isInteger(threes) ? { threes, twos } : null
}

/**
 * 선호 순서로 정렬한 조합: 혼합(2시간·3시간 둘 다 있음) 먼저 → |3시간 수 − 2시간 수| 작은 순 → 일수 적은 순.
 * 마지막 기준까지 같으면(드묾) 호출부가 seed로 고른다.
 */
export function preferredCompositions(hours: number): Array<{ threes: number; twos: number; days: number }> {
  return compositions(hours)
    .map(c => ({ ...c, days: c.threes + c.twos }))
    .sort((x, y) =>
      Number(!(x.threes > 0 && x.twos > 0)) - Number(!(y.threes > 0 && y.twos > 0)) ||
      Math.abs(x.threes - x.twos) - Math.abs(y.threes - y.twos) ||
      x.days - y.days)
}

/** 가장 선호하는 조합을 2시간부터 나열. 5 → [2,3], 12 → [2,2,2,3,3], 4 → [2,2], 1 → null */
export function splitHours(hours: number): number[] | null {
  if (!isRepresentable(hours)) return null
  if (hours === 0) return []
  const c = preferredCompositions(hours)[0]
  return [...Array(c.twos).fill(2), ...Array(c.threes).fill(3)]
}

export interface WeekSlot {
  key: string
  days: number    // 그 주에 배정한 날짜 수
  cap: number     // 그 주에 더 쓸 수 있는 시간(12 − 잠금, 정수로 내림)
  load?: number   // 이미 있는 시간(잠금) — balanced 배분에서 주별 합계를 고르게 맞출 때 쓴다
}

/**
 * 주별 시간 배분. 주마다 [2n, min(3n, cap)] 안의 정수만 가능하고 그 구간들의 합은 연속이므로,
 * 전체 합계가 [Σ2n, Σmin(3n,cap)] 안이면 항상 정확히 만들 수 있다. 불가능하면 null.
 *   - balanced(기본): 2시간을 깔고, 남는 1시간씩을 (잠금 + 배정) 합계가 가장 작은 주부터 준다 → 주간 분산.
 *     합계가 같으면 3시간 비율이 낮은 주부터 → 주마다 2·3시간이 섞인다
 *   - front: 앞 주부터 채운다
 */
export function distributeWeekHours(weeks: readonly WeekSlot[], total: number, mode: 'balanced' | 'front' = 'balanced'): Map<string, number> | null {
  if (!Number.isInteger(total)) return null
  let low = 0
  let high = 0
  for (const w of weeks) {
    const max = Math.min(3 * w.days, Math.floor(w.cap))
    if (2 * w.days > max) return null
    low += 2 * w.days
    high += max
  }
  if (total < low || total > high) return null
  const out = new Map<string, number>(weeks.map(w => [w.key, 2 * w.days]))
  const maxOf = (w: WeekSlot) => Math.min(3 * w.days, Math.floor(w.cap))
  let extra = total - low
  if (mode === 'front') {
    for (const w of weeks) {
      const add = Math.min(extra, maxOf(w) - 2 * w.days)
      out.set(w.key, 2 * w.days + add)
      extra -= add
    }
    return out
  }
  // 합계가 같은 주끼리는 3시간 비율이 낮은 주를 먼저 — 3시간이 한 주에 몰리지 않고 주마다 2·3시간이 섞이게
  const threeRatio = (w: WeekSlot) => (out.get(w.key)! - 2 * w.days) / w.days
  while (extra > 0) {
    let pick: WeekSlot | null = null
    for (const w of weeks) {
      if (out.get(w.key)! >= maxOf(w)) continue
      if (!pick) { pick = w; continue }
      const load = (w.load ?? 0) + out.get(w.key)!
      const pickLoad = (pick.load ?? 0) + out.get(pick.key)!
      if (load < pickLoad || (load === pickLoad && threeRatio(w) < threeRatio(pick))) pick = w
    }
    out.set(pick!.key, out.get(pick!.key)! + 1)
    extra--
  }
  return out
}
