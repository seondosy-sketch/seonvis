/**
 * 홈 Hero(미래사업팀 브랜드 영상)의 "하루 1회 자동재생" 판정.
 *
 * 판정 규칙을 순수 함수로 떼어 둔 이유는 두 가지다.
 *  1) vitest가 node 환경이라 브라우저 API 없이 규칙만 테스트할 수 있다.
 *  2) app/components/FutureTeamHero.tsx가 렌더 중에는 아무것도 읽지 않고 useEffect에서만
 *     이 모듈을 부르면 되므로 SSR/CSR hydration이 어긋나지 않는다.
 *
 * "오늘"은 새로 만들지 않고 lib/kstDate.ts의 KST 규약을 그대로 쓴다 — 홈화면 위젯·Google
 * Calendar와 기준일이 어긋나면 자정 근처에서 화면마다 재생 여부가 달라진다.
 */
import { kstTodayKey } from '@/lib/kstDate'

export const HERO_STORAGE_KEY = 'futurehub:hero:last-played'

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

export interface AutoplayInput {
  /** localStorage에 저장된 마지막 재생일(`YYYY-MM-DD`). 저장된 적 없으면 null */
  lastPlayed: string | null
  /** KST 오늘 (`YYYY-MM-DD`) */
  todayKey: string
  reducedMotion: boolean
  saveData: boolean
}

/**
 * 자동재생 여부. 저장값이 손상됐으면 "아직 안 본 것"으로 본다 — 브랜드 영상을 한 번 더
 * 보여주는 쪽이, 영영 안 보여주는 쪽보다 낫다.
 */
export function shouldAutoplay({ lastPlayed, todayKey, reducedMotion, saveData }: AutoplayInput): boolean {
  if (reducedMotion || saveData) return false
  if (lastPlayed === null || !DATE_KEY.test(lastPlayed)) return true
  return lastPlayed !== todayKey
}

/** localStorage는 사파리 프라이빗 모드 등에서 접근 자체가 throw할 수 있다. */
export function readLastPlayed(): string | null {
  try {
    return window.localStorage.getItem(HERO_STORAGE_KEY)
  } catch {
    return null
  }
}

export function markPlayed(todayKey: string = kstTodayKey()): void {
  try {
    window.localStorage.setItem(HERO_STORAGE_KEY, todayKey)
  } catch {
    // 저장이 막힌 브라우저에서는 매 접속마다 한 번씩 재생된다 — 기능이 깨지진 않는다.
  }
}

export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Navigator.connection은 표준이 아니라 lib.dom에 없다. 전역 타입을 건드리지 않고 여기서만 좁게 본다. */
export function prefersSaveData(): boolean {
  const nav = navigator as Navigator & { connection?: { saveData?: boolean } }
  return nav.connection?.saveData === true
}

/**
 * 이 page load 동안 고정되는 자동재생 결정 — useSyncExternalStore용 작은 스토어.
 *
 * 모듈 스코프에 담아두는 이유: useIsMobile()이 첫 렌더에서 무조건 false라 모바일에서는
 * 데스크톱 분기로 한 번 마운트됐다가 모바일 분기로 재마운트된다. 마운트할 때마다
 * localStorage를 다시 읽으면 첫 마운트가 남긴 기록 때문에 두 번째 마운트가 "오늘 이미 봤음"
 * 으로 판정해 재생이 끊긴다. 재마운트는 같은 답을 재사용해야 한다.
 *
 * 값이 바뀌는 건 page load당 최대 한 번 — 재생이 끝났을 때 false로 내려간다. 그래야 이후의
 * 마운트가 같은 load에서 두 번째 자동재생을 시작하지 않는다.
 */
let decision: boolean | null = null
const listeners = new Set<() => void>()

export function subscribeAutoplayDecision(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => { listeners.delete(onChange) }
}

export function autoplayDecisionForThisLoad(): boolean {
  if (decision === null) {
    decision = shouldAutoplay({
      lastPlayed: readLastPlayed(),
      todayKey: kstTodayKey(),
      reducedMotion: prefersReducedMotion(),
      saveData: prefersSaveData(),
    })
  }
  return decision
}

/** SSR 스냅샷 — 서버는 언제나 poster를 그린다(first paint = poster 보장). */
export function autoplayDecisionOnServer(): boolean {
  return false
}

export function notePlaybackFinished(): void {
  if (decision === false) return
  decision = false
  listeners.forEach(notify => notify())
}

/** 테스트 전용 — 모듈 스코프에 남은 판정을 지운다. */
export function resetPlaybackDecisionForTests(): void {
  decision = null
  listeners.clear()
}
