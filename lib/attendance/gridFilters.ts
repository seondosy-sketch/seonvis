/**
 * 기술인 출근부 — 월별 그리드의 프로젝트/참여기술인 필터링 순수 로직 (Phase 2).
 * page.tsx가 이 함수들을 호출만 하도록 분리해, 필터 규칙을 화면 코드 없이 단위 테스트한다.
 */
import type { ProjectParticipant } from './types'

export interface ProjectForGridFilter {
  id: string
  project_number: string
  name: string
  announce_date: string | null
  interview_date: string | null
  bid_date: string | null // 개찰일 — 지난 회계기간에 대해서는 더 이상 "겹침"으로 보지 않는다(사용자 지시)
  status: string
  /**
   * 서면평가 여부와 제출일 — 서면평가 건은 기다릴 발표가 없어 Project List가 interview_date를
   * null로 저장한다. 종료일을 면접일에서만 찾으면 "면접일 미입력 = 계속 진행중"으로 잘못 읽혀
   * 제출이 끝난 사업이 매달 목록에 다시 뜬다. 종료일 판정은 제출일로 한다
   * (lib/attendance/participantPeriod.ts의 computeAttendancePeriod와 같은 규칙).
   * 이 두 컬럼을 아직 읽지 않는 화면(숙박 등)도 있어 optional로 둔다 — 없으면 예전처럼 면접일만 본다.
   */
  interview_written?: boolean | null
  submit_date?: string | null
  /**
   * 발주처 — 출근부의 발주처 필터에서만 쓴다. 이 타입을 함께 쓰는 숙박관리
   * (lib/lodging/projectOptions.ts)는 발주처를 읽지 않으므로 optional로 둔다.
   */
  client?: string | null
}

/**
 * 프로젝트 일정의 종료일 — 서면평가 건이면 제출일, 아니면 면접일.
 * 값이 비어 있으면 null(= 종료일 미확정, 계속 겹치는 것으로 본다).
 */
function scheduleEndDate(project: ProjectForGridFilter): string | null {
  if (project.interview_written) return project.submit_date || null
  return project.interview_date || null
}

/**
 * 프로젝트의 공고일~종료일(면접일, 서면평가면 제출일)이 조회 중인 회계기간과 겹치는지.
 * 종료일이 없으면 계속 겹치는 것으로 본다 — 다만 개찰일(bid_date)이 그 회계기간 시작보다
 * 이전이면, 종료일이 없어도 이미 개찰이 끝난 사업이므로 더 이상 겹치는 것으로 보지 않는다
 * (사용자 지시 — 개찰이 끝난 사업은 출근부에 계속 남지 않게 함).
 */
export function projectOverlapsPeriod(
  project: ProjectForGridFilter,
  periodStart: string,
  periodEnd: string,
): boolean {
  if (!project.announce_date) return false
  if (project.announce_date > periodEnd) return false
  const end = scheduleEndDate(project)
  if (end && end < periodStart) return false
  if (project.bid_date && project.bid_date < periodStart) return false
  return true
}

/**
 * 이 회계기간에 "활성"으로 볼 참여기술인을 가진 프로젝트 id 집합.
 *
 * status가 '진행중'인 것만으로는 부족하다 — 참여자 status는 사람이 참여기술인 관리 모달에서 직접
 * 종료 처리할 때만 '종료'로 바뀌고, 프로젝트 일정이 끝나도 자동으로 닫히지 않는다. 그래서 이 집합을
 * 기간과 무관하게 만들면 한 번 참여자가 등록된 프로젝트는 일정이 끝나도(심지어 미래 월을 조회해도)
 * 매번 목록에 다시 뜬다(사용자 지적).
 *
 * 그래서 관리자가 명시적으로 잡아둔 참여기간(participation_start/end)이 조회 기간과 겹칠 때만
 * 활성으로 본다. 참여기간이 둘 다 비어 있으면(NULL = 프로젝트 일정 상속) 이 집합에 넣지 않는다 —
 * 그 경우의 판단은 projectOverlapsPeriod가 이미 프로젝트 일정으로 하고 있고, 과거 기록이 있는
 * 프로젝트는 filterVisibleProjects의 projectIdsWithRecords가 따로 붙잡아 준다.
 */
