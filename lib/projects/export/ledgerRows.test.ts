import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { buildParticipationSheet, toExcelDate, type LedgerProject } from './ledgerRows'
import { buildProjectLedgerWorkbook } from './projectLedgerWorkbook'

function project(overrides: Partial<LedgerProject>): LedgerProject {
  return {
    project_number: '0000', type: '면접', client: '발주처', name: '용역명',
    fee: null, tp_score: '', duration_days: '',
    submit_date: null, interview_date: null, interview_written: false,
    result_score: '', evaluation: '', participants: '', note: '',
    director: '', staff_arch: '', staff_civil: '', staff_mech: '', staff_safety: '',
    status_override: null,
    ...overrides,
  }
}

// 원본 워크북(2026년 참여프로젝트 관리)에서 그대로 뽑아온 3건.
const SAMPLE: LedgerProject[] = [
  project({
    project_number: '2589', type: 'SOQ', client: '국군재정관리단', name: '25-A-00부대(A406)',
    fee: 22.8, tp_score: '20p', duration_days: '30',
    submit_date: '2025-12-10', interview_date: '2025-12-18',
    result_score: '상', evaluation: '예성', participants: '9개사',
    director: '김지훈', staff_arch: '이광택', staff_civil: '이기영',
  }),
  project({
    project_number: '2622', type: 'SOQ', client: '한국전력공사', name: '154kV 서충주S/S',
    fee: 26.01, submit_date: '2026-05-20', interview_date: '2026-06-09',
    result_score: '수', evaluation: '선', participants: '6개사',
    director: '이영춘', staff_arch: '박세진',
  }),
  project({
    project_number: '2639', type: 'SOQ', client: '한국전력공사', name: '154kV 동면S/S',
    participants: '서충주 수주로 드랍', director: '미정',
  }),
]

describe('toExcelDate', () => {
  it('KST 로컬 자정이 아니라 UTC 자정으로 만들어 엑셀에서 하루 밀리지 않는다', () => {
    const d = toExcelDate('2026-08-11')
    expect(d?.toISOString()).toBe('2026-08-11T00:00:00.000Z')
  })

  it('날짜가 아닌 값("서면", 빈 값)은 null', () => {
    expect(toExcelDate('서면')).toBeNull()
    expect(toExcelDate(null)).toBeNull()
  })
})

describe('buildParticipationSheet', () => {
  it('단장과 분야 기술인을 각각 등장 순서대로 모은다', () => {
    const { directors, specialists } = buildParticipationSheet(SAMPLE)

    expect(directors.map(r => r.name)).toEqual(['김지훈', '이영춘'])
    expect(specialists.map(r => [r.name, r.field])).toEqual([
      ['이광택', '건축'], ['이기영', '토목'], ['박세진', '건축'],
    ])
  })

  it('"미정"은 사람으로 세지 않는다', () => {
    const { directors } = buildParticipationSheet(SAMPLE)
    expect(directors.map(r => r.name)).not.toContain('미정')
  })

  it('참여 프로젝트를 누적하고 횟수를 센다', () => {
    const rows = buildParticipationSheet([
      ...SAMPLE,
      project({ project_number: '2640', name: '154kV 학운변전소', director: '이영춘' }),
    ])
    const lee = rows.directors.find(r => r.name === '이영춘')
    expect(lee?.projectNames).toEqual(['154kV 서충주S/S', '154kV 학운변전소'])
    expect(lee?.count).toBe(2)
  })

  it('한 사람이 한 건에서 두 분야를 겸해도 1회로 센다', () => {
    const rows = buildParticipationSheet([
      project({ project_number: '3000', name: '겸직 건', staff_arch: '홍길동', staff_safety: '홍길동' }),
    ])
    expect(rows.specialists).toHaveLength(1)
    expect(rows.specialists[0].count).toBe(1)
  })

  it('수주(낙찰사 "선") 참여자에게 강조 표시가 붙는다', () => {
    const { directors, specialists } = buildParticipationSheet(SAMPLE)
    expect(directors.find(r => r.name === '이영춘')?.hasWin).toBe(true)
    expect(directors.find(r => r.name === '김지훈')?.hasWin).toBe(false)
    expect(specialists.find(r => r.name === '박세진')?.hasWin).toBe(true)
  })

  it('단장의 분야는 다른 건의 분야 칸 등장 이력에서 찾고, 없으면 건축으로 둔다', () => {
    const rows = buildParticipationSheet([
      project({ project_number: '3001', name: 'A', director: '오인환' }),
      project({ project_number: '3002', name: 'B', staff_civil: '오인환' }),
      project({ project_number: '3003', name: 'C', director: '이현승' }),
    ])
    expect(rows.directors.find(r => r.name === '오인환')?.field).toBe('토목')
    expect(rows.directors.find(r => r.name === '이현승')?.field).toBe('건축')
  })
})

