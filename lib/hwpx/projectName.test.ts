import { describe, it, expect } from 'vitest'
import { formatProjectNameForReport } from './projectName'

describe('formatProjectNameForReport', () => {
  it('1) 제거 대상 문구가 없는 일반 프로젝트명은 그대로 유지한다', () => {
    expect(formatProjectNameForReport('345kV ○○변전소')).toBe('345kV ○○변전소')
  })

  it('2) 건설사업관리용역만 있는 경우 해당 문구만 제거한다', () => {
    expect(formatProjectNameForReport('○○센터 신축공사 건설사업관리용역')).toBe('○○센터')
  })

  it('3) 여러 제거 문구가 연속으로 있는 경우 전부 제거한다', () => {
    expect(
      formatProjectNameForReport('○○청사 건립공사 감독권한대행 등 건설사업관리용역')
    ).toBe('○○청사')
  })

  it('4) 하이픈·밑줄·괄호를 동반한 경우 구분 문자까지 정리한다', () => {
    expect(formatProjectNameForReport('○○센터 - 건설사업관리용역')).toBe('○○센터')
    expect(formatProjectNameForReport('○○센터_신축공사')).toBe('○○센터')
    expect(formatProjectNameForReport('○○센터(신축공사)')).toBe('○○센터')
  })

  it('5) 띄어쓰기 변형(건설 사업관리용역 / 건설사업관리 용역)을 처리한다', () => {
    expect(formatProjectNameForReport('○○센터 건설 사업관리용역')).toBe('○○센터')
    expect(formatProjectNameForReport('○○센터 건설사업관리 용역')).toBe('○○센터')
  })

  it('6) 감독권한대행등 표기 변형을 모두 처리한다', () => {
    expect(formatProjectNameForReport('○○센터 감독권한대행등 건설사업관리용역')).toBe('○○센터')
    expect(formatProjectNameForReport('○○센터 감독 권한대행 등 건설사업관리용역')).toBe('○○센터')
    expect(formatProjectNameForReport('○○센터 감독권한 대행 등 건설사업관리용역')).toBe('○○센터')
  })

  it('7) 식별번호와 의미 있는 괄호는 유지한다', () => {
    expect(
      formatProjectNameForReport('26-U-왜관 캠프캐롤 전술장비정비시설(E008) 신축공사')
    ).toBe('26-U-왜관 캠프캐롤 전술장비정비시설(E008)')
    expect(
      formatProjectNameForReport('화성동탄(1) M1-1-2블럭 건설사업관리용역')
    ).toBe('화성동탄(1) M1-1-2블럭')
    expect(
      formatProjectNameForReport('345kV ○○변전소 토건공사 건설사업관리용역')
    ).toBe('345kV ○○변전소')
  })

  it('8) 제거 후 빈 문자열이 되면 원본 그대로를 반환한다(fallback)', () => {
    expect(formatProjectNameForReport('건설사업관리용역')).toBe('건설사업관리용역')
    expect(formatProjectNameForReport('신축공사 건설사업관리용역')).toBe('신축공사 건설사업관리용역')
  })

  it('9) 원본 문자열/객체를 변경하지 않는다(순수 함수)', () => {
    const project = { name: '○○센터 신축공사 건설사업관리용역' }
    const formatted = formatProjectNameForReport(project.name)
    expect(formatted).toBe('○○센터')
    expect(project.name).toBe('○○센터 신축공사 건설사업관리용역') // 원본 불변
  })

  it('과도한 제거 방지 — 지정 문구가 더 큰 단어의 일부일 때는 건드리지 않는다', () => {
    expect(formatProjectNameForReport('공사중단 건축물 정비사업')).toBe('공사중단 건축물 정비사업')
    expect(formatProjectNameForReport('용역동 주민센터')).toBe('용역동 주민센터')
    expect(formatProjectNameForReport('사업관리시스템 구축')).toBe('사업관리시스템 구축')
    expect(formatProjectNameForReport('신축공사비 검증센터')).toBe('신축공사비 검증센터')
  })

  it('실제 기준 문서(CM본부주간업무/월업무계획 7.24자)의 프로젝트명이 손상 없이 유지된다', () => {
    // 월간 문서 원본은 "연번_이름[_상태]" 형태를 쓴다 — 연번과 재공고 표시 모두 보존돼야 한다.
    expect(formatProjectNameForReport('2648_26-A-00부대(A143)_재공고')).toBe('2648_26-A-00부대(A143)_재공고')
    expect(formatProjectNameForReport('2654_26-U-왜관 캠프캐롤 정비시설(E008)')).toBe('2654_26-U-왜관 캠프캐롤 정비시설(E008)')
    expect(formatProjectNameForReport('2655_화성동탄(1) M1-1-2블럭')).toBe('2655_화성동탄(1) M1-1-2블럭')
    expect(formatProjectNameForReport('345kV 신석문변전소')).toBe('345kV 신석문변전소')
  })

  it('빈 문자열/빈 값은 그대로 반환한다', () => {
    expect(formatProjectNameForReport('')).toBe('')
  })

  it('대소문자 영문과 숫자는 변경하지 않는다', () => {
    expect(formatProjectNameForReport('ABC Tower 신축공사 건설사업관리용역')).toBe('ABC Tower')
  })
})
