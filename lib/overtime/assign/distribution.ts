/**
 * 주간 분산 평가 — 직원 1명의 주별 배정시간이 얼마나 고르게 퍼졌는지.
 *
 * 분산은 강제조건이 아니라 최적화조건이다(우선순위: 제출일 → 평일 → 프로젝트 연속성 → 전환 최소 → 주간 분산 → seed).
 * 엔진은 블록 위치를 고를 때 이 기준을 직접 쓰지 않고 "남는 공간을 블록 사이에 고르게" 나누는 방식으로 분산하며,
 * 이 함수는 결과를 평가·비교(테스트, 요약)하는 데 쓴다.
 */

export interface WeeklySpread {
  weeks: number        // 평가한 주 수(배정 가능했던 주)
  activeWeeks: number  // 배정이 1시간 이상 있는 주
  mean: number
  stdev: number        // 모집단 표준편차
  max: number
  min: number
  range: number        // max − min
}

export function weeklyLoadSpread(hoursByWeek: readonly number[]): WeeklySpread {
  const n = hoursByWeek.length
  if (n === 0) return { weeks: 0, activeWeeks: 0, mean: 0, stdev: 0, max: 0, min: 0, range: 0 }
  const mean = hoursByWeek.reduce((s, h) => s + h, 0) / n
  const variance = hoursByWeek.reduce((s, h) => s + (h - mean) ** 2, 0) / n
  const max = Math.max(...hoursByWeek)
  const min = Math.min(...hoursByWeek)
  const round = (x: number) => Math.round(x * 1000) / 1000
  return {
    weeks: n,
    activeWeeks: hoursByWeek.filter(h => h > 0).length,
    mean: round(mean),
    stdev: round(Math.sqrt(variance)),
    max,
    min,
    range: max - min,
  }
}
