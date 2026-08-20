import { describe, expect, it } from 'vitest'
import {
  availableGroupOptions,
  countValidQuestions,
  groupLabel,
  groupOptionsForSelect,
  groupQuestions,
  hasDuplicateGroups,
  newQuestionDraft,
  newQuestionGroup,
  nextAvailableGroup,
  questionTagLabel,
  toQuestionGroupDrafts,
  toQuestionPayloads,
  type QuestionGroupDraft,
} from './questionGroups'
import type { EvaluationQuestion, EvaluationRole } from './types'

/** 실제 seed와 같은 모양 — 신규 UI 6종(is_primary) + legacy 4종. */
const ROLES: EvaluationRole[] = [
  { id: 'r-lead', name: '책임', sort_order: 10, is_primary: true, is_active: true, created_at: '' },
  { id: 'r-arch', name: '건축', sort_order: 20, is_primary: true, is_active: true, created_at: '' },
  { id: 'r-safe', name: '안전', sort_order: 30, is_primary: true, is_active: true, created_at: '' },
  { id: 'r-civil', name: '토목', sort_order: 40, is_primary: true, is_active: true, created_at: '' },
  { id: 'r-mech', name: '기계', sort_order: 50, is_primary: true, is_active: true, created_at: '' },
  { id: 'r-elec', name: '전기', sort_order: 60, is_primary: true, is_active: true, created_at: '' },
  { id: 'r-common', name: '공통', sort_order: 900, is_primary: false, is_active: true, created_at: '' },
  { id: 'r-other-co', name: '타사', sort_order: 910, is_primary: false, is_active: true, created_at: '' },
  { id: 'r-unspec', name: '미지정', sort_order: 999, is_primary: false, is_active: true, created_at: '' },
]

function makeQuestion(overrides: Partial<EvaluationQuestion> = {}): EvaluationQuestion {
  return {
    id: 'q-1',
    review_id: 'rev-1',
    question_text: '작업계획서 대상과 포함되어야 할 내용은?',
    role_id: 'r-safe',
    category_id: 'c-safety',
    specialty_id: null,
    group_order: 0,
    question_order: 0,
    created_at: '2026-08-19T00:00:00Z',
    updated_at: '2026-08-19T00:00:00Z',
    ...overrides,
  }
}

function draft(roleId: string | null, texts: Array<[string, string | null]>): QuestionGroupDraft {
  const g = newQuestionGroup(roleId)
  g.questions = texts.map(([text, category_id]) => ({ ...newQuestionDraft(category_id), text }))
  return g
}

describe('toQuestionPayloads — 질의그룹 + 질의분류 저장', () => {
  it('질문 1개 = 페이로드 1건이고 그룹/분류가 함께 저장된다', () => {
    const groups = [draft('r-lead', [
      ['시공계획서 작성 시 포함되어야 할 사항은?', 'c-pm'],
      ['공정 지연 발생 시 관리방안을 말씀하세요.', 'c-schedule'],
    ])]

    expect(toQuestionPayloads(groups)).toEqual([
      { question_text: '시공계획서 작성 시 포함되어야 할 사항은?', role_id: 'r-lead', category_id: 'c-pm', group_order: 0, question_order: 0 },
      { question_text: '공정 지연 발생 시 관리방안을 말씀하세요.', role_id: 'r-lead', category_id: 'c-schedule', group_order: 0, question_order: 1 },
    ])
  })

  it('같은 그룹 안에서 질문마다 분류가 다를 수 있다', () => {
    const payloads = toQuestionPayloads([draft('r-lead', [['A', 'c-pm'], ['B', 'c-quality']])])
    expect(payloads.map(p => p.category_id)).toEqual(['c-pm', 'c-quality'])
  })

  it('그룹이 여러 개면 group_order가 화면 순서대로 매겨진다', () => {
    const groups = [
      draft('r-lead', [['책임 질문', 'c-pm']]),
      draft('r-arch', [['건축 질문', 'c-quality']]),
      draft('r-safe', [['안전 질문', 'c-safety']]),
    ]
    expect(toQuestionPayloads(groups).map(p => [p.role_id, p.group_order])).toEqual([
      ['r-lead', 0], ['r-arch', 1], ['r-safe', 2],
    ])
  })

  it('빈 질문칸은 저장하지 않는다', () => {
    const payloads = toQuestionPayloads([draft('r-lead', [['실제 질문', 'c-pm'], ['   ', 'c-pm'], ['', null]])])
    expect(payloads).toHaveLength(1)
    expect(payloads[0].question_text).toBe('실제 질문')
  })

  it('질문 앞뒤 공백은 정리한다', () => {
    expect(toQuestionPayloads([draft('r-lead', [['  공정관리 방안은?  ', 'c-schedule']])])[0].question_text)
      .toBe('공정관리 방안은?')
  })

  it('질문이 하나도 없는 그룹은 사라지고 group_order에 구멍이 생기지 않는다', () => {
    const groups = [
      draft('r-lead', [['질문 A', 'c-pm']]),
      draft('r-arch', [['', null], ['  ', null]]),
      draft('r-safe', [['질문 B', 'c-safety']]),
    ]
    expect(toQuestionPayloads(groups).map(p => [p.role_id, p.group_order])).toEqual([['r-lead', 0], ['r-safe', 1]])
  })

  it('분류를 안 고른 질문도 저장된다(잘못된 분류를 강제하지 않는다)', () => {
    expect(toQuestionPayloads([draft('r-lead', [['분류 미선택 질문', null]])])[0].category_id).toBeNull()
  })

  it('legacy 그룹(타사/미지정)도 그대로 저장된다', () => {
    const payloads = toQuestionPayloads([
      draft('r-other-co', [['타사에게 나간 질문', null]]),
      draft('r-unspec', [['머리말 없는 과거 질문', null]]),
    ])
    expect(payloads.map(p => p.role_id)).toEqual(['r-other-co', 'r-unspec'])
  })

  it('countValidQuestions는 실제 저장될 질문 수를 센다', () => {
    expect(countValidQuestions([draft('r-lead', [['1', null], ['2', null]]), draft('r-arch', [['3', null], ['', null]])])).toBe(3)
    expect(countValidQuestions([draft('r-lead', [['', null]])])).toBe(0)
  })
})

