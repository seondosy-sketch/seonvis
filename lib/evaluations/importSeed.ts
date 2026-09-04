/**
 * 평가 DB — HWP 후기 초안(ImportedReviewDraft)을 등록 폼 초기값(ReviewFormSeed)으로 바꾸는 순수 로직.
 *
 * 파서(lib/evaluations/hwpImport.ts)는 문서에 적힌 **글자**만 뽑는다. 그 글자를 마스터의 id로
 * 잇는 일(평가유형·질의그룹·프로젝트·기술인)은 여기서 한다 — 화면이 이미 읽어 둔 마스터 배열을
 * 넘겨받아 처리하므로 이 파일도 DB에 접근하지 않는다.
 *
 * 연결 원칙:
 *   - 확실하지 않으면 잇지 않는다. 같은 이름 후보가 둘 이상이면 비워 두고 사람이 고르게 한다.
 *     (틀린 프로젝트·틀린 기술인에 후기가 붙는 것이 비워 두는 것보다 나쁘다.)
 *   - 질의분류(주제)는 추론하지 않고 전부 '미지정'으로 시작한다.
 *   - 무엇을 못 이었는지 notes로 돌려줘 화면이 사람에게 알린다.
 */
import type { InterviewEngineerRef, InterviewProjectRef } from '@/app/(dashboard)/interviews/types'
import { countImportedQuestions, type ImportedReviewDraft } from './hwpImport'
import type {
  EvaluationAttendee,
  EvaluationQuestion,
  EvaluationQuestionCategory,
  EvaluationRole,
  EvaluationType,
  ReviewFormSeed,
} from './types'

export interface ImportMasters {
  evaluationTypes: readonly EvaluationType[]
  roles: readonly EvaluationRole[]
  categories: readonly EvaluationQuestionCategory[]
  projects: readonly InterviewProjectRef[]
  engineers: readonly InterviewEngineerRef[]
}

export interface ImportSeedResult {
  seed: ReviewFormSeed
  /** 자동으로 이어진 프로젝트 — 못 찾으면 null. */
  matchedProject: InterviewProjectRef | null
  /** 사람이 확인해야 할 것들(화면에 그대로 보여준다). */
  notes: string[]
}

