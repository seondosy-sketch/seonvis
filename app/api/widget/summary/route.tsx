/**
 * 홈화면 위젯 이미지 (PNG) — 아이폰/안드로이드 공용.
 *
 * 왜 이미지인가: iOS·Android 홈화면 위젯은 네이티브 코드만 그릴 수 있어서 웹앱을 그대로
 * 위젯으로 만들 수 없다. 대신 두 OS 모두 "URL의 이미지를 주기적으로 가져와 위젯에 띄우는"
 * 앱(iOS Scriptable, Android 이미지 위젯 앱)이 있으므로, 서버가 위젯 모양 PNG를 그려주면
 * 구현 하나로 양쪽을 커버할 수 있다. 설치 방법은 docs/widget/README.md.
 *
 * 인증: 쿠키가 없으므로 ?token= 로만 신원을 확인한다(lib/widget/token.ts). 토큰이 무효하면
 * 빈 응답 대신 "재발급 안내" 이미지를 200으로 돌려준다 — 위젯 앱들은 4xx를 받으면 아무것도
 * 안 그려서 사용자가 원인을 알 수 없기 때문이다.
 *
 * ── 캐시 정책: 어디에도 저장하지 않는다 ──
 * 이 이미지에는 프로젝트 제출일·발표일·개찰일과 팀 일정이 담긴다. 토큰별로 URL이 갈린다고 해도
 * 사내 일정 그림을 외부 CDN의 공개(public) 캐시에 남기지 않는 것이 원칙이라, 모든 응답을
 * `private, no-store`로 내려 CDN·단말 어디에도 저장되지 않게 한다.
 *
 * 그래서 ETag/304(조건부 요청)도 두지 않는다 — `no-store`면 클라이언트가 응답을 보관할 수 없어
 * If-None-Match를 보낼 수가 없고, 남겨두면 절대 동작하지 않는 코드가 된다. 결과적으로 모든
 * 요청이 "DB 조회 → PNG 렌더"를 거치므로 이미지에 찍히는 시각이 항상 실제 생성 시각이 된다.
 *
 * 서버 내부 캐시(요약 데이터나 PNG를 짧게 메모이즈)도 두지 않았다. 팀 9명 × 자동 갱신 2시간
 * 기준 요청량이 월 수천 회 수준이라 렌더 비용이 문제되지 않고, 내부 캐시를 두면 토큰 해지·권한
 * 회수 시점에 낡은 이미지가 남을 위험(무효화 누락)이 생기기 때문이다. 훗날 정말 필요해지면
 * "권한 확인을 먼저 하고 → 토큰 원문이 아닌 해시를 키로 → 짧은 TTL" 순서를 지켜야 한다
 * (docs/widget/README.md에 기록).
 *
 * 이미지 좌하단의 "업데이트 HH:MM"(KST)은 **이 PNG를 만든 시각 = 그 요청에서 DB를 조회한 시각**
 * 이다(휴대폰이 받은 시각이나 화면에 그려진 시각이 아니다). iOS 홈화면 썸네일이 예전 그림이면
 * 그 그림에 찍힌 예전 시각이 그대로 보이므로, 오히려 얼마나 묵은 화면인지 판단할 수 있다.
 *
 * 파라미터: size=small|medium|large (기본 medium), theme=light|dark (기본 light).
 * 그 외 파라미터(예: 클라이언트가 OS 캐시를 우회하려고 붙이는 `t=<타임스탬프>`)는 무시한다.
 */
import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveWidgetToken } from '@/lib/widget/token'
import { loadWidgetSummary, type WidgetDay, type WidgetItem, type WidgetSummary } from '@/lib/widget/summary'

export const dynamic = 'force-dynamic'

/** 공개 CDN·단말 캐시 모두 금지. private는 "공유 캐시에 저장 금지"를 한 번 더 명시하는 의미. */
const NO_STORE = 'private, no-store'

type SizeName = 'small' | 'medium' | 'large'

/** 3배 스케일 픽셀 — iOS 위젯 실측 비율(작은 1:1, 중간 2.14:1, 큰 1:1.05)에 맞춘 값. */
const SIZES: Record<SizeName, { width: number; height: number }> = {
  small: { width: 474, height: 474 },
  medium: { width: 1014, height: 474 },
  large: { width: 1014, height: 1062 },
}

interface Layout {
  pad: number
  title: number
  meta: number
  day: number
  item: number
  gap: number
  maxDays: number
  maxItems: number
  nameChars: number
}

const LAYOUTS: Record<SizeName, Layout> = {
  small: { pad: 26, title: 25, meta: 18, day: 21, item: 21, gap: 8, maxDays: 3, maxItems: 2, nameChars: 11 },
  medium: { pad: 32, title: 30, meta: 20, day: 24, item: 23, gap: 9, maxDays: 4, maxItems: 3, nameChars: 26 },
  large: { pad: 36, title: 34, meta: 22, day: 27, item: 25, gap: 12, maxDays: 7, maxItems: 6, nameChars: 30 },
}

