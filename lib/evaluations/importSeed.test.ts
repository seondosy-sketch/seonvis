import { describe, expect, it } from 'vitest'
import type { InterviewEngineerRef, InterviewProjectRef } from '@/app/(dashboard)/interviews/types'
import type { ImportedReviewDraft } from './hwpImport'
import {
  buildReviewFormSeed,
  matchEngineer,
  matchEvaluationType,
  matchEvaluationTypeFromTitle,
  matchProject,
  type ImportMasters,
} from './importSeed'
import type { EvaluationQuestionCategory, EvaluationRole, EvaluationType } from './types'

function evaluationType(id: string, code: string, name: string): EvaluationType {
  return { id, code, name, sort_order: 0, is_active: true, created_at: '' }
}

function role(id: string, name: string, is_primary = true): EvaluationRole {
  return { id, name, sort_order: 0, is_primary, is_active: true, created_at: '' }
}

function category(id: string, code: string, name: string): EvaluationQuestionCategory {
  return { id, code, name, sort_order: 0, is_active: true, created_at: '' }
}

function project(id: string, name: string, client: string, status = '진행'): InterviewProjectRef {
  return { id, project_number: id, name, client, interview_date: null, status }
}

function engineer(id: string, name: string): InterviewEngineerRef {
  return { id, name, rank: '', company: '' }
}

const MASTERS: ImportMasters = {
  evaluationTypes: [evaluationType('t-interview', 'interview', '면접'), evaluationType('t-tp', 'tp', 'TP')],
  roles: [role('r-lead', '책임'), role('r-safety', '안전'), role('r-none', '미지정', false)],
  categories: [category('c-none', 'unspecified', '미지정'), category('c-quality', 'quality', '품질')],
  projects: [
    project('p-1', '청주시 복합문화센터 건립공사 건설사업관리', '충청북도 청주시'),
    project('p-2', '청주시 복합문화센터 조경공사', '충청북도 청주시'),
    project('p-3', '취소된 사업', '충청북도 청주시', '취소'),
  ],
  engineers: [engineer('e-1', '홍길동'), engineer('e-2', '김철수'), engineer('e-3', '김철수')],
}

function draftOf(patch: Partial<ImportedReviewDraft> = {}): ImportedReviewDraft {
  return {
    document_title: '청주시 복합문화센터 면접후기',
    evaluation_type_source: '면접',
    client: '충청북도 청주시',
    project_name: '청주시 복합문화센터 건립공사 건설사업관리',
    facility_type: '문화 및 집회시설',
    evaluation_date: '2026-08-19',
    evaluation_year: null,
    evaluation_time: '13:30~',
    location: '청주시청 3층 회의실',
    evaluator_count: 5,
    participant_company_count: 7,
    presentation_order: 1,
    participant_companies: 'A사, B사',
    evaluation_method: 'PT 발표 후 질의응답',
    special_notes: '',
    attendees: [{ name: '홍길동', role: '단장' }],
    groups: [{ role_name: '책임', questions: ['품질관리 계획은?'] }],
    unmatched_labels: [],
    ...patch,
  }
}

describe('matchEvaluationType', () => {
  it('공백만 다른 표기를 흡수한다', () => {
    expect(matchEvaluationType('T P', MASTERS.evaluationTypes)?.id).toBe('t-tp')
  })

  it('모르는 원문은 잇지 않는다', () => {
    expect(matchEvaluationType('기술자평가서/PPT', MASTERS.evaluationTypes)).toBeNull()
  })
})