describe('groupQuestions / toQuestionGroupDrafts — 수정 왕복', () => {
  it('group_order·question_order 순으로 묶는다', () => {
    const questions = [
      makeQuestion({ id: 'q3', group_order: 1, question_order: 0, role_id: 'r-safe', question_text: '안전 Q1' }),
      makeQuestion({ id: 'q2', group_order: 0, question_order: 1, role_id: 'r-lead', question_text: '책임 Q2' }),
      makeQuestion({ id: 'q1', group_order: 0, question_order: 0, role_id: 'r-lead', question_text: '책임 Q1' }),
    ]
    const groups = groupQuestions(questions)
    expect(groups).toHaveLength(2)
    expect(groups[0].role_id).toBe('r-lead')
    expect(groups[0].questions.map(q => q.question_text)).toEqual(['책임 Q1', '책임 Q2'])
    expect(groups[1].questions.map(q => q.question_text)).toEqual(['안전 Q1'])
  })

  it('수정 진입 후 그대로 저장하면 그룹·분류·순서가 보존된다', () => {
    const questions = [
      makeQuestion({ id: 'q1', group_order: 0, question_order: 0, question_text: 'A', role_id: 'r-lead', category_id: 'c-pm' }),
      makeQuestion({ id: 'q2', group_order: 0, question_order: 1, question_text: 'B', role_id: 'r-lead', category_id: 'c-schedule' }),
      makeQuestion({ id: 'q3', group_order: 1, question_order: 0, question_text: 'C', role_id: 'r-safe', category_id: 'c-safety' }),
    ]
    expect(toQuestionPayloads(toQuestionGroupDrafts(questions))).toEqual([
      { question_text: 'A', role_id: 'r-lead', category_id: 'c-pm', group_order: 0, question_order: 0 },
      { question_text: 'B', role_id: 'r-lead', category_id: 'c-schedule', group_order: 0, question_order: 1 },
      { question_text: 'C', role_id: 'r-safe', category_id: 'c-safety', group_order: 1, question_order: 0 },
    ])
  })

  it('질문 분류만 바꾸면 그 질문만 바뀐다', () => {
    const drafts = toQuestionGroupDrafts([
      makeQuestion({ id: 'q1', question_order: 0, question_text: 'A', category_id: 'c-pm' }),
      makeQuestion({ id: 'q2', question_order: 1, question_text: 'B', category_id: 'c-pm' }),
    ])
    drafts[0].questions[0].category_id = 'c-quality'
    expect(toQuestionPayloads(drafts).map(p => [p.question_text, p.category_id]))
      .toEqual([['A', 'c-quality'], ['B', 'c-pm']])
  })

  it('질문을 지우면 뒤 질문의 question_order가 당겨진다', () => {
    const drafts = toQuestionGroupDrafts([
      makeQuestion({ id: 'q1', question_order: 0, question_text: 'A' }),
      makeQuestion({ id: 'q2', question_order: 1, question_text: 'B' }),
      makeQuestion({ id: 'q3', question_order: 2, question_text: 'C' }),
    ])
    drafts[0].questions.splice(1, 1)
    expect(toQuestionPayloads(drafts).map(p => [p.question_text, p.question_order])).toEqual([['A', 0], ['C', 1]])
  })

  it('빈 배열이면 빈 결과', () => {
    expect(groupQuestions([])).toEqual([])
    expect(toQuestionGroupDrafts([])).toEqual([])
  })
})

