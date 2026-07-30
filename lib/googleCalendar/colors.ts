/**
 * Google Calendar 이벤트 색상 매칭.
 *
 * 색상 ID를 하드코딩하지 않는다 — 연결 시점에 `colors.get`으로 실제 팔레트를 받아 목표색과
 * 가장 가까운 ID를 골라 DB(color_map)에 저장한다. 공개 자료마다 ID↔이름 대응이 다르게 적혀
 * 있고(어떤 곳은 1=Peacock, 어떤 곳은 1=Lavender) API 응답에는 이름이 없기 때문이다.
 *
 * ── 왜 RGB 거리가 아니라 HSV인가 (실측으로 확인한 사항) ──
 * 2026-07-30 실제 colors.get 응답의 event 팔레트는 전부 밝은 파스텔이다
 * (예: 보라 계열이 #dbadff, 회색이 #e1e1e1). 목표색은 진한 색(#8e24aa, #616161)이라
 * 단순 RGB 유클리드 거리로 고르면 명도 차이가 지배해 엉뚱한 색이 뽑힌다 — 실제로
 * 보라 → 파랑(#5484ed), 회색 → 초록(#51b749)이 선택됐다.
 *
 * 그래서 색상(hue)을 1순위, 채도(saturation)를 2순위로 비교한다. 채도를 넣지 않으면
 * hue가 2도밖에 차이 나지 않는 연한 라벤더가, 채도가 정확히 일치하는 진한 파랑을 이겨버린다
 * (파랑 목표에서 실제로 발생). 무채색 목표(회색)는 hue가 의미 없으므로 채도가 가장 낮은
 * 항목을 고른다.
 */
import { ACTION_TARGET_COLOR, ALL_ACTIONS, type CalendarAction } from './actions'

export interface ColorEntry {
  background: string
  foreground: string
}

/** colors.get 응답의 `event` 팔레트 — { colorId: {background, foreground} } */
export type EventColorPalette = Record<string, ColorEntry>

/** 채도가 이 값보다 낮으면 무채색(회색)으로 본다 */
const GRAY_SATURATION = 0.15
/** 채도 차이를 hue 각도(도)와 견줄 수 있게 만드는 가중치 — 채도 0.1 차이 ≈ hue 3도 차이 */
const SATURATION_WEIGHT = 30

export interface Hsv { h: number; s: number; v: number }

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.trim().replace('#', '')
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16)) as [number, number, number]
}

export function rgbToHsv(hex: string): Hsv {
  const [r, g, b] = hexToRgb(hex).map(v => v / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: max === 0 ? 0 : d / max, v: max }
}

/** 원형인 hue의 최단 각도 차이 (0~180) */
export function hueGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

/**
 * 목표색에 가장 가까운 팔레트 ID. 팔레트가 비어 있으면 null(= 캘린더 기본색).
 */
export function matchColorId(targetHex: string, palette: EventColorPalette): string | null {
  const entries = Object.entries(palette).map(([id, c]) => ({ id, ...rgbToHsv(c.background) }))
  if (entries.length === 0) return null

  const target = rgbToHsv(targetHex)

  if (target.s < GRAY_SATURATION) {
    return entries.reduce((a, b) => (b.s < a.s ? b : a)).id
  }

  const chromatic = entries.filter(e => e.s >= GRAY_SATURATION)
  const pool = chromatic.length > 0 ? chromatic : entries
  const score = (e: { h: number; s: number }) => hueGap(target.h, e.h) + SATURATION_WEIGHT * Math.abs(target.s - e.s)
  return pool.reduce((a, b) => (score(b) < score(a) ? b : a)).id
}

/** 행위별 colorId 매핑 — 목표색이 없는 행위는 키를 넣지 않아 캘린더 기본색을 쓰게 한다. */
export function resolveColorMap(palette: EventColorPalette): Partial<Record<CalendarAction, string>> {
  const map: Partial<Record<CalendarAction, string>> = {}
  for (const action of ALL_ACTIONS) {
    const target = ACTION_TARGET_COLOR[action]
    if (!target) continue
    const id = matchColorId(target, palette)
    if (id) map[action] = id
  }
  return map
}
