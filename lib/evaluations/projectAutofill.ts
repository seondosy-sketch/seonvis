/**
 * 면접후기 등록/수정 — 프로젝트 연동 자동입력 규칙.
 *
 * 왜 필요한가
 *   프로젝트를 고르면 Project List에서 용역명·발주처·평가일을 가져온다. 그런데 예전 구현은
 *   "이미 값이 있으면 덮어쓰지 않는다"였고 용역명만 무조건 갈아끼웠다. 그래서 프로젝트 A를 고른 뒤
 *   B로 바꾸면 **용역명은 B, 발주처·평가일은 A** 가 남아 저장하면 틀린 발주처가 기록됐다
 *   (실측: 2658 한국전력공사 → 2657 국군재정관리단으로 바꿔도 발주처가 한국전력공사로 남음).
 *
 * 규칙
 *   - 용역명(projectName)은 프로젝트를 바꾸면 **항상** 새 프로젝트명으로 갱신한다.
 *   - 발주처(client) · 평가일(evaluationDate)은 소유자를 따진다:
 *       · 자동입력으로 채워진 값이면 → 새 프로젝트 값으로 갱신
 *       · 사용자가 직접 고친 값이면 → 그대로 보존
 *   - 사용자가 칸을 비워서 되돌리면 다시 자동입력이 소유한다(빈 칸은 "내가 넣은 값"이 아니다).
 *   - 보존된 값은 "프로젝트 정보 다시 불러오기"로 언제든 프로젝트 원본값으로 되돌릴 수 있다.
 *
 * 시설용도는 projects에 대응 컬럼이 없어 자동입력 대상이 아니다(사용자 입력 전용).
 * 참여기술인은 값이 아니라 projectId로 다시 조회하므로 여기서 다루지 않는다.
 *
 * 이 파일은 DB에 접근하지 않는다.
 */

/** Project List에서 가져오는 값(InterviewProjectRef의 부분집합). */
export interface ProjectAutofillSource {
  name: string
  client: string
  interview_date: string | null
}

/** 자동입력이 소유한 칸인지. true면 프로젝트를 바꿀 때 새 값으로 갈아끼운다. */
export interface AutofillOwnership {
  client: boolean
  evaluationDate: boolean
}

/** 자동입력이 관여하는 칸들의 현재 값. */
export interface AutofillValues {
  projectName: string
  client: string
  /** YYYY-MM-DD 또는 빈 문자열. */
  evaluationDate: string
}

/** 사용자가 직접 고칠 수 있고 소유자를 따지는 칸. */
export type OwnedField = keyof AutofillOwnership

export const AUTO_OWNED: AutofillOwnership = { client: true, evaluationDate: true }

/** 프로젝트 값을 폼이 쓰는 모양으로. 없는 값은 빈 문자열이다. */
export function projectValues(project: ProjectAutofillSource): AutofillValues {
  return {
    projectName: project.name,
    client: project.client ?? '',
    evaluationDate: project.interview_date ?? '',
  }
}

/**
 * 폼을 열 때의 소유자 판정.
 * 빈 칸은 자동입력이 소유하고, 값이 들어 있으면(기존 기록을 수정하는 경우) 사용자 소유로 본다 —
 * 저장돼 있던 발주처·평가일이 프로젝트를 연결하는 순간 조용히 날아가지 않게 하려는 것이다.
 */
export function initialOwnership(values: Pick<AutofillValues, 'client' | 'evaluationDate'>): AutofillOwnership {
  return {
    client: values.client.trim() === '',
    evaluationDate: values.evaluationDate.trim() === '',
  }
}

export interface ProjectSelectionResult {
  values: AutofillValues
  ownership: AutofillOwnership
  /** 사용자가 직접 고쳐 둔 값이라 갱신하지 않은 칸들. */
  preserved: OwnedField[]
}

/** 프로젝트를 새로 고를 때 각 칸을 어떻게 할지 계산한다. */
export function applyProjectSelection(
  current: AutofillValues,
  ownership: AutofillOwnership,
  project: ProjectAutofillSource,
): ProjectSelectionResult {
  const incoming = projectValues(project)
  const preserved: OwnedField[] = []
  if (!ownership.client) preserved.push('client')
  if (!ownership.evaluationDate) preserved.push('evaluationDate')

  return {
    values: {
      // 용역명은 프로젝트를 가리키는 이름이므로 항상 새 프로젝트를 따른다.
      projectName: incoming.projectName,
      client: ownership.client ? incoming.client : current.client,
      evaluationDate: ownership.evaluationDate ? incoming.evaluationDate : current.evaluationDate,
    },
    // 갱신한 칸은 계속 자동입력 소유, 보존한 칸은 계속 사용자 소유다.
    ownership,
    preserved,
  }
}

/** "프로젝트 정보 다시 불러오기" — 세 칸을 프로젝트 원본값으로 되돌리고 자동입력 소유로 표시한다. */
export function reloadFromProject(project: ProjectAutofillSource): {
  values: AutofillValues
  ownership: AutofillOwnership
} {
  return { values: projectValues(project), ownership: { ...AUTO_OWNED } }
}

/**
 * 사용자가 칸을 고쳤을 때의 소유자 갱신.
 * 값을 비우면 다시 자동입력이 소유한다(빈 칸을 사용자 값으로 붙잡아 두면 이후 프로젝트 변경 때
 * 계속 빈 칸이 남는다).
 */
export function markEdited(
  ownership: AutofillOwnership,
  field: OwnedField,
  value: string,
): AutofillOwnership {
  return { ...ownership, [field]: value.trim() === '' }
}

/**
 * "다시 불러오기"를 보여줄지 — 프로젝트가 연결돼 있고, 사용자 소유 칸의 값이 프로젝트 원본과
 * 실제로 다를 때만 의미가 있다(같은 값이면 누를 이유가 없다).
 */
export function canReloadFromProject(
  current: Pick<AutofillValues, 'client' | 'evaluationDate'>,
  ownership: AutofillOwnership,
  project: ProjectAutofillSource | null,
): boolean {
  if (!project) return false
  const incoming = projectValues(project)
  const clientDiffers = !ownership.client && current.client.trim() !== incoming.client.trim()
  const dateDiffers = !ownership.evaluationDate && current.evaluationDate !== incoming.evaluationDate
  return clientDiffers || dateDiffers
}

/** 보존된 칸을 사용자에게 알려줄 문구. 보존이 없으면 null. */
export function preservedNotice(preserved: readonly OwnedField[]): string | null {
  if (preserved.length === 0) return null
  const labels = preserved.map(f => (f === 'client' ? '발주처' : '평가일'))
  return `${labels.join(' · ')} 값은 직접 입력한 것을 유지했습니다.`
}
