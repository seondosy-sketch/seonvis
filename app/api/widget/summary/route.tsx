/**
 * 홈화면 위젯 이미지 (PNG) — 아이폰/안드로이드 공용, 달력형.
 *
 * 왜 이미지인가: iOS·Android 홈화면 위젯은 네이티브 코드만 그릴 수 있어서 웹앱을 그대로
 * 위젯으로 만들 수 없다. 대신 두 OS 모두 "URL의 이미지를 주기적으로 가져와 위젯에 띄우는"
 * 앱(iOS Scriptable, Android 이미지 위젯 앱)이 있으므로, 서버가 위젯 모양 PNG를 그려주면
 * 구현 하나로 양쪽을 커버할 수 있다. 설치 방법은 docs/widget/README.md.
 *
 * ── 크기별 레이아웃 ──
 *   small  : 달력 없음. 오늘 날짜를 크게 + 오늘 일정 건수 + 다음 일정 1건
 *   medium : 이번 주 월~일 7칸 달력 (날짜 숫자 + 일정 이름 2줄까지)
 *   large  : 이번 달 전체 달력(월요일 시작, 이전·다음 달은 흐리게) + 하단 다가오는 일정 3건
 *
 * 날짜 칸에는 일정 종류를 **색**(왼쪽 색 막대 + 같은 색 이름)으로 구분하고 **프로젝트명을 짧게
 * 잘라** 넣는다. 칸 폭이 좁아 몇 글자밖에 안 들어가지만, 건수만 보이는 것보다 "어느 사업인지"
 * 감이 잡히는 쪽이 쓸모 있다는 요청에 따른 것이다. 이름은 HWPX 보고서와 같은 정제 규칙
 * (`formatProjectNameForReport`)을 거쳐 앞부분에 식별 정보가 오게 만든다. 종류 색의 범례는
 * 헤더에 한 글자 칩(제·발·개·팀)으로 두고, 칸에 넣을 줄 수를 넘으면 `+N`으로 접는다.
 * 전체 이름은 large 하단 "다가오는 일정"과 small의 "다음 일정"에서 더 길게 보여준다.
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
 * 이미지의 "업데이트 HH:MM"(KST)은 **이 PNG를 만든 시각 = 그 요청에서 DB를 조회한 시각**
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
import {
  groupByKind,
  loadWidgetSummary,
  type WidgetCell,
  type WidgetItemKind,
  type WidgetSummary,
  type WidgetUpcoming,
} from '@/lib/widget/summary'
import { WEEKDAY_LABELS } from '@/lib/widget/calendar'

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
  header: number
  meta: number
  weekday: number
  day: number
  chip: number
  body: number
  /** 날짜 칸에 넣는 일정 줄 수 (초과분은 +N) */
  cellItems: number
  /** 날짜 칸 프로젝트명 글자 크기 */
  cellName: number
  /** 날짜 칸 프로젝트명 최대 글자 수 (한 줄 기준, 말줄임) */
  cellChars: number
  /** 날짜 칸 프로젝트명을 몇 줄까지 보여줄지 */
  cellLines: number
  /** 하단 목록에 넣는 일정 수 */
  upcoming: number
  /** 하단 목록 프로젝트명 최대 글자 수 */
  nameChars: number
}

/**
 * 폰트 크기는 "이미지가 3배 스케일"인 것을 감안한 값이다 — 화면에서는 1/3로 줄어들어 보이므로
 * 27px 미만은 폰에서 9pt 아래가 되어 잘 안 읽힌다. 그래서 본문·칩은 24px 이상을 쓴다.
 */
