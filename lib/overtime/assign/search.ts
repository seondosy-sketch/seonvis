import { composeForDays } from './hours'
import type { CalendarDay } from './types'

/**
 * 직원 1명의 배정 날짜 탐색 — 날짜를 시간순으로 훑는 동적계획법(DP)으로 "가장 좋은" 날짜·프로젝트 배치를 정확히 찾는다.
 *
 * 구조(강제): 프로젝트마다 기간 안의 날짜만, 잠금일·급여기간 밖 제외, 하루 1건, 주(월~일)마다 ⌊(12 − 잠금)/2⌋일 이하,
 *   주별 시간 용량 Σ min(3 × 일수, 12 − 잠금) ≥ 목표 T, 그리고 **프로젝트는 한 번 끝나면 다시 시작하지 않는다**
 *   (A→B→A 왕복이 구조적으로 불가능). 상태 = (지금까지 쓴 프로젝트 집합, 진행 중 프로젝트, 그 일수(0·1·2+),
 *   이번 주 일수, 총 일수, 주 한도 초과로 잃은 시간, 진행 중 블록 사이에 쓰지 않은 평일이 있었는지).
 *
 * 비교 순서(작을수록 좋음, 사전식):
 *   0 −(1일 이상 받은 프로젝트 수)      1 −(받은 프로젝트의 제출일 우선순위 가중합)
 *     — 기존 규칙 유지: 여력이 있으면 참여 프로젝트마다 최소 1일, 모자라면 제출일 빠른 프로젝트부터
 *   2 주말·공휴일 일수
 *   3 피할 수 있었던 1일 블록 수 — 기간 안에 (잠금·주 한도를 빼고) 평일 2일을 쓸 수 있는 프로젝트가 1일만 받은 수
 *   4 −(2일 이상 받은 프로젝트 수)
 *   5 우선순위 역전(제출일이 늦은 프로젝트 블록이 빠른 프로젝트 블록보다 먼저) 수
 *   6 블록 끊김(진행 중 프로젝트 사이에 쓰지 않은 평일) 수
 *   [일수 D별 2·3시간 조합 선호: 혼합 → 개수 차이 → 일수 적음 — 같은 T 안에서 D끼리 비교할 때 여기 끼운다]
 *   7 −(제출일 우선순위 가중 일수 — 남는 일수는 앞선 프로젝트가)
 *   8 블록 시작이 고른 간격 목표 위치에서 2평일 넘게 벗어난 거리 합   (2차 탐색에서만)
 *   9 주별 일수 제곱합(주간 분산)
 *   10 블록 시작과 목표 위치 거리 합                                (2차 탐색에서만)
 *   11 seed 난수(동률 깨기)
 * 탐색을 줄이는 규칙(결과를 나쁘게 하지 않음이 보장되는 것만):
 *   - 기간·평일 2일 가능 여부가 같은 두 프로젝트는 우선순위가 높은 쪽이 먼저 시작한다(이름만 바꾼 배치는 0~7번이 같거나 나쁘다)
 *   - 바로 앞 블록 q 다음에 우선순위가 더 높은 p를 시작하지 않는다 — p의 기간이 q보다 늦게 시작하거나 늦게 끝나지 않는 경우.
 *     두 블록의 날짜 묶음을 그대로 두고 p가 앞쪽 날짜를 갖게 바꾸면 기간·주말·일수가 같고 5번(역전)만 줄어든다.
 *   - 목표 T·최소 일수에 남은 날짜로 닿을 수 없는 상태, 기간이 끝나 다시 시작할 수 없는 프로젝트 표시는 버린다
 * 1차 탐색으로 구조(순서·일수)를 정하고, 그 순서로 고른 간격 목표 위치를 계산해 같은 비교로 2차 탐색한다 — 2차 결과는
 * 0~7번이 1차와 같으므로 위치만 다듬는다.
 */

export interface SearchProject {
  /** 우선순위 순서(0 = 제출일 가장 빠름) — 배열 위치와 같다 */
  id: string
  start: string
  end: string
  /** 잠금·주 한도를 빼고도 기간 안에서 평일 2일을 쓸 수 있는가 */
  capable: boolean
}

