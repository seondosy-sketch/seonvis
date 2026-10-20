import { describe, expect, it } from 'vitest'
import {
  BidProjectSource,
  evaluateProjectEligibility,
  isStrictIsoDate,
  koreaToday,
  sortForAssignment,
} from './eligibility'

const ASOF = '2026-10-03'

const src = (over: Partial<BidProjectSource> = {}): BidProjectSource => ({
  id: 'p1',
  project_number: '2700',
  name: '테스트 사업',
  announce_date: '2026-09-15',
  submit_date: '2026-10-10',
  interview_date: '2026-10-20',
  interview_written: false,
  bid_date: '2026-10-30',
  status: '진행중',
  ...over,
})

const evalOf = (over: Partial<BidProjectSource> = {}, asOf = ASOF) => evaluateProjectEligibility(src(over), asOf)

describe('isStrictIsoDate', () => {
  it.each(['2026-10-03', '2028-02-29', '2026-12-31'])('%s → true', v => { expect(isStrictIsoDate(v)).toBe(true) })
  it.each([
    '2026-02-30',   // 존재하지 않는 날짜 (new Date는 3/2로 보정한다)
    '2027-02-29',   // 평년 2/29
    '2026-13-01',
    '2026-10-3',
    '26-10-03',
    '2026/10/03',
    '10/3',
    '추후',
    ' 2026-10-03',
    '',
  ])('%s → false', v => { expect(isStrictIsoDate(v)).toBe(false) })
  it('null/undefined → false', () => {
    expect(isStrictIsoDate(null)).toBe(false)
    expect(isStrictIsoDate(undefined)).toBe(false)
  })
})

describe('koreaToday — 한국 날짜 (UTC 경계)', () => {
  it('UTC 10/02 15:00 = 한국 10/03 00:00 → 2026-10-03', () => {
    expect(koreaToday(new Date('2026-10-02T15:00:00Z'))).toBe('2026-10-03')
  })
  it('UTC 10/02 14:59 = 한국 10/02 23:59 → 2026-10-02', () => {
    expect(koreaToday(new Date('2026-10-02T14:59:59Z'))).toBe('2026-10-02')
  })
  it('UTC 날짜(toISOString)와 하루 다른 시각에도 한국 날짜를 쓴다', () => {
    const t = new Date('2026-12-31T20:00:00Z') // 한국 2027-01-01 05:00
    expect(t.toISOString().slice(0, 10)).toBe('2026-12-31')
    expect(koreaToday(t)).toBe('2027-01-01')
  })
  it('한국 기준일 경계가 개찰일 경과 판정에 그대로 반영된다', () => {
    const p = { interview_date: null, bid_date: '2026-10-02' }
    // 한국 10/02 23:59 → 개찰일 당일 → 대상
    expect(evalOf(p, koreaToday(new Date('2026-10-02T14:59:00Z'))).kind).toBe('eligible')
    // 한국 10/03 00:00 → 개찰일 경과 → 확인 필요
    expect(evalOf(p, koreaToday(new Date('2026-10-02T15:00:00Z'))).kind).toBe('needs_review')
  })
})

