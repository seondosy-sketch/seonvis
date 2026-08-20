/**
 * 평가 DB — 질의그룹/질의분류 순수 로직.
 *
 * 실제 면접후기는 질문을 "누구에게 나온 질문인지"로 묶어서 적는다(참고자료 HWP: 단장/안전,
 * 기존 질의답변 Excel: ▷책임기술자 질의/▷건축보조기술자 질의). 그래서 입력 화면도 그룹 단위로
 * 다루고, DB에는 그룹을 별도 테이블로 만들지 않고 질문 행의 (role_id, group_order)로 표현한다 —
 * 그룹은 질문의 속성일 뿐 독립적으로 존재할 이유가 없다.
 *
 * 두 축을 혼동하지 말 것:
 *   질의그룹(role_id)     = 누구에게 나온 질문인가 (책임/건축/안전/토목/기계/전기 + legacy)
 *   질의분류(category_id) = 질문의 주제가 무엇인가 (품질/안전/공정/사업관리/…)
 * 예) 책임기술인에게 나온 공정 질문 → 그룹 '책임' + 분류 '공정'
 *
 * 이 파일은 DB에 접근하지 않는다.
 */
import type { EvaluationQuestion, EvaluationRole, QuestionSavePayload } from './types'

/** 입력 화면에서 편집 중인 질문 1개. 저장 전이라 id가 없다. */
export interface QuestionDraft {
  /** React key 용도의 로컬 식별자 — DB에 저장되지 않는다. */
  key: string
  text: string
  category_id: string | null
}

/** 입력 화면에서 편집 중인 질의그룹 1개. */
export interface QuestionGroupDraft {
  key: string
  /** 질의그룹(evaluation_roles.id). */
  role_id: string | null
  questions: QuestionDraft[]
}

/** 저장된 데이터를 그룹 단위로 다시 묶은 결과(상세보기 / 수정 진입 공용). */
export interface QuestionGroupView {
  role_id: string | null
  group_order: number
  questions: EvaluationQuestion[]
}

let keySeq = 0
function nextKey(prefix: string): string {
  keySeq += 1
  return `${prefix}${keySeq}`
}

/** 새 빈 질문 1개. 분류 기본값을 넘기면 그것으로 시작한다(보통 '미지정'). */
export function newQuestionDraft(categoryId: string | null = null): QuestionDraft {
  return { key: nextKey('q'), text: '', category_id: categoryId }
}

/** 새 빈 그룹 하나. 질문 입력칸 1개를 미리 열어둔다(바로 타이핑할 수 있도록). */
export function newQuestionGroup(
  roleId: string | null = null,
  defaultCategoryId: string | null = null,
): QuestionGroupDraft {
  return { key: nextKey('g'), role_id: roleId, questions: [newQuestionDraft(defaultCategoryId)] }
}

/**
 * 저장된 질문들을 입력 화면용 그룹 배열로 되돌린다(수정 모드 진입 시).
 * group_order → question_order 순으로 정렬한 뒤 group_order가 같은 것을 한 그룹으로 본다.
 * group_order 값 자체는 버리고 배열 순서로 다시 매기므로, 과거에 저장된 값이 띄엄띄엄해도 상관없다.
 */
export function toQuestionGroupDrafts(questions: readonly EvaluationQuestion[]): QuestionGroupDraft[] {
  return groupQuestions(questions).map(g => ({
    key: nextKey('g'),
    role_id: g.role_id,
    // 질문이 하나도 없는 그룹은 groupQuestions가 만들지 않으므로 항상 1개 이상이다.
    questions: g.questions.map(q => ({ key: nextKey('q'), text: q.question_text, category_id: q.category_id })),
  }))
}

/**
 * 저장된 질문들을 그룹 단위로 묶는다.
 * 같은 group_order를 한 그룹으로 본다 — 그룹이 같아도 사용자가 따로 만들었다면 따로 보여주는 게
 * 입력한 모양에 충실하다.
 */
export function groupQuestions(questions: readonly EvaluationQuestion[]): QuestionGroupView[] {
  const sorted = [...questions].sort(
    (a, b) => a.group_order - b.group_order || a.question_order - b.question_order,
  )

  const out: QuestionGroupView[] = []
  for (const q of sorted) {
    const last = out[out.length - 1]
    if (last && last.group_order === q.group_order) {
      last.questions.push(q)
      continue
    }
    out.push({ role_id: q.role_id, group_order: q.group_order, questions: [q] })
  }
  return out
}

