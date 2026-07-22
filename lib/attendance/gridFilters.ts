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
}

/**
 * 프로젝트의 공고일~면접일이 조회 중인 회계기간과 겹치는지. 면접일 없으면 계속 겹치는 것으로 본다 —
 * 다만 개찰일(bid_date)이 그 회계기간 시작보다 이전이면, 면접일이 없어도 이미 개찰이 끝난 사업이므로
 * 더 이상 겹치는 것으로 보지 않는다(사용자 지시 — 개찰이 끝난 사업은 출근부에 계속 남지 않게 함).
 */
export function projectOverlapsPeriod(
  project: ProjectForGridFilter,
  periodStart: string,
  periodEnd: string,
): boolean {
  if (!project.announce_date) return false
  if (project.announce_date > periodEnd) return false
  if (project.interview_date && project.interview_date < periodStart) return false
  if (project.bid_date && project.bid_date < periodStart) return false
  return true
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
  projectIdsWithActiveParticipants: Set<string>
  projectIdsWithRecords: Set<string>
  rowParticipantCount: (projectId: string) => number
  hasParticipantFilter: boolean
}

/**
 * 표시할 프로젝트 = (기간과 겹침 OR 활성 참여자 있음 OR 이 기간 출근기록 있음) AND 상태/검색 필터 통과.
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
