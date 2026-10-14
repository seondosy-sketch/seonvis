import { compareProjectNumber } from '@/lib/projectOrder'

/**
 * 입찰 프로젝트(Project List `projects`)가 연장근무 대상인지, 대상기간이 언제인지 판정한다.
 *
 * 순수 함수다 — DB도 현재 시각도 읽지 않는다. "오늘"은 호출부가 한국 날짜(`koreaToday`)로
 * 만들어 `asOf`로 넘긴다. 그래서 같은 입력이면 항상 같은 결과가 나오고 테스트가 결정적이다.
 * 원본은 항상 `projects`다 — `overtime_projects.status`는 이 판정의 결과를 담는 사본일 뿐,
 * 판정 근거로 쓰지 않는다(동기화가 늦으면 실제 상태와 어긋나 있을 수 있다).
 *
 * 대상기간 종료일 우선순위(경계일은 모두 당일 포함):
 *   1. 서면평가                    → 공고일 ~ 제출일
 *   2. 면접일 있음                  → 공고일 ~ 면접일
 *   3. 면접일 미정, 개찰일 있음       → 개찰일이 오늘 이후(당일 포함)면 공고일 ~ 개찰일,
 *                                     이미 지났으면 확인 필요
 *   4. 면접일·개찰일 모두 미정        → 제출일이 있으면 공고일 ~ 제출일(제출일이 지났으면 신규 배정 제외),
 *                                     없으면 차단
 * 공통: 상태가 '진행중'이 아니면 신규 배정 제외, 공고일은 필수, 공고일이 제출일·면접일·개찰일보다
 * 늦으면 차단. 제출일·면접일·개찰일 서로 간의 순서는 사업 유형마다 달라 검사하지 않는다.
 */

/** Project List에서 판정에 필요한 컬럼만. 날짜는 DB에서 오는 `YYYY-MM-DD` 문자열(공고일만 text 컬럼). */
export interface BidProjectSource {
  id: string
  project_number: string | null
  name: string
  announce_date: string | null
  submit_date: string | null
  interview_date: string | null
  interview_written: boolean | null
  bid_date: string | null
  status: string | null
}

/**
 * - eligible: 신규 자동배정 대상
 * - ineligible: 데이터는 정상이지만 대상이 아님(진행중이 아님, 제출일 경과)
 * - needs_review: 날짜가 아직 정해지지 않아 담당자가 Project List를 보완해야 함
 * - blocked: 날짜가 없거나 앞뒤가 맞지 않아 대상기간을 정할 수 없음
 */
export type EligibilityKind = 'eligible' | 'ineligible' | 'needs_review' | 'blocked'

/** 종료일을 어느 날짜에서 가져왔는지 */
export type PeriodBasis = 'written_submit' | 'interview' | 'bid' | 'submit_only'

export type EligibilityCode =
  | 'STATUS_NOT_ACTIVE'        // 수주·탈락·취소
  | 'ANNOUNCE_MISSING'         // 공고일 없음
  | 'INVALID_DATE'             // YYYY-MM-DD가 아니거나 존재하지 않는 날짜
  | 'WRITTEN_SUBMIT_MISSING'   // 서면평가인데 제출일 없음
  | 'NO_END_DATE'              // 면접일·개찰일·제출일 모두 없음
  | 'SUBMIT_BEFORE_ANNOUNCE'
  | 'INTERVIEW_BEFORE_ANNOUNCE'
  | 'BID_BEFORE_ANNOUNCE'
  | 'BID_PASSED_NO_INTERVIEW'  // 면접일 미정인데 개찰일이 지남
  | 'SUBMIT_PASSED'            // 면접일·개찰일 미정이고 제출일이 지남

