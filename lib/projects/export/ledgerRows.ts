/**
 * 프로젝트 List — "○○년 참여프로젝트 관리" 엑셀 대장의 순수 계산 레이어.
 *
 * 기준 서식은 사용자가 손으로 관리해 온 워크북이다(2시트 구성).
 *   1시트 "2026년"        : 프로젝트 관리 대장 (연번~기계, 20열)
 *   2시트 "26년 참여기술자" : 왼쪽 = 책임기술인(단장) 참여현황, 오른쪽 = 분야별 기술인 참여현황
 *
 * 2시트는 1시트에서 전부 파생되는 집계다 — 사람 이름을 모아 참여 프로젝트를 줄바꿈으로 잇고
 * 누적 횟수를 센다. 원본 워크북에서 노란 음영이 칠해진 행을 전수 대조해 보니 "수주한 프로젝트에
 * 참여한 기술인"과 정확히 일치해서(단장 9명·분야 6명), 그 규칙을 그대로 계산으로 옮겼다.
 *
 * 렌더링(셀 서식·색·너비)은 projectLedgerWorkbook.ts가 맡고, 여기서는 값만 만든다.
 */

import { computeProjectStatus } from '@/lib/projectStatus'

/** 대장 한 줄을 만드는 데 필요한 projects 컬럼. */
export interface LedgerProject {
  project_number: string
  type: string
  client: string
  name: string
  fee: number | null
  tp_score: string
  /** 원본 대장의 "배점" 열. 임포트 당시 컬럼명이 duration_days로 굳어 있다(reimport_projects.py). */
  duration_days: string
  submit_date: string | null
  /** 원본 대장의 "평가일" 열 = 발표(면접)일. */
  interview_date: string | null
  interview_written: boolean | null
  result_score: string
  evaluation: string
  participants: string
  note: string
  director: string
  staff_arch: string
  staff_civil: string
  staff_mech: string
  staff_safety: string
  status_override: string | null
}

/** 2시트 한 줄 — 사람 1명 = 1행. */
export interface ParticipationRow {
  name: string
  field: string
  /** 참여 프로젝트명. 셀에서는 줄바꿈으로 이어 붙인다. */
  projectNames: string[]
  /** 누적(회) — 프로젝트 수. 한 프로젝트에 두 역할로 들어가도 1회로 센다. */
  count: number
  /** 수주 프로젝트 참여자 — 원본 서식의 노란 음영 대상. */
  hasWin: boolean
}

export interface ParticipationSheet {
  /** 왼쪽 블록 — 책임기술인(단장). */
  directors: ParticipationRow[]
  /** 오른쪽 블록 — 분야별 기술인(건축·토목·기계·안전). */
  specialists: ParticipationRow[]
}

/** 분야 열 4종 — 원본 대장의 Q·R·S·T 열 순서(건축·안전·토목·기계)와는 별개로, 집계는 분야 우선순위 순으로 훑는다. */
const SPECIALTY_COLUMNS: { key: keyof LedgerProject; field: string }[] = [
  { key: 'staff_arch', field: '건축' },
  { key: 'staff_civil', field: '토목' },
  { key: 'staff_mech', field: '기계' },
  { key: 'staff_safety', field: '안전' },
]

/**
 * 사람 이름이 아닌 값 — 대장에는 담당자가 정해지기 전 "미정"이나 빈칸 대용 대시가 그대로 들어 있다.
 * 이런 값이 참여현황에 사람으로 잡히면 누적 횟수가 통째로 틀어진다.
 */
const NON_NAMES = new Set(['', '-', 'ㅡ', '미정', '미상', 'TBD'])

function cleanName(raw: string | null | undefined): string {
  const v = (raw ?? '').trim()
  return NON_NAMES.has(v) ? '' : v
}

/** '2026-08-11' → 엑셀이 그대로 읽는 UTC 자정 Date. 로컬 자정으로 만들면 KST(+9) 때문에 하루 밀린다. */
export function toExcelDate(value: string | null | undefined): Date | null {
  const m = (value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
}

/**
 * 단장의 분야 — projects에는 단장의 분야 컬럼이 따로 없다.
 * 같은 이름이 다른 프로젝트의 분야 칸에 등장하면 그 분야를 쓰고(예: 정영석은 다른 건에서 건축),
 * 끝내 못 찾으면 '건축'으로 둔다. 원본 워크북에서도 단장 27명이 전원 건축이었다.
 *
 * engineer_contact_specialties(기술인 주소록)를 쓰지 않은 이유: 실제 참여자 62명 중 분야가
 * 등록된 사람이 절반뿐이라 이름 조회가 자주 빈손으로 돌아온다.
 */
function specialtyOfDirector(name: string, projects: LedgerProject[]): string {
  for (const p of projects) {
    for (const col of SPECIALTY_COLUMNS) {
      if (cleanName(p[col.key] as string) === name) return col.field
    }
  }
  return '건축'
}

/** 이름별 누적 상자 — 등장 순서를 유지하려고 Map을 쓴다(삽입 순서 = 프로젝트 정렬 순). */
class Accumulator {
  private readonly rows = new Map<string, ParticipationRow & { seen: Set<string> }>()

  add(name: string, field: string, project: LedgerProject, isWin: boolean): void {
    let row = this.rows.get(name)
    if (!row) {
      row = { name, field, projectNames: [], count: 0, hasWin: false, seen: new Set() }
      this.rows.set(name, row)
    }
    // 같은 프로젝트를 두 번 세지 않는다 — 한 사람이 한 건에서 두 분야를 겸할 수 있다.
    if (row.seen.has(project.project_number)) return
    row.seen.add(project.project_number)
    row.projectNames.push(project.name)
    row.count = row.projectNames.length
    if (isWin) row.hasWin = true
  }

  toRows(): ParticipationRow[] {
    return [...this.rows.values()].map(({ name, field, projectNames, count, hasWin }) => ({
      name, field, projectNames, count, hasWin,
    }))
  }
}

/**
 * 2시트(참여기술자) 집계.
 *
 * 행 순서는 프로젝트 목록에 처음 등장한 순서다. 원본 워크북은 사람이 손으로 채워 넣은 순서라
 * 재현할 규칙이 없어서, 대장을 위에서 아래로 읽으면 그대로 나오는 순서를 택했다.
 */
export function buildParticipationSheet(projects: LedgerProject[]): ParticipationSheet {
  const directors = new Accumulator()
  const specialists = new Accumulator()

  for (const p of projects) {
    const isWin = computeProjectStatus(p) === '수주'

    const director = cleanName(p.director)
    if (director) directors.add(director, specialtyOfDirector(director, projects), p, isWin)

    for (const col of SPECIALTY_COLUMNS) {
      const name = cleanName(p[col.key] as string)
      if (name) specialists.add(name, col.field, p, isWin)
    }
  }

  return { directors: directors.toRows(), specialists: specialists.toRows() }
}