export interface SearchContext {
  days: readonly CalendarDay[]
  locked: ReadonlySet<string>
  /** 그 주에 더 쓸 수 있는 시간(12 − 잠금, 정수 내림) */
  capH: (week: string) => number
  projects: readonly SearchProject[]
  /** [날짜 index][프로젝트 index] → [0,1) — seed 동률 깨기 */
  jitter: readonly (readonly number[])[]
  /** 고른 간격 목표 위치 계산용: 이 직원이 쓸 수 있는 평일 목록(시간순) */
  weekdayList: readonly string[]
}

export interface SearchResult {
  /** 날짜 → 프로젝트 id */
  chosen: Map<string, string>
  days: number
  score: number[]
}

const SCORE_LEN = 12
const isWorkday = (d: CalendarDay) => !d.is_weekend && !d.is_holiday

interface Node { s: number[]; parent: Node | null; t: number; p: number }
interface Entry { mask: number; cur: number; cnt: number; wk: number; days: number; loss: number; skip: number; node: Node }

function popcount(x: number): number {
  let c = 0
  for (let v = x; v; v &= v - 1) c++
  return c
}

function less(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i] - 1e-12) return true
    if (a[i] > b[i] + 1e-12) return false
  }
  return false
}

/** D일로 T시간을 만드는 조합의 선호 벌점 [혼합 아님, |3시간 수 − 2시간 수|, 일수] */
function compositionPenalty(total: number, days: number): number[] {
  const c = composeForDays(total, days)!
  return [c.threes > 0 && c.twos > 0 ? 0 : 1, Math.abs(c.threes - c.twos), days]
}

/** 같은 T 안에서 일수가 다른 후보끼리 비교하는 키: 구조(0~6) → 조합 선호 → 나머지(7~11) */
function finalKey(total: number, r: { days: number; score: number[] }): number[] {
  return [...r.score.slice(0, 7), ...compositionPenalty(total, r.days), ...r.score.slice(7)]
}

/** 2차 탐색 고정 조건: 1차 결과의 프로젝트 순서와 프로젝트별 일수 */
interface FixedStructure { order: number[]; counts: number[] }