export function projectIdsWithActiveParticipantsInPeriod(
  participants: readonly ProjectParticipant[],
  periodStart: string,
  periodEnd: string,
): Set<string> {
  const ids = new Set<string>()
  for (const p of participants) {
    if (p.status !== '진행중') continue
    if (!p.participation_start && !p.participation_end) continue
    if (p.participation_end && p.participation_end < periodStart) continue
    if (p.participation_start && p.participation_start > periodEnd) continue
    ids.add(p.project_id)
  }
  return ids
}

export interface FilterParticipantRowsInput {
  participants: ProjectParticipant[]
  projectId: string
  recordedParticipantIds: Set<string>
  specialtyFilter: string
  specialtyNameById: Map<string, string>
  engineerSearch: string
  engineerNameById: Map<string, string>
}

/**
 * 한 프로젝트의 표시 대상 참여기술인 — "진행중"이거나(활성) 이 기간에 출근기록이 있으면(종료됐어도)
 * 행을 유지한다(단장 교체 등으로 종료된 참여자의 과거 체크가 화면에서 사라지지 않도록).
 * 분야/기술인 검색 필터를 적용한 뒤 단장이 먼저 오도록 정렬한다.
 */
export function filterParticipantRows(input: FilterParticipantRowsInput): ProjectParticipant[] {
  const q = input.engineerSearch.trim().toLowerCase()
  return input.participants
    .filter(p => p.project_id === input.projectId && (p.status === '진행중' || input.recordedParticipantIds.has(p.id)))
    .filter(p => input.specialtyFilter === '전체' || input.specialtyNameById.get(p.specialty_id ?? '') === input.specialtyFilter)
    .filter(p => !q || (input.engineerNameById.get(p.engineer_id) ?? '').toLowerCase().includes(q))
    .sort((a, b) => (b.is_director ? 1 : 0) - (a.is_director ? 1 : 0) || a.sort_order - b.sort_order)
}

export interface FilterVisibleProjectsInput<P extends ProjectForGridFilter> {
  projects: P[]
  periodStart: string
  periodEnd: string
  statusFilter: string
  search: string
  /** 발주처 이름. '전체'이거나 생략하면 거르지 않는다. */
  clientFilter?: string
  projectIdsWithActiveParticipants: Set<string>
  projectIdsWithRecords: Set<string>
  rowParticipantCount: (projectId: string) => number
  hasParticipantFilter: boolean
}

/**
 * 표시할 프로젝트 = (기간과 겹침 OR 활성 참여자 있음 OR 이 기간 출근기록 있음) AND 상태/발주처/검색 필터 통과.
 * 분야·기술인 검색이 걸려 있으면(hasParticipantFilter) 참여자 행이 0건인 프로젝트는 숨긴다.
 */
export function filterVisibleProjects<P extends ProjectForGridFilter>(
  input: FilterVisibleProjectsInput<P>,
): P[] {
  const q = input.search.trim().toLowerCase()
  return input.projects.filter(p => {
    // 취소된 프로젝트는 기본적으로 출근부에 포함하지 않는다(사용자 지시) — 다만 상태 필터에서
    // 사용자가 명시적으로 '취소'를 선택했을 때는(과거 확인 목적) 그대로 보여준다.
    if (p.status === '취소' && input.statusFilter !== '취소') return false
    const relevant =
      projectOverlapsPeriod(p, input.periodStart, input.periodEnd) ||
      input.projectIdsWithActiveParticipants.has(p.id) ||
      input.projectIdsWithRecords.has(p.id)
    if (!relevant) return false
    if (input.statusFilter !== '전체' && p.status !== input.statusFilter) return false
    // 발주처는 정확히 일치할 때만 남긴다 — 목록에서 고른 값이라 부분일치로 넓힐 이유가 없다.
    if (input.clientFilter && input.clientFilter !== '전체' && (p.client ?? '') !== input.clientFilter) return false
    if (q && !p.name.toLowerCase().includes(q) && !p.project_number.toLowerCase().includes(q)) return false
    if (input.hasParticipantFilter && input.rowParticipantCount(p.id) === 0) return false
    return true
  })
}

/** 출근기록 저장/삭제 실패 시 보여줄 메시지 — DB 에러 코드를 화면 문구로 매핑하는 부분만 분리해 테스트한다. */
export function attendanceRecordErrorMessage(action: 'insert' | 'delete', errorCode: string | undefined): string {
  if (action === 'delete') return '출근 체크 해제에 실패했습니다.'
  return errorCode === '23505' ? '이미 저장된 출근기록입니다.' : '출근 체크 저장에 실패했습니다.'
}
