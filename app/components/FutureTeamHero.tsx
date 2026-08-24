'use client'

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  autoplayDecisionForThisLoad,
  autoplayDecisionOnServer,
  markPlayed,
  notePlaybackFinished,
  subscribeAutoplayDecision,
} from '@/lib/hero/dailyPlayback'

const VIDEO_SRC = '/brand/future-team-hero.mp4'
const POSTER_SRC = '/brand/future-team-hero-poster.webp'

/** 재생이 시작되지 않은 채 이만큼 지나면 poster로 되돌린다(무한 대기 방지). */
const START_TIMEOUT_MS = 8000

type HeroState = 'idle' | 'playing' | 'ended'

interface Props {
  /** 16:9로 잡은 높이의 상한. 데스크톱 340 / 모바일 200 */
  maxHeight: number
  /**
   * 재생하지 않을 때 접히는 높이(px). 넘기면 idle/ended에서 로고 띠로 접히고,
   * 그 아래 카드(금주 일정)가 그만큼 넓어진다. 생략하면 접지 않는다(모바일).
   */
  collapsedHeight?: number
  /** 배치용 여백·flex만 넘긴다(카드 자체 모양은 여기서 고정). */
  style?: React.CSSProperties
}

/**
 * 미래Hub Home 상단의 브랜드 Hero.
 *
 * poster가 바닥 레이어로 항상 깔려 있고 video는 재생할 때만 그 위에 마운트된다. 그래서
 * 404·autoplay 차단·디코딩 실패 같은 상황이 예외 처리가 아니라 "원래 상태로 남는 것"이
 * 되고, Hero가 깨질 수 있는 경로 자체가 없다. 같은 날 재방문이면 video를 아예 마운트하지
 * 않으므로 mp4를 한 바이트도 받지 않는다.
 *
 * 재생 정책(하루 1회·reduced motion·save data)의 판정은 전부 lib/hero/dailyPlayback.ts에 있다.
 */