const LAYOUTS: Record<SizeName, Layout> = {
  small: { pad: 26, header: 28, meta: 24, weekday: 40, day: 130, chip: 26, body: 30, cellItems: 0, cellName: 0, cellChars: 0, cellLines: 1, upcoming: 1, nameChars: 14 },
  // medium은 세로 여유가 있어 이름 줄을 4개까지 넣는다(그 이상은 프레임을 넘쳐 머리글이 잘린다).
  medium: { pad: 24, header: 34, meta: 24, weekday: 26, day: 40, chip: 26, body: 26, cellItems: 4, cellName: 19, cellChars: 6, cellLines: 2, upcoming: 0, nameChars: 0 },
  // large는 주 행 수(4~6)에 따라 행 높이가 달라진다 — cellItems는 렌더 시점에 주 수로 보정한다
  // (6주 달은 2줄, 4~5주 달은 3줄). 이름 글자 크기·수는 칸 폭 133px에서 실측해 정했다.
  large: { pad: 28, header: 36, meta: 24, weekday: 26, day: 26, chip: 21, body: 26, cellItems: 3, cellName: 17, cellChars: 6, cellLines: 1, upcoming: 3, nameChars: 24 },
}

interface KindStyle { label: string; color: string; bg: string }

interface Theme {
  bg: string
  card: string
  border: string
  title: string
  text: string
  dim: string
  outMonth: string
  todayBg: string
  todayBorder: string
  saturday: string
  sunday: string
  kind: Record<WidgetItemKind, KindStyle>
}

/**
 * 일정 종류별 색·라벨. 프로젝트 일정 색은 웹 주간달력(app/components/WeeklyCalendar.tsx의
 * TYPE_META)과 맞추고, 라벨은 한 글자로 줄여 좁은 칸에서도 색과 함께 두 가지 단서를 준다.
 */
const THEMES: Record<'light' | 'dark', Theme> = {
  light: {
    bg: '#ffffff',
    card: '#f8f8f7',
    border: '#e8e8e6',
    title: '#111111',
    text: '#333333',
    dim: '#9a9a97',
    outMonth: '#cfcfcb',
    todayBg: '#fef9f0',
    todayBorder: '#b45309',
    saturday: '#1d4ed8',
    sunday: '#dc2626',
    kind: {
      holiday: { label: '휴', color: '#dc2626', bg: '#fef2f2' },
      submit: { label: '제', color: '#1d4ed8', bg: '#eff6ff' },
      interview: { label: '발', color: '#b45309', bg: '#fffbeb' },
      result: { label: '개', color: '#15803d', bg: '#f0fdf4' },
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
    outMonth: '#4a4a52',
    todayBg: '#2b2419',
    todayBorder: '#d09a4a',
    saturday: '#93b8ff',
    sunday: '#f87171',
    kind: {
      holiday: { label: '휴', color: '#f87171', bg: '#3a1d1d' },
      submit: { label: '제', color: '#93b8ff', bg: '#1c2740' },
      interview: { label: '발', color: '#f0c07a', bg: '#3a2c14' },
      result: { label: '개', color: '#86e0a3', bg: '#16301f' },
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

  const body =
    size === 'small' ? <TodayWidget summary={summary} theme={theme} layout={layout} />
    : size === 'medium' ? <WeekWidget summary={summary} theme={theme} layout={layout} />
    : <MonthWidget summary={summary} theme={theme} layout={layout} />

  return new ImageResponse(body, { ...imageOptions, headers: { 'Cache-Control': NO_STORE } })
}

function Frame({ theme, layout, children }: { theme: Theme; layout: Layout; children: React.ReactNode }) {
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
      {children}
    </div>
  )
}

function Notice({ theme, layout }: { theme: Theme; layout: Layout }) {
  return (
    <Frame theme={theme} layout={layout}>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center' }}>
        <div style={{ fontSize: layout.header, fontWeight: 700, color: theme.title }}>위젯 연결 필요</div>
        {/* satori는 자식이 둘 이상인 div에 명시적 display를 요구한다 — 텍스트는 한 줄에 한 div. */}
        <div style={{ fontSize: layout.body, color: theme.dim, marginTop: 10 }}>미래Hub → 홈화면 위젯에서</div>
        <div style={{ fontSize: layout.body, color: theme.dim, marginTop: 2 }}>주소를 다시 발급받아 주세요</div>
      </div>
    </Frame>
  )
}

/** 종류 칩 — 색 + 한 글자 라벨(+ 같은 종류가 여러 건이면 개수) */
function Chip({
  kind,
  count,
  theme,
  fontSize,
}: {
  kind: WidgetItemKind
  count: number
  theme: Theme
  fontSize: number
}) {
  const s = theme.kind[kind]
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: s.bg,
        color: s.color,
        borderRadius: 5,
        padding: '1px 5px',
        fontSize,
        fontWeight: 700,
      }}
    >
      {count > 1 ? `${s.label}${count}` : s.label}
    </div>
  )
}