/**
 * 입력 화면의 그룹들을 저장 페이로드로 바꾼다.
 *
 * - 공백만 있는 질문은 버린다(질문칸을 추가만 하고 안 채운 경우 — 빈 질문 방지).
 * - 질문이 하나도 안 남은 그룹은 통째로 사라진다(그룹만 만들고 질문을 안 적은 경우).
 * - group_order/question_order는 화면에 보이는 순서대로 0,1,2...로 다시 매긴다. 중간 그룹이
 *   비어서 빠지더라도 번호에 구멍이 생기지 않는다.
 *
 * DB의 CHECK(빈 질문 금지)와 RPC의 필터가 최종 방어선이고, 이 함수는 그 전에 화면 단에서 같은
 * 규칙을 적용해 "저장했는데 조용히 사라진 질문"이 생기지 않게 한다.
 */
export function toQuestionPayloads(groups: readonly QuestionGroupDraft[]): QuestionSavePayload[] {
  const out: QuestionSavePayload[] = []
  let groupOrder = 0

  for (const group of groups) {
    const filled = group.questions.filter(q => q.text.trim().length > 0)
    if (filled.length === 0) continue

    filled.forEach((q, i) => {
      out.push({
        question_text: q.text.trim(),
        role_id: group.role_id,
        category_id: q.category_id,
        group_order: groupOrder,
        question_order: i,
      })
    })
    groupOrder += 1
  }

  return out
}

/** 저장 대상 질문이 몇 건인지 — 저장 버튼 옆 안내와 "질문 0건" 경고에 쓴다. */
export function countValidQuestions(groups: readonly QuestionGroupDraft[]): number {
  return toQuestionPayloads(groups).length
}

/**
 * 질의그룹 머리말 표기. 마스터에서 이름을 못 찾으면(비활성/삭제된 값) '미지정'으로 적는다 —
 * 없는 그룹 이름을 추측해 만들지 않는다.
 */
export function groupLabel(roleName: string | null | undefined): string {
  const name = (roleName ?? '').trim()
  return name || '미지정'
}

/**
 * 질의 검색 결과 카드에 붙는 "그룹 · 분류" 표기(예: "책임 · 공정").
 * 한쪽만 알면 있는 쪽만, 둘 다 모르면 '미지정'.
 */
export function questionTagLabel(
  roleName: string | null | undefined,
  categoryName: string | null | undefined,
): string {
  const parts = [roleName, categoryName]
    .map(s => (s ?? '').trim())
    .filter(s => s.length > 0)
  return parts.length > 0 ? parts.join(' · ') : '미지정'
}

/**
 * "+ 질의그룹 추가"에서 고를 수 있는 그룹 목록.
 *
 * 이미 화면에 있는 그룹은 제외해서 같은 그룹이 두 번 만들어지지 않게 한다(실수 방지). 신규 입력은
 * 업무용 6종(is_primary)만 고르게 하고, legacy 전용 값(공통/타사/기타/미지정)은 신규 작성 화면에
 * 노출하지 않는다 — legacy 수용성과 신규 UX를 분리하기 위함이다.
 */
export function availableGroupOptions(
  roles: readonly EvaluationRole[],
  usedGroups: readonly QuestionGroupDraft[],
): EvaluationRole[] {
  const used = new Set(usedGroups.map(g => g.role_id).filter((v): v is string => !!v))
  return roles
    .filter(r => r.is_active && r.is_primary)
    .filter(r => !used.has(r.id))
    .sort((a, b) => a.sort_order - b.sort_order)
}

/**
 * 아직 안 쓴 그룹 중 첫 번째(= "+ 질의그룹 추가"를 눌렀을 때 기본으로 선택될 그룹).
 * 6종을 다 썼으면 null — 호출부가 버튼을 비활성화한다.
 */
export function nextAvailableGroup(
  roles: readonly EvaluationRole[],
  usedGroups: readonly QuestionGroupDraft[],
): EvaluationRole | null {
  return availableGroupOptions(roles, usedGroups)[0] ?? null
}

/** 그룹 선택 드롭다운에 넣을 목록 — 아직 안 쓴 6종 + 자기 자신(현재 선택값)은 유지. */
export function groupOptionsForSelect(
  roles: readonly EvaluationRole[],
  usedGroups: readonly QuestionGroupDraft[],
  currentRoleId: string | null,
): EvaluationRole[] {
  const options = availableGroupOptions(roles, usedGroups)
  if (!currentRoleId) return options
  const current = roles.find(r => r.id === currentRoleId)
  if (!current || options.some(o => o.id === current.id)) return options
  return [...options, current].sort((a, b) => a.sort_order - b.sort_order)
}

/** 같은 그룹이 두 번 이상 들어 있는지 — 저장 전 경고용. */
export function hasDuplicateGroups(groups: readonly QuestionGroupDraft[]): boolean {
  const ids = groups.map(g => g.role_id).filter((v): v is string => !!v)
  return new Set(ids).size !== ids.length
}