describe('buildProjectLedgerWorkbook', () => {
  async function build(): Promise<ExcelJS.Workbook> {
    const buffer = await buildProjectLedgerWorkbook(2026, SAMPLE)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(new Uint8Array(buffer).buffer as ArrayBuffer)
    return wb
  }

  it('원본과 같은 두 시트를 만든다', async () => {
    const wb = await build()
    expect(wb.worksheets.map(w => w.name)).toEqual(['2026년', '26년 참여기술자'])
  })

  it('1시트 제목·머리글이 원본 자리(B1 병합, 2행)에 온다', async () => {
    const sheet = (await build()).getWorksheet('2026년')!
    expect(sheet.getCell('B1').value).toBe('26년 프로젝트 관리 대장')
    expect(sheet.getRow(2).values).toEqual([
      undefined,
      '연번', '관리번호', '발주방식', '발주처', '용역명', '용역비(억)', 'T P', '배점',
      '제출일', '평가일', '평가결과', '최종 낙찰사', '참가업체', '비고',
      '단장', '단장', '건축', '안전', '토목', '기계',
    ])
  })

  it('1시트 데이터 행이 원본 열 순서(분야는 건축·안전·토목·기계)를 따른다', async () => {
    const sheet = (await build()).getWorksheet('2026년')!
    const row = sheet.getRow(3)
    expect(row.getCell(1).value).toBe(1)             // 연번
    expect(row.getCell(2).value).toBe(2589)          // 관리번호(숫자)
    expect(row.getCell(6).value).toBe(22.8)          // 용역비
    expect(row.getCell(9).value).toEqual(new Date(Date.UTC(2025, 11, 10)))  // 제출일
    expect(row.getCell(15).value).toBe('김지훈')      // 단장
    expect(row.getCell(16).value).toBe('김지훈')      // 단장(원본에 두 번 있는 열)
    expect(row.getCell(17).value).toBe('이광택')      // 건축
    expect(row.getCell(18).value).toBe('')           // 안전
    expect(row.getCell(19).value).toBe('이기영')      // 토목
  })

  it('서면평가 건은 평가일 칸에 날짜 대신 "서면평가"가 들어간다', async () => {
    const buffer = await buildProjectLedgerWorkbook(2026, [
      project({ project_number: '2605', name: '세종-천안간 건축공사', interview_written: true }),
    ])
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(new Uint8Array(buffer).buffer as ArrayBuffer)
    expect(wb.getWorksheet('2026년')!.getRow(3).getCell(10).value).toBe('서면평가')
  })

  it('수주 행은 노랑, 취소(드랍) 행은 회색으로 칠한다', async () => {
    const sheet = (await build()).getWorksheet('2026년')!
    const fillOf = (rowNumber: number) => (sheet.getRow(rowNumber).getCell(1).fill as ExcelJS.FillPattern)?.fgColor?.argb
    expect(fillOf(3)).toBeUndefined()   // 2589 탈락
    expect(fillOf(4)).toBe('FFFFFF00')  // 2622 수주
    expect(fillOf(5)).toBe('FF808080')  // 2639 드랍
  })

  it('원본 열 너비를 지키고, 9인 열도 좁아지지 않게 시트 기본 너비를 9로 잡는다', async () => {
    const sheet = (await build()).getWorksheet('2026년')!
    expect(sheet.getColumn(5).width).toBe(29.375)   // 용역명
    expect(sheet.getColumn(13).width).toBe(33)      // 참가업체
    // 배점(H)·평가일(J)·단장(P)은 원본이 9.0 — exceljs가 <col>을 생략하므로 기본값으로 받쳐야 한다.
    expect(sheet.properties.defaultColWidth).toBe(9)
  })

  it('2시트는 왼쪽(A~E) 책임기술인 / 오른쪽(G~K) 분야별 두 블록으로 나뉜다', async () => {
    const sheet = (await build()).getWorksheet('26년 참여기술자')!
    expect(sheet.getCell('A1').value).toBe('책임기술인 참여현황')
    expect(sheet.getCell('G1').value).toBe('분야별 기술인 참여현황')
    expect(sheet.getCell('A2').value).toBe('번호')
    expect(sheet.getCell('G2').value).toBe('번호')
    // F열은 두 블록 사이 빈 칸
    expect(sheet.getCell('F2').value).toBeNull()
  })

  it('2시트 참여프로젝트는 줄바꿈으로 잇고 누적 횟수를 함께 적는다', async () => {
    const buffer = await buildProjectLedgerWorkbook(2026, [
      ...SAMPLE,
      project({ project_number: '2640', name: '154kV 학운변전소', director: '이영춘' }),
    ])
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(new Uint8Array(buffer).buffer as ArrayBuffer)
    const sheet = wb.getWorksheet('26년 참여기술자')!
    expect(sheet.getCell('B4').value).toBe('이영춘')
    expect(sheet.getCell('D4').value).toBe('154kV 서충주S/S\n154kV 학운변전소')
    expect(sheet.getCell('E4').value).toBe(2)
    expect(sheet.getCell('D4').alignment?.wrapText).toBe(true)
  })
})