export interface ProjectEligibility {
  kind: EligibilityKind
  /** 대상기간을 정할 수 있고 진행중인 사업 — 수동 입력·표시에 쓸 수 있는 기간이 있다 */
  isTarget: boolean
  /** 신규 자동배정에 쓸 수 있는가 (kind === 'eligible') */
  autoAssignable: boolean
  start: string | null
  end: string | null
  basis: PeriodBasis | null
  /** 화면에 보여줄 제외·확인 필요 사유 (eligible이면 null) */
  reason: string | null
  /** 발견된 모든 문제 코드 — kind를 정한 코드 외의 경고도 함께 담는다 */
  codes: EligibilityCode[]
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * 엄격한 `YYYY-MM-DD` 검사. 형식이 맞아도 `2026-02-30`처럼 없는 날짜는 거절한다 —
 * `new Date`는 이런 값을 3월 2일로 자동 보정하므로 그대로 쓰면 기간이 조용히 틀어진다.
 */
export function isStrictIsoDate(value: string | null | undefined): value is string {
  if (typeof value !== 'string') return false
  const m = value.match(ISO_DATE)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(y, mo - 1, d)
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d
}

/**
 * 주어진 시각의 한국(Asia/Seoul) 날짜를 `YYYY-MM-DD`로. 판정 함수에 넘길 `asOf`를 만드는
 * 호출부용이다 — `toISOString()`은 UTC라 한국 00:00~08:59에는 하루 전 날짜가 나온다.
 */
export function koreaToday(now: Date = new Date()): string {
  // en-CA 로케일은 날짜를 YYYY-MM-DD로 포맷한다
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

const REASON: Record<EligibilityCode, string> = {
  STATUS_NOT_ACTIVE: '진행중이 아닌 사업',
  ANNOUNCE_MISSING: '공고일 없음',
  INVALID_DATE: '날짜 형식 오류',
  WRITTEN_SUBMIT_MISSING: '서면평가인데 제출일 없음',
  NO_END_DATE: '면접일·개찰일·제출일 미정',
  SUBMIT_BEFORE_ANNOUNCE: '제출일이 공고일보다 빠름',
  INTERVIEW_BEFORE_ANNOUNCE: '면접일이 공고일보다 빠름',
  BID_BEFORE_ANNOUNCE: '개찰일이 공고일보다 빠름',
  BID_PASSED_NO_INTERVIEW: '면접일 미정 및 개찰일 경과',
  SUBMIT_PASSED: '면접일·개찰일 미정이고 제출일 경과',
}

const BLOCKING: readonly EligibilityCode[] = [
  'ANNOUNCE_MISSING', 'INVALID_DATE', 'WRITTEN_SUBMIT_MISSING', 'NO_END_DATE',
  'SUBMIT_BEFORE_ANNOUNCE', 'INTERVIEW_BEFORE_ANNOUNCE', 'BID_BEFORE_ANNOUNCE',
]

export function evaluateProjectEligibility(project: BidProjectSource, asOf: string): ProjectEligibility {
  if (!isStrictIsoDate(asOf)) throw new Error(`asOf must be YYYY-MM-DD: ${asOf}`)
  const codes: EligibilityCode[] = []

  // 날짜 정규화 — 비어 있으면 null, 값이 있는데 형식이 틀리면 INVALID_DATE (그 값은 쓰지 않는다)
  const norm = (v: string | null): string | null => {
    if (v == null || v.trim() === '') return null
    if (isStrictIsoDate(v.trim())) return v.trim()
    if (!codes.includes('INVALID_DATE')) codes.push('INVALID_DATE')
    return null
  }
  const announce = norm(project.announce_date)
  const submit = norm(project.submit_date)
  const interview = norm(project.interview_date)
  const bid = norm(project.bid_date)
  const written = project.interview_written === true

  if (!announce && !codes.includes('INVALID_DATE')) codes.push('ANNOUNCE_MISSING')
  if (announce && submit && submit < announce) codes.push('SUBMIT_BEFORE_ANNOUNCE')
  if (announce && interview && interview < announce) codes.push('INTERVIEW_BEFORE_ANNOUNCE')
  if (announce && bid && bid < announce) codes.push('BID_BEFORE_ANNOUNCE')

  // 종료일 결정 (YYYY-MM-DD 문자열끼리는 사전순 비교가 곧 날짜 비교)
  let end: string | null = null
  let basis: PeriodBasis | null = null
  if (written) {
    if (submit) { end = submit; basis = 'written_submit' }
    else codes.push('WRITTEN_SUBMIT_MISSING')
  } else if (interview) {
    end = interview; basis = 'interview'
  } else if (bid) {
    if (bid >= asOf) { end = bid; basis = 'bid' }
    else codes.push('BID_PASSED_NO_INTERVIEW')
  } else if (submit) {
    end = submit; basis = 'submit_only'
    if (submit < asOf) codes.push('SUBMIT_PASSED')
  } else {
    codes.push('NO_END_DATE')
  }

  const active = project.status === '진행중'
  if (!active) codes.unshift('STATUS_NOT_ACTIVE')

  const blocking = codes.find(c => BLOCKING.includes(c))
  // 날짜 오류가 있으면 기간을 믿을 수 없으므로 기간을 비운다
  const periodOk = !!announce && !!end && !blocking
  const start = periodOk ? announce : null
  const finalEnd = periodOk ? end : null

  let kind: EligibilityKind
  let decisive: EligibilityCode | null
  if (!active) { kind = 'ineligible'; decisive = 'STATUS_NOT_ACTIVE' }
  else if (blocking) { kind = 'blocked'; decisive = blocking }
  else if (codes.includes('BID_PASSED_NO_INTERVIEW')) { kind = 'needs_review'; decisive = 'BID_PASSED_NO_INTERVIEW' }
  else if (codes.includes('SUBMIT_PASSED')) { kind = 'ineligible'; decisive = 'SUBMIT_PASSED' }
  else { kind = 'eligible'; decisive = null }

  return {
    kind,
    isTarget: active && periodOk,
    autoAssignable: kind === 'eligible',
    start,
    end: finalEnd,
    basis: periodOk ? basis : null,
    reason: decisive ? REASON[decisive] : null,
    codes,
  }
}

export interface EvaluatedProject<P extends BidProjectSource = BidProjectSource> {
  project: P
  eligibility: ProjectEligibility
}

/**
 * 자동배정 처리 순서. eligible만 남기고 다음 순으로 세운다(난수 없음, 같은 입력 → 같은 순서):
 *   1. 제출일 빠른 순  2. 대상기간 종료일 빠른 순  3. 공고일 빠른 순
 *   4. 공사번호(lib/projectOrder.ts와 같은 비교)  5. 프로젝트 id
 * 날짜가 없는 값은 항상 있는 값 뒤로 보낸다(면접일 기준 사업은 제출일이 비어 있을 수 있다).
 */
export function sortForAssignment<P extends BidProjectSource>(items: readonly EvaluatedProject<P>[]): EvaluatedProject<P>[] {
  const nullsLast = (a: string | null, b: string | null) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1)
  const submitOf = (x: EvaluatedProject<P>) => (isStrictIsoDate(x.project.submit_date) ? x.project.submit_date : null)
  return items
    .filter(x => x.eligibility.kind === 'eligible')
    .sort((a, b) =>
      nullsLast(submitOf(a), submitOf(b)) ||
      nullsLast(a.eligibility.end, b.eligibility.end) ||
      nullsLast(a.eligibility.start, b.eligibility.start) ||
      compareProjectNumber(a.project.project_number, b.project.project_number) ||
      (a.project.id < b.project.id ? -1 : a.project.id > b.project.id ? 1 : 0)
    )
}
