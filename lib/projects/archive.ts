/**
 * 프로젝트 List 과거 연도(project_archive / project_archive_staff) — 순수 로직.
 *
 * 표 구조와 이유는 supabase/migration_project_archive.sql 머리말, 데이터는 scripts/import_project_archive.py.
 *
 * 올해(projects)와 과거 연도의 차이:
 *   - 올해의 참여현황(2시트)은 1시트 인력 칸에서 전부 계산된다(ledgerRows.ts buildParticipationSheet).
 *   - 과거 연도는 엑셀 2시트에 사람이 손으로 적은 줄이 원본이다. 2021~2024년은 1시트에 분야 인력 칸이
 *     없어서 계산으로는 만들 수 없다 → 저장된 줄을 그대로 보여준다. 1시트 프로젝트와 연결 안 된 줄도
 *     원문을 지우지 않고 보여준다(linked=false).
 *
 * 이 파일은 DB에 접근하지 않는다.
 */

import { computeProjectStatus } from '@/lib/projectStatus'
import type { LedgerProject, ParticipationRow, ParticipationSheet } from '@/lib/projects/export/ledgerRows'

/** project_archive 한 행에서 화면·출력이 쓰는 칸 — 이름은 projects와 같다. */
export interface ArchiveProject {
  id: string
  ledger_year: number
  seq: number | null
  project_number: string
  type: string
  order_basis: string
  client: string
  name: string
  fee: number | null
  fee_raw: string
  tp_score: string
  duration_days: string
  submit_date: string | null
  interview_date: string | null
  interview_written: boolean
  interview_raw: string
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
  created_at: string
}

export interface ArchiveStaffRow {
  section: 'director' | 'specialist'
  person_seq: number
  name: string
  field: string
  line_no: number
  project_text: string
  archive_project_id: string | null
}

/** 참여현황 한 줄 — 원문과 연결 여부. */
export interface ParticipationLine {
  text: string
  /** 1시트 프로젝트와 연결됐는지. false면 원문만 있다(검토표 '미매칭'). */
  linked: boolean
  /** 연결된 프로젝트가 수주했거나 원문에 '수주'가 적혀 있다. */
  win: boolean
  /** 전체 연도 보기에서만 — 이 줄이 어느 해 대장 것인지. */
  year?: number
}

export interface ArchiveParticipationRow extends ParticipationRow {
  lines: ParticipationLine[]
}

export interface ArchiveParticipationSheet extends ParticipationSheet {
  directors: ArchiveParticipationRow[]
  specialists: ArchiveParticipationRow[]
}

const WIN_TEXT = /수주/

/**
 * 저장된 2시트 줄 → 화면/출력용 집계. 사람 순서는 원본의 '번호', 줄 순서는 셀 안의 순서.
 * 누적(회)은 줄 수다 — 원본 '누적(회)' 칸은 손으로 적어 줄 수와 다른 사람이 몇 있다(이관 로그 참고).
 */
export function buildArchiveParticipationSheet(
  staff: ArchiveStaffRow[],
  projects: Pick<ArchiveProject, 'id' | 'result_score' | 'evaluation' | 'participants' | 'status_override'>[],
): ArchiveParticipationSheet {
  const winById = new Map(projects.map(p => [p.id, computeProjectStatus(p) === '수주']))

  const group = (section: ArchiveStaffRow['section']): ArchiveParticipationRow[] => {
    const people = new Map<string, ArchiveStaffRow[]>()
    for (const row of staff.filter(s => s.section === section)) {
      const key = `${row.person_seq}\u0000${row.name}`
      const list = people.get(key) ?? []
      list.push(row)
      people.set(key, list)
    }
    return [...people.values()]
      .sort((a, b) => a[0].person_seq - b[0].person_seq)
      .map(rows => {
        const sorted = [...rows].sort((a, b) => a.line_no - b.line_no)
        const lines = sorted.map(r => ({
          text: r.project_text,
          linked: r.archive_project_id != null,
          win: (r.archive_project_id != null && winById.get(r.archive_project_id) === true) || WIN_TEXT.test(r.project_text),
        }))
        return {
          name: sorted[0].name,
          field: sorted[0].field,
          projectNames: lines.map(l => l.text),
          count: lines.length,
          hasWin: lines.some(l => l.win),
          lines,
        }
      })
  }

  return { directors: group('director'), specialists: group('specialist') }
}