describe('newQuestionGroup / newQuestionDraft', () => {
  it('그룹은 질문칸 1개를 열어두고 분류 기본값을 받는다', () => {
    const g = newQuestionGroup('r-lead', 'c-unspec')
    expect(g.role_id).toBe('r-lead')
    expect(g.questions).toHaveLength(1)
    expect(g.questions[0]).toMatchObject({ text: '', category_id: 'c-unspec' })
  })

  it('key는 매번 달라진다 (React 목록 렌더 안정성)', () => {
    expect(newQuestionGroup().key).not.toBe(newQuestionGroup().key)
    expect(newQuestionDraft().key).not.toBe(newQuestionDraft().key)
  })
})

describe('질의그룹 중복 방지', () => {
  it('availableGroupOptions는 이미 쓴 그룹을 제외한 6종만 준다', () => {
    const used = [draft('r-lead', [['x', null]]), draft('r-safe', [['y', null]])]
    expect(availableGroupOptions(ROLES, used).map(r => r.name)).toEqual(['건축', '토목', '기계', '전기'])
  })

  it('legacy 그룹(공통/타사/미지정)은 신규 입력 후보에 나오지 않는다', () => {
    expect(availableGroupOptions(ROLES, []).map(r => r.name)).toEqual(['책임', '건축', '안전', '토목', '기계', '전기'])
  })

  it('비활성 그룹은 후보에서 빠진다', () => {
    const roles = ROLES.map(r => (r.id === 'r-mech' ? { ...r, is_active: false } : r))
    expect(availableGroupOptions(roles, []).map(r => r.name)).not.toContain('기계')
  })

  it('6종을 다 쓰면 후보가 비고 nextAvailableGroup은 null', () => {
    const used = ['r-lead', 'r-arch', 'r-safe', 'r-civil', 'r-mech', 'r-elec'].map(id => draft(id, [['x', null]]))
    expect(availableGroupOptions(ROLES, used)).toEqual([])
    expect(nextAvailableGroup(ROLES, used)).toBeNull()
  })

  it('nextAvailableGroup은 sort_order가 가장 앞선 미사용 그룹을 준다', () => {
    expect(nextAvailableGroup(ROLES, [])?.name).toBe('책임')
    expect(nextAvailableGroup(ROLES, [draft('r-lead', [['x', null]])])?.name).toBe('건축')
  })

  it('groupOptionsForSelect는 현재 선택값을 유지하면서 미사용 그룹을 보여준다', () => {
    const used = [draft('r-lead', [['x', null]]), draft('r-safe', [['y', null]])]
    expect(groupOptionsForSelect(ROLES, used, 'r-safe').map(r => r.name))
      .toEqual(['건축', '안전', '토목', '기계', '전기'])
  })

  it('legacy 그룹이 현재 선택값이면(과거 기록 수정) 목록에 남는다', () => {
    const used = [draft('r-other-co', [['x', null]])]
    expect(groupOptionsForSelect(ROLES, used, 'r-other-co').map(r => r.name)).toContain('타사')
  })

  it('hasDuplicateGroups는 같은 그룹이 두 번 있으면 true', () => {
    expect(hasDuplicateGroups([draft('r-lead', [['a', null]]), draft('r-lead', [['b', null]])])).toBe(true)
    expect(hasDuplicateGroups([draft('r-lead', [['a', null]]), draft('r-arch', [['b', null]])])).toBe(false)
    // 아직 그룹을 안 고른 줄(null)이 여러 개인 것은 중복이 아니다
    expect(hasDuplicateGroups([draft(null, [['a', null]]), draft(null, [['b', null]])])).toBe(false)
  })
})

describe('표기 helper', () => {
  it('groupLabel은 이름이 없으면 미지정', () => {
    expect(groupLabel('책임')).toBe('책임')
    expect(groupLabel(null)).toBe('미지정')
    expect(groupLabel('  ')).toBe('미지정')
  })

  it('questionTagLabel은 "그룹 · 분류"로 잇는다', () => {
    expect(questionTagLabel('책임', '공정')).toBe('책임 · 공정')
    expect(questionTagLabel('안전', null)).toBe('안전')
    expect(questionTagLabel(null, '품질')).toBe('품질')
    expect(questionTagLabel(null, null)).toBe('미지정')
  })
})
