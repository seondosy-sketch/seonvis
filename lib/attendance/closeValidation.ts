/**
 * 기술인 출근부 — 월 마감 전 검증 (마스터 프롬프트 7번 항목, docs/attendance/02-requirements.md §7).
 *
 * 이 코드베이스 관례상 쿼리 레이어(queries.ts)를 두지 않으므로(docs/overtime.md 6단계 결정사항),
 * 이 함수는 DB에 접근하지 않는 순수 함수다 — Phase 4에서 화면이 이미 조회해둔 배열을 그대로 넘긴다.
 *
 * 오류(errors) = 마감을 막는다 / 경고(warnings) = 마감은 가능하되 사용자에게 확인을 요구한다.
 * 분류 기준은 마스터 프롬프트 예시("오류: 중복 출근기록, 필수 식별정보 누락 / 경고: 면접일 미입력,
 * 비고 미작성")를 그대로 따르고, 나머지 항목은 그 기준에 맞춰 분류했다(이 파일 각 함수 주석 참고).
 */
import { computeAttendancePeriod, isDateWithinAttendancePeriod } from './participantPeriod'
import type { AttendanceRecord, ProjectParticipant, ProjectChangeHistory } from './types'

export type IssueSeverity = 'error' | 'warning'

export interface ValidationIssue {
  code: string
  severity: IssueSeverity
  message: string
  projectId?: string
  engineerId?: string
  workDate?: string
}

/** 이 검증 모듈이 알아야 하는 프로젝트 정보의 최소 형태. 취소 여부는 호출부가 기존 computeProjectStatus로 계산해 넘긴다(중복 계산 금지). */
export interface ProjectForValidation {
  id: string
  announce_date: string | null
  interview_date: string | null
  director: string // projects.director — 참여기술인 목록과의 불일치 검사용
  isCancelled: boolean
}

export interface CloseValidationInput {
  periodStart: string
  periodEnd: string
  projects: ProjectForValidation[]
  participants: ProjectParticipant[]
  attendanceRecords: AttendanceRecord[]
  changeHistory: ProjectChangeHistory[]
}

export interface CloseValidationResult {
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
}

/** 오류 — 동일 (project_id, engineer_id, work_date) 중복. DB unique 제약으로 평소엔 생길 수 없지만 방어적으로 검사. */
function findDuplicateAttendanceRecords(records: AttendanceRecord[]): ValidationIssue[] {
  const seen = new Map<string, number>()
  for (const r of records) {
    const key = `${r.project_id}__${r.engineer_id}__${r.work_date}`
    seen.set(key, (seen.get(key) ?? 0) + 1)
  }
  const issues: ValidationIssue[] = []
  for (const [key, count] of seen) {
    if (count > 1) {
      const [projectId, engineerId, workDate] = key.split('__')
      issues.push({
        code: 'duplicate_attendance_record',
        severity: 'error',
        message: `동일 프로젝트·기술인·날짜에 출근기록이 ${count}건 중복되어 있습니다.`,
        projectId, engineerId, workDate,
      })
    }
  }
  return issues
}

/** 오류 — 필수 식별정보 누락: 출근기록이 가리키는 참여자(participant_id)가 참여기술인 목록에 없음. */
function findMissingIdentifyingInfo(
  records: AttendanceRecord[],
  participants: ProjectParticipant[],
): ValidationIssue[] {
  const participantIds = new Set(participants.map(p => p.id))
  return records
    .filter(r => !participantIds.has(r.participant_id))
    .map(r => ({
      code: 'missing_identifying_info',
      severity: 'error' as const,
      message: '출근기록이 참조하는 참여기술인 정보를 찾을 수 없습니다.',
      projectId: r.project_id, engineerId: r.engineer_id, workDate: r.work_date,
    }))
}

/** 오류 — 같은 프로젝트에 같은 기술인의 "진행중" 참여가 2건 이상(중복 참여기술인). */
function findDuplicateActiveParticipants(participants: ProjectParticipant[]): ValidationIssue[] {
  const seen = new Map<string, number>()
  for (const p of participants) {
    if (p.status !== '진행중') continue
    const key = `${p.project_id}__${p.engineer_id}`
    seen.set(key, (seen.get(key) ?? 0) + 1)
  }
  const issues: ValidationIssue[] = []
  for (const [key, count] of seen) {
    if (count > 1) {
      const [projectId, engineerId] = key.split('__')
      issues.push({
        code: 'duplicate_active_participant',
        severity: 'error',
        message: '같은 프로젝트에 동일 기술인의 진행중 참여가 중복 등록되어 있습니다.',
        projectId, engineerId,
      })
    }
  }
  return issues
}

/** 오류 — 취소된 프로젝트에 입력된 출근기록. */
function findAttendanceForCancelledProjects(
  records: AttendanceRecord[],
  projects: ProjectForValidation[],
): ValidationIssue[] {
  const cancelledIds = new Set(projects.filter(p => p.isCancelled).map(p => p.id))
  return records
    .filter(r => cancelledIds.has(r.project_id))
    .map(r => ({
      code: 'attendance_for_cancelled_project',
      severity: 'error' as const,
      message: '취소된 프로젝트에 출근기록이 남아 있습니다.',
      projectId: r.project_id, engineerId: r.engineer_id, workDate: r.work_date,
    }))
}