/**
 * 날짜 칸 내용 — 일정 종류는 **색**으로 구분하고, 프로젝트명을 짧게 잘라 함께 보여준다.
 *
 * 칸 폭이 좁아 이름은 몇 글자밖에 못 넣지만(말줄임), 건수만 보이는 것보다 "어느 사업인지"
 * 감이 잡히는 쪽이 쓸모 있다는 요청에 따른 구성이다. 왼쪽 색 막대 + 같은 색 이름으로
 * 종류를 나타내고(범례는 헤더에 있다), 넣을 수 있는 줄 수를 넘으면 `+N`으로 접는다.
 * 전체 이름은 large 하단 "다가오는 일정"과 small의 "다음 일정"에서 더 길게 보여준다.
 */
function CellItems({
  cell,
  theme,
  layout,
  maxItems,
}: {
  cell: WidgetCell
  theme: Theme
  layout: Layout
  maxItems: number
}) {
  // '+N' 줄도 한 줄을 차지하므로 줄 수 예산에 포함시킨다 — 그러지 않으면 칸이 한 줄 더 높아져
  // 좁은 행(5~6주 달)에서 날짜 숫자와 겹친다. 결과적으로 칸의 줄 수는 항상 maxItems 이하다.
  const overflow = cell.items.length > maxItems
  const shown = cell.items.slice(0, overflow ? maxItems - 1 : maxItems)
  const hidden = cell.items.length - shown.length
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', gap: 2 }}>
      {shown.map((item, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'stretch', gap: 3 }}>
          <div
            style={{
              display: 'flex',
              width: 5,
              minHeight: layout.cellName,
              borderRadius: 3,
              background: theme.kind[item.kind].color,
            }}
          />
          <div
            style={{
              display: 'flex',
              flex: 1,
              fontSize: layout.cellName,
              lineHeight: 1.15,
              color: theme.kind[item.kind].color,
              // 여러 줄을 허용할 때: satori에서는 lineClamp가 먹지 않아(3줄로 흘러넘쳤다)
              // ① 글자 수를 줄당 폭 × 줄 수로 미리 자르고 ② 높이를 줄 수만큼으로 묶어
              // 혹시 한 줄 더 흐르더라도 칸이 높아지지 않게 한다.
              ...(layout.cellLines > 1
                ? { maxHeight: Math.round(layout.cellName * 1.15 * layout.cellLines), overflow: 'hidden' }
                : {}),
            }}
          >
            {truncate(item.short, layout.cellChars * layout.cellLines)}
          </div>
        </div>
      ))}
      {hidden > 0 && (
        <div style={{ display: 'flex', fontSize: layout.cellName, color: theme.dim }}>{`+${hidden}`}</div>
      )}
    </div>
  )
}

/** 요일 머리글 — 토·일은 색으로 구분(한국 달력 관례) */
function WeekdayHeader({ theme, layout }: { theme: Theme; layout: Layout }) {
  return (
    <div style={{ display: 'flex', width: '100%' }}>
      {WEEKDAY_LABELS.map((label, i) => (
        <div
          key={label}
          style={{
            display: 'flex',
            flex: 1,
            justifyContent: 'center',
            fontSize: layout.weekday,
            color: i === 5 ? theme.saturday : i === 6 ? theme.sunday : theme.dim,
          }}
        >
          {label}
        </div>
      ))}
    </div>
  )
}

function Footer({ summary, theme, layout }: { summary: WidgetSummary; theme: Theme; layout: Layout }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginTop: 6 }}>
      <div style={{ fontSize: layout.meta, color: theme.dim }}>{summary.updatedLabel}</div>
    </div>
  )
}

function UpcomingRow({
  item,
  theme,
  layout,
}: {
  item: WidgetUpcoming
  theme: Theme
  layout: Layout
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 4 }}>
      <div style={{ display: 'flex', fontSize: layout.body, color: theme.dim }}>{item.label}</div>
      <Chip kind={item.kind} count={1} theme={theme} fontSize={layout.chip} />
      <div style={{ display: 'flex', fontSize: layout.body, color: theme.text }}>
        {truncate(item.short, layout.nameChars)}
      </div>
    </div>
  )
}

