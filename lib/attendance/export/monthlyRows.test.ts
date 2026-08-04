import { describe, it, expect } from 'vitest'
import { getPayPeriodForLabel } from '../period'
import type { AttendanceRecord, ProjectChangeHistory, ProjectParticipant } from '../types'
import { buildMonthlyExportBlocks, totalPresentCount, type MonthlyExportProject } from './monthlyRows'

// 2026년 8월분 = 2026-07-21 ~ 2026-08-20
const DAYS = getPayPeriodForLabel(2026, 8)
const PERIOD_START = '2026-07-21'
const PERIOD_END = '2026-08-20'

const PROJECT: MonthlyExportProject = {
  id: 'p1',
  project_number: '2647',
  name: '테스트 감리용역',
  announce_date: '2026-07-01',
  interview_date: '2026-08-31',
}

function participant(over: Partial<ProjectParticipant> & { id: string }): ProjectParticipant {
  return {
    project_id: 'p1',
    engineer_id: 'e1',
    role: '기술인',
    specialty_id: 's1',
    is_director: false,
    participation_start: null,
    participation_end: null,
    status: '진행중',
    sort_order: 0,
    created_at: '', updated_at: '',
    ...over,
  }
}

function record(participantId: string, workDate: string): AttendanceRecord {
  return {
    id: `r-${participantId}-${workDate}`,
    project_id: 'p1',
    engineer_id: 'e1',
    participant_id: participantId,
    work_date: workDate,
    status: 'present',
    created_by: '', updated_by: '', created_at: '', updated_at: '', note: '',
  }
}

const ENGINEERS = new Map([['e1', '홍길동'], ['e2', '김철수']])
const SPECIALTIES = new Map([['s1', '건축'], ['s2', '토목']])

function build(over: Partial<Parameters<typeof buildMonthlyExportBlocks>[0]> = {}) {
  return buildMonthlyExportBlocks({
    days: DAYS,
    projects: [PROJECT],
    participantsOf: () => [participant({ id: 'pt1' })],
    engineerNameById: ENGINEERS,
    specialtyNameById: SPECIALTIES,
    records: [],
    changeHistory: [],
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    ...over,
  })
}

describe('buildMonthlyExportBlocks — 출근일', () => {
  it('기간 안의 출근만 세고 날짜를 그대로 담는다', () => {
    const blocks = build({
      records: [record('pt1', '2026-07-25'), record('pt1', '2026-08-03')],
    })
    expect(blocks[0].participants[0].presentDates).toEqual(['2026-07-25', '2026-08-03'])
    expect(blocks[0].participants[0].presentCount).toBe(2)
  })

  it('기간 밖 날짜가 records에 섞여 들어와도 합계에 들어가지 않는다', () => {
    const blocks = build({
      records: [record('pt1', '2026-07-25'), record('pt1', '2026-09-01')],
    })
    expect(blocks[0].participants[0].presentCount).toBe(1)
  })

  it('다른 참여자의 기록은 섞이지 않는다', () => {
    const blocks = build({ records: [record('pt2', '2026-07-25')] })
    expect(blocks[0].participants[0].presentCount).toBe(0)
  })
})

describe('buildMonthlyExportBlocks — 체크 가능 기간', () => {
  it('참여 시작 전 날짜는 eligible에 들어가지 않는다', () => {
    const blocks = build({
      participantsOf: () => [participant({ id: 'pt1', participation_start: '2026-08-01' })],
    })
    const eligible = blocks[0].participants[0].eligibleDates
    expect(eligible).not.toContain('2026-07-25')
    expect(eligible).toContain('2026-08-05')
  })

  it('공고일 이전 날짜도 제외된다', () => {
    const blocks = build({
      projects: [{ ...PROJECT, announce_date: '2026-08-10' }],
    })
    const eligible = blocks[0].participants[0].eligibleDates
    expect(eligible).not.toContain('2026-08-01')
    expect(eligible).toContain('2026-08-15')
  })
})

describe('buildMonthlyExportBlocks — 직책 표기', () => {
  it('단장은 role을 그대로 쓴다', () => {
    const blocks = build({
      participantsOf: () => [participant({ id: 'pt1', role: '단장', is_director: true })],
    })
    expect(blocks[0].participants[0].role).toBe('단장')
    expect(blocks[0].participants[0].isDirector).toBe(true)
  })

  it('단장이 아니면 분야명을 직책 칸에 쓴다(화면과 같은 규칙)', () => {
    const blocks = build({
      participantsOf: () => [participant({ id: 'pt1', role: '기술인', specialty_id: 's2' })],
    })
    expect(blocks[0].participants[0].role).toBe('토목')
  })

  it('분야가 없으면 role로 되돌린다', () => {
    const blocks = build({
      participantsOf: () => [participant({ id: 'pt1', role: '기술인', specialty_id: null })],
    })
    expect(blocks[0].participants[0].role).toBe('기술인')
  })
})

describe('buildMonthlyExportBlocks — 비고', () => {
  const history = (over: Partial<ProjectChangeHistory>): ProjectChangeHistory => ({
    id: 'h1', project_id: 'p1', change_type: 'cancelled', change_date: '2026-08-02',
    before_value: null, after_value: null, memo: '', created_by: '', created_at: '',
    ...over,
  })

  it('기간 안의 변경이력을 줄바꿈으로 잇는다', () => {
    const blocks = build({
      changeHistory: [
        history({ id: 'h2', change_date: '2026-08-05', change_type: 'reannounced' }),
        history({ id: 'h1', change_date: '2026-08-02', change_type: 'cancelled' }),
      ],
    })
    expect(blocks[0].note).toBe('08.02 공고 취소\n08.05 재공고')
  })

  it('기간 밖 이력과 다른 프로젝트 이력은 넣지 않는다', () => {
    const blocks = build({
      changeHistory: [
        history({ id: 'h3', change_date: '2026-09-10' }),
        history({ id: 'h4', project_id: 'other' }),
      ],
    })
    expect(blocks[0].note).toBe('')
  })
})

describe('buildMonthlyExportBlocks — 블록 구성', () => {
  it('참여기술인이 없는 프로젝트도 블록으로 남긴다', () => {
    const blocks = build({ participantsOf: () => [] })
    expect(blocks).toHaveLength(1)
    expect(blocks[0].participants).toEqual([])
    expect(blocks[0].projectNumber).toBe('2647')
  })
})

describe('totalPresentCount', () => {
  it('모든 프로젝트·참여자의 출근일을 합친다', () => {
    const blocks = build({
      participantsOf: () => [participant({ id: 'pt1' }), participant({ id: 'pt2', engineer_id: 'e2' })],
      records: [record('pt1', '2026-07-25'), record('pt1', '2026-07-26'), record('pt2', '2026-08-03')],
    })
    expect(totalPresentCount(blocks)).toBe(3)
  })
  it('비어 있으면 0', () => {
    expect(totalPresentCount([])).toBe(0)
  })
})