describe('evaluateProjectEligibility — 대상기간 규칙', () => {
  it('서면평가 + 제출일 있음 → 공고일~제출일 (면접일·개찰일보다 우선)', () => {
    const r = evalOf({ interview_written: true, interview_date: null, submit_date: '2026-10-10', bid_date: '2026-10-30' })
    expect(r).toMatchObject({ kind: 'eligible', isTarget: true, autoAssignable: true, start: '2026-09-15', end: '2026-10-10', basis: 'written_submit', reason: null, codes: [] })
  })

  it('서면평가인데 면접일이 잘못 남아 있어도 제출일을 쓴다', () => {
    expect(evalOf({ interview_written: true, interview_date: '2026-10-20' })).toMatchObject({ end: '2026-10-10', basis: 'written_submit' })
  })

  it('서면평가 + 제출일 없음 → blocked', () => {
    const r = evalOf({ interview_written: true, interview_date: null, submit_date: null })
    expect(r).toMatchObject({ kind: 'blocked', isTarget: false, autoAssignable: false, start: null, end: null, reason: '서면평가인데 제출일 없음' })
    expect(r.codes).toContain('WRITTEN_SUBMIT_MISSING')
  })

  it('서면평가 + 제출일이 이미 지나도 기간은 유지 (제출일 경과 제외는 면접·개찰 미정 규칙에만 적용)', () => {
    expect(evalOf({ interview_written: true, submit_date: '2026-09-30' })).toMatchObject({ kind: 'eligible', end: '2026-09-30' })
  })

  it('면접일 있음 → 공고일~면접일', () => {
    expect(evalOf()).toMatchObject({ kind: 'eligible', start: '2026-09-15', end: '2026-10-20', basis: 'interview' })
  })

  it('면접일 있음 + 제출일 없음 → 공고일~면접일 (제출일은 필수 아님)', () => {
    expect(evalOf({ submit_date: null })).toMatchObject({ kind: 'eligible', end: '2026-10-20' })
  })

  it('면접일 미정 + 개찰일 미도래 → 공고일~개찰일', () => {
    expect(evalOf({ interview_date: null, bid_date: '2026-10-30' })).toMatchObject({ kind: 'eligible', end: '2026-10-30', basis: 'bid' })
  })

  it('면접일 미정 + 개찰일 당일 → 대상 (당일 포함)', () => {
    expect(evalOf({ interview_date: null, bid_date: ASOF })).toMatchObject({ kind: 'eligible', end: ASOF, basis: 'bid' })
  })

  it('면접일 미정 + 개찰일 경과 → needs_review', () => {
    const r = evalOf({ interview_date: null, bid_date: '2026-10-02' })
    expect(r).toMatchObject({ kind: 'needs_review', isTarget: false, autoAssignable: false, end: null, reason: '면접일 미정 및 개찰일 경과' })
    expect(r.codes).toEqual(['BID_PASSED_NO_INTERVIEW'])
  })

  it('면접일·개찰일 미정 + 제출일 미도래 → 공고일~제출일', () => {
    expect(evalOf({ interview_date: null, bid_date: null, submit_date: '2026-11-02' })).toMatchObject({ kind: 'eligible', end: '2026-11-02', basis: 'submit_only' })
  })

  it('면접일·개찰일 미정 + 제출일 당일 → 대상', () => {
    expect(evalOf({ interview_date: null, bid_date: null, submit_date: ASOF })).toMatchObject({ kind: 'eligible', end: ASOF })
  })

  it('면접일·개찰일 미정 + 제출일 경과 → ineligible (기간은 남겨둔다)', () => {
    const r = evalOf({ interview_date: null, bid_date: null, submit_date: '2026-10-02' })
    expect(r).toMatchObject({ kind: 'ineligible', isTarget: true, autoAssignable: false, start: '2026-09-15', end: '2026-10-02', reason: '면접일·개찰일 미정이고 제출일 경과' })
    expect(r.codes).toEqual(['SUBMIT_PASSED'])
  })

  it('면접일·개찰일·제출일 모두 미정 → blocked', () => {
    const r = evalOf({ interview_date: null, bid_date: null, submit_date: null })
    expect(r).toMatchObject({ kind: 'blocked', end: null, reason: '면접일·개찰일·제출일 미정' })
  })

  it('공고일 없음 → blocked', () => {
    const r = evalOf({ announce_date: null })
    expect(r).toMatchObject({ kind: 'blocked', start: null, end: null, reason: '공고일 없음' })
    expect(evalOf({ announce_date: '  ' }).codes).toContain('ANNOUNCE_MISSING')
  })

  it.each(['2026/09/15', '9/15', '추후', '2026-9-15'])('공고일 형식 오류 %s → blocked(INVALID_DATE), 보정해서 쓰지 않는다', v => {
    const r = evalOf({ announce_date: v })
    expect(r).toMatchObject({ kind: 'blocked', start: null, end: null, reason: '날짜 형식 오류' })
    expect(r.codes).toContain('INVALID_DATE')
    expect(r.codes).not.toContain('ANNOUNCE_MISSING')
  })

  it('존재하지 않는 날짜(2026-02-30) → blocked', () => {
    expect(evalOf({ announce_date: '2026-02-30' }).kind).toBe('blocked')
    expect(evalOf({ interview_date: '2026-11-31' }).codes).toContain('INVALID_DATE')
  })

  it.each([
    [{ submit_date: '2026-09-14' }, 'SUBMIT_BEFORE_ANNOUNCE', '제출일이 공고일보다 빠름'],
    [{ interview_date: '2026-09-14' }, 'INTERVIEW_BEFORE_ANNOUNCE', '면접일이 공고일보다 빠름'],
    [{ interview_date: null, bid_date: '2026-09-14' }, 'BID_BEFORE_ANNOUNCE', '개찰일이 공고일보다 빠름'],
    [{ interview_written: true, interview_date: null, submit_date: '2026-09-01' }, 'SUBMIT_BEFORE_ANNOUNCE', '제출일이 공고일보다 빠름'],
  ] as const)('공고일보다 빠른 날짜 %o → blocked', (over, code, reason) => {
    const r = evalOf(over)
    expect(r).toMatchObject({ kind: 'blocked', start: null, end: null, reason })
    expect(r.codes).toContain(code)
  })

  it('종료일 기준이 아닌 날짜도 공고일보다 빠르면 차단한다 (면접일 사업의 개찰일 오류)', () => {
    expect(evalOf({ bid_date: '2026-09-01' })).toMatchObject({ kind: 'blocked', reason: '개찰일이 공고일보다 빠름' })
  })

  it('제출일·면접일·개찰일 서로 간 순서는 검사하지 않는다', () => {
    // 면접일 > 개찰일, 제출일 > 면접일 모두 허용
    expect(evalOf({ submit_date: '2026-10-25', interview_date: '2026-10-20', bid_date: '2026-10-18' })).toMatchObject({ kind: 'eligible', end: '2026-10-20' })
  })

  it('공고일 = 종료일 (하루짜리 기간) → 대상, 양 끝 포함', () => {
    expect(evalOf({ announce_date: '2026-10-20', submit_date: '2026-10-20', interview_date: '2026-10-20', bid_date: null })).toMatchObject({ kind: 'eligible', start: '2026-10-20', end: '2026-10-20' })
  })

  it.each(['수주', '탈락', '취소'])('상태 %s → ineligible, 기간은 원본 날짜로 계산', status => {
    const r = evalOf({ status })
    expect(r).toMatchObject({ kind: 'ineligible', isTarget: false, autoAssignable: false, start: '2026-09-15', end: '2026-10-20', reason: '진행중이 아닌 사업' })
    expect(r.codes[0]).toBe('STATUS_NOT_ACTIVE')
  })

  it('상태가 진행중이 아니면 날짜 오류보다 상태 사유가 우선', () => {
    const r = evalOf({ status: '탈락', announce_date: null })
    expect(r.kind).toBe('ineligible')
    expect(r.codes).toEqual(['STATUS_NOT_ACTIVE', 'ANNOUNCE_MISSING'])
  })

  it('asOf 형식이 틀리면 예외 — 잘못된 기준일로 조용히 판정하지 않는다', () => {
    expect(() => evaluateProjectEligibility(src(), '2026-10-3')).toThrow()
  })

  it('같은 입력 → 같은 결과', () => {
    expect(evalOf()).toEqual(evalOf())
  })
})