describe('matchEvaluationTypeFromTitle', () => {
  it('제목에 든 유형 이름을 읽는다(평가유형 칸이 없는 실제 문서용)', () => {
    expect(matchEvaluationTypeFromTitle('345kV ○○변전소 면접후기', MASTERS.evaluationTypes)?.id)
      .toBe('t-interview')
  })

  it('제목에 유형 이름이 없으면 아무것도 고르지 않는다', () => {
    expect(matchEvaluationTypeFromTitle('345kV ○○변전소 평가 결과 정리', MASTERS.evaluationTypes))
      .toBeNull()
  })

  it("'기타'·'미지정'은 제목에서 찾지 않는다", () => {
    const types = [...MASTERS.evaluationTypes, evaluationType('t-etc', 'etc', '기타')]
    expect(matchEvaluationTypeFromTitle('기타 사업 후기', types)).toBeNull()
  })
})

describe('matchProject', () => {
  it('용역명이 정확히 일치하면 잇는다', () => {
    expect(matchProject('청주시 복합문화센터 건립공사 건설사업관리', '충청북도 청주시', MASTERS.projects)?.id)
      .toBe('p-1')
  })

  it('후보가 둘 이상이고 발주처로도 못 좁히면 잇지 않는다', () => {
    // '청주시 복합문화센터'는 p-1·p-2 둘 다에 포함되고 발주처도 같다 — 사람이 고르게 둔다.
    expect(matchProject('청주시 복합문화센터', '충청북도 청주시', MASTERS.projects)).toBeNull()
  })

  it('취소된 프로젝트에는 잇지 않는다', () => {
    expect(matchProject('취소된 사업', '충청북도 청주시', MASTERS.projects)).toBeNull()
  })

  it('용역명이 너무 짧으면 잇지 않는다', () => {
    expect(matchProject('청주', '', MASTERS.projects)).toBeNull()
  })
})

describe('matchEngineer', () => {
  it('이름이 하나면 잇는다', () => {
    expect(matchEngineer('홍길동', MASTERS.engineers)?.id).toBe('e-1')
  })

  it('같은 이름이 둘 이상이면 잇지 않는다(누구인지 알 수 없다)', () => {
    expect(matchEngineer('김철수', MASTERS.engineers)).toBeNull()
  })

  it('문서에 붙은 직급을 떼고 찾는다', () => {
    expect(matchEngineer('홍길동 상무', MASTERS.engineers)?.id).toBe('e-1')
    expect(matchEngineer('홍길동 차장', MASTERS.engineers)?.id).toBe('e-1')
  })

  it('직급을 떼도 동명이인이면 잇지 않는다', () => {
    expect(matchEngineer('김철수 차장', MASTERS.engineers)).toBeNull()
  })
})