/** 오류 — 프로젝트 기간(공고일~면접일, 참여자 예외조정 포함) 밖에 입력된 출근기록. */
function findAttendanceOutOfPeriod(
  records: AttendanceRecord[],
  participants: ProjectParticipant[],
  projects: ProjectForValidation[],
  periodEnd: string,
): ValidationIssue[] {
  const participantById = new Map(participants.map(p => [p.id, p]))
  const projectById = new Map(projects.map(p => [p.id, p]))
  const issues: ValidationIssue[] = []
  for (const r of records) {
    const participant = participantById.get(r.participant_id)
    const project = projectById.get(r.project_id)
    if (!participant || !project) continue // missing-identifying-info 쪽에서 이미 잡음
    const period = computeAttendancePeriod({
      announceDate: project.announce_date,
      interviewDate: project.interview_date,
      participationStart: participant.participation_start,
      participationEnd: participant.participation_end,
      viewedPeriodEnd: periodEnd,
    })
    if (!isDateWithinAttendancePeriod(period, r.work_date)) {
      issues.push({
        code: 'attendance_out_of_period',
        severity: 'error',
        message: '프로젝트 참여 가능 기간을 벗어난 날짜에 출근기록이 있습니다.',
        projectId: r.project_id, engineerId: r.engineer_id, workDate: r.work_date,
      })
    }
  }
  return issues
}

/** 경고 — 공고일 또는 면접일 누락(진행중 참여기술인이 있는 프로젝트만 대상). */
function findScheduleDateWarnings(
  projects: ProjectForValidation[],
  participants: ProjectParticipant[],
): ValidationIssue[] {
  const relevantProjectIds = new Set(participants.map(p => p.project_id))
  return projects
    .filter(p => relevantProjectIds.has(p.id) && !p.isCancelled)
    .filter(p => !p.announce_date || !p.interview_date || !p.interview_date.trim())
    .map(p => ({
      code: 'schedule_date_missing',
      severity: 'warning' as const,
      message: !p.announce_date ? '공고일이 입력되지 않았습니다.' : '면접일이 입력되지 않았습니다.',
      projectId: p.id,
    }))
}

/** 경고 — 참여기술인의 직책 또는 분야 누락. */
function findParticipantFieldWarnings(participants: ProjectParticipant[]): ValidationIssue[] {
  return participants
    .filter(p => p.status === '진행중' && (!p.role.trim() || !p.specialty_id))
    .map(p => ({
      code: 'participant_field_missing',
      severity: 'warning' as const,
      message: !p.role.trim() ? '참여기술인의 직책이 입력되지 않았습니다.' : '참여기술인의 분야가 입력되지 않았습니다.',
      projectId: p.project_id, engineerId: p.engineer_id,
    }))
}

/** 경고 — 이번 기간 중 참여자 변경(신규 참여/종료)이 있었는데 그 기간에 해당하는 변경이력이 없음. */
function findMissingChangeNotes(
  participants: ProjectParticipant[],
  changeHistory: ProjectChangeHistory[],
  periodStart: string,
  periodEnd: string,
): ValidationIssue[] {
  const inPeriod = (d: string | null) => !!d && d >= periodStart && d <= periodEnd
  const changedProjectIds = new Set(
    participants.filter(p => inPeriod(p.participation_start) || inPeriod(p.participation_end)).map(p => p.project_id),
  )
  const historyProjectIds = new Set(
    changeHistory.filter(h => h.change_date >= periodStart && h.change_date <= periodEnd).map(h => h.project_id),
  )
  return [...changedProjectIds]
    .filter(projectId => !historyProjectIds.has(projectId))
    .map(projectId => ({
      code: 'change_note_missing',
      severity: 'warning' as const,
      message: '이번 기간 중 참여기술인 변경이 있었으나 변경이력(비고)이 작성되지 않았습니다.',
      projectId,
    }))
}

/** 경고 — Project List의 단장(director, 레거시 텍스트 필드)과 참여기술인 목록의 단장 지정이 불일치. */
function findDirectorMismatchWarnings(
  projects: ProjectForValidation[],
  participants: ProjectParticipant[],
): ValidationIssue[] {
  const activeDirectorProjectIds = new Set(
    participants.filter(p => p.status === '진행중' && p.is_director).map(p => p.project_id),
  )
  return projects
    .filter(p => p.director.trim() && !p.isCancelled && !activeDirectorProjectIds.has(p.id))
    .map(p => ({
      code: 'director_mismatch',
      severity: 'warning' as const,
      message: 'Project List에 단장 정보가 있으나 참여기술인 목록에 단장으로 지정된 사람이 없습니다.',
      projectId: p.id,
    }))
}

export function validateForClose(input: CloseValidationInput): CloseValidationResult {
  const errors: ValidationIssue[] = [
    ...findDuplicateAttendanceRecords(input.attendanceRecords),
    ...findMissingIdentifyingInfo(input.attendanceRecords, input.participants),
    ...findDuplicateActiveParticipants(input.participants),
    ...findAttendanceForCancelledProjects(input.attendanceRecords, input.projects),
    ...findAttendanceOutOfPeriod(input.attendanceRecords, input.participants, input.projects, input.periodEnd),
  ]
  const warnings: ValidationIssue[] = [
    ...findScheduleDateWarnings(input.projects, input.participants),
    ...findParticipantFieldWarnings(input.participants),
    ...findMissingChangeNotes(input.participants, input.changeHistory, input.periodStart, input.periodEnd),
    ...findDirectorMismatchWarnings(input.projects, input.participants),
  ]
  return { errors, warnings }
}