function runDp(ctx: SearchContext, total: number, targets: readonly number[] | null, fixed: FixedStructure | null): SearchResult | null {
  const { days, projects } = ctx
  const n = projects.length
  const dMin = Math.ceil(total / 3)
  const dMax = Math.floor(total / 2)
  if (n === 0 || dMin > dMax) return null
  const lossCap = 3 * dMax - total
  const N = days.length
  const onlyDays = fixed ? fixed.counts.reduce((a, b) => a + b, 0) : null
  const cntCap = fixed ? Math.max(...fixed.counts) : 2
  const allFixed = fixed ? fixed.order.reduce((m, q) => m | (1 << q), 0) : 0

  // 가지치기용: t 이후(그 날 포함)로 더 놓을 수 있는 최대 일수·시간(주 일수 한도 반영) — 목표 T·최소 일수에 못 미치는 상태는 버린다
  const usableAt = days.map((d, t) => !ctx.locked.has(d.date) && projects.some((_, q) => d.date >= projects[q].start && d.date <= projects[q].end) && t >= 0)
  const remInWeek = new Array<number>(N + 1).fill(0)
  const futureDays = new Array<number>(N + 1).fill(0)
  const futureCap = new Array<number>(N + 1).fill(0)
  for (let t = N - 1; t >= 0; t--) {
    const sameWeekNext = t + 1 < N && days[t + 1].week_start === days[t].week_start
    remInWeek[t] = (usableAt[t] ? 1 : 0) + (sameWeekNext ? remInWeek[t + 1] : 0)
    if (sameWeekNext) {
      futureDays[t] = futureDays[t + 1]
      futureCap[t] = futureCap[t + 1]
    } else {
      // t가 그 주 마지막 날 → 다음 주 이후 합계 = (t+1에서 시작하는 주의 값) + 그 뒤
      const w = t + 1 < N ? days[t + 1].week_start : null
      const k = w ? Math.min(remInWeek[t + 1], Math.floor(ctx.capH(w) / 2)) : 0
      futureDays[t] = t + 1 < N ? futureDays[t + 1] + k : 0
      futureCap[t] = t + 1 < N ? futureCap[t + 1] + (w ? Math.min(3 * k, ctx.capH(w)) : 0) : 0
    }
  }
  const reachable = (e: Entry, t: number) => {
    const w = days[t].week_start
    const capW = ctx.capH(w)
    const x = Math.max(0, Math.min(remInWeek[t], Math.floor(capW / 2) - e.wk))
    const maxDays = e.days + x + futureDays[t]
    if (maxDays < (onlyDays ?? dMin)) return false
    const closedCap = 3 * (e.days - e.wk) - e.loss
    return closedCap + Math.min(3 * (e.wk + x), capW) + futureCap[t] >= total
  }
  const inWin = projects.map(p => days.map(d => d.date >= p.start && d.date <= p.end))
  const prioWeight = projects.map((_, i) => 2 ** (n - 1 - i))
  // 기간·평일 2일 가능 여부가 같은 프로젝트끼리는 우선순위가 높은 쪽이 먼저 시작한다(이름만 바꾼 배치보다 항상 같거나
  // 좋다 — 같은 날짜를 우선순위 높은 프로젝트에 주면 0~7번 비교가 같거나 나아진다). 대칭인 순서를 미리 지워 탐색을 줄인다.
  const mustPrecede = projects.map((p, q) => projects.reduce((m, o, r) => (r < q && o.start === p.start && o.end === p.end && o.capable === p.capable ? m | (1 << r) : m), 0))
  const dayWeight = projects.map((_, i) => 32 ** (n - 1 - i))
  const widx = new Map(ctx.weekdayList.map((d, i) => [d, i]))
  const posIndex = days.map(d => {
    // 주말·공휴일이면 그 뒤 첫 평일의 위치
    let i = ctx.weekdayList.findIndex(w => w >= d.date)
    if (i < 0) i = ctx.weekdayList.length - 1
    return widx.get(d.date) ?? i
  })

  const keyOf = (mask: number, cur: number, cnt: number, wk: number, dd: number, loss: number, skip: number) =>
    ((((((mask * (n + 1) + (cur + 1)) * (cntCap + 1) + cnt) * 7 + wk) * (dMax + 1) + dd) * (lossCap + 1) + loss) * 2) + skip
  /** 같은 상태면 점수가 더 좋은 쪽만 남긴다. 점수 배열은 넣을 때만 복사한다(비교는 작업 배열로). */
  const put = (m: Map<number, Entry>, mask: number, cur: number, cnt: number, wk: number, dd: number, loss: number, skip: number,
    s: number[], copy: boolean, node: Node) => {
    const k = keyOf(mask, cur, cnt, wk, dd, loss, skip)
    const old = m.get(k)
    if (old && !less(s, old.node.s)) return
    const nd = copy ? { s: s.slice(), parent: node.parent, t: node.t, p: node.p } : node
    m.set(k, { mask, cur, cnt, wk, days: dd, loss, skip, node: nd })
  }
  const finalizeCur = (s: number[], cur: number, cnt: number) => {
    if (cur < 0) return
    if (cnt === 1 && projects[cur].capable) s[3] += 1
    // (2차 탐색에서는 cnt가 실제 일수 — 2 이상이면 2일 이상)
    if (cnt >= 2) s[4] -= 1
  }
  const closeWeek = (e: Entry, week: string): Entry | null => {
    const loss = e.loss + Math.max(0, 3 * e.wk - ctx.capH(week))
    if (loss > lossCap) return null
    if (e.wk === 0) return loss === e.loss ? e : { ...e, loss }
    const s = e.node.s.slice()
    s[9] += e.wk * e.wk
    return { ...e, wk: 0, loss, node: { s, parent: e.node.parent, t: e.node.t, p: e.node.p } }
  }

  let layer = new Map<number, Entry>()
  layer.set(0, { mask: 0, cur: -1, cnt: 0, wk: 0, days: 0, loss: 0, skip: 0, node: { s: new Array(SCORE_LEN).fill(0), parent: null, t: -1, p: -1 } })
  const work = new Array<number>(SCORE_LEN).fill(0)

  for (let t = 0; t < N; t++) {
    const d = days[t]
    if (t > 0 && d.week_start !== days[t - 1].week_start) {
      const closed = new Map<number, Entry>()
      for (const e of layer.values()) {
        const c = closeWeek(e, days[t - 1].week_start)
        if (c) put(closed, c.mask, c.cur, c.cnt, c.wk, c.days, c.loss, c.skip, c.node.s, false, c.node)
      }
      layer = closed
    }
    const locked = ctx.locked.has(d.date)
    const workday = isWorkday(d)
    const dayLimit = Math.floor(ctx.capH(d.week_start) / 2)
    const weekend = workday ? 0 : 1
    const next = new Map<number, Entry>()
    for (const e of layer.values()) {
      if (!reachable(e, t)) continue
      // 이 날짜를 쓰지 않음 — 진행 중 프로젝트 기간 안의 평일(잠금 아님)을 건너뛰면 그 블록이 끊길 수 있다
      const skip = e.cur >= 0 && workday && !locked && inWin[e.cur][t] ? 1 : e.skip
      put(next, e.mask, e.cur, e.cnt, e.wk, e.days, e.loss, skip, e.node.s, false, e.node)
      if (locked || e.wk >= dayLimit || e.days >= dMax) continue
      const base = e.node.s
      // 진행 중 프로젝트에 이어서
      if (e.cur >= 0 && inWin[e.cur][t] && (!fixed || e.cnt < fixed.counts[e.cur])) {
        for (let i = 0; i < SCORE_LEN; i++) work[i] = base[i]
        work[2] += weekend
        work[6] += e.skip
        work[7] -= dayWeight[e.cur]
        work[11] += ctx.jitter[t][e.cur]
        put(next, e.mask, e.cur, Math.min(cntCap, e.cnt + 1), e.wk + 1, e.days + 1, e.loss, 0, work, true, { s: work, parent: e.node, t, p: e.cur })
      }
      // 새 프로젝트 시작(진행 중 프로젝트는 여기서 끝 — 다시 시작하지 않는다)
      for (let q = 0; q < n; q++) {
        if (e.mask & (1 << q) || !inWin[q][t] || (e.mask & mustPrecede[q]) !== mustPrecede[q]) continue
        if (e.cur > q && projects[q].start <= projects[e.cur].start && projects[q].end <= projects[e.cur].end) continue
        if (fixed && (fixed.order[popcount(e.mask)] !== q || (e.cur >= 0 && e.cnt !== fixed.counts[e.cur]))) continue
        for (let i = 0; i < SCORE_LEN; i++) work[i] = base[i]
        finalizeCur(work, e.cur, e.cnt)
        work[2] += weekend
        work[0] -= 1
        work[1] -= prioWeight[q]
        work[7] -= dayWeight[q]
        let inversions = 0
        for (let r = q + 1; r < n; r++) if (e.mask & (1 << r)) inversions++
        work[5] += inversions
        if (targets && Number.isFinite(targets[q])) {
          const dist = Math.abs(posIndex[t] - targets[q])
          work[8] += Math.max(0, dist - 2)
          work[10] += dist
        }
        work[11] += ctx.jitter[t][q]
        put(next, e.mask | (1 << q), q, 1, e.wk + 1, e.days + 1, e.loss, 0, work, true, { s: work, parent: e.node, t, p: q })
      }
    }
    layer = next
    // 다시 시작할 수 없는 프로젝트(기간 끝)의 "사용함" 표시는, 그보다 우선순위가 높은 프로젝트가 더는 시작될 수 없으면
    // 앞으로의 판단(역전 수·대칭 규칙·재시작 금지)에 영향이 없다 → 지워서 같은 상태를 합친다 (1차 탐색만)
    if (!fixed && t + 1 < N) {
      const nextDate = days[t + 1].date
      const ended = projects.reduce((m, p, q) => (nextDate > p.end ? m | (1 << q) : m), 0)
      if (ended) {
        const merged = new Map<number, Entry>()
        for (const e of layer.values()) {
          let mask = e.mask
          for (let r = 0; r < n; r++) {
            if (!(mask & (1 << r)) || !(ended & (1 << r)) || r === e.cur) continue
            const lower = (1 << r) - 1
            if (((mask | ended) & lower) === lower) mask &= ~(1 << r)
          }
          put(merged, mask, e.cur, e.cnt, e.wk, e.days, e.loss, e.skip, e.node.s, false, e.node)
        }
        layer = merged
      }
    }
  }

  let best: SearchResult | null = null
  let bestKey: number[] | null = null
  for (const raw of layer.values()) {
    const e = closeWeek(raw, days[N - 1].week_start)
    if (!e || e.days < dMin || e.loss > 3 * e.days - total) continue
    if (fixed && (e.days !== onlyDays || e.mask !== allFixed || (e.cur >= 0 && e.cnt !== fixed.counts[e.cur]))) continue
    const s = e.node.s.slice()
    finalizeCur(s, e.cur, e.cnt)
    const cand = { days: e.days, score: s }
    const key = finalKey(total, cand)
    if (!bestKey || less(key, bestKey)) {
      const chosen = new Map<string, string>()
      for (let nd: Node | null = e.node; nd; nd = nd.parent) if (nd.p >= 0) chosen.set(days[nd.t].date, projects[nd.p].id)
      best = { chosen, days: e.days, score: s }
      bestKey = key
    }
  }
  return best
}