interface Theme {
  bg: string
  card: string
  border: string
  title: string
  text: string
  dim: string
  todayBg: string
  kind: Record<WidgetItem['kind'], { label: string; color: string; bg: string }>
}

/** 프로젝트 일정 색·라벨은 웹 주간달력(app/components/WeeklyCalendar.tsx TYPE_META)과 맞춘다. */
const THEMES: Record<'light' | 'dark', Theme> = {
  light: {
    bg: '#ffffff',
    card: '#f8f8f7',
    border: '#e8e8e6',
    title: '#111111',
    text: '#333333',
    dim: '#9a9a97',
    todayBg: '#fef9f0',
    kind: {
      submit: { label: '제출', color: '#1d4ed8', bg: '#eff6ff' },
      interview: { label: '발표', color: '#b45309', bg: '#fffbeb' },
      result: { label: '개찰', color: '#15803d', bg: '#f0fdf4' },
      event: { label: '팀', color: '#6d28d9', bg: '#f5f3ff' },
    },
  },
  dark: {
    bg: '#17171a',
    card: '#202024',
    border: '#32323a',
    title: '#f5f5f4',
    text: '#d8d8d6',
    dim: '#7c7c82',
    todayBg: '#2b2419',
    kind: {
      submit: { label: '제출', color: '#93b8ff', bg: '#1c2740' },
      interview: { label: '발표', color: '#f0c07a', bg: '#3a2c14' },
      result: { label: '개찰', color: '#86e0a3', bg: '#16301f' },
      event: { label: '팀', color: '#c4b0ff', bg: '#2a2140' },
    },
  },
}

function truncate(text: string, max: number): string {
  const trimmed = text.trim()
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed
}

/**
 * 한글 폰트 — satori는 시스템 폰트를 못 쓰므로 직접 넣어야 한다(안 넣으면 한글이 통째로 빈칸).
 * 파일 읽기를 먼저 시도하고, 서버리스 번들에 public/이 없을 때를 대비해 같은 오리진 HTTP로
 * 폴백한다(lib/export/fonts.ts도 같은 파일을 pdfmake용으로 읽는다).
 * 6MB짜리라 모듈 스코프에 캐시해 콜드스타트당 1회만 받는다.
 */
let fontCache: Promise<{ regular: ArrayBuffer; bold: ArrayBuffer }> | null = null

async function loadFont(origin: string): Promise<{ regular: ArrayBuffer; bold: ArrayBuffer }> {
  if (!fontCache) {
    fontCache = (async () => {
      const read = async (file: string): Promise<ArrayBuffer> => {
        try {
          const buf = await readFile(path.join(process.cwd(), 'public', 'fonts', file))
          return new Uint8Array(buf).buffer
        } catch {
          const res = await fetch(`${origin}/fonts/${file}`, { cache: 'force-cache' })
          if (!res.ok) throw new Error(`폰트 로드 실패: ${file} (${res.status})`)
          return await res.arrayBuffer()
        }
      }
      const [regular, bold] = await Promise.all([
        read('NotoSansKR-Regular.ttf'),
        read('NotoSansKR-Bold.ttf'),
      ])
      return { regular, bold }
    })().catch(err => {
      fontCache = null // 다음 요청에서 다시 시도
      throw err
    })
  }
  return fontCache
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const size = (['small', 'medium', 'large'] as const).find(s => s === url.searchParams.get('size')) ?? 'medium'
  const theme = THEMES[url.searchParams.get('theme') === 'dark' ? 'dark' : 'light']
  const { width, height } = SIZES[size]
  const layout = LAYOUTS[size]

  let fonts
  try {
    fonts = await loadFont(url.origin)
  } catch {
    return new Response('font unavailable', { status: 500 })
  }

  const imageOptions = {
    width,
    height,
    fonts: [
      { name: 'NotoSansKR', data: fonts.regular, weight: 400 as const, style: 'normal' as const },
      { name: 'NotoSansKR', data: fonts.bold, weight: 700 as const, style: 'normal' as const },
    ],
  }

  const identity = await resolveWidgetToken(url.searchParams.get('token'))
  if (!identity) {
    return new ImageResponse(<Notice theme={theme} layout={layout} />, {
      ...imageOptions,
      headers: { 'Cache-Control': NO_STORE },
    })
  }

  // 조건부 응답(304)이 없으므로 이 시각이 곧 이미지에 찍히는 "업데이트 HH:MM"이 된다.
  const summary = await loadWidgetSummary(identity.menuPermissions, identity.isAdmin, new Date())

  return new ImageResponse(<Widget summary={summary} theme={theme} layout={layout} size={size} />, {
    ...imageOptions,
    headers: { 'Cache-Control': NO_STORE },
  })
}