/** 이름 비교용 정규화 — 공백·괄호·구두점을 지운다. 문서와 DB의 표기 차이를 흡수한다. */
function normalizeName(raw: string): string {
  return raw
    .replace(/[\s()（）[\]「」'"·,.\-_/]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * 문서의 평가유형 원문을 마스터에서 찾는다. 'T P' → 'TP'처럼 공백만 다른 표기를 흡수한다.
 * 못 찾으면 null — 폼에서 사용자가 직접 고른다(평가유형은 저장 필수값이다).
 */
export function matchEvaluationType(
  source: string,
  types: readonly EvaluationType[],
): EvaluationType | null {
  const key = normalizeName(source)
  if (!key) return null
  return (
    types.find(t => normalizeName(t.name) === key)
    ?? types.find(t => normalizeName(t.code) === key)
    ?? null
  )
}

/**
 * 평가유형 칸이 없는 문서를 위해 **제목에서** 유형을 찾는다.
 * 실제 후기 문서에는 평가유형 칸이 아예 없고 제목만 "…면접후기"라고 적혀 있다. 제목에 유형
 * 이름이 그대로 들어 있으면 그것을 읽는 것은 추측이 아니라 문서를 읽는 것이다.
 *
 * '기타'·'미지정'은 제목에서 찾지 않는다 — 우연히 낱말이 겹쳤을 때 뜻 없는 유형이 붙는다.
 * 긴 이름을 먼저 본다('면접평가서'가 '면접'보다 앞).
 */
export function matchEvaluationTypeFromTitle(
  title: string,
  types: readonly EvaluationType[],
): EvaluationType | null {
  const key = normalizeName(title)
  if (!key) return null

  const candidates = types
    .filter(t => !['기타', '미지정'].includes(t.name.trim()))
    .filter(t => normalizeName(t.name).length >= 2)
    .sort((a, b) => normalizeName(b.name).length - normalizeName(a.name).length)

  return candidates.find(t => key.includes(normalizeName(t.name))) ?? null
}

/**
 * 문서의 용역명으로 Project List에서 프로젝트를 찾는다.
 *
 * 정확히 일치하는 것이 하나면 잇고, 없으면 포함 관계(문서 용역명 ⊂ 프로젝트명 또는 그 반대)를
 * 본다. 후보가 둘 이상이면 발주처로 한 번 더 좁히고, 그래도 하나로 줄지 않으면 잇지 않는다 —
 * 틀린 프로젝트에 후기를 붙이는 것보다 사람이 고르는 편이 안전하다.
 */
export function matchProject(
  projectName: string,
  client: string,
  projects: readonly InterviewProjectRef[],
): InterviewProjectRef | null {
  const key = normalizeName(projectName)
  if (key.length < 4) return null

  const pool = projects.filter(p => p.status !== '취소')

  const exact = pool.filter(p => normalizeName(p.name) === key)
  const narrowed = exact.length > 0
    ? exact
    : pool.filter(p => {
      const name = normalizeName(p.name)
      return name.length >= 4 && (name.includes(key) || key.includes(name))
    })

  if (narrowed.length === 1) return narrowed[0]
  if (narrowed.length === 0) return null

  const clientKey = normalizeName(client)
  if (!clientKey) return null
  const byClient = narrowed.filter(p => {
    const c = normalizeName(p.client)
    return c.length > 0 && (c === clientKey || c.includes(clientKey) || clientKey.includes(c))
  })
  return byClient.length === 1 ? byClient[0] : null
}

/**
 * 후기에 적히는 직급 — 주소록은 이름만 담고 있어서 비교 전에 떼어낸다.
 * (문서 표기 "조장연 상무"는 attendee_name_snapshot에 그대로 남는다.)
 */
const RANKS: readonly string[] = [
  '회장', '부회장', '사장', '부사장', '전무', '상무보', '상무', '이사', '고문',
  '본부장', '지사장', '소장', '실장', '팀장', '부장', '차장', '과장', '대리', '주임', '사원',
  '수석', '책임', '선임', '기사',
]

/** "조장연 상무" → "조장연". 직급이 없으면 그대로 돌려준다. */
function stripRank(name: string): string {
  const text = name.trim()
  for (const rank of RANKS) {
    if (text.endsWith(rank)) return text.slice(0, -rank.length).trim()
  }
  return text
}

/**
 * 참석자 이름을 기술인 주소록에서 찾는다. 같은 이름이 둘 이상이면 누구인지 알 수 없으므로
 * 연결하지 않는다(이름 스냅샷만 남고, 폼에서 사람이 고를 수 있다).
 *
 * 문서는 "조장연 상무", "이상원(65) 상무"처럼 직급을 붙여 적으므로 직급을 뗀 이름으로도
 * 한 번 더 찾아본다. 동명이인 구분용 괄호("(65)")는 주소록 표기와 같은 방식으로 정규화된다.
 */
export function matchEngineer(
  name: string,
  engineers: readonly InterviewEngineerRef[],
): InterviewEngineerRef | null {
  for (const candidate of [name, stripRank(name)]) {
    const key = normalizeName(candidate)
    if (!key) continue
    const hits = engineers.filter(e => normalizeName(e.name) === key)
    if (hits.length === 1) return hits[0]
    // 후보가 여러 명이면 추측하지 않고 멈춘다(직급을 뗀 이름으로도 다시 시도하지 않는다).
    if (hits.length > 1) return null
  }
  return null
}

/** 마스터에서 이름으로 질의그룹을 찾는다. */
function findRole(name: string | null, roles: readonly EvaluationRole[]): EvaluationRole | null {
  if (!name) return null
  const key = normalizeName(name)
  return roles.find(r => normalizeName(r.name) === key) ?? null
}

function unspecifiedRole(roles: readonly EvaluationRole[]): EvaluationRole | null {
  return roles.find(r => normalizeName(r.name) === '미지정') ?? null
}

function unspecifiedCategory(
  categories: readonly EvaluationQuestionCategory[],
): EvaluationQuestionCategory | null {
  return categories.find(c => c.code === 'unspecified') ?? null
}

/**
 * 초안 + 마스터 → 등록 폼 초기값.
 *
 * 폼은 ReviewDetail 모양을 그대로 읽어 초기 state를 만든다. 그래서 초안도 같은 모양으로 만들어
 * 넘긴다 — 폼에 "HWP 전용 초기화 경로"를 따로 만들지 않기 위함이다. id만 null이라서 저장할 때
 * 신규 등록이 된다.
 */
export function buildReviewFormSeed(
  draft: ImportedReviewDraft,
  masters: ImportMasters,
): ImportSeedResult {
  const notes: string[] = []

  // 평가유형: 문서에 칸이 있으면 그 값만 본다. 칸이 **아예 없을 때만** 제목에서 찾는다
  // (실제 후기 문서에는 칸이 없다). 칸에 적힌 원문이 표준 유형에 없더라도 제목으로 덮어쓰지
  // 않는다 — 문서가 직접 적어 둔 값과 어긋나는 유형을 붙이는 것이 비워 두는 것보다 나쁘다.
  const typeFromField = matchEvaluationType(draft.evaluation_type_source, masters.evaluationTypes)
  const typeFromTitle = draft.evaluation_type_source.trim()
    ? null
    : matchEvaluationTypeFromTitle(draft.document_title, masters.evaluationTypes)
  const type = typeFromField ?? typeFromTitle

  if (draft.evaluation_type_source && !typeFromField) {
    notes.push(`평가유형 "${draft.evaluation_type_source}"을 표준 유형에서 찾지 못했습니다 — 직접 선택해주세요.`)
  } else if (typeFromTitle) {
    notes.push(`평가유형을 문서 제목에서 '${typeFromTitle.name}'으로 읽었습니다 — 맞는지 확인해주세요.`)
  } else if (!type) {
    notes.push('문서에서 평가유형을 찾지 못했습니다 — 직접 선택해주세요.')
  }

  const project = matchProject(draft.project_name, draft.client, masters.projects)
  if (draft.project_name && !project) {
    notes.push('용역명과 일치하는 프로젝트를 찾지 못했습니다 — 필요하면 직접 연결해주세요.')
  }

  // 실제 후기 문서에는 시설용도 칸이 없다(Project List에도 없는 값이라 후기가 자체 보관한다).
  // 질의 검색의 필터 축이라 비워 두면 나중에 걸리지 않으므로, 조용히 넘기지 않고 알린다.
  if (!draft.facility_type.trim()) {
    notes.push('문서에 시설용도가 없습니다 — 직접 입력해주세요(질의 검색 필터에 쓰입니다).')
  }

  // ── 참석자 ────────────────────────────────────────────────────────────────
  const unlinked: string[] = []
  const attendees: EvaluationAttendee[] = draft.attendees.map((a, i) => {
    const engineer = matchEngineer(a.name, masters.engineers)
    if (!engineer) unlinked.push(a.name)
    return {
      id: `import-attendee-${i}`,
      review_id: '',
      engineer_contact_id: engineer?.id ?? null,
      attendee_name_snapshot: a.name,
      attendee_role: a.role,
      sort_order: i,
      created_at: '',
    }
  })
  if (unlinked.length > 0) {
    notes.push(`주소록에서 찾지 못한 참석자: ${unlinked.join(', ')} — 이름만 저장됩니다.`)
  }

  // ── 질문 ──────────────────────────────────────────────────────────────────
  // 같은 질의그룹으로 해석된 그룹이 여러 개면 하나로 합친다. 문서에 "단장"과 "책임기술자"가
  // 따로 적혀 있어도 표준 그룹은 둘 다 '책임'이고, 폼은 같은 그룹이 두 번 있으면 저장을 막는다.
  const fallbackRole = unspecifiedRole(masters.roles)
  const category = unspecifiedCategory(masters.categories)
  const unknownRoleNames = new Set<string>()

  const merged: { role_id: string | null; questions: string[] }[] = []
  for (const group of draft.groups) {
    const role = findRole(group.role_name, masters.roles)
    if (group.role_name && !role) unknownRoleNames.add(group.role_name)
    const roleId = role?.id ?? fallbackRole?.id ?? null

    const existing = merged.find(m => m.role_id === roleId)
    if (existing) existing.questions.push(...group.questions)
    else merged.push({ role_id: roleId, questions: [...group.questions] })
  }
  if (unknownRoleNames.size > 0) {
    notes.push(`질의그룹을 못 정한 항목이 있어 '미지정'으로 넣었습니다: ${[...unknownRoleNames].join(', ')}`)
  }
  if (draft.groups.some(g => g.role_name === null)) {
    notes.push("문서에서 질의그룹 머리말을 찾지 못한 질문은 '미지정' 그룹에 담았습니다.")
  }

  const questions: EvaluationQuestion[] = []
  merged.forEach((group, groupOrder) => {
    group.questions.forEach((text, questionOrder) => {
      questions.push({
        id: `import-question-${groupOrder}-${questionOrder}`,
        review_id: '',
        question_text: text,
        role_id: group.role_id,
        category_id: category?.id ?? null,
        specialty_id: null,
        group_order: groupOrder,
        question_order: questionOrder,
        created_at: '',
        updated_at: '',
      })
    })
  })
  if (countImportedQuestions(draft) === 0) {
    notes.push('문서에서 실제질의를 찾지 못했습니다 — 질문은 직접 입력해주세요.')
  }

  if (draft.unmatched_labels.length > 0) {
    notes.push(`읽지 못한 항목: ${draft.unmatched_labels.join(', ')} — 필요하면 직접 입력해주세요.`)
  }

  // 발주처는 문서 값이 우선이다. 문서에 없을 때만 이어진 프로젝트에서 가져온다.
  const client = draft.client || project?.client || ''

  const seed: ReviewFormSeed = {
    id: null,
    project_id: project?.id ?? null,
    evaluation_type_id: type?.id ?? null,
    // 표준 유형으로 이어졌다면 원문을 따로 남기지 않는다. 못 이은 원문만 보존한다
    // (evaluation_type_source의 용도 — types.ts 주석 참고).
    evaluation_type_source: typeFromField ? '' : draft.evaluation_type_source,
    client_snapshot: client,
    project_name_snapshot: draft.project_name || project?.name || '',
    facility_type: draft.facility_type,
    evaluation_date: draft.evaluation_date,
    evaluation_year: draft.evaluation_date ? null : draft.evaluation_year,
    evaluation_year_effective: draft.evaluation_date
      ? Number(draft.evaluation_date.slice(0, 4))
      : draft.evaluation_year,
    evaluation_time: draft.evaluation_time,
    location: draft.location,
    evaluator_count: draft.evaluator_count,
    participant_company_count: draft.participant_company_count,
    presentation_order: draft.presentation_order,
    participant_companies: draft.participant_companies,
    evaluation_method: draft.evaluation_method,
    special_notes: draft.special_notes,
    created_by: '',
    updated_by: '',
    created_at: '',
    updated_at: '',
    attendees,
    questions,
  }

  return { seed, matchedProject: project, notes }
}
