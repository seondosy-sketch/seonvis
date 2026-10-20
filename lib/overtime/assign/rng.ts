/**
 * 결정적 난수 — 같은 seed면 항상 같은 수열. Math.random()은 쓰지 않는다.
 *
 * 자동배정은 "실행할 때마다 무조건 달라지는 난수"가 아니라, seed를 실행 기록에 남겨 같은 입력으로
 * 같은 초안을 다시 만들 수 있어야 한다(docs/overtime-planning-db.md — overtime_assignment_runs.seed).
 * 난수는 우선순위·강제조건을 바꾸지 않는 선택(블록 시작 후보, 3시간 날짜 고르기, 업무 블록 순서)에만 쓴다.
 */

export interface Rng {
  /** [0, 1) */
  next(): number
  /** 0 이상 n 미만 정수 (n ≥ 1) */
  int(n: number): number
  /** 복사본을 섞어 돌려준다(원본 불변) */
  shuffle<T>(items: readonly T[]): T[]
}

/** 32비트 FNV-1a — 문자열 키를 seed에 섞기 위한 해시 */
export function hashString(value: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * seed에 키(직원 id, 용도 등)를 섞은 하위 seed. 직원마다 독립된 수열을 쓰면 처리 순서나 다른 직원의
 * 입력이 바뀌어도 그 직원의 결과가 흔들리지 않는다.
 */
export function deriveSeed(seed: number, ...keys: string[]): number {
  let h = (Math.trunc(seed) >>> 0) ^ 0x9e3779b9
  for (const k of keys) h = Math.imul(h ^ hashString(k), 0x85ebca6b) >>> 0
  return h >>> 0
}

/** mulberry32 */
export function createRng(seed: number): Rng {
  let state = seed >>> 0
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int(n: number) {
      if (!(n >= 1)) throw new Error(`rng.int: n must be ≥ 1 (${n})`)
      return Math.floor(next() * n)
    },
    shuffle<T>(items: readonly T[]): T[] {
      const out = [...items]
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        ;[out[i], out[j]] = [out[j], out[i]]
      }
      return out
    },
  }
}