function Notice({ theme, layout }: { theme: Theme; layout: Layout }) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        background: theme.bg,
        padding: layout.pad,
        fontFamily: 'NotoSansKR',
      }}
    >
      <div style={{ fontSize: layout.title, fontWeight: 700, color: theme.title }}>위젯 연결 필요</div>
      {/* satori는 자식이 둘 이상인 div에 명시적 display를 요구한다 — 텍스트는 한 줄에 한 div. */}
      <div style={{ fontSize: layout.item, color: theme.dim, marginTop: 10 }}>미래Hub → 홈화면 위젯에서</div>
      <div style={{ fontSize: layout.item, color: theme.dim, marginTop: 2 }}>주소를 다시 발급받아 주세요</div>
    </div>
  )
}

function Widget({
  summary,
  theme,
  layout,
  size,
}: {
  summary: WidgetSummary
  theme: Theme
  layout: Layout
  size: SizeName
}) {
  // 작은/보통 위젯은 자리가 좁으니 "앞으로 남은 일정"만 보여준다(오늘은 하루 종일 유지).
  // 큰 위젯은 자리가 남으므로 지난 요일까지 흐리게 넣어 이번 주 전체를 한눈에 보여준다 —
  // 헤더의 합계(제출/발표/개찰/팀)가 주 전체 기준이라, 큰 위젯에서는 목록과 합계가 맞는다.
  const withContent = summary.days.filter(d => d.items.length > 0 || d.holidayName)
  const upcoming = size === 'large' ? withContent : withContent.filter(d => !d.isPast)
  const shown = upcoming.slice(0, layout.maxDays)
  const hiddenDays = upcoming.length - shown.length
  const hiddenItems = shown.reduce((n, d) => n + Math.max(0, d.items.length - layout.maxItems), 0)

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: theme.bg,
        padding: layout.pad,
        fontFamily: 'NotoSansKR',
      }}
    >
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <div style={{ fontSize: layout.title, fontWeight: 700, color: theme.title }}>
          {size === 'small' ? '이번 주' : '미래사업팀 이번 주'}
        </div>
        <div style={{ fontSize: layout.meta, color: theme.dim, marginLeft: 'auto' }}>{summary.rangeLabel}</div>
      </div>

      {/* 요약 카운트 */}
      <div style={{ display: 'flex', gap: 6, marginTop: layout.gap }}>
        {(['submit', 'interview', 'result', 'event'] as const)
          .filter(kind => summary.totals[kind] > 0)
          .map(kind => (
            <div
              key={kind}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                background: theme.kind[kind].bg,
                borderRadius: 6,
                padding: '3px 8px',
              }}
            >
              <div style={{ fontSize: layout.meta, color: theme.kind[kind].color }}>
                {`${theme.kind[kind].label} ${summary.totals[kind]}`}
              </div>
            </div>
          ))}
        {Object.values(summary.totals).every(n => n === 0) && (
          <div style={{ fontSize: layout.meta, color: theme.dim }}>등록된 일정 없음</div>
        )}
      </div>

      {/* 날짜별 일정 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: layout.gap, marginTop: layout.gap + 4, flex: 1 }}>
        {shown.map(day => (
          <DayRow key={day.date} day={day} theme={theme} layout={layout} />
        ))}
        {shown.length === 0 && (
          <div style={{ display: 'flex', fontSize: layout.item, color: theme.dim, marginTop: 6 }}>
            남은 일정이 없습니다
          </div>
        )}
      </div>

      {/* 푸터 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ fontSize: layout.meta, color: theme.dim }}>{summary.updatedLabel}</div>
        {(hiddenDays > 0 || hiddenItems > 0) && (
          <div style={{ fontSize: layout.meta, color: theme.dim, marginLeft: 'auto' }}>
            {`+${hiddenDays + hiddenItems}건 더`}
          </div>
        )}
      </div>
    </div>
  )
}

function DayRow({ day, theme, layout }: { day: WidgetDay; theme: Theme; layout: Layout }) {
  const items = day.items.slice(0, layout.maxItems)
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: day.isToday ? theme.todayBg : theme.card,
        border: `1px solid ${day.isToday ? theme.kind.interview.color : theme.border}`,
        borderRadius: 8,
        padding: '6px 9px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{
          fontSize: layout.day,
          fontWeight: 700,
          color: day.isPast ? theme.dim : day.isToday ? theme.title : theme.text,
        }}>
          {day.label}
        </div>
        {day.isToday && <div style={{ fontSize: layout.meta, color: theme.kind.interview.color }}>오늘</div>}
        {day.holidayName && (
          <div style={{ fontSize: layout.meta, color: '#dc2626' }}>{truncate(day.holidayName, 10)}</div>
        )}
      </div>
      {items.map((item, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3 }}>
          <div
            style={{
              display: 'flex',
              fontSize: layout.meta,
              color: item.kind === 'event' ? item.color : theme.kind[item.kind].color,
              background: theme.kind[item.kind].bg,
              borderRadius: 4,
              padding: '1px 5px',
            }}
          >
            {theme.kind[item.kind].label}
          </div>
          <div style={{ fontSize: layout.item, color: day.isPast ? theme.dim : theme.text }}>
            {truncate(item.text, layout.nameChars)}
          </div>
        </div>
      ))}
    </div>
  )
}