describe('대상기간 경계 — 양 끝 포함', () => {
  const r = evalOf()
  const inPeriod = (d: string) => d >= r.start! && d <= r.end!
  it('공고일 당일·종료일 당일 포함, 하루 전후는 제외', () => {
    expect(inPeriod('2026-09-15')).toBe(true)
    expect(inPeriod('2026-10-20')).toBe(true)
    expect(inPeriod('2026-09-14')).toBe(false)
    expect(inPeriod('2026-10-21')).toBe(false)
  })
})

describe('sortForAssignment — 제출일 → 종료일 → 공고일 → 공사번호 → id', () => {
  const item = (over: Partial<BidProjectSource>) => {
    const project = src(over)
    return { project, eligibility: evaluateProjectEligibility(project, ASOF) }
  }

  it('제출일 빠른 순', () => {
    const items = [
      item({ id: 'c', submit_date: '2026-10-12' }),
      item({ id: 'a', submit_date: '2026-10-05' }),
      item({ id: 'b', submit_date: '2026-10-08' }),
    ]
    expect(sortForAssignment(items).map(x => x.project.id)).toEqual(['a', 'b', 'c'])
  })

  it('제출일 같으면 종료일 → 공고일 → 공사번호 순', () => {
    const items = [
      item({ id: 'num-late', project_number: '2710', interview_date: '2026-10-20', announce_date: '2026-09-10' }),
      item({ id: 'end-late', project_number: '2600', interview_date: '2026-10-25' }),
      item({ id: 'ann-late', project_number: '2600', interview_date: '2026-10-20', announce_date: '2026-09-20' }),
      item({ id: 'num-early', project_number: '2701', interview_date: '2026-10-20', announce_date: '2026-09-10' }),
    ]
    expect(sortForAssignment(items).map(x => x.project.id)).toEqual(['num-early', 'num-late', 'ann-late', 'end-late'])
  })

  it('공사번호는 숫자 인식 비교, 번호 없는 사업은 뒤, 그다음 id', () => {
    const items = [
      item({ id: 'z', project_number: '' }),
      item({ id: 'y', project_number: '1000' }),
      item({ id: 'x', project_number: '999' }),
      item({ id: 'w', project_number: '' }),
    ]
    expect(sortForAssignment(items).map(x => x.project.id)).toEqual(['x', 'y', 'w', 'z'])
  })

  it('제출일 없는 사업은 제출일 있는 사업보다 뒤 (누락값이 앞서지 않음)', () => {
    const items = [
      item({ id: 'no-submit', submit_date: null, interview_date: '2026-10-05' }),
      item({ id: 'late-submit', submit_date: '2026-10-25', interview_date: '2026-10-28' }),
    ]
    expect(sortForAssignment(items).map(x => x.project.id)).toEqual(['late-submit', 'no-submit'])
  })

  it('eligible이 아닌 사업(ineligible·needs_review·blocked)은 제외', () => {
    const items = [
      item({ id: 'ok' }),
      item({ id: 'lost', status: '탈락' }),
      item({ id: 'review', interview_date: null, bid_date: '2026-10-01' }),
      item({ id: 'blocked', announce_date: null }),
      item({ id: 'passed', interview_date: null, bid_date: null, submit_date: '2026-10-01' }),
    ]
    expect(sortForAssignment(items).map(x => x.project.id)).toEqual(['ok'])
  })

  it('입력 순서와 무관하게 같은 결과, 원본 배열은 바꾸지 않는다', () => {
    const items = [
      item({ id: 'a', submit_date: '2026-10-05' }),
      item({ id: 'b', submit_date: '2026-10-05' }),
      item({ id: 'c', submit_date: '2026-10-04' }),
    ]
    const before = items.map(x => x.project.id)
    const r1 = sortForAssignment(items).map(x => x.project.id)
    const r2 = sortForAssignment([...items].reverse()).map(x => x.project.id)
    expect(r1).toEqual(['c', 'a', 'b'])
    expect(r2).toEqual(r1)
    expect(items.map(x => x.project.id)).toEqual(before)
  })
})
