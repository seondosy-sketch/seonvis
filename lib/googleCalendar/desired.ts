/**
 * "Google Calendar에 있어야 하는 일정 목록"을 Hub 원본에서 계산한다 — 순수 함수.
 *
 * Hub의 프로젝트 쓰기는 전부 브라우저에서 일어나고 서버 훅이 없다. 그래서 저장 시점에 이벤트를
 * 하나씩 밀어 넣는 방식이 아니라, **원본과 대조(reconcile)** 하는 방식을 쓴다. 이 파일은 그 대조의
 * 한쪽인 "있어야 하는 상태"만 만들고, 실제 Google 호출은 reconcile 쪽이 담당한다.
 *
 * ── 날짜 파싱 정책 ──
 * projects의 submit/interview/bid는 date 타입이지만, announce_date와 project_tooltips의
 * pq/soq/notify는 text이고 실제 데이터에 `2026-07-24` 외에 `2/25`(연도 없음), `추후` 같은 값이
 * 섞여 있다. **`YYYY-MM-DD`만 인정하고** 나머지는 건너뛴다 — 연도를 추측하면 엉뚱한 해에 일정이
 * 생긴다. 건너뛴 값은 개수와 함께 돌려줘 관리자 화면에서 확인할 수 있게 한다.
 *
 * ── 대상 필터 ──
 * 대시보드·위젯·주간보고와 같은 기준으로 취소·드랍/드롭·자사 수주(evaluation='선')를 제외한다.
 * 화면에 안 보이는 일정이 캘린더에만 생기는 상황을 막기 위해 기준을 일부러 일치시킨다.
 */
import { formatProjectNameForReport } from '@/lib/hwpx/projectName'
import { ALL_ACTIONS, eventTitle, type CalendarAction } from './actions'

export interface CalendarProjectRow {
  id: string
  project_number: string
  name: string
  announce_date: string | null
  submit_date: string | null
  interview_date: string | null
  bid_date: string | null
  status_override: string | null
  participants: string | null
  evaluation: string | null
}

export interface CalendarTooltipRow {
  project_number: string
  pq_date: string | null
  soq_date: string | null
  notify_date: string | null
}

export interface DesiredEvent {
  projectId: string
  action: CalendarAction
  /** YYYY-MM-DD */
  date: string
  title: string
  /** 캘린더 기본색을 쓸 때는 null */
  colorId: string | null
  /** 날짜·제목·색을 합친 값 — 이 값이 같으면 Google을 다시 부르지 않는다 */
  fingerprint: string
}

export interface SkippedDate {
  projectId: string
  projectName: string
  action: CalendarAction
  /** 원본 문자열 (형식이 날짜가 아니어서 건너뛴 값) */
  raw: string
}

