import { describe, it, expect } from 'vitest'
import {
  normalizeHeaderText,
  matchesHeaderFingerprint,
  MONTHLY_PROJECT_HEADER_FINGERPRINT,
  MONTHLY_CALENDAR_HEADER_FINGERPRINT,
} from './monthlyHeaderFingerprint'

describe('normalizeHeaderText', () => {
  it('연속 공백을 1칸으로 축소한다(제거하지 않음) — 실측된 "용     역     명" 사례', () => {
    expect(normalizeHeaderText('용     역     명')).toBe('용 역 명')
  })

  it('NBSP를 일반 공백으로 바꾼다', () => {
    expect(normalizeHeaderText('용 역 명')).toBe('용 역 명')
  })

  it('줄바꿈과 탭을 공백으로 바꾼 뒤 연속 공백을 축소한다', () => {
    expect(normalizeHeaderText('용\n역\t명')).toBe('용 역 명')
  })

  it('앞뒤 공백을 제거한다', () => {
    expect(normalizeHeaderText('  발주처  ')).toBe('발주처')
  })

  it('대소문자는 바꾸지 않는다', () => {
    expect(normalizeHeaderText('ABC')).toBe('ABC')
  })

  it('괄호와 한글은 그대로 유지한다', () => {
    expect(normalizeHeaderText('금액(억원)')).toBe('금액(억원)')
    expect(normalizeHeaderText('개찰일(낙찰자)')).toBe('개찰일(낙찰자)')
  })
})

describe('matchesHeaderFingerprint', () => {
  it('실측된 프로젝트 표 원본 헤더 12칸과 정확히 일치한다', () => {
    const raw = [
      '용     역     명', '발주처', '단장', '금액(억원)', '기간(개월)', '쪽수',
      '과업설명도서열람', '현장조사', '제출일', '발표/면접', '개찰일(낙찰자)', '비고',
    ]
    expect(matchesHeaderFingerprint(raw, MONTHLY_PROJECT_HEADER_FINGERPRINT)).toBe(true)
  })

  it('달력 표 원본 헤더 7칸과 정확히 일치한다', () => {
    expect(matchesHeaderFingerprint(['일', '월', '화', '수', '목', '금', '토'], MONTHLY_CALENDAR_HEADER_FINGERPRINT)).toBe(true)
  })

  it('헤더 1개가 바뀌면 불일치한다', () => {
    const raw = [
      '용     역     명', '발주처(변경)', '단장', '금액(억원)', '기간(개월)', '쪽수',
      '과업설명도서열람', '현장조사', '제출일', '발표/면접', '개찰일(낙찰자)', '비고',
    ]
    expect(matchesHeaderFingerprint(raw, MONTHLY_PROJECT_HEADER_FINGERPRINT)).toBe(false)
  })

  it('헤더 순서가 바뀌면 불일치한다', () => {
    const raw = [
      '발주처', '용     역     명', '단장', '금액(억원)', '기간(개월)', '쪽수',
      '과업설명도서열람', '현장조사', '제출일', '발표/면접', '개찰일(낙찰자)', '비고',
    ]
    expect(matchesHeaderFingerprint(raw, MONTHLY_PROJECT_HEADER_FINGERPRINT)).toBe(false)
  })

  it('줄바꿈·NBSP·연속 공백만 다른 헤더는 정규화 후 정상 일치한다', () => {
    const raw = [
      '용\n역 명', '발주처', '단장', '금액(억원)', '기간(개월)', '쪽수',
      '과업설명도서열람', '현장조사', '제출일', '발표/면접', '개찰일(낙찰자)', '비고',
    ]
    expect(matchesHeaderFingerprint(raw, MONTHLY_PROJECT_HEADER_FINGERPRINT)).toBe(true)
  })

  it('칸 수가 다르면 불일치한다', () => {
    expect(matchesHeaderFingerprint(['용 역 명', '발주처'], MONTHLY_PROJECT_HEADER_FINGERPRINT)).toBe(false)
  })
})