/**
 * 1차 탐색 결과의 프로젝트 순서·평일 수로 고른 간격 목표 위치(평일 목록 index)를 계산한다.
 * 블록마다 가장 이른 위치(E)·뒤 블록 자리를 남기는 가장 늦은 위치(R) 사이를 (블록 수 + 1)등분 — 블록 1개면 가운데.
 */
function evenTargets(ctx: SearchContext, chosen: ReadonlyMap<string, string>): number[] | null {
  const wl = ctx.weekdayList
  const order: Array<{ q: number; n: number }> = []
  for (const date of [...chosen.keys()].sort()) {
    const q = ctx.projects.findIndex(p => p.id === chosen.get(date))
    const last = order[order.length - 1]
    if (!last || last.q !== q) order.push({ q, n: 0 })
    if (wl.includes(date)) order[order.length - 1].n++
  }
  const blocks = order.filter(b => b.n > 0).map(b => {
    const p = ctx.projects[b.q]
    const a = wl.findIndex(d => d >= p.start)
    let z = -1
    for (let i = wl.length - 1; i >= 0; i--) if (wl[i] <= p.end) { z = i; break }
    return { ...b, a, z }
  })
  const k = blocks.length
  if (k === 0) return null
  const E: number[] = []
  let cursor = -1
  for (const b of blocks) {
    const e = Math.max(b.a, cursor + 1)
    if (b.a < 0 || e + b.n - 1 > b.z) return null
    E.push(e)
    cursor = e + b.n - 1
  }
  const R: number[] = []
  let limit = wl.length
  for (let i = k - 1; i >= 0; i--) {
    const r = Math.min(blocks[i].z, limit - 1) - blocks[i].n + 1
    if (r < E[i]) return null
    R[i] = r
    limit = r
  }
  const targets = new Array<number>(ctx.projects.length).fill(Number.NaN)
  blocks.forEach((b, i) => { targets[b.q] = E[i] + Math.round(((R[i] - E[i]) * (i + 1)) / (k + 1)) })
  return targets
}

/** 목표 T시간을 만들 수 있는 가장 좋은 배치. 불가능하면 null(호출부가 T를 낮춘다). */
export function searchSchedule(ctx: SearchContext, total: number): SearchResult | null {
  const first = runDp(ctx, total, null, null)
  if (!first) return null
  const targets = evenTargets(ctx, first.chosen)
  if (!targets) return first
  const order: number[] = []
  const counts = new Array<number>(ctx.projects.length).fill(0)
  for (const date of [...first.chosen.keys()].sort()) {
    const q = ctx.projects.findIndex(p => p.id === first.chosen.get(date))
    if (order[order.length - 1] !== q) order.push(q)
    counts[q]++
  }
  const second = runDp(ctx, total, targets, { order, counts })
  return second && second.score.slice(0, 8).every((v, i) => Math.abs(v - first.score[i]) < 1e-9) ? second : first
}
