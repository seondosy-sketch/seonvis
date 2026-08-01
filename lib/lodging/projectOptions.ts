/**
 * 숙박관리 — 숙박 등록 폼의 프로젝트 선택 목록을 만드는 순수 로직.
 *
 * 어떤 프로젝트가 "지금 출장 갈 만한 프로젝트"인지 판단하는 기준은 이미 기술인 출근부가 정해뒀다
 * (`lib/attendance/gridFilters.ts`의 `projectOverlapsPeriod` — 공고일~발표일이 조회 기간과 겹치는가,
 * 개찰이 끝났으면 제외). 숙박도 결국 같은 질문이라 그 함수를 그대로 재사용한다 — 규칙을 복사하면
 * 두 화면이 서로 다른 프로젝트 목록을 보여주게 된다(사용자 지시: 출근부의 일정 기준을 반영).
 *
 * 다만 출근부와 달리 숙박은 **아무것도 못 고르는 상황이 생기면 안 된다**. 이미 지난 프로젝트로
 * 뒤늦게 숙박비를 정산하는 경우가 있어서, 검색어를 입력하면 기간 밖 프로젝트도 찾을 수 있게 하되
 * `inPeriod: false`로 표시해 화면이 구분해 보여주도록 한다.
 */
import { projectOverlapsPeriod, type ProjectForGridFilter } from '@/lib/attendance/gridFilters'

/** 프로젝트 선택에 필요한 최소 필드 — 출근부의 필터 입력과 같은 모양이다. */
export type LodgingProjectOption = ProjectForGridFilter

export interface ProjectOptionRow {
  project: LodgingProjectOption
  /** 공고일~발표일이 조회 기간과 겹치는가. false면 "일정 밖"으로 표시한다. */
  inPeriod: boolean
}

export interface BuildProjectOptionsInput {
  projects: readonly LodgingProjectOption[]
  /** 숙박 기간(체크인~체크아웃). 아직 안 정했으면 보고 있는 달의 범위를 넘긴다. */
  periodStart: string
  periodEnd: string
  query: string
  limit?: number
}

const DEFAULT_LIMIT = 30

function matchesQuery(p: LodgingProjectOption, q: string): boolean {
  if (!q) return true
  const needle = q.toLowerCase()
  return p.name.toLowerCase().includes(needle) || p.project_number.toLowerCase().includes(needle)
}

/**
 * 검색어가 비어 있으면 기간과 겹치는 프로젝트만, 검색어가 있으면 기간 밖까지 찾아준다.
 * 어느 쪽이든 기간 안이 먼저 오고, 그 안에서는 넘겨받은 순서(공사번호 순)를 유지한다.
 * 취소된 프로젝트는 출근부와 마찬가지로 항상 제외한다.
 */
export function buildProjectOptions(input: BuildProjectOptionsInput): ProjectOptionRow[] {
  const q = input.query.trim()
  const limit = input.limit ?? DEFAULT_LIMIT

  const inPeriod: ProjectOptionRow[] = []
  const outOfPeriod: ProjectOptionRow[] = []

  for (const project of input.projects) {
    if (project.status === '취소') continue
    if (!matchesQuery(project, q)) continue
    if (projectOverlapsPeriod(project, input.periodStart, input.periodEnd)) {
      inPeriod.push({ project, inPeriod: true })
    } else if (q) {
      // 검색 중일 때만 기간 밖까지 보여준다 — 빈 목록은 "이 기간에 해당하는 프로젝트"가 기본값이다.
      outOfPeriod.push({ project, inPeriod: false })
    }
  }

  return [...inPeriod, ...outOfPeriod].slice(0, limit)
}

/**
 * 프로젝트 목록을 거를 기간. 체크인·체크아웃을 이미 입력했으면 그 숙박 기간을, 아직이면
 * 보고 있는 달을 쓴다 — 날짜를 채우기 전에도 목록이 비어 보이지 않게 하기 위함이다.
 */
export function projectFilterPeriod(
  checkIn: string,
  checkOut: string,
  fallback: { start: string; end: string },
): { start: string; end: string } {
  if (checkIn && checkOut && checkIn <= checkOut) return { start: checkIn, end: checkOut }
  if (checkIn) return { start: checkIn, end: checkIn }
  return fallback
}