/**
 * 프로젝트 List가 '올해'로 보여줄 연도 — 보관된 마지막 연도 다음 해.
 * 달력 연도를 쓰지 않는 이유: 1월에 넘어가도 projects에는 아직 전년도 대장이 들어 있다.
 * 전년도를 보관 표로 옮기는 순간(연말 이관) 자동으로 다음 해가 된다. 보관 연도가 없으면 달력 연도.
 */
export function liveLedgerYear(archiveYears: number[], fallbackYear: number): number {
  return archiveYears.length ? Math.max(...archiveYears) + 1 : fallbackYear
}

/**
 * 올해(projects)의 참여현황 — ledgerRows.ts가 계산한 집계에 줄 단위 정보(연결·수주)를 붙인다.
 * 올해 줄은 1시트 인력 칸에서 나온 것이라 전부 연결돼 있다.
 */
export function liveParticipationSheet(
  sheet: ParticipationSheet,
  projects: Pick<LedgerProject, 'name' | 'result_score' | 'evaluation' | 'participants' | 'status_override'>[],
): ArchiveParticipationSheet {
  const winNames = new Set(projects.filter(p => computeProjectStatus(p) === '수주').map(p => p.name))
  const withLines = (rows: ParticipationRow[]): ArchiveParticipationRow[] => rows.map(r => ({
    ...r,
    lines: r.projectNames.map(text => ({ text, linked: true, win: winNames.has(text) })),
  }))
  return { directors: withLines(sheet.directors), specialists: withLines(sheet.specialists) }
}

/**
 * 같은 사람인지 판단하는 키 — 연도마다 표기가 조금씩 다르다(2025년 '이상원(57)', 띄어쓰기 차이).
 * 괄호 안 구분자와 공백을 지운다. 동명이인은 대장에도 구분이 없어 합쳐진다(괄호 구분이 있으면 그 표기를 보여준다).
 */
export function participantKey(name: string): string {
  return name.replace(/[(（][^)）]*[)）]/g, '').replace(/\s/g, '')
}

/**
 * 전체 연도 참여현황 — 연도별 집계를 사람 단위로 합친다.
 * 책임기술인/분야별은 따로 합친다(엑셀 2시트와 같은 구분 — 한 사람이 해마다 다른 쪽에 있을 수 있다).
 * 줄은 최근 연도부터, 사람은 누적이 많은 순(같으면 이름순). 표기·분야는 가장 최근 연도 것을 쓴다.
 */
export function mergeParticipationYears(
  entries: { year: number; sheet: ArchiveParticipationSheet }[],
): ArchiveParticipationSheet {
  const sorted = [...entries].sort((a, b) => b.year - a.year)
  const merge = (pick: (s: ArchiveParticipationSheet) => ArchiveParticipationRow[]): ArchiveParticipationRow[] => {
    const people = new Map<string, ArchiveParticipationRow>()
    for (const { year, sheet } of sorted) {
      for (const row of pick(sheet)) {
        const key = participantKey(row.name)
        const lines = row.lines.map(l => ({ ...l, year }))
        const found = people.get(key)
        if (!found) {
          people.set(key, { ...row, lines, projectNames: lines.map(l => l.text) })
        } else {
          found.lines.push(...lines)
          found.projectNames.push(...lines.map(l => l.text))
          found.hasWin = found.hasWin || row.hasWin
        }
      }
    }
    return [...people.values()]
      .map(r => ({ ...r, count: r.lines.length }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ko'))
  }
  return { directors: merge(s => s.directors), specialists: merge(s => s.specialists) }
}
