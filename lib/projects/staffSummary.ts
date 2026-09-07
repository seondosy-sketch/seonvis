/**
 * 프로젝트 상세(공고 상세 모달)의 **참여 기술인 목록** 조립 — 순수 로직.
 *
 * 한 프로젝트의 인력 정보가 두 곳에 있다.
 *   1) `project_participants` 행 — 출근부·면접 DB가 쓰는 정식 소스(기술인 주소록과 FK로 연결)
 *   2) `projects.staff_arch/civil/mech/safety` 텍스트 — 프로젝트 List 입력 폼에서 손으로 적는 칸
 *
 * 둘 중 하나만 채워진 프로젝트가 실제로 많다(2026-09 기준 78건 중 행 30건 / 텍스트 47건).
 * 그래서 어느 한쪽만 보여주면 사람이 아는 정보가 화면에서 사라진다. 이 함수는 **행을 먼저 놓고,
 * 행에 없는 텍스트 이름만 뒤에 덧붙여** 중복 없이 둘을 합친다.
 *
 * 이 파일은 DB에 접근하지 않는다.
 */

/** `project_participants` + 조인해 온 기술인/분야 이름 중 화면에 필요한 것만. */
export interface ProjectParticipantRef {
  engineer_contact_id: string
  name: string
  /** project_participants.role 원문 (예: '책임', '건축 담당'). */
  role: string
  /** engineer_specialties.name (예: '건축'). 미지정이면 null. */
  specialty_name: string | null
  is_director: boolean
  sort_order: number
}

/** `projects`의 손입력 인력 칸. */
export interface StaffTextFields {
  staff_arch: string
  staff_civil: string
  staff_mech: string
  staff_safety: string
}

export interface StaffEntry {
  name: string
  /** 옆에 붙는 짧은 역할/분야 표기. */
  label: string
  /**
   * 어디서 온 값인지 — 화면이 출처를 구분해 보여줄 수 있게 남긴다.
   * 'participant' = project_participants 행, 'text' = 손입력 칸.
   */
  source: 'participant' | 'text'
}

const TEXT_FIELDS: ReadonlyArray<{ key: keyof StaffTextFields; label: string }> = [
  { key: 'staff_arch', label: '건축' },
  { key: 'staff_civil', label: '토목' },
  { key: 'staff_mech', label: '기계' },
  { key: 'staff_safety', label: '안전' },
]

/** 이름 비교용 정규화 — 표기 차이(공백·괄호·직급 구분자)를 흡수한다. */
function nameKey(raw: string): string {
  return raw.replace(/[\s()（）·,]/g, '').toLowerCase()
}

/**
 * 행에 붙일 짧은 표기.
 *
 * 단장은 role 원문을 그대로 쓴다 — 단장의 specialty는 자동연계 규칙상 '건축'으로 채워져 있어
 * (lib/attendance/engineerLink.ts) 분야를 쓰면 "건축"으로 잘못 보인다.
 * (면접 DB의 lib/evaluations/attendees.ts `participantShortLabel`과 같은 판단이다.)
 */
export function participantLabel(p: ProjectParticipantRef): string {
  if (p.is_director) return p.role.trim() || '단장'
  const specialty = (p.specialty_name ?? '').trim()
  return specialty || p.role.trim() || '기술인'
}

/** 손입력 칸 하나에 여러 명이 적히는 경우가 있다("김철수/이영희", "김철수, 이영희"). */
function splitNames(raw: string): string[] {
  return raw
    .split(/[/,·、]|\s{2,}/)
    .map(s => s.trim())
    .filter(s => s.length > 0)
}

/**
 * 참여기술인 행 + 손입력 텍스트 → 화면에 뿌릴 한 줄짜리 목록.
 *
 * - 행이 먼저 온다: 단장 → 그다음 sort_order(같으면 이름).
 * - 텍스트는 행에 **없는 이름만** 뒤에 붙는다(같은 사람을 두 번 보여주지 않는다).
 * - 같은 이름이 텍스트 여러 칸에 적혀 있으면 처음 것만 남긴다.
 */
export function buildStaffSummary(
  participants: readonly ProjectParticipantRef[],
  text: StaffTextFields | null,
): StaffEntry[] {
  const out: StaffEntry[] = []
  const seen = new Set<string>()

  const rows = [...participants].sort((a, b) => {
    if (a.is_director !== b.is_director) return a.is_director ? -1 : 1
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order
    return a.name.localeCompare(b.name)
  })

  for (const p of rows) {
    const name = p.name.trim()
    if (!name) continue
    const key = nameKey(name)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ name, label: participantLabel(p), source: 'participant' })
  }

  if (!text) return out

  for (const field of TEXT_FIELDS) {
    for (const name of splitNames(text[field.key] ?? '')) {
      const key = nameKey(name)
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ name, label: field.label, source: 'text' })
    }
  }

  return out
}