describe('buildReviewFormSeed', () => {
  it('초안을 신규 등록용 폼 초기값으로 만든다', () => {
    const { seed, matchedProject } = buildReviewFormSeed(draftOf(), MASTERS)

    expect(seed.id).toBeNull()  // 저장 시 신규 등록
    expect(matchedProject?.id).toBe('p-1')
    expect(seed.project_id).toBe('p-1')
    expect(seed.evaluation_type_id).toBe('t-interview')
    // 표준 유형으로 이었으면 legacy 원문 칸은 비운다.
    expect(seed.evaluation_type_source).toBe('')
    expect(seed.client_snapshot).toBe('충청북도 청주시')
    expect(seed.facility_type).toBe('문화 및 집회시설')
    expect(seed.evaluation_date).toBe('2026-08-19')
    expect(seed.evaluation_year).toBeNull()
    expect(seed.evaluator_count).toBe(5)
    expect(seed.participant_companies).toBe('A사, B사')
  })

  it('참석자를 주소록에 잇고, 못 이은 사람은 이름만 남기고 알린다', () => {
    const { seed, notes } = buildReviewFormSeed(
      draftOf({ attendees: [{ name: '홍길동', role: '단장' }, { name: '김철수', role: '안전' }] }),
      MASTERS,
    )
    expect(seed.attendees.map(a => a.engineer_contact_id)).toEqual(['e-1', null])
    expect(seed.attendees[1].attendee_name_snapshot).toBe('김철수')
    expect(notes.some(n => n.includes('김철수'))).toBe(true)
  })

  it('질문에 질의그룹을 잇고 질의분류는 미지정으로 시작한다', () => {
    const { seed } = buildReviewFormSeed(draftOf({
      groups: [
        { role_name: '책임', questions: ['품질관리 계획은?'] },
        { role_name: '안전', questions: ['위험성평가 절차는?'] },
      ],
    }), MASTERS)

    expect(seed.questions.map(q => [q.role_id, q.category_id, q.group_order, q.question_order])).toEqual([
      ['r-lead', 'c-none', 0, 0],
      ['r-safety', 'c-none', 1, 0],
    ])
  })

  it('같은 그룹으로 해석된 그룹은 하나로 합친다(폼이 중복 그룹 저장을 막기 때문)', () => {
    const { seed } = buildReviewFormSeed(draftOf({
      groups: [
        { role_name: '책임', questions: ['질문 1'] },
        { role_name: '책임', questions: ['질문 2'] },
      ],
    }), MASTERS)

    expect(seed.questions.map(q => q.group_order)).toEqual([0, 0])
    expect(seed.questions.map(q => q.question_text)).toEqual(['질문 1', '질문 2'])
  })

  it('그룹을 못 정한 질문은 미지정 그룹에 담고 알린다', () => {
    const { seed, notes } = buildReviewFormSeed(draftOf({
      groups: [{ role_name: null, questions: ['이건 누구 질문인지 모른다'] }],
    }), MASTERS)

    expect(seed.questions[0].role_id).toBe('r-none')
    expect(notes.some(n => n.includes('미지정'))).toBe(true)
  })

  it('표준 유형에 없는 평가유형 원문은 보존하고 사람에게 고르라고 알린다', () => {
    const { seed, notes } = buildReviewFormSeed(
      draftOf({ evaluation_type_source: '기술자평가서/PPT' }),
      MASTERS,
    )
    expect(seed.evaluation_type_id).toBeNull()
    expect(seed.evaluation_type_source).toBe('기술자평가서/PPT')
    expect(notes.some(n => n.includes('기술자평가서/PPT'))).toBe(true)
  })

  it('평가유형 칸이 없으면 제목에서 읽고 그 사실을 알린다(실제 후기 문서)', () => {
    const { seed, notes } = buildReviewFormSeed(
      draftOf({ evaluation_type_source: '', document_title: '345kV ○○변전소 면접후기' }),
      MASTERS,
    )
    expect(seed.evaluation_type_id).toBe('t-interview')
    expect(seed.evaluation_type_source).toBe('')
    expect(notes.some(n => n.includes('제목에서'))).toBe(true)
  })

  it('시설용도가 비어 있으면 직접 입력하라고 알린다(문서에 칸이 없다)', () => {
    const { notes } = buildReviewFormSeed(draftOf({ facility_type: '' }), MASTERS)
    expect(notes.some(n => n.includes('시설용도'))).toBe(true)
  })

  it('연도만 아는 자료는 연도로 남긴다', () => {
    const { seed } = buildReviewFormSeed(
      draftOf({ evaluation_date: null, evaluation_year: 2015 }),
      MASTERS,
    )
    expect(seed.evaluation_date).toBeNull()
    expect(seed.evaluation_year).toBe(2015)
    expect(seed.evaluation_year_effective).toBe(2015)
  })

  it('발주처가 비어 있으면 이어진 프로젝트에서 가져온다', () => {
    const { seed } = buildReviewFormSeed(draftOf({ client: '' }), MASTERS)
    expect(seed.client_snapshot).toBe('충청북도 청주시')
  })

  it('읽지 못한 라벨과 빈 질의를 알린다', () => {
    const { notes } = buildReviewFormSeed(
      draftOf({ groups: [], unmatched_labels: ['입회자'] }),
      MASTERS,
    )
    expect(notes.some(n => n.includes('실제질의'))).toBe(true)
    expect(notes.some(n => n.includes('입회자'))).toBe(true)
  })
})