/** small — 달력 없이 오늘에 집중 */
function TodayWidget({ summary, theme, layout }: { summary: WidgetSummary; theme: Theme; layout: Layout }) {
  const { today } = summary
  const groups = groupByKind(today.items)
  const next = summary.upcoming.filter(u => u.date > today.date)[0] ?? null

  return (
    <Frame theme={theme} layout={layout}>
      <div style={{ display: 'flex', fontSize: layout.header, color: theme.dim }}>{summary.monthLabel}</div>

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, marginTop: 2 }}>
        <div style={{ display: 'flex', fontSize: layout.day, fontWeight: 700, color: theme.title, lineHeight: 1 }}>
          {`${today.day}`}
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: layout.weekday,
            color: today.holidayName ? theme.sunday : theme.text,
            paddingBottom: 8,
          }}
        >
          {today.weekday}
        </div>
      </div>

      {today.holidayName && (
        <div style={{ display: 'flex', fontSize: layout.body, color: theme.sunday, marginTop: 2 }}>
          {truncate(today.holidayName, 12)}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10 }}>
        <div style={{ display: 'flex', fontSize: layout.body, color: theme.text }}>
          {today.items.length > 0 ? `오늘 ${today.items.length}건` : '오늘 일정 없음'}
        </div>
        {groups.map(g => (
          <Chip key={g.kind} kind={g.kind} count={g.count} theme={theme} fontSize={layout.chip} />
        ))}
      </div>

      <div style={{ display: 'flex', flex: 1, flexDirection: 'column', justifyContent: 'flex-end' }}>
        <div style={{ display: 'flex', width: '100%', height: 1, background: theme.border, marginBottom: 8 }} />
        <div style={{ display: 'flex', fontSize: layout.meta, color: theme.dim }}>다음 일정</div>
        {next ? (
          <UpcomingRow item={next} theme={theme} layout={layout} />
        ) : (
          <div style={{ display: 'flex', fontSize: layout.body, color: theme.dim, marginTop: 4 }}>
            예정된 일정 없음
          </div>
        )}
      </div>

      <Footer summary={summary} theme={theme} layout={layout} />
    </Frame>
  )
}

