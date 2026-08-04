/**
 * 기술인 출근부 — 월별 출력물에 들어갈 행을 조립하는 순수 로직 (Phase 5).
 *
 * 워크북 조립(monthlyWorkbook.ts)은 exceljs 호출로만 채우고, "어떤 프로젝트의 어떤 기술인이
 * 며칠 나왔고 비고에 무엇이 적히는가"는 전부 이 파일에서 정한다 — 화면(AttendanceGrid.tsx)과
 * 같은 값이 나와야 하므로 판정 함수는 새로 만들지 않고 화면이 쓰는 것을 그대로 재사용한다:
 *   · 출근 여부      → lib/attendance/summary.ts    presentDatesByParticipant
 *   · 체크 가능 기간 → lib/attendance/participantPeriod.ts computeAttendancePeriod
 *   · 비고           → lib/attendance/changeHistoryFormat.ts formatChangeHistoryForPeriod
 *
 * 표시할 프로젝트·참여기술인을 고르는 필터(gridFilters.ts)는 호출부가 적용한 뒤 넘긴다 —
 * 서버(API Route)가 화면과 같은 필터를 적용해야 "보이는 대로 출력"이 성립하기 때문이다.
 */
import type { PayPeriodDay } from '../period'
import { computeAttendancePeriod, isDateWithinAttendancePeriod } from '../participantPeriod'
import { presentDatesByParticipant } from '../summary'
import { formatChangeHistoryForPeriod } from '../changeHistoryFormat'
import type { AttendanceRecord, ProjectChangeHistory, ProjectParticipant } from '../types'

/** 출력에 필요한 프로젝트 최소 정보 — 화면의 AttendanceProjectRow와 같은 모양이다. */
export interface MonthlyExportProject {
  id: string
  project_number: string
  name: string
  announce_date: string | null
  interview_date: string | null
}

export interface MonthlyExportParticipantRow {
  /** 직책 — 단장이면 role, 아니면 분야명을 우선 표기(화면 AttendanceGrid와 동일 규칙) */
  role: string
  specialty: string
  name: string
  isDirector: boolean
  /** 출근 처리된 날짜(YYYY-MM-DD) */
  presentDates: string[]
  /** 체크 가능 기간에 속하는 날짜 — 출력물에서 기간 밖 칸을 음영 처리하는 데 쓴다 */
  eligibleDates: string[]
  presentCount: number
}

export interface MonthlyExportProjectBlock {
  projectId: string
  projectNumber: string
  projectName: string
  /** 이 기간의 변경이력을 줄바꿈으로 이은 비고 — 없으면 빈 문자열 */
  note: string
  participants: MonthlyExportParticipantRow[]
}

export interface BuildMonthlyExportBlocksInput {
  days: PayPeriodDay[]
  projects: readonly MonthlyExportProject[]
  /** 이미 필터가 적용된 참여기술인 목록을 프로젝트별로 돌려주는 함수 */
  participantsOf: (projectId: string) => ProjectParticipant[]
  engineerNameById: ReadonlyMap<string, string>
  specialtyNameById: ReadonlyMap<string, string>
  records: readonly AttendanceRecord[]
  changeHistory: readonly ProjectChangeHistory[]
  periodStart: string
  periodEnd: string
}

/**
 * 참여기술인이 한 명도 없는 프로젝트도 블록으로 남긴다 — 화면이 "등록된 참여기술인이 없습니다"
 * 행을 보여주는 것과 같은 이유다. 명부에서 통째로 빠지면 누락인지 원래 없는 건지 알 수 없다.
 */
export function buildMonthlyExportBlocks(
  input: BuildMonthlyExportBlocksInput,
): MonthlyExportProjectBlock[] {
  const presentByParticipant = presentDatesByParticipant([...input.records])
  const periodEndOfView = input.days[input.days.length - 1]?.dateStr ?? input.periodEnd

  return input.projects.map(project => {
    const noteLines = formatChangeHistoryForPeriod(
      [...input.changeHistory],
      input.periodStart,
      input.periodEnd,
      project.id,
    )

    const participants = input.participantsOf(project.id).map(participant => {
      const period = computeAttendancePeriod({
        announceDate: project.announce_date,
        interviewDate: project.interview_date,
        participationStart: participant.participation_start,
        participationEnd: participant.participation_end,
        viewedPeriodEnd: periodEndOfView,
      })
      const presentSet = presentByParticipant.get(participant.id)
      const specialty = participant.specialty_id
        ? input.specialtyNameById.get(participant.specialty_id) ?? ''
        : ''

      const presentDates: string[] = []
      const eligibleDates: string[] = []
      for (const day of input.days) {
        if (presentSet?.has(day.dateStr)) presentDates.push(day.dateStr)
        if (isDateWithinAttendancePeriod(period, day.dateStr)) eligibleDates.push(day.dateStr)
      }

      return {
        // 화면과 같은 규칙 — 단장만 role을 쓰고 나머지는 분야명을 쓴다(분야가 없으면 role로 되돌림).
        role: participant.is_director ? participant.role : (specialty || participant.role),
        specialty,
        name: input.engineerNameById.get(participant.engineer_id) ?? '(알 수 없음)',
        isDirector: participant.is_director,
        presentDates,
        eligibleDates,
        // 합계는 이 기간 안의 출근만 센다 — records에 기간 밖 행이 섞여 들어와도 표와 어긋나지 않게.
        presentCount: presentDates.length,
      }
    })

    return {
      projectId: project.id,
      projectNumber: project.project_number,
      projectName: project.name,
      note: noteLines.join('\n'),
      participants,
    }
  })
}

/** 출력물 전체의 출근 연인원 — 시트 하단 합계에 쓴다. */
export function totalPresentCount(blocks: readonly MonthlyExportProjectBlock[]): number {
  return blocks.reduce(
    (sum, block) => sum + block.participants.reduce((s, p) => s + p.presentCount, 0),
    0,
  )
}