export interface DesiredResult {
  events: DesiredEvent[]
  /** 날짜 형식이 아니어서 건너뛴 항목 — 관리자 화면에 건수로 표시한다 */
  skipped: SkippedDate[]
  /** 필터로 제외된 프로젝트 수 (취소·드랍·자사 수주) */
  excludedProjects: number
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** `YYYY-MM-DD`만 통과. 그 밖의 값(빈값·추후·서면·`2/25` 등)은 null. */
export function parseIsoDate(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = String(raw).trim()
  if (!ISO_DATE.test(s)) return null
  // 2026-02-30 같은 존재하지 않는 날짜를 걸러낸다.
  const [y, m, d] = s.split('-').map(Number)
  const probe = new Date(y, m - 1, d)
  if (probe.getFullYear() !== y || probe.getMonth() !== m - 1 || probe.getDate() !== d) return null
  return s
}

/** 날짜 문자열이지만 값이 비어 있지도 않은 경우 = "건너뛴 값"으로 보고할 대상인지 */
function isSkippable(raw: string | null | undefined): boolean {
  return !!raw && String(raw).trim() !== '' && parseIsoDate(raw) === null
}

/**
 * 캘린더에서 제외할 프로젝트인지 — 대시보드(app/(dashboard)/page.tsx의 loadPerforming)와 동일 기준.
 */
export function isExcludedProject(p: CalendarProjectRow): boolean {
  if (p.status_override === '취소') return true
  if (p.participants?.includes('드랍') || p.participants?.includes('드롭')) return true
  if (p.evaluation === '선') return true
  return false
}

export function makeFingerprint(date: string, title: string, colorId: string | null): string {
  return `${date}|${title}|${colorId ?? ''}`
}

/** 종일 일정의 end.date — Google은 끝을 배타적으로 다루므로 하루를 더한다. */
export function exclusiveEndDate(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  const next = new Date(y, m - 1, d + 1)
  const mm = String(next.getMonth() + 1).padStart(2, '0')
  const dd = String(next.getDate()).padStart(2, '0')
  return `${next.getFullYear()}-${mm}-${dd}`
}

/**
 * @param todayKey KST 기준 오늘 (YYYY-MM-DD). 호출부가 계산해 넘긴다 — 이 함수는 시계를 읽지 않는다.
 * @param syncedKeys 이미 동기화된 `projectId:action` 집합. 시간이 지나 과거가 된 일정을
 *   "오늘 이후" 조건 때문에 삭제해 버리지 않도록, 이미 만든 일정은 계속 유지 대상으로 둔다.
 * @param backfillFromKey 이 날짜부터는 과거 일정도 포함한다(소급). 기본은 오늘 = 소급 없음.
 *   지난 공고일처럼 이미 지나간 일정을 한 번 채워 넣을 때 쓴다. 한 번 만들어진 일정은
 *   syncedKeys에 들어가므로 이후 일반 동기화에서 삭제되지 않는다.
 */
export function buildDesiredEvents(
  projects: CalendarProjectRow[],
  tooltips: CalendarTooltipRow[],
  todayKey: string,
  colorMap: Partial<Record<CalendarAction, string>>,
  syncedKeys: ReadonlySet<string> = new Set(),
  backfillFromKey: string = todayKey,
): DesiredResult {
  // 소급 기준일은 오늘보다 미래일 수 없다(잘못 넘겨도 "오늘 이후"로 동작하게 한다).
  const fromKey = backfillFromKey < todayKey ? backfillFromKey : todayKey
  const tooltipByNumber = new Map(tooltips.map(t => [t.project_number, t]))
  const events: DesiredEvent[] = []
  const skipped: SkippedDate[] = []
  let excludedProjects = 0

  for (const p of projects) {
    if (isExcludedProject(p)) {
      excludedProjects++
      continue
    }
    if (!p.name?.trim()) continue

    const tip = tooltipByNumber.get(p.project_number)
    const raws: Record<CalendarAction, string | null> = {
      announce: p.announce_date,
      pq: tip?.pq_date ?? null,
      soq: tip?.soq_date ?? null,
      submit: p.submit_date,
      interview: p.interview_date,
      bid: p.bid_date,
      notify: tip?.notify_date ?? null,
    }

    const cleanName = formatProjectNameForReport(p.name).trim() || p.name.trim()

    for (const action of ALL_ACTIONS) {
      const raw = raws[action]
      const date = parseIsoDate(raw)
      if (!date) {
        if (isSkippable(raw)) {
          skipped.push({ projectId: p.id, projectName: cleanName, action, raw: String(raw).trim() })
        }
        continue
      }
      // 기준일(기본 오늘) 이후만 새로 만든다. 이미 동기화한 일정은 과거가 되어도 유지한다.
      const alreadySynced = syncedKeys.has(`${p.id}:${action}`)
      if (date < fromKey && !alreadySynced) continue

      const title = eventTitle(cleanName, action)
      const colorId = colorMap[action] ?? null
      events.push({
        projectId: p.id,
        action,
        date,
        title,
        colorId,
        fingerprint: makeFingerprint(date, title, colorId),
      })
    }
  }

  return { events, skipped, excludedProjects }
}
