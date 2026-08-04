import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { getPayPeriodForLabel, getPayPeriodRangeForLabel } from '../period'
import { buildMonthlyAttendanceWorkbook } from './monthlyWorkbook'
import type { MonthlyExportProjectBlock } from './monthlyRows'

// 2026년 8월분 = 2026-07-21 ~ 2026-08-20 (31일)
const DAYS = getPayPeriodForLabel(2026, 8)
const { start: PERIOD_START, end: PERIOD_END } = getPayPeriodRangeForLabel(2026, 8)

const BLOCKS: MonthlyExportProjectBlock[] = [
  {
    projectId: 'p1',
    projectNumber: '2647',
    projectName: '가 감리용역',
    note: '08.02 공고 취소\n08.05 재공고',
    participants: [
      {
        role: '단장', specialty: '건축', name: '홍길동', isDirector: true,
        presentDates: ['2026-07-25', '2026-08-03'],
        eligibleDates: DAYS.map(d => d.dateStr),
        presentCount: 2,
      },
      {
        role: '토목', specialty: '토목', name: '김철수', isDirector: false,
        presentDates: ['2026-08-03'],
        eligibleDates: ['2026-08-01', '2026-08-03'],
        presentCount: 1,
      },
    ],
  },
  {
    projectId: 'p2', projectNumber: '2650', projectName: '나 감리용역', note: '',
    participants: [],
  },
]

async function buildAndOpen(blocks: MonthlyExportProjectBlock[]) {
  const buffer = await buildMonthlyAttendanceWorkbook({
    year: 2026,
    periodMonth: 8,
    days: DAYS,
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    blocks,
    holidays: new Set(['2026-08-15']),
    closureLabel: '미마감',
    printedOn: '2026-08-21',
  })
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer)
  return { buffer, worksheet: workbook.worksheets[0] }
}

describe('buildMonthlyAttendanceWorkbook', () => {
  it('실제로 열리는 xlsx를 만든다', async () => {
    const { buffer, worksheet } = await buildAndOpen(BLOCKS)
    expect(buffer.length).toBeGreaterThan(0)
    expect(worksheet.name).toBe('2026년 8월')
  })

  it('제목과 대상기간·마감 상태를 적는다', async () => {
    const { worksheet } = await buildAndOpen(BLOCKS)
    expect(worksheet.getCell(1, 1).value).toBe('기술인 출근명부 (2026년 8월분)')
    const meta = String(worksheet.getCell(2, 1).value)
    expect(meta).toContain('2026.07.21 ~ 2026.08.20')
    expect(meta).toContain('출력일 2026-08-21')
    expect(meta).toContain('마감 미마감')
  })

  it('머리글은 3단(월/일/요일)이고 정보 열은 세로 병합한다', async () => {
    const { worksheet } = await buildAndOpen(BLOCKS)
    expect(worksheet.getCell(4, 1).value).toBe('프로젝트')
    expect(worksheet.getCell(4, 4).value).toBe('성명')
    // 5열이 첫 날짜(7/21) — 월 머리글은 "7월", 일자는 21, 요일은 화
    expect(worksheet.getCell(4, 5).value).toBe('7월')
    expect(worksheet.getCell(5, 5).value).toBe(21)
    expect(worksheet.getCell(6, 5).value).toBe('화')
    // 마지막 날짜 열(8/20)
    const lastDayCol = 4 + DAYS.length
    expect(worksheet.getCell(5, lastDayCol).value).toBe(20)
  })

  it('출근 칸에는 1을 넣고 출근일수는 SUM 수식으로 둔다', async () => {
    const { worksheet } = await buildAndOpen(BLOCKS)
    const firstDataRow = 7
    // 7/21이 5열이므로 7/25는 9열, 8/3은 18열
    expect(worksheet.getCell(firstDataRow, 9).value).toBe(1)
    expect(worksheet.getCell(firstDataRow, 18).value).toBe(1)
    expect(worksheet.getCell(firstDataRow, 10).value).toBeFalsy() // 7/22 미출근

    const totalCol = 5 + DAYS.length
    const total = worksheet.getCell(firstDataRow, totalCol).value as { formula?: string }
    expect(total.formula).toMatch(/^SUM\(/)
  })

  it('프로젝트명·직책·성명과 비고를 적는다', async () => {
    const { worksheet } = await buildAndOpen(BLOCKS)
    expect(String(worksheet.getCell(7, 1).value)).toContain('가 감리용역')
    expect(String(worksheet.getCell(7, 1).value)).toContain('2647')
    expect(worksheet.getCell(7, 2).value).toBe('단장')
    expect(worksheet.getCell(7, 4).value).toBe('홍길동')
    expect(worksheet.getCell(8, 4).value).toBe('김철수')

    const noteCol = 6 + DAYS.length
    expect(worksheet.getCell(7, noteCol).value).toBe('08.02 공고 취소\n08.05 재공고')
  })

  it('참여기술인이 없는 프로젝트도 행으로 남긴다', async () => {
    const { worksheet } = await buildAndOpen(BLOCKS)
    // 앞 블록이 2행이므로 9행이 두 번째 프로젝트
    expect(String(worksheet.getCell(9, 1).value)).toContain('나 감리용역')
    expect(worksheet.getCell(9, 2).value).toBe('등록된 참여기술인 없음')
  })

  it('마지막 행은 합계다', async () => {
    const { worksheet } = await buildAndOpen(BLOCKS)
    expect(String(worksheet.getCell(10, 1).value)).toContain('합계')
    expect(String(worksheet.getCell(10, 1).value)).toContain('2건')
  })

  it('가로 A4 + 머리글/정보열 반복 인쇄로 설정한다', async () => {
    const { worksheet } = await buildAndOpen(BLOCKS)
    expect(worksheet.pageSetup.orientation).toBe('landscape')
    expect(worksheet.pageSetup.fitToWidth).toBe(1)
    expect(worksheet.pageSetup.printTitlesRow).toBe('1:6')
    expect(worksheet.pageSetup.printTitlesColumn).toBe('A:D')
  })

  it('프로젝트가 하나도 없어도 깨지지 않는다', async () => {
    const { worksheet } = await buildAndOpen([])
    expect(String(worksheet.getCell(7, 1).value)).toContain('합계')
  })
})