export default function FutureTeamHero({ maxHeight, collapsedHeight, style }: Props) {
  // 자동재생 여부는 localStorage·matchMedia 같은 "React 밖의 값"이라 useSyncExternalStore로
  // 읽는다. 서버 스냅샷이 항상 false라서 SSR과 첫 페인트는 언제나 poster이고, 렌더 중에
  // 브라우저 API를 만지지 않으므로 hydration mismatch가 없다.
  const autoplay = useSyncExternalStore(
    subscribeAutoplayDecision,
    autoplayDecisionForThisLoad,
    autoplayDecisionOnServer,
  )
  // 사용자 조작·재생 결과가 자동재생 판정을 덮어쓴다(다시보기 / 종료 / 실패).
  const [override, setOverride] = useState<HeroState | null>(null)
  const state: HeroState = override ?? (autoplay ? 'playing' : 'idle')
  const videoRef = useRef<HTMLVideoElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  // 접힌 높이 ↔ 펼친 높이를 부드럽게 잇는다. aspect-ratio가 만든 높이는 transition이 안 걸리므로
  // 카드 폭을 재서 펼친 높이를 px로 직접 계산한다(측정 전에는 aspect-ratio로 그린다).
  const [expandedHeight, setExpandedHeight] = useState<number | null>(null)
  useEffect(() => {
    const el = cardRef.current
    if (!el || collapsedHeight === undefined) return
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width
      if (w > 0) setExpandedHeight(Math.min(Math.round((w * 9) / 16), maxHeight))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [collapsedHeight, maxHeight])

  const collapsed = collapsedHeight !== undefined && state !== 'playing'
  const sizing = useMemo((): React.CSSProperties => {
    if (collapsedHeight === undefined) return { aspectRatio: '16 / 9', maxHeight }
    if (collapsed) return { height: collapsedHeight }
    return expandedHeight === null
      ? { aspectRatio: '16 / 9', maxHeight }
      : { height: expandedHeight }
  }, [collapsed, collapsedHeight, expandedHeight, maxHeight])

  useEffect(() => {
    if (state !== 'playing') return
    const video = videoRef.current
    if (!video) return

    // muted를 속성이 아니라 프로퍼티로 직접 보장한다 — SSR로 그려진 HTML에서 muted 속성이
    // 누락되면 Chrome이 autoplay를 막는다.
    video.muted = true
    video.play()?.catch(() => setOverride('idle'))

    const timer = setTimeout(() => { if (video.paused) setOverride('idle') }, START_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [state])

  return (
    <div
      ref={cardRef}
      style={{
        position: 'relative',
        // width:'100%'가 아니라 auto다 — 모바일은 좌우 margin 12px을 쓰는데, 100%는 부모
        // 콘텐츠 폭 전체라서 margin이 그대로 넘쳐 가로 스크롤이 생긴다. auto(=stretch)면
        // 데스크톱 컬럼에서도 같은 폭이 나오고 모바일에서는 margin을 제대로 뺀다.
        width: 'auto',
        ...sizing,
        border: '1px solid #e8e8e6',
        borderRadius: 8,
        overflow: 'hidden',
        // maxHeight가 걸려 상자가 16:9보다 납작해지면 contain 때문에 좌우에 여백이 남는다.
        // 그 여백 색을 상태에 따라 다르게 둔다:
        //  - idle/ended: 정지화면(마지막 프레임) 가장자리 색 #a2a088~#aeab91의 중간값 →
        //    여백이 그림에 묻혀 보이지 않는다. 화면에 거의 항상 떠 있는 상태라 여기를 우선한다.
        //  - playing: 영상 중반(약 5.9~7.4초)에 배경이 짙은 초록으로 바뀌어 올리브 여백이
        //    띠처럼 도드라진다. 재생 동안만 어둡게 두면 어떤 장면에서도 레터박스로 읽힌다.
        background: state === 'playing' ? '#22231f' : '#a8a68d',
        transition: 'height 420ms cubic-bezier(0.4, 0, 0.2, 1), background-color 300ms ease',
        ...style,
      }}
    >
      {/* 이미 16:9로 딱 맞게 뽑아둔 정적 asset이라 next/image 최적화가 얻을 게 없다 — 위젯
          화면(app/(dashboard)/widget/page.tsx)과 같은 이유로 img를 그대로 쓴다. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={POSTER_SRC}
        alt="SEON 미래사업팀"
        width={1280}
        height={720}
        style={{
          width: '100%', height: '100%', display: 'block',
          // 접힌 띠에서는 마지막 화면 전체를 억지로 우겨넣지 않고, 위쪽 `SEON 미래사업팀` 글자
          // 부분만 잘라서 보여준다 — 폭이 고정이라 전체를 contain하면 좌우가 텅 빈다.
          objectFit: collapsed ? 'cover' : 'contain',
          objectPosition: collapsed ? 'center 6%' : 'center',
        }}
      />

      {state === 'playing' && (
        <video
          ref={videoRef}
          src={VIDEO_SRC}
          poster={POSTER_SRC}
          muted
          playsInline
          loop={false}
          preload="auto"
          aria-hidden="true"
          tabIndex={-1}
          onPlaying={() => markPlayed()}
          onEnded={() => { notePlaybackFinished(); setOverride('ended') }}
          onError={() => setOverride('idle')}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            objectPosition: 'center',
          }}
        />
      )}

      {state !== 'playing' && (
        <button
          onClick={() => setOverride('playing')}
          aria-label="미래사업팀 소개 영상 다시 재생"
          style={{
            position: 'absolute',
            right: 8,
            ...(collapsed
              ? { top: '50%', transform: 'translateY(-50%)' }
              : { bottom: 8 }),
            fontSize: 11,
            padding: '4px 9px',
            borderRadius: 6,
            border: 'none',
            background: 'rgba(0,0,0,0.42)',
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          ↺ 다시보기
        </button>
      )}
    </div>
  )
}
