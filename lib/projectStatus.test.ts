import { describe, it, expect } from 'vitest'
import {
  type ProjectRef,
  categorizeProject,
  isWrittenEvaluation,
} from './projectStatus'

// 주간보고 분류(개찰/진행중/제외)는 "이번 주 월요일"을 기준으로 한다.
const WEEK_START = new Date(2026, 6, 27) // 2026-07-27 (월)

function ref(over: Partial<ProjectRef> = {}): ProjectRef {
  return {
    name: '테스트 용역', director: '', client: '', fee: null,
    submit_date: null, interview_date: null, bid_date: null,
    result_score: '', evaluation: '', participants: '', status_override: null,
    staff_arch: '', staff_civil: '', staff_mech: '', staff_safety: '',
    ...over,
  }
}

describe('isWrittenEvaluation', () => {
  it('interview_written이 true면 서면평가', () => {
    expect(isWrittenEvaluation({ interview_written: true })).toBe(true)
  })
  it('발표일 칸에 글자로 적어둔 옛 표기도 받아준다(수동 추가 행 경로)', () => {
    expect(isWrittenEvaluation({ interview_date: '서면' })).toBe(true)
    expect(isWrittenEvaluation({ interview_date: '서면평가' })).toBe(true)
  })
  it('날짜·공란은 서면평가가 아니다', () => {
    expect(isWrittenEvaluation({ interview_date: '2026-08-10' })).toBe(false)
    expect(isWrittenEvaluation({ interview_date: null })).toBe(false)
    expect(isWrittenEvaluation({})).toBe(false)
  })
})

describe('categorizeProject — 서면평가', () => {
  it('제출일이 아직 안 지났으면 서면평가여도 진행중', () => {
    const r = ref({ submit_date: '2026-07-31', interview_written: true })
    expect(categorizeProject(r, WEEK_START)).toBe('진행중')
  })

  it('제출일이 지나면 발표일이 없어도 곧장 개찰로 내려간다', () => {
    const r = ref({ submit_date: '2026-07-20', interview_written: true })
    expect(categorizeProject(r, WEEK_START)).toBe('개찰')
  })

  it('서면평가가 아니면 발표일이 비어 있는 동안 진행중에 머문다', () => {
    const r = ref({ submit_date: '2026-07-20' })
    expect(categorizeProject(r, WEEK_START)).toBe('진행중')
  })

  it('서면평가라도 개찰일까지 지났으면 제외', () => {
    const r = ref({ submit_date: '2026-07-20', interview_written: true, bid_date: '2026-07-24' })
    expect(categorizeProject(r, WEEK_START)).toBe('제외')
  })

  it('드랍/취소는 서면평가보다 우선해 제외', () => {
    const r = ref({ submit_date: '2026-07-20', interview_written: true, participants: '3개사(드랍)' })
    expect(categorizeProject(r, WEEK_START)).toBe('제외')
  })
})

describe('categorizeProject — 날짜 기반 기존 규칙', () => {
  it('제출일이 지나고 발표일이 이번 주 이후면 진행중', () => {
    const r = ref({ submit_date: '2026-07-20', interview_date: '2026-08-05' })
    expect(categorizeProject(r, WEEK_START)).toBe('진행중')
  })
  it('제출일·발표일이 모두 지났고 개찰일이 남아 있으면 개찰', () => {
    const r = ref({ submit_date: '2026-07-13', interview_date: '2026-07-20', bid_date: '2026-08-03' })
    expect(categorizeProject(r, WEEK_START)).toBe('개찰')
  })
})
