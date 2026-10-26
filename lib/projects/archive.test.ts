import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { buildArchiveParticipationSheet, liveLedgerYear, type ArchiveStaffRow } from './archive'
import { buildProjectLedgerWorkbook } from './export/projectLedgerWorkbook'
import type { LedgerProject } from './export/ledgerRows'

function staff(overrides: Partial<ArchiveStaffRow>): ArchiveStaffRow {
  return {
    section: 'director', person_seq: 1, name: '김우영', field: '단장', line_no: 1,
    project_text: '', archive_project_id: null,
    ...overrides,
  }
}

const PROJECTS = [
  { id: 'p-win', result_score: '1등', evaluation: '선', participants: '선, 광장', status_override: null },
  { id: 'p-lose', result_score: '2등', evaluation: '광장', participants: '선, 광장', status_override: null },
]

// 2021년 대장 2시트에서 옮겨 온 모양 — 셀 하나에 두 줄, 그중 한 줄은 1시트에 없는 프로젝트.
const STAFF: ArchiveStaffRow[] = [
  staff({ person_seq: 1, name: '김우영', line_no: 2, project_text: '인천지방법원 별관청사' }),
  staff({ person_seq: 1, name: '김우영', line_no: 1, project_text: 'LH천안신부', archive_project_id: 'p-win' }),
  staff({ person_seq: 2, name: '김대현', project_text: 'LH밀양가곡', archive_project_id: 'p-lose' }),
  staff({ section: 'specialist', person_seq: 1, name: '이재욱', field: '건축', project_text: 'LH천안신부', archive_project_id: 'p-win' }),
  staff({ section: 'specialist', person_seq: 2, name: '김태현', field: '안전', project_text: '345kV 신기흥변전소(수주)' }),
]

describe('buildArchiveParticipationSheet', () => {
  const sheet = buildArchiveParticipationSheet(STAFF, PROJECTS)

  it('사람은 원본 번호 순, 줄은 셀 안의 순서대로 모은다', () => {
    expect(sheet.directors.map(r => r.name)).toEqual(['김우영', '김대현'])
    expect(sheet.directors[0].projectNames).toEqual(['LH천안신부', '인천지방법원 별관청사'])
    expect(sheet.directors[0].count).toBe(2)
  })

  it('1시트와 연결 안 된 줄도 원문 그대로 남기고 linked=false로 구분한다', () => {
    expect(sheet.directors[0].lines.map(l => l.linked)).toEqual([true, false])
  })

  it('수주 판정 — 연결된 프로젝트가 수주했거나, 원문에 "수주"가 적혀 있으면', () => {
    expect(sheet.directors[0].hasWin).toBe(true)
    expect(sheet.directors[1].hasWin).toBe(false)
    expect(sheet.specialists.map(r => r.hasWin)).toEqual([true, true])
  })

  it('분야는 원본 칸 값을 그대로 쓴다(2021~2023년 책임기술인은 "단장")', () => {
    expect(sheet.directors[0].field).toBe('단장')
    expect(sheet.specialists[1].field).toBe('안전')
  })
})

describe('liveLedgerYear', () => {
  it('보관된 마지막 연도의 다음 해가 올해 대장이다 — 1월에 달력이 넘어가도 이관 전엔 그대로', () => {
    expect(liveLedgerYear([2021, 2022, 2025], 2027)).toBe(2026)
  })
  it('보관 연도가 없으면 달력 연도', () => {
    expect(liveLedgerYear([], 2026)).toBe(2026)
  })
})

describe('buildProjectLedgerWorkbook — 과거 연도 2시트 주입', () => {
  it('넘긴 2시트를 계산값 대신 그대로 쓴다(1시트 인력 칸이 비어 있어도)', async () => {
    const ledger: LedgerProject[] = [{
      project_number: '2084', type: '종심제', client: 'LH', name: '천안신부 행복주택',
      fee: 70.4, tp_score: '37+12p', duration_days: '45', submit_date: '2020-12-17', interview_date: null,
      interview_written: false, result_score: '1등', evaluation: '선', participants: '선, 광장', note: '',
      director: '', staff_arch: '', staff_civil: '', staff_mech: '', staff_safety: '', status_override: null,
    }]
    const buffer = await buildProjectLedgerWorkbook(2021, ledger, buildArchiveParticipationSheet(STAFF, PROJECTS))
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer as unknown as ArrayBuffer)
    const sheet2 = wb.getWorksheet('21년 참여기술자')!
    expect(sheet2.getCell(3, 2).value).toBe('김우영')
    expect(sheet2.getCell(3, 4).value).toBe('LH천안신부\n인천지방법원 별관청사')
    expect(sheet2.getCell(3, 5).value).toBe(2)
  })
})