/** medium — 이번 주 월~일 7칸 */
function WeekWidget({ summary, theme, layout }: { summary: WidgetSummary; theme: Theme; layout: Layout }) {
  return (
    <Frame theme={theme} layout={layout}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <div style={{ display: 'flex', fontSize: layout.header, fontWeight: 700, color: theme.title }}>
          {summary.monthLabel}
        </div>
        <div style={{ display: 'flex', fontSize: layout.meta, color: theme.dim }}>{summary.weekRangeLabel}</div>
        <div style={{ display: 'flex', marginLeft: 'auto', gap: 4 }}>
          {(['submit', 'interview', 'result', 'event'] as const).map(kind => (
            <Chip key={kind} kind={kind} count={1} theme={theme} fontSize={layout.chip} />
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', marginTop: 8 }}>
        <WeekdayHeader theme={theme} layout={layout} />
      </div>

      {/* 주 1줄이라 칸을 프레임 높이까지 늘리면 아래가 텅 빈다 — 내용 높이만 쓰되(바깥 세로 중앙),
          칸끼리는 stretch로 같은 높이를 유지해 들쭉날쭉하지 않게 한다 */}
      <div style={{ display: 'flex', flex: 1, flexDirection: 'column', justifyContent: 'center', marginTop: 4 }}>
      <div style={{ display: 'flex', width: '100%', alignItems: 'stretch', gap: 4 }}>
        {summary.weekCells.map(cell => (
          <div
            key={cell.date}
            style={{
              display: 'flex',
              flex: 1,
              flexDirection: 'column',
              alignItems: 'center',
              gap: 6,
              padding: '10px 6px 12px',
              borderRadius: 9,
              background: cell.isToday ? theme.todayBg : theme.card,
              border: `1px solid ${cell.isToday ? theme.todayBorder : theme.border}`,
            }}
          >
            <div
              style={{
                display: 'flex',
                fontSize: layout.day,
                fontWeight: cell.isToday ? 700 : 400,
                color: cell.isToday
                  ? theme.title
                  : cell.weekday === 6
                    ? theme.sunday
                    : cell.weekday === 5
                      ? theme.saturday
                      : cell.isPast
                        ? theme.dim
                        : theme.text,
              }}
            >
              {`${cell.day}`}
            </div>
            <CellItems cell={cell} theme={theme} layout={layout} maxItems={layout.cellItems} />
          </div>
        ))}
      </div>
      </div>

      <Footer summary={summary} theme={theme} layout={layout} />
    </Frame>
  )
}

/** large — 이번 달 전체 달력 + 하단 다가오는 일정 */
function MonthWidget({ summary, theme, layout }: { summary: WidgetSummary; theme: Theme; layout: Layout }) {
  const upcoming = summary.upcoming.slice(0, layout.upcoming)
  // 6주 달은 행 높이가 가장 낮아 이름 줄을 2개로 줄인다(그대로 3줄이면 날짜 숫자와 겹친다)
  const cellItems = summary.monthWeeks.length >= 6 ? 2 : layout.cellItems
  return (
    <Frame theme={theme} layout={layout}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <div style={{ display: 'flex', fontSize: layout.header, fontWeight: 700, color: theme.title }}>
          {summary.monthLabel}
        </div>
        <div style={{ display: 'flex', fontSize: layout.meta, color: theme.dim }}>{summary.today.label}</div>
        <div style={{ display: 'flex', marginLeft: 'auto', gap: 4 }}>
          {(['submit', 'interview', 'result', 'event'] as const).map(kind => (
            <Chip key={kind} kind={kind} count={1} theme={theme} fontSize={layout.chip} />
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', marginTop: 10 }}>
        <WeekdayHeader theme={theme} layout={layout} />
      </div>

      {/* 주 행마다 flex:1 — 4주/5주/6주 어느 달이든 남는 높이를 균등하게 나눠 깨지지 않는다 */}
      <div style={{ display: 'flex', flex: 1, flexDirection: 'column', gap: 4, marginTop: 4 }}>
        {summary.monthWeeks.map((week, i) => (
          <div key={i} style={{ display: 'flex', flex: 1, gap: 4 }}>
            {week.map(cell => (
              <div
                key={cell.date}
                style={{
                  display: 'flex',
                  flex: 1,
                  flexDirection: 'column',
                  gap: 2,
                  padding: '4px 6px',
                  borderRadius: 8,
                  background: cell.isToday ? theme.todayBg : cell.inMonth ? theme.card : 'transparent',
                  border: `1px solid ${cell.isToday ? theme.todayBorder : cell.inMonth ? theme.border : 'transparent'}`,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    fontSize: layout.day,
                    fontWeight: cell.isToday ? 700 : 400,
                    color: !cell.inMonth
                      ? theme.outMonth
                      : cell.isToday
                        ? theme.title
                        : cell.weekday === 6
                          ? theme.sunday
                          : cell.weekday === 5
                            ? theme.saturday
                            : theme.text,
                  }}
                >
                  {`${cell.day}`}
                </div>
                {cell.inMonth && <CellItems cell={cell} theme={theme} layout={layout} maxItems={cellItems} />}
              </div>
            ))}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', marginTop: 10 }}>
        <div style={{ display: 'flex', width: '100%', height: 1, background: theme.border, marginBottom: 7 }} />
        <div style={{ display: 'flex', fontSize: layout.meta, color: theme.dim }}>다가오는 일정</div>
        {upcoming.length > 0 ? (
          upcoming.map(item => <UpcomingRow key={`${item.date}-${item.kind}-${item.text}`} item={item} theme={theme} layout={layout} />)
        ) : (
          <div style={{ display: 'flex', fontSize: layout.body, color: theme.dim, marginTop: 4 }}>
            예정된 일정 없음
          </div>
        )}
      </div>

      <Footer summary={summary} theme={theme} layout={layout} />
    </Frame>
  )
}
