/* eslint-disable @typescript-eslint/no-explicit-any -- route.ts 자체가 @ts-nocheck로 처리하는
   xmldom(타입 미비 라이브러리) DOM 순회를 그대로 검증하는 테스트라 동일하게 any를 쓴다. */
import { describe, it, expect, vi, beforeAll, afterEach, afterAll } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import AdmZip from 'adm-zip'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import { POST } from './route'
import { PAGE_BUDGET_EXCEEDED_MESSAGE } from '@/lib/hwpx/pageBudget'
import {
  MONTHLY_PAGE_BUDGET_EXCEEDED_MESSAGE, MONTHLY_VERIFIED_MAX_PROJECT_COUNT,
  MONTHLY_MAX_PROJECT_COUNT_EXCEEDED_CODE, formatMonthlyMaxProjectCountExceededMessage,
  estimateMonthlyPageBudget,
} from '@/lib/hwpx/monthlyPageBudget'

// route.ts는 POST()만 export한다(불필요한 내부 함수 export를 피하기 위해). 이 테스트는 실제
// 프로덕션 핸들러를 최소 mock request로 직접 호출해서 검증한다 — Next 서버를 띄울 필요가 없다.
function mockRequest(body: unknown) {
  return { json: async () => body } as any
}

const HP_NS = 'http://www.hancom.co.kr/hwpml/2011/paragraph'

function getTcs(tr: any): any[] {
  return Array.from(tr.childNodes || []).filter((n: any) => n.nodeType === 1 && n.localName === 'tc')
}
function getCellText(tc: any): string {
  return Array.from(tc.getElementsByTagNameNS(HP_NS, 't') as any[]).map((t: any) => t.textContent ?? '').join('')
}
function getAllText(doc: any): string[] {
  return Array.from(doc.getElementsByTagNameNS(HP_NS, 't') as any[]).map((t: any) => t.textContent ?? '')
}
function rowHeight(tr: any): number {
  const tcs = getTcs(tr)
  const cell = tcs.find((tc: any) => {
    const span = tc.getElementsByTagNameNS(HP_NS, 'cellSpan')[0]
    return !span || Number(span.getAttribute('rowSpan') || 1) === 1
  })
  const sz = cell?.getElementsByTagNameNS(HP_NS, 'cellSz')[0]
  return Number(sz?.getAttribute('height') || 0)
}
function tableSzHeight(tbl: any): number {
  const sz: any = Array.from(tbl.childNodes || []).find((n: any) => n.nodeType === 1 && n.localName === 'sz')
  return Number(sz?.getAttribute('height') || 0)
}

async function toZipDoc(res: Response) {
  const buf = Buffer.from(await res.arrayBuffer())
  const zip = new AdmZip(buf)
  const xml = zip.readAsText('Contents/section0.xml')
  const doc: any = new DOMParser().parseFromString(xml, 'text/xml')
  return { buf, zip, doc }
}

function computeWeeklyDateStr(week: string): string {
  const [yearStr, wStr] = week.split('-W')
  const year = parseInt(yearStr), w = parseInt(wStr)
  const jan4 = new Date(year, 0, 4)
  const startOfW1 = new Date(jan4)
  startOfW1.setDate(jan4.getDate() - jan4.getDay() + 1)
  const weekStart = new Date(startOfW1)
  weekStart.setDate(startOfW1.getDate() + (w - 1) * 7)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 4)
  const fmt = (d: Date) => `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}.`
  return `(${fmt(weekStart)} ~ ${fmt(weekEnd)})`
}

const perfItem = (status: '개찰' | '진행중', name: string) => ({
  status, name, director: '홍길동', submit_date: '5.19', interview_date: '5.20', result_date: '5.22',
  fee: 1, note: '',
})
const expItem = (name: string) => ({
  name, client: '발주청', director: '단장', project_cost: '100억', order_month: '7월', fee: '10억', note: '',
})

// 생성된 문서를 다시 열어 동적 행 재구성 계약을 전부 검증한다:
// rowCnt===실제 tr 개수, rowAddr 0부터 연속, 개찰/진행중 rowSpan이 실제 섹션 행 수와 일치,
// hp:sz height가 rowSpan=1 셀 높이 합과 일치(표 2개 전부), 발주예상 데이터 행 수가 기대값과 일치.
function assertWeeklyDynamicXmlContract(doc: any, expectedGaeyal: number, expectedJinhaeng: number, expectedExp: number) {
  const tbls: any[] = Array.from(doc.getElementsByTagNameNS(HP_NS, 'tbl') as any[])
  const perfTbl = tbls[0]
  const rows: any[] = Array.from(perfTbl.getElementsByTagNameNS(HP_NS, 'tr') as any[])
  expect(Number(perfTbl.getAttribute('rowCnt'))).toBe(rows.length)

  rows.forEach((tr, idx) => {
    for (const tc of getTcs(tr)) {
      const addr = tc.getElementsByTagNameNS(HP_NS, 'cellAddr')[0]
      expect(addr).not.toBeUndefined()
      expect(Number(addr.getAttribute('rowAddr'))).toBe(idx)
    }
  })

  let gaeyalIdx = -1, jinhaengIdx = -1
  rows.forEach((tr, i) => {
    const t0 = getCellText(getTcs(tr)[0]).trim()
    if (t0 === '개찰') gaeyalIdx = i
    if (t0 === '진행중') jinhaengIdx = i
  })
  expect(gaeyalIdx).toBeGreaterThanOrEqual(0)
  expect(jinhaengIdx).toBeGreaterThan(gaeyalIdx)

  const gaeyalSpan = Number(getTcs(rows[gaeyalIdx])[0].getElementsByTagNameNS(HP_NS, 'cellSpan')[0].getAttribute('rowSpan'))
  const jinhaengSpan = Number(getTcs(rows[jinhaengIdx])[0].getElementsByTagNameNS(HP_NS, 'cellSpan')[0].getAttribute('rowSpan'))
  expect(gaeyalSpan).toBe(Math.max(expectedGaeyal, 1))
  expect(jinhaengSpan).toBe(Math.max(expectedJinhaeng, 1))
  expect(jinhaengIdx - gaeyalIdx).toBe(gaeyalSpan)
  expect(rows.length - jinhaengIdx).toBe(jinhaengSpan)

  const perfSum = rows.reduce((s, tr) => s + rowHeight(tr), 0)
  expect(tableSzHeight(perfTbl)).toBe(perfSum)

  const expTbl = tbls[1]
  const expRows: any[] = Array.from(expTbl.getElementsByTagNameNS(HP_NS, 'tr') as any[])
  expect(Number(expTbl.getAttribute('rowCnt'))).toBe(expRows.length)
  expect(expRows.length - 1).toBe(Math.max(expectedExp, 1))
  expRows.forEach((tr, idx) => {
    for (const tc of getTcs(tr)) {
      const addr = tc.getElementsByTagNameNS(HP_NS, 'cellAddr')[0]
      expect(addr).not.toBeUndefined()
      expect(Number(addr.getAttribute('rowAddr'))).toBe(idx)
    }
  })
  const expSum = expRows.reduce((s, tr) => s + rowHeight(tr), 0)
  expect(tableSzHeight(expTbl)).toBe(expSum)
}

// 수행 프로젝트 표에서 실제로 채워진 연번(빈 문자열 제외)을 문서 순서대로 뽑는다 — 개찰·진행중을
// 합쳐 전체 기준 연속 번호인지 확인하는 데 쓴다.
function extractPerfRowNumbers(doc: any): string[] {
  const perfTbl = Array.from(doc.getElementsByTagNameNS(HP_NS, 'tbl') as any[])[0]
  const rows: any[] = Array.from(perfTbl.getElementsByTagNameNS(HP_NS, 'tr') as any[])
  let gaeyalIdx = -1, jinhaengIdx = -1
  rows.forEach((tr, i) => {
    const t0 = getCellText(getTcs(tr)[0]).trim()
    if (t0 === '개찰') gaeyalIdx = i
    if (t0 === '진행중') jinhaengIdx = i
  })
  const numbers: string[] = []
  for (let i = 1; i < rows.length; i++) {
    const tcs = getTcs(rows[i])
    const numCell = (i === gaeyalIdx || i === jinhaengIdx) ? tcs[1] : tcs[0]
    const t = getCellText(numCell).trim()
    if (t) numbers.push(t)
  }
  return numbers
}

// 월간 요청 바디 — 기본값은 2026년 5월, 기준일 2026-05-22(실제 템플릿 예시 캡션과 동일한 달).
function monthlyReq(performing: any[], overrides: Record<string, unknown> = {}) {
  return { type: 'monthly', performing, reportYear: 2026, reportMonth: 5, asOfDate: '2026-05-22', ...overrides }
}

// 월간 프로젝트 표(첫 번째 12열 표)를 찾아 헤더 제외 데이터 행을 돌려준다.
function getMonthlyProjectTable(doc: any): any {
  const tbls: any[] = Array.from(doc.getElementsByTagNameNS(HP_NS, 'tbl') as any[])
  return tbls.find((t: any) => Number(t.getAttribute('colCnt')) === 12)
}

// 월간 프로젝트 표 재구성 계약을 전부 검증한다: rowCnt===실제 tr 개수, rowAddr/colAddr 연속,
// 데이터 행 수가 max(count,1)과 일치, 각 셀 1x1 span, hp:sz height가 실측 행 높이 합과 일치.
function assertMonthlyDynamicXmlContract(doc: any, expectedCount: number) {
  const projTbl = getMonthlyProjectTable(doc)
  // 직계 자식 tr만 센다 — 셀 안에 중첩 표가 있어도 바깥 표의 행 수 계약이 유지되는지 확인해야
  // 하므로, descendant 검색(getElementsByTagNameNS)을 쓰면 안 된다.
  const rows: any[] = Array.from(projTbl.childNodes || []).filter((n: any) => n.nodeType === 1 && n.localName === 'tr')
  expect(Number(projTbl.getAttribute('rowCnt'))).toBe(rows.length)
  expect(rows.length - 1).toBe(Math.max(expectedCount, 1))

  // cellAddr/cellSpan/cellSz도 반드시 직계 자식으로 찾는다. 실측 확인 결과 hp:tc의 자식 순서는
  // subList가 cellAddr보다 앞이므로, descendant 검색을 쓰면 셀 안 중첩 표의 cellAddr을 먼저
  // 집어 잘못된 값을 읽는다(프로덕션 코드도 같은 이유로 직계 검색만 쓴다).
  const directChild = (parent: any, localName: string): any =>
    Array.from(parent.childNodes || []).find((n: any) => n.nodeType === 1 && n.localName === localName)

  rows.forEach((tr, rowIdx) => {
    const tcs = getTcs(tr)
    expect(tcs.length).toBe(12)
    tcs.forEach((tc: any, colIdx: number) => {
      const addr = directChild(tc, 'cellAddr')
      expect(Number(addr.getAttribute('rowAddr'))).toBe(rowIdx)
      expect(Number(addr.getAttribute('colAddr'))).toBe(colIdx)
      const span = directChild(tc, 'cellSpan')
      expect(Number(span.getAttribute('colSpan'))).toBe(1)
      expect(Number(span.getAttribute('rowSpan'))).toBe(1)
    })
  })

  const sum = rows.reduce(
    (s, tr) => s + Number(directChild(getTcs(tr)[0], 'cellSz').getAttribute('height')),
    0
  )
  expect(tableSzHeight(projTbl)).toBe(sum)
}

describe('POST /api/hwpx — 기본 생성', () => {
  it('주간 데이터가 모두 빈 경우 200과 zip 바이너리를 반환한다', async () => {
    const res: any = await POST(mockRequest({
      type: 'weekly', week: '2026-W22', performing: [], expected: [], meta: {},
    }))
    expect(res.status).toBe(200)
    const { buf, zip } = await toZipDoc(res)
    expect(buf[0]).toBe(0x50) // 'P'
    expect(buf[1]).toBe(0x4b) // 'K'
    expect(zip.getEntry('Contents/section0.xml')).not.toBeNull()
  })

  it('개찰 1건 · 진행중 1건 · 발주예상 1건이면 200과 zip 바이너리를 반환한다', async () => {
    const res: any = await POST(mockRequest({
      type: 'weekly', week: '2026-W22',
      performing: [perfItem('개찰', 'A용역'), perfItem('진행중', 'B용역')],
      expected: [expItem('C예상')],
      meta: {},
    }))
    expect(res.status).toBe(200)
    const { doc } = await toZipDoc(res)
    const all = getAllText(doc).join('|')
    expect(all).toContain('A용역')
    expect(all).toContain('B용역')
    expect(all).toContain('C예상')
  })

  const eduCases: [string, Record<string, string>][] = [
    ['교육참가자 전부 빈 값', { edu_chief: '', edu_arch: '', edu_civil: '', edu_safety: '', edu_mech: '' }],
    ['책임 기술자만 존재', { edu_chief: '김책임', edu_arch: '', edu_civil: '', edu_safety: '', edu_mech: '' }],
    ['일부 분야만 존재', { edu_chief: '김책임', edu_arch: '박건축', edu_civil: '', edu_safety: '', edu_mech: '이기계' }],
    ['책임·건축·토목·안전·기계 전부 존재', { edu_chief: '김책임', edu_arch: '박건축', edu_civil: '최토목', edu_safety: '정안전', edu_mech: '이기계' }],
  ]
  for (const [label, meta] of eduCases) {
    it(`교육참가자: ${label} → 200과 zip 바이너리를 반환한다`, async () => {
      const res: any = await POST(mockRequest({ type: 'weekly', week: '2026-W22', performing: [], expected: [], meta }))
      expect(res.status).toBe(200)
      const { buf } = await toZipDoc(res)
      expect(buf[0]).toBe(0x50)
      expect(buf[1]).toBe(0x4b)
    })
  }

  it('월간: 프로젝트가 없어도 200과 zip 바이너리를 반환한다', async () => {
    const res: any = await POST(mockRequest(monthlyReq([])))
    expect(res.status).toBe(200)
    const { zip } = await toZipDoc(res)
    expect(zip.getEntry('Contents/section0.xml')).not.toBeNull()
  })

  it('월간: 프로젝트 11건(원래 템플릿 용량과 정확히 일치)이면 200과 zip 바이너리를 반환한다', async () => {
    const performing = Array.from({ length: 11 }, (_, i) => perfItem('개찰', `월간${i + 1}`))
    const res: any = await POST(mockRequest(monthlyReq(performing)))
    expect(res.status).toBe(200)
    const { doc } = await toZipDoc(res)
    const all = getAllText(doc).join('|')
    expect(all).toContain('월간1')
    expect(all).toContain('월간11')
  })

  it('월간: 프로젝트 12건(원래 템플릿 고정 용량을 넘음)도 200과 zip 바이너리를 반환한다(더 이상 고정 11건 제한이 없음)', async () => {
    const performing = Array.from({ length: 12 }, (_, i) => perfItem('개찰', `월간${i + 1}`))
    const res: any = await POST(mockRequest(monthlyReq(performing)))
    expect(res.status).toBe(200)
    const { doc } = await toZipDoc(res)
    const all = getAllText(doc).join('|')
    expect(all).toContain('월간12')
  })

  it('월간: reportYear/reportMonth가 없으면 400과 날짜 계약 오류를 반환한다', async () => {
    const res: any = await POST(mockRequest({ type: 'monthly', performing: [] }))
    expect(res.status).toBe(400)
  })

  it('월간: reportMonth가 13처럼 범위를 벗어나면 400을 반환한다', async () => {
    const res: any = await POST(mockRequest(monthlyReq([], { reportMonth: 13 })))
    expect(res.status).toBe(400)
  })

  it('알 수 없는 status 값이 섞여 있으면 400으로 명확히 실패한다(조용히 무시하지 않음)', async () => {
    const performing = [perfItem('개찰', 'A용역'), { ...perfItem('개찰', 'B용역'), status: '보류' as any }]
    const res: any = await POST(mockRequest({ type: 'weekly', week: '2026-W22', performing, expected: [], meta: {} }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('개찰')
    expect(json.error).toContain('진행중')
  })
})

describe('POST /api/hwpx — 주간 동적 행 재구성 (개찰/진행중/발주예상)', () => {
  const cases: [string, number, number, number][] = [
    ['개찰 1 / 진행중 1 / 발주예상 1', 1, 1, 1],
    ['개찰 2 / 진행중 3 / 발주예상 4', 2, 3, 4],
    ['개찰 4 / 진행중 6 / 발주예상 4 (기준 문서 CM본부주간업무 7.24자 데이터 수)', 4, 6, 4],
    ['개찰 6 / 진행중 4', 6, 4, 0],
    ['개찰 0 / 진행중 5', 0, 5, 0],
    ['개찰 5 / 진행중 0', 5, 0, 0],
    ['개찰 0 / 진행중 0', 0, 0, 0],
    ['발주예상 0 (수행 프로젝트는 1/1)', 1, 1, 0],
  ]

  for (const [label, gaeyalCount, jinhaengCount, expCount] of cases) {
    it(`${label} → 200, XML 계약 통과, 데이터·연번 누락 없음`, async () => {
      const performing = [
        ...Array.from({ length: gaeyalCount }, (_, i) => perfItem('개찰', `개찰${i + 1}`)),
        ...Array.from({ length: jinhaengCount }, (_, i) => perfItem('진행중', `진행${i + 1}`)),
      ]
      const expected = Array.from({ length: expCount }, (_, i) => expItem(`예상${i + 1}`))
      const res: any = await POST(mockRequest({ type: 'weekly', week: '2026-W22', performing, expected, meta: {} }))
      expect(res.status).toBe(200)
      const { doc } = await toZipDoc(res)

      assertWeeklyDynamicXmlContract(doc, gaeyalCount, jinhaengCount, expCount)

      const all = getAllText(doc).join('|')
      for (let i = 1; i <= gaeyalCount; i++) expect(all).toContain(`개찰${i}`)
      for (let i = 1; i <= jinhaengCount; i++) expect(all).toContain(`진행${i}`)
      for (let i = 1; i <= expCount; i++) expect(all).toContain(`예상${i}`)

      // 연번은 개찰·진행중을 합쳐 전체 기준 연속 번호
      const numbers = extractPerfRowNumbers(doc)
      const expectedNumbers = Array.from({ length: gaeyalCount + jinhaengCount }, (_, i) => String(i + 1))
      expect(numbers).toEqual(expectedNumbers)
    })
  }

  it('개찰 0 / 진행중 0이면 두 라벨 행 모두 rowSpan=1(빈 행 1개)로 유지되고 rowSpan=0은 만들지 않는다', async () => {
    const res: any = await POST(mockRequest({ type: 'weekly', week: '2026-W22', performing: [], expected: [], meta: {} }))
    expect(res.status).toBe(200)
    const { doc } = await toZipDoc(res)
    const perfTbl = Array.from(doc.getElementsByTagNameNS(HP_NS, 'tbl') as any[])[0]
    const rows: any[] = Array.from(perfTbl.getElementsByTagNameNS(HP_NS, 'tr') as any[])
    for (const tr of rows) {
      for (const tc of getTcs(tr)) {
        const span = tc.getElementsByTagNameNS(HP_NS, 'cellSpan')[0]
        if (span) expect(Number(span.getAttribute('rowSpan'))).toBeGreaterThanOrEqual(1)
      }
    }
  })

  it('발주예상 0건이면 표는 헤더 + 빈 데이터 행 1개로 줄어든다(헤더만 남기지 않음)', async () => {
    const res: any = await POST(mockRequest({
      type: 'weekly', week: '2026-W22',
      performing: [perfItem('개찰', 'A용역')], expected: [], meta: {},
    }))
    expect(res.status).toBe(200)
    const { doc } = await toZipDoc(res)
    const expTbl = Array.from(doc.getElementsByTagNameNS(HP_NS, 'tbl') as any[])[1]
    const rows: any[] = Array.from(expTbl.getElementsByTagNameNS(HP_NS, 'tr') as any[])
    expect(rows.length).toBe(2) // 헤더 1 + 빈 데이터 행 1
    // 데이터 셀·번호 셀 모두 공백(기존 예시 데이터 잔존 없음)
    for (const tc of getTcs(rows[1])) expect(getCellText(tc).trim()).toBe('')
  })

  // 0건 정책 세부 단언 — 각 구분이 개별적으로/동시에 0건일 때 rowSpan·공백·연번을 명시적으로 확인한다.
  function getPerfSections(doc: any) {
    const perfTbl = Array.from(doc.getElementsByTagNameNS(HP_NS, 'tbl') as any[])[0]
    const rows: any[] = Array.from(perfTbl.getElementsByTagNameNS(HP_NS, 'tr') as any[])
    let gaeyalIdx = -1, jinhaengIdx = -1
    rows.forEach((tr, i) => {
      const t0 = getCellText(getTcs(tr)[0]).trim()
      if (t0 === '개찰') gaeyalIdx = i
      if (t0 === '진행중') jinhaengIdx = i
    })
    return { perfTbl, rows, gaeyalIdx, jinhaengIdx }
  }
  function rowSpanOf(tr: any): number {
    return Number(getTcs(tr)[0].getElementsByTagNameNS(HP_NS, 'cellSpan')[0].getAttribute('rowSpan'))
  }
  function labelRowDataCells(tr: any): any[] {
    return getTcs(tr).slice(1) // 라벨 칸 제외 8칸
  }

  it('개찰 0건: 라벨 rowSpan=1, 개찰 데이터 영역 전부 공백(기존 템플릿 예시 텍스트 잔존 없음), 진행중 연번은 1부터 시작', async () => {
    const performing = [perfItem('진행중', '진행1'), perfItem('진행중', '진행2')]
    const res: any = await POST(mockRequest({ type: 'weekly', week: '2026-W22', performing, expected: [], meta: {} }))
    expect(res.status).toBe(200)
    const { doc } = await toZipDoc(res)
    const { rows, gaeyalIdx, jinhaengIdx } = getPerfSections(doc)

    expect(rowSpanOf(rows[gaeyalIdx])).toBe(1)
    expect(jinhaengIdx - gaeyalIdx).toBe(1) // 개찰 섹션은 라벨 행 1개뿐
    for (const tc of labelRowDataCells(rows[gaeyalIdx])) expect(getCellText(tc).trim()).toBe('')

    expect(extractPerfRowNumbers(doc)).toEqual(['1', '2'])
  })

  it('진행중 0건: 라벨 rowSpan=1, 진행중 데이터 영역 전부 공백, 개찰 연번만 1부터 연속', async () => {
    const performing = [perfItem('개찰', '개찰1'), perfItem('개찰', '개찰2'), perfItem('개찰', '개찰3')]
    const res: any = await POST(mockRequest({ type: 'weekly', week: '2026-W22', performing, expected: [], meta: {} }))
    expect(res.status).toBe(200)
    const { doc } = await toZipDoc(res)
    const { rows, jinhaengIdx } = getPerfSections(doc)

    expect(rowSpanOf(rows[jinhaengIdx])).toBe(1)
    expect(rows.length - jinhaengIdx).toBe(1) // 진행중 섹션은 라벨 행 1개뿐
    for (const tc of labelRowDataCells(rows[jinhaengIdx])) expect(getCellText(tc).trim()).toBe('')

    expect(extractPerfRowNumbers(doc)).toEqual(['1', '2', '3'])
  })

  it('개찰·진행중 모두 0건: 두 라벨 행만 각 1행 유지, 프로젝트·번호 셀 전부 공백, 기존 템플릿 데이터 잔존 없음', async () => {
    const res: any = await POST(mockRequest({ type: 'weekly', week: '2026-W22', performing: [], expected: [], meta: {} }))
    expect(res.status).toBe(200)
    const { doc } = await toZipDoc(res)
    const { rows, gaeyalIdx, jinhaengIdx } = getPerfSections(doc)

    expect(jinhaengIdx - gaeyalIdx).toBe(1)
    expect(rows.length - jinhaengIdx).toBe(1)
    expect(rowSpanOf(rows[gaeyalIdx])).toBe(1)
    expect(rowSpanOf(rows[jinhaengIdx])).toBe(1)

    for (const idx of [gaeyalIdx, jinhaengIdx]) {
      for (const tc of labelRowDataCells(rows[idx])) expect(getCellText(tc).trim()).toBe('')
    }
    expect(extractPerfRowNumbers(doc)).toEqual([])
  })

  it('새로 복제된 행(원래 템플릿 용량을 넘는 진행중 6번째 항목)에도 프로젝트명 정제가 적용된다', async () => {
    const performing = Array.from({ length: 6 }, (_, i) =>
      perfItem('진행중', i === 5 ? '○○센터 신축공사 건설사업관리용역' : `진행${i + 1}`)
    )
    const res: any = await POST(mockRequest({ type: 'weekly', week: '2026-W22', performing, expected: [], meta: {} }))
    expect(res.status).toBe(200)
    const { doc } = await toZipDoc(res)
    const all = getAllText(doc).join('|')
    expect(all).toContain('○○센터')
    expect(all).not.toContain('건설사업관리용역')
  })

  it('경계값 이내(개찰 5 / 진행중 5 / 발주예상 5) — 자동 문서 높이 예산 안에서 정상 생성된다', async () => {
    const performing = [
      ...Array.from({ length: 5 }, (_, i) => perfItem('개찰', `개찰${i + 1}`)),
      ...Array.from({ length: 5 }, (_, i) => perfItem('진행중', `진행${i + 1}`)),
    ]
    const expected = Array.from({ length: 5 }, (_, i) => expItem(`예상${i + 1}`))
    const res: any = await POST(mockRequest({ type: 'weekly', week: '2026-W22', performing, expected, meta: {} }))
    expect(res.status).toBe(200)
  })

  it('예산 초과(개찰 15 / 진행중 15 / 발주예상 15) — 문서를 생성하지 않고 400과 예산 초과 메시지를 반환한다', async () => {
    const performing = [
      ...Array.from({ length: 15 }, (_, i) => perfItem('개찰', `개찰${i + 1}`)),
      ...Array.from({ length: 15 }, (_, i) => perfItem('진행중', `진행${i + 1}`)),
    ]
    const expected = Array.from({ length: 15 }, (_, i) => expItem(`예상${i + 1}`))
    const res: any = await POST(mockRequest({ type: 'weekly', week: '2026-W22', performing, expected, meta: {} }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe(PAGE_BUDGET_EXCEEDED_MESSAGE)
    expect(json.error).not.toContain('반드시 2페이지')
    expect(json.error).not.toContain('1페이지가 보장')
  })

  // 6-6-2는 6-6-4의 대체물이 아니라 별도 비교 샘플이다 — 6-6-4 자체는 현재 높이 예산
  // 정책에서 명확히 차단되어야 하고, 그 과정에서 일부 데이터만 잘려 생성되는 경로가 없어야 한다.
  it('개찰 6 / 진행중 6 / 발주예상 4는 현재 높이 예산에서 명확히 차단되고, 잘린 문서가 생성되지 않는다', async () => {
    const performing = [
      ...Array.from({ length: 6 }, (_, i) => perfItem('개찰', `개찰${i + 1}`)),
      ...Array.from({ length: 6 }, (_, i) => perfItem('진행중', `진행${i + 1}`)),
    ]
    const expected = Array.from({ length: 4 }, (_, i) => expItem(`예상${i + 1}`))
    const res: any = await POST(mockRequest({ type: 'weekly', week: '2026-W22', performing, expected, meta: { edu_chief: '김책임' } }))

    expect(res.status).toBe(400)
    const contentType = res.headers.get('content-type') || ''
    expect(contentType).toContain('application/json') // zip이 아니라 JSON 오류 응답 — 문서가 생성되지 않았다는 뜻
    expect(contentType).not.toContain('application/zip')

    const json = await res.json()
    expect(json.error).toBe(PAGE_BUDGET_EXCEEDED_MESSAGE)
  })
})

describe('POST /api/hwpx — 월간 동적 행 재구성 (프로젝트 표)', () => {
  const counts = [0, 1, 5, 11, 13, 20]

  for (const count of counts) {
    it(`프로젝트 ${count}건 → 200, XML 계약 통과(rowCnt/rowAddr/colAddr/hp:sz), 데이터 누락 없음`, async () => {
      const performing = Array.from({ length: count }, (_, i) => perfItem('개찰', `월${i + 1}`))
      const res: any = await POST(mockRequest(monthlyReq(performing)))
      expect(res.status).toBe(200)
      const { doc } = await toZipDoc(res)

      assertMonthlyDynamicXmlContract(doc, count)

      const all = getAllText(doc).join('|')
      for (let i = 1; i <= count; i++) expect(all).toContain(`월${i}`)
    })
  }

  it('0건이면 헤더는 유지되고 데이터 행 1개가 전부 공백(기존 템플릿 예시 텍스트 잔존 없음)으로 남는다', async () => {
    const res: any = await POST(mockRequest(monthlyReq([])))
    expect(res.status).toBe(200)
    const { doc } = await toZipDoc(res)
    const projTbl = getMonthlyProjectTable(doc)
    const rows: any[] = Array.from(projTbl.getElementsByTagNameNS(HP_NS, 'tr') as any[])
    expect(rows.length).toBe(2) // 헤더 1 + 빈 데이터 행 1
    for (const tc of getTcs(rows[1])) expect(getCellText(tc).trim()).toBe('')
  })

  it('새로 복제된 행(원래 템플릿 용량을 넘는 13번째 항목)에도 프로젝트명 정제가 적용된다', async () => {
    const performing = Array.from({ length: 13 }, (_, i) =>
      perfItem('개찰', i === 12 ? '○○센터 신축공사 건설사업관리용역' : `월${i + 1}`)
    )
    const res: any = await POST(mockRequest(monthlyReq(performing)))
    expect(res.status).toBe(200)
    const { doc } = await toZipDoc(res)
    const all = getAllText(doc).join('|')
    expect(all).toContain('○○센터')
    expect(all).not.toContain('건설사업관리용역')
  })

  it('프로젝트 수가 계속 늘어나면 어느 지점부터는 반드시 400을 반환한다(경계 존재 확인)', async () => {
    let lastOk = -1
    let firstFail = -1
    for (let n = 1; n <= 30; n++) {
      const performing = Array.from({ length: n }, (_, i) => perfItem('개찰', `월${i + 1}`))
      const res: any = await POST(mockRequest(monthlyReq(performing)))
      if (res.status === 200) {
        lastOk = n
      } else {
        firstFail = n
        break
      }
    }
    // 원래 템플릿 용량(11건)은 반드시 통과해야 한다 — 그 이하에서 막히면 회귀.
    expect(lastOk).toBeGreaterThanOrEqual(11)
    expect(lastOk).toBe(MONTHLY_VERIFIED_MAX_PROJECT_COUNT)
    expect(firstFail).toBe(MONTHLY_VERIFIED_MAX_PROJECT_COUNT + 1)
  })
})

// ── P1-1: 최대 건수 정책이 실제 요청 경로에 고정되어 있는지 ─────────────────────────────
describe('POST /api/hwpx — 월간 최대 건수 정책(수동 검증 범위)', () => {
  const make = (n: number) => Array.from({ length: n }, (_, i) => perfItem('개찰', `월${i + 1}`))

  it(`${MONTHLY_VERIFIED_MAX_PROJECT_COUNT}건은 최대 건수 정책과 페이지 예산을 모두 통과해 생성된다`, async () => {
    const res: any = await POST(mockRequest(monthlyReq(make(MONTHLY_VERIFIED_MAX_PROJECT_COUNT))))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/zip')
    const { doc } = await toZipDoc(res)
    assertMonthlyDynamicXmlContract(doc, MONTHLY_VERIFIED_MAX_PROJECT_COUNT)
    const all = getAllText(doc).join('|')
    for (let i = 1; i <= MONTHLY_VERIFIED_MAX_PROJECT_COUNT; i++) expect(all).toContain(`월${i}`)
  })

  it(`${MONTHLY_VERIFIED_MAX_PROJECT_COUNT + 1}건은 최대 건수 정책으로 400이며 ZIP이 아니다`, async () => {
    const res: any = await POST(mockRequest(monthlyReq(make(MONTHLY_VERIFIED_MAX_PROJECT_COUNT + 1))))
    expect(res.status).toBe(400)
    const contentType = res.headers.get('content-type') || ''
    expect(contentType).toContain('application/json')
    expect(contentType).not.toContain('application/zip')
    const buf = Buffer.from(await res.arrayBuffer())
    expect(buf.subarray(0, 2).toString('latin1')).not.toBe('PK') // ZIP 시그니처 없음
  })

  it('최대 건수 초과 응답은 예산 초과 응답과 코드·메시지로 구분된다', async () => {
    const res: any = await POST(mockRequest(monthlyReq(make(MONTHLY_VERIFIED_MAX_PROJECT_COUNT + 1))))
    const json = await res.json()
    expect(json.code).toBe(MONTHLY_MAX_PROJECT_COUNT_EXCEEDED_CODE)
    expect(json.error).toBe(formatMonthlyMaxProjectCountExceededMessage(MONTHLY_VERIFIED_MAX_PROJECT_COUNT + 1))
    expect(json.error).toContain(`최대 프로젝트 수 ${MONTHLY_VERIFIED_MAX_PROJECT_COUNT}건을 초과`)
    // 예산 초과 메시지와 반드시 다른 문구여야 한다(두 제한이 합쳐지지 않았다는 증거).
    expect(json.error).not.toBe(MONTHLY_PAGE_BUDGET_EXCEEDED_MESSAGE)
  })

  // 두 제한이 독립임을 보이는 핵심 테스트: renderSafetyReserve를 0으로 낮추면 24건은 산술
  // 예산상 "들어간다". 그래도 요청 경로는 최대 건수 정책으로 막는다.
  it('페이지 예산상으로는 24건이 들어가는 설정이어도, 최대 건수 정책이 독립적으로 차단한다', async () => {
    const budgetAt24WithoutReserve = estimateMonthlyPageBudget({
      pageHeight: 84188, topMargin: 2835, bottomMargin: 1417,
      fixedContentHeight: 4604, projectHeaderHeight: 2502, projectRowHeight: 1818,
      projectRowCount: MONTHLY_VERIFIED_MAX_PROJECT_COUNT + 1,
      calendarHeight: 25014, objectMargins: 848, calendarVertOffset: 474,
      renderSafetyReserve: 0,
    })
    expect(budgetAt24WithoutReserve.fits).toBe(true) // 예산 단독으로는 24건이 통과하는 조건

    const res: any = await POST(mockRequest(monthlyReq(make(MONTHLY_VERIFIED_MAX_PROJECT_COUNT + 1))))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe(MONTHLY_MAX_PROJECT_COUNT_EXCEEDED_CODE)
  })

  it('최대 건수를 크게 넘는 60건도 최대 건수 정책으로 차단되고 파일이 생성되지 않는다', async () => {
    const res: any = await POST(mockRequest(monthlyReq(make(60))))
    expect(res.status).toBe(400)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect((await res.json()).code).toBe(MONTHLY_MAX_PROJECT_COUNT_EXCEEDED_CODE)
  })
})

describe('POST /api/hwpx — 월간 날짜 계약(연/월/기준일)', () => {
  it('제목과 파일명은 reportYear/reportMonth를 반영하고, 기준일 캡션은 asOfDate를 반영한다', async () => {
    const res: any = await POST(mockRequest(monthlyReq([], { reportYear: 2027, reportMonth: 3, asOfDate: '2027-03-10' })))
    expect(res.status).toBe(200)
    const { doc } = await toZipDoc(res)
    const texts = getAllText(doc)

    expect(texts.some(t => t.trim() === '2027년')).toBe(true)
    expect(texts.some(t => t.trim() === '3월')).toBe(true)
    expect(texts.some(t => t.trim().endsWith('3월 10일 현재'))).toBe(true)

    const disposition = res.headers.get('content-disposition') || ''
    expect(disposition).toContain(encodeURIComponent('202703'))
  })

  it('asOfDate를 생략하면 서버가 Asia/Seoul 오늘 날짜로 기준일을 채운다(응답이 항상 200)', async () => {
    const res: any = await POST(mockRequest({ type: 'monthly', performing: [], reportYear: 2026, reportMonth: 5 }))
    expect(res.status).toBe(200)
  })

  it('asOfDate가 reportYear/reportMonth와 다른 달이어도 각각 독립적으로 반영된다', async () => {
    // 예: 5월 보고서를 6월 1일 기준으로 작성하는 경우 — 제목은 5월, 기준일 캡션은 6월 1일.
    const res: any = await POST(mockRequest(monthlyReq([], { reportYear: 2026, reportMonth: 5, asOfDate: '2026-06-01' })))
    expect(res.status).toBe(200)
    const { doc } = await toZipDoc(res)
    const texts = getAllText(doc)
    expect(texts.some(t => t.trim() === '5월')).toBe(true)
    expect(texts.some(t => t.trim().endsWith('6월 1일 현재'))).toBe(true)
  })
})

describe('POST /api/hwpx — 날짜 오염 회귀 테스트', () => {
  it('note에 보고기간과 같은 패턴의 날짜가 있어도 note는 그대로 유지되고, 보고기간 표시 위치만 갱신된다', async () => {
    const week = '2026-W23'
    const pollutedNote = '작업기간 (2099.1.1. ~ 2099.1.5.) 참고'
    const performing = [{ ...perfItem('개찰', 'A용역'), note: pollutedNote }]
    const res: any = await POST(mockRequest({ type: 'weekly', week, performing, expected: [], meta: {} }))
    expect(res.status).toBe(200)
    const { doc } = await toZipDoc(res)
    const texts = getAllText(doc)

    // 1) 사용자가 입력한 note 전체가 그대로 유지된다
    expect(texts).toContain(pollutedNote)

    // 2) 보고기간 날짜는 지정된 위치에서 올바른 값(해당 주의 월~금)으로 바뀐다
    const expectedDateStr = computeWeeklyDateStr(week)
    const dateMatches = texts.filter(t => t === expectedDateStr)
    expect(dateMatches.length).toBe(1)

    // 3) note 안의 날짜 문자열은 보고기간 날짜로 바뀌지 않는다(오염되지 않는다)
    const stillHasPollutedDate = texts.some(t => t.includes('2099.1.1'))
    expect(stillHasPollutedDate).toBe(true)
    const noteWasOverwritten = texts.some(t => t.includes('참고') && t !== pollutedNote)
    expect(noteWasOverwritten).toBe(false)
  })

  it('월간: note에 기준일과 같은 패턴("N월 N일 현재")이 있어도 note는 그대로 유지되고, 기준일 표시 위치만 asOfDate로 갱신된다', async () => {
    const expectedCaption = '7월 15일 현재'
    const pollutedNote = '이 사업은 4월 3일 현재 설계 진행 중'
    const performing = [{ ...perfItem('개찰', 'A용역'), note: pollutedNote }]
    const res: any = await POST(mockRequest(monthlyReq(performing, { reportYear: 2026, reportMonth: 7, asOfDate: '2026-07-15' })))
    expect(res.status).toBe(200)
    const { doc } = await toZipDoc(res)
    const texts = getAllText(doc)

    // 1) 사용자가 입력한 note 전체가 그대로 유지된다
    expect(texts).toContain(pollutedNote)

    // 2) 기준일은 지정된 위치에서 요청한 asOfDate로 정확히 하나만 바뀐다
    const dateMatches = texts.filter(t => t.trim() === expectedCaption)
    expect(dateMatches.length).toBe(1)

    // 3) note 안의 "4월 3일 현재" 문자열은 asOfDate로 바뀌지 않는다(오염되지 않는다)
    const stillHasPollutedDate = texts.some(t => t.includes('4월 3일 현재'))
    expect(stillHasPollutedDate).toBe(true)
  })
})

describe('POST /api/hwpx — 출력용 프로젝트명 정제가 실제로 적용된다', () => {
  it('주간 수행 Project 표에는 정제된 이름이, 발주예상 Project 표에도 정제된 이름이 출력된다', async () => {
    const performing = [
      { ...perfItem('개찰', '○○센터 신축공사 건설사업관리용역') },
      { ...perfItem('진행중', '○○청사 건립공사 감독권한대행 등 건설사업관리용역') },
    ]
    const expected = [{ ...expItem('345kV ○○변전소 토건공사 건설사업관리용역') }]
    const res: any = await POST(mockRequest({ type: 'weekly', week: '2026-W22', performing, expected, meta: {} }))
    expect(res.status).toBe(200)
    const { doc } = await toZipDoc(res)
    const texts = getAllText(doc)

    expect(texts).toContain('○○센터')
    expect(texts).toContain('○○청사')
    expect(texts).toContain('345kV ○○변전소')
    // 정제 전 원본 문구가 남아있지 않아야 한다(연결이 실제로 됐는지 확인)
    expect(texts.some(t => t.includes('건설사업관리용역'))).toBe(false)
  })

  it('월간 프로젝트 표에도 정제된 이름이 출력된다', async () => {
    const performing = [perfItem('개찰', '화성동탄(1) M1-1-2블럭 건설사업관리용역')]
    const res: any = await POST(mockRequest(monthlyReq(performing)))
    expect(res.status).toBe(200)
    const { doc } = await toZipDoc(res)
    const texts = getAllText(doc)

    expect(texts).toContain('화성동탄(1) M1-1-2블럭')
    expect(texts.some(t => t.includes('건설사업관리용역'))).toBe(false)
  })
})

describe('weekly.hwpx / montly.hwpx 템플릿 구조 계약', () => {
  const templatesDir = path.join(process.cwd(), 'lib', 'templates')

  it('weekly.hwpx: 표 구조와 기준 문구가 현재 생성 로직이 기대하는 그대로다', () => {
    const zip = new AdmZip(path.join(templatesDir, 'weekly.hwpx'))
    const xml = zip.readAsText('Contents/section0.xml')
    const doc: any = new DOMParser().parseFromString(xml, 'text/xml')
    const tbls = Array.from(doc.getElementsByTagNameNS(HP_NS, 'tbl'))
    expect(tbls.length).toBeGreaterThanOrEqual(2)

    const perfTbl: any = tbls[0]
    expect(Number(perfTbl.getAttribute('rowCnt'))).toBe(11)
    expect(Number(perfTbl.getAttribute('colCnt'))).toBe(9)

    const rows = Array.from(perfTbl.getElementsByTagNameNS(HP_NS, 'tr') as any[])
    const tcs = rows.map(r => getTcs(r))
    let gaeyalIdx = -1, jinhaengIdx = -1
    for (let i = 0; i < rows.length; i++) {
      const t0 = getCellText(tcs[i][0]).trim()
      if (t0 === '개찰') gaeyalIdx = i
      if (t0 === '진행중') jinhaengIdx = i
    }
    expect(gaeyalIdx).toBeGreaterThanOrEqual(0)
    expect(jinhaengIdx).toBeGreaterThanOrEqual(0)
    // 원본 템플릿 자체의 여유 행 수(코드의 동적 재구성 최소 요구사항 — 라벨 포함 2행 이상)를 확인한다.
    expect(jinhaengIdx - gaeyalIdx).toBeGreaterThanOrEqual(2)
    expect(rows.length - jinhaengIdx).toBeGreaterThanOrEqual(2)

    const expTbl: any = tbls[1]
    expect(Number(expTbl.getAttribute('rowCnt'))).toBe(3)
    expect(Number(expTbl.getAttribute('colCnt'))).toBe(8)
    const expRows = Array.from(expTbl.getElementsByTagNameNS(HP_NS, 'tr') as any[])
    expect(expRows.length - 1).toBeGreaterThanOrEqual(1)

    const allText = Array.from(doc.getElementsByTagNameNS(HP_NS, 't') as any[]).map((t: any) => t.textContent ?? '').join('|')
    for (const phrase of ['개찰', '진행중', '책  임 기술자', '3) 교육참가자', '4) 기  타']) {
      expect(allText).toContain(phrase)
    }
  })

  it('montly.hwpx: 표 구조가 현재 생성 로직이 기대하는 그대로다 (파일명은 저장소 실제 파일명을 따름)', () => {
    const zip = new AdmZip(path.join(templatesDir, 'montly.hwpx'))
    const xml = zip.readAsText('Contents/section0.xml')
    const doc: any = new DOMParser().parseFromString(xml, 'text/xml')
    const tbls = Array.from(doc.getElementsByTagNameNS(HP_NS, 'tbl'))
    expect(tbls.length).toBeGreaterThanOrEqual(2)

    const projTbl: any = tbls[0]
    expect(Number(projTbl.getAttribute('rowCnt'))).toBe(12)
    expect(Number(projTbl.getAttribute('colCnt'))).toBe(12)
    const rows = Array.from(projTbl.getElementsByTagNameNS(HP_NS, 'tr') as any[])
    expect(rows.length - 1).toBe(11) // 헤더 제외 데이터 행 11개

    const calendarTbl: any = tbls[1]
    expect(Number(calendarTbl.getAttribute('rowCnt'))).toBe(4)
    expect(Number(calendarTbl.getAttribute('colCnt'))).toBe(7)
  })
})

// ════════════════════════════════════════════════════════════════════════════════
// montly.hwpx Template Contract 통합 검증 (Codex 감사 P1-2 / P2-1 / P2-2)
//
// 실제 montly.hwpx의 section0.xml을 메모리에서 변형해 프로덕션 POST 경로에 그대로 통과시킨다.
// 변형본은 fs.readFileSync를 가로채 주입한다 — 커밋된 템플릿 파일을 절대 건드리지 않으므로
// 테스트가 중간에 끊겨도 리포지토리가 오염되지 않고, 병렬 실행 경쟁 상태도 생기지 않는다.
// (라우트는 Monthly 템플릿을 fs.readFileSync로 읽어 버퍼로 넘기므로 이 지점이 유일한 경계다.)
// ════════════════════════════════════════════════════════════════════════════════
describe('montly.hwpx Template Contract 통합 검증 (변형 템플릿 주입)', () => {
  const templatePath = path.join(process.cwd(), 'lib', 'templates', 'montly.hwpx')
  let originalTemplate: Buffer

  beforeAll(() => { originalTemplate = fs.readFileSync(templatePath) })
  afterEach(() => { vi.restoreAllMocks() })
  afterAll(() => { vi.restoreAllMocks() })

  function directChildren(parent: any, localName: string): any[] {
    return Array.from(parent.childNodes || []).filter((n: any) => n.nodeType === 1 && n.localName === localName)
  }
  function projectTableOf(doc: any): any {
    return Array.from(doc.getElementsByTagNameNS(HP_NS, 'tbl') as any[])
      .find((t: any) => Number(t.getAttribute('colCnt')) === 12)
  }
  function calendarTableOf(doc: any): any {
    return Array.from(doc.getElementsByTagNameNS(HP_NS, 'tbl') as any[])
      .find((t: any) => Number(t.getAttribute('colCnt')) === 7)
  }
  function firstDataRowCell(doc: any, colIdx: number): any {
    const rows = directChildren(projectTableOf(doc), 'tr')
    return directChildren(rows[1], 'tc')[colIdx]
  }
  function cellSubList(tc: any): any {
    return directChildren(tc, 'subList')[0]
  }

  // 변형된 템플릿 버퍼를 만든다(디스크에 쓰지 않는다).
  function buildMutatedTemplate(mutate: (doc: any) => void): Buffer {
    const zip = new AdmZip(originalTemplate)
    const doc: any = new DOMParser().parseFromString(zip.readAsText('Contents/section0.xml'), 'text/xml')
    mutate(doc)
    zip.updateFile('Contents/section0.xml', Buffer.from(new XMLSerializer().serializeToString(doc), 'utf8'))
    return zip.toBuffer()
  }

  // 라우트가 월간 템플릿을 읽는 fs.readFileSync 호출만 변형본으로 바꿔치기한다.
  // 다른 경로의 readFileSync는 원래 동작을 그대로 위임한다.
  function injectMutatedTemplate(mutate: (doc: any) => void): void {
    const mutated = buildMutatedTemplate(mutate)
    const realReadFileSync = fs.readFileSync
    vi.spyOn(fs, 'readFileSync').mockImplementation(((p: any, ...rest: any[]) => {
      if (typeof p === 'string' && path.resolve(p) === path.resolve(templatePath)) return mutated
      return (realReadFileSync as any)(p, ...rest)
    }) as any)
  }

  async function postWithMutatedTemplate(mutate: (doc: any) => void, body?: any) {
    injectMutatedTemplate(mutate)
    return (await POST(mockRequest(body ?? monthlyReq([perfItem('개찰', 'A용역')])))) as any
  }

  // 구조 위반은 전부 "500 + JSON + ZIP 아님 + HWPX 일부 바이트 미반환"이어야 한다.
  async function expectStructureRejection(res: any) {
    expect(res.status).toBe(500)
    const contentType = res.headers.get('content-type') || ''
    expect(contentType).toContain('application/json')
    expect(contentType).not.toContain('application/zip')
    const buf = Buffer.from(await res.arrayBuffer())
    expect(buf.subarray(0, 2).toString('latin1')).not.toBe('PK')
    expect(buf.length).toBeLessThan(1024)
    expect(JSON.parse(buf.toString('utf8')).error)
      .toBe('문서 양식이 예상 구조와 달라 생성할 수 없습니다. 관리자에게 문의하세요.')
  }

  it('하베스 정상 동작 확인: 변형 없이 주입하면 200 ZIP', async () => {
    const res = await postWithMutatedTemplate(() => {})
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/zip')
  })

  // ── 표 식별: 후보 0개 / 2개 / 순서 역전 / 중첩 표 ──────────────────────────────
  it('프로젝트 표 후보 0개(헤더 fingerprint 훼손) → 거절', async () => {
    await expectStructureRejection(await postWithMutatedTemplate((doc) => {
      const header = directChildren(projectTableOf(doc), 'tr')[0]
      directChildren(header, 'tc')[0].getElementsByTagNameNS(HP_NS, 't')[0].textContent = '전혀 다른 헤더'
    }))
  })

  it('프로젝트 표 후보 2개(같은 표 복제) → 거절', async () => {
    await expectStructureRejection(await postWithMutatedTemplate((doc) => {
      const projTbl = projectTableOf(doc)
      projTbl.parentNode.appendChild(projTbl.cloneNode(true))
    }))
  })

  it('달력 표 후보 0개(요일 헤더 훼손) → 거절', async () => {
    await expectStructureRejection(await postWithMutatedTemplate((doc) => {
      const header = directChildren(calendarTableOf(doc), 'tr')[0]
      directChildren(header, 'tc')[0].getElementsByTagNameNS(HP_NS, 't')[0].textContent = 'XX'
    }))
  })

  it('달력 표 후보 2개(같은 표 복제) → 거절', async () => {
    await expectStructureRejection(await postWithMutatedTemplate((doc) => {
      const calTbl = calendarTableOf(doc)
      calTbl.parentNode.appendChild(calTbl.cloneNode(true))
    }))
  })

  it('프로젝트 표와 달력 표의 문서 순서가 역전되면 → 거절', async () => {
    await expectStructureRejection(await postWithMutatedTemplate((doc) => {
      const calTbl = calendarTableOf(doc)
      const projWrapperRun = projectTableOf(doc).parentNode
      calTbl.parentNode.removeChild(calTbl)
      projWrapperRun.insertBefore(calTbl, projectTableOf(doc))
    }))
  })

  it('데이터 행 셀 안에 중첩 표가 있어도 직계 tr/tc 계산이 유지되어 정상 생성된다', async () => {
    const res = await postWithMutatedTemplate((doc) => {
      // 복제 원본이 되는 첫 데이터 행의 첫 셀에 1x1 중첩 표를 심는다. descendant 검색이라면
      // 행·셀 수와 rowAddr 재부여가 오염되지만, 직계 전용 계산이면 영향이 없어야 한다.
      const subList = cellSubList(firstDataRowCell(doc, 0))
      const nested = doc.createElementNS(HP_NS, 'hp:tbl')
      nested.setAttribute('rowCnt', '1')
      nested.setAttribute('colCnt', '1')
      const ntr = doc.createElementNS(HP_NS, 'hp:tr')
      const ntc = doc.createElementNS(HP_NS, 'hp:tc')
      const naddr = doc.createElementNS(HP_NS, 'hp:cellAddr')
      naddr.setAttribute('rowAddr', '0')
      naddr.setAttribute('colAddr', '0')
      ntc.appendChild(naddr)
      ntr.appendChild(ntc)
      nested.appendChild(ntr)
      directChildren(subList, 'p')[0].appendChild(nested)
    }, monthlyReq([perfItem('개찰', 'A용역'), perfItem('개찰', 'B용역')]))

    expect(res.status).toBe(200)
    const { doc } = await toZipDoc(res)
    // 바깥 프로젝트 표의 직계 행/셀 수와 주소가 정상이어야 한다.
    assertMonthlyDynamicXmlContract(doc, 2)
    const all = getAllText(doc).join('|')
    expect(all).toContain('A용역')
    expect(all).toContain('B용역')
  })

  // ── 프로젝트 표 계약 위반 ────────────────────────────────────────────────────
  it('프로젝트 표 rowCnt 불일치 → 거절', async () => {
    await expectStructureRejection(await postWithMutatedTemplate((doc) => {
      projectTableOf(doc).setAttribute('rowCnt', '99')
    }))
  })

  it('프로젝트 표 rowAddr 불일치 → 거절', async () => {
    await expectStructureRejection(await postWithMutatedTemplate((doc) => {
      firstDataRowCell(doc, 0).getElementsByTagNameNS(HP_NS, 'cellAddr')[0].setAttribute('rowAddr', '7')
    }))
  })

  it('프로젝트 표 colAddr 불일치 → 거절', async () => {
    await expectStructureRejection(await postWithMutatedTemplate((doc) => {
      firstDataRowCell(doc, 3).getElementsByTagNameNS(HP_NS, 'cellAddr')[0].setAttribute('colAddr', '9')
    }))
  })

  it('프로젝트 표 cellSpan 불일치(colSpan=2) → 거절', async () => {
    await expectStructureRejection(await postWithMutatedTemplate((doc) => {
      firstDataRowCell(doc, 0).getElementsByTagNameNS(HP_NS, 'cellSpan')[0].setAttribute('colSpan', '2')
    }))
  })

  it('프로젝트 표 cellSpan 불일치(rowSpan=2) → 거절', async () => {
    await expectStructureRejection(await postWithMutatedTemplate((doc) => {
      firstDataRowCell(doc, 0).getElementsByTagNameNS(HP_NS, 'cellSpan')[0].setAttribute('rowSpan', '2')
    }))
  })

  it('프로젝트 데이터 행 안에서 셀 높이가 하나만 달라도 → 거절', async () => {
    await expectStructureRejection(await postWithMutatedTemplate((doc) => {
      firstDataRowCell(doc, 5).getElementsByTagNameNS(HP_NS, 'cellSz')[0].setAttribute('height', '1234')
    }))
  })

  it('프로젝트 데이터 행끼리 높이가 다르면 → 거절', async () => {
    await expectStructureRejection(await postWithMutatedTemplate((doc) => {
      const rows = directChildren(projectTableOf(doc), 'tr')
      for (const tc of directChildren(rows[2], 'tc')) {
        tc.getElementsByTagNameNS(HP_NS, 'cellSz')[0].setAttribute('height', '2222')
      }
    }))
  })

  it('프로젝트 표 pageBreak 변경 → 거절', async () => {
    await expectStructureRejection(await postWithMutatedTemplate((doc) => {
      projectTableOf(doc).setAttribute('pageBreak', 'TABLE')
    }))
  })

  it('프로젝트 표 treatAsChar 변경 → 거절', async () => {
    await expectStructureRejection(await postWithMutatedTemplate((doc) => {
      directChildren(projectTableOf(doc), 'pos')[0].setAttribute('treatAsChar', '0')
    }))
  })

  // ── 달력 표 계약 위반 (P2-1: cellSpan 포함) ───────────────────────────────────
  it('달력 헤더 셀 colSpan 변경 → 거절', async () => {
    await expectStructureRejection(await postWithMutatedTemplate((doc) => {
      const header = directChildren(calendarTableOf(doc), 'tr')[0]
      directChildren(header, 'tc')[0].getElementsByTagNameNS(HP_NS, 'cellSpan')[0].setAttribute('colSpan', '2')
    }))
  })

  it('달력 날짜 셀 rowSpan 변경 → 거절', async () => {
    await expectStructureRejection(await postWithMutatedTemplate((doc) => {
      const rows = directChildren(calendarTableOf(doc), 'tr')
      directChildren(rows[2], 'tc')[3].getElementsByTagNameNS(HP_NS, 'cellSpan')[0].setAttribute('rowSpan', '2')
    }))
  })

  it('달력 표 rowCnt 불일치 → 거절', async () => {
    await expectStructureRejection(await postWithMutatedTemplate((doc) => {
      calendarTableOf(doc).setAttribute('rowCnt', '5')
    }))
  })

  it('달력 표 rowAddr 불일치 → 거절', async () => {
    await expectStructureRejection(await postWithMutatedTemplate((doc) => {
      const rows = directChildren(calendarTableOf(doc), 'tr')
      directChildren(rows[1], 'tc')[2].getElementsByTagNameNS(HP_NS, 'cellAddr')[0].setAttribute('rowAddr', '3')
    }))
  })

  it('달력 표 vertOffset 변경 → 거절', async () => {
    await expectStructureRejection(await postWithMutatedTemplate((doc) => {
      directChildren(calendarTableOf(doc), 'pos')[0].setAttribute('vertOffset', '999')
    }))
  })

  it('달력 표 pageBreak 변경 → 거절', async () => {
    await expectStructureRejection(await postWithMutatedTemplate((doc) => {
      calendarTableOf(doc).setAttribute('pageBreak', 'CELL')
    }))
  })

  it('달력 표 treatAsChar 변경 → 거절', async () => {
    await expectStructureRejection(await postWithMutatedTemplate((doc) => {
      directChildren(calendarTableOf(doc), 'pos')[0].setAttribute('treatAsChar', '0')
    }))
  })

  it('달력 표 hp:sz가 검증된 행 높이 합과 다르면 → 거절', async () => {
    await expectStructureRejection(await postWithMutatedTemplate((doc) => {
      directChildren(calendarTableOf(doc), 'sz')[0].setAttribute('height', '1')
    }))
  })

  it('달력 날짜 행 높이가 실측값과 다르면 → 거절', async () => {
    await expectStructureRejection(await postWithMutatedTemplate((doc) => {
      const rows = directChildren(calendarTableOf(doc), 'tr')
      for (const tc of directChildren(rows[1], 'tc')) {
        tc.getElementsByTagNameNS(HP_NS, 'cellSz')[0].setAttribute('height', '7000')
      }
    }))
  })

  // ── P1-2: 프로젝트명 "외" 열의 기록 실패가 조용히 넘어가지 않는지 ──────────────────
  // 이전 postcondition은 프로젝트명만 비교했기 때문에 정확히 이 열들의 누락을 놓쳤다.
  const DIRECTOR_COL = 2

  it('프로젝트명 외 셀의 hp:run을 제거하면 조용히 넘어가지 않고 거절된다', async () => {
    await expectStructureRejection(await postWithMutatedTemplate((doc) => {
      const para = directChildren(cellSubList(firstDataRowCell(doc, DIRECTOR_COL)), 'p')[0]
      for (const run of directChildren(para, 'run')) para.removeChild(run)
    }))
  })

  it('프로젝트명 외 셀의 hp:t와 hp:run을 모두 제거하면 거절된다', async () => {
    await expectStructureRejection(await postWithMutatedTemplate((doc) => {
      const para = directChildren(cellSubList(firstDataRowCell(doc, DIRECTOR_COL)), 'p')[0]
      for (const run of directChildren(para, 'run')) {
        for (const t of directChildren(run, 't')) run.removeChild(t)
        para.removeChild(run)
      }
    }))
  })

  it('프로젝트명 외 셀의 문단(hp:p)을 모두 제거하면 거절된다', async () => {
    await expectStructureRejection(await postWithMutatedTemplate((doc) => {
      const subList = cellSubList(firstDataRowCell(doc, DIRECTOR_COL))
      for (const p of directChildren(subList, 'p')) subList.removeChild(p)
    }))
  })

  it('프로젝트명 외 셀의 hp:subList를 제거하면 거절된다', async () => {
    await expectStructureRejection(await postWithMutatedTemplate((doc) => {
      const tc = firstDataRowCell(doc, DIRECTOR_COL)
      tc.removeChild(cellSubList(tc))
    }))
  })

  it('프로젝트명 외 셀에 두 번째 hp:t가 있어도 기록 시 제거되어 잔존 텍스트가 남지 않는다', async () => {
    const res = await postWithMutatedTemplate((doc) => {
      const run = directChildren(directChildren(cellSubList(firstDataRowCell(doc, DIRECTOR_COL)), 'p')[0], 'run')[0]
      const extra = doc.createElementNS(HP_NS, 'hp:t')
      extra.textContent = '잔존텍스트XYZ'
      run.appendChild(extra)
    })
    expect(res.status).toBe(200)
    const { doc } = await toZipDoc(res)
    expect(getAllText(doc).join('|')).not.toContain('잔존텍스트XYZ')
  })

  it('프로젝트명 외 셀에 추가 run 텍스트가 있어도 기록 시 제거된다', async () => {
    const res = await postWithMutatedTemplate((doc) => {
      const para = directChildren(cellSubList(firstDataRowCell(doc, DIRECTOR_COL)), 'p')[0]
      const extraRun = directChildren(para, 'run')[0].cloneNode(true)
      const t = extraRun.getElementsByTagNameNS(HP_NS, 't')[0]
      if (t) t.textContent = '추가run잔존ABC'
      para.appendChild(extraRun)
    })
    expect(res.status).toBe(200)
    const { doc } = await toZipDoc(res)
    expect(getAllText(doc).join('|')).not.toContain('추가run잔존ABC')
  })

  it('프로젝트명 외 셀에 추가 문단이 있어도 기록 시 제거된다', async () => {
    const res = await postWithMutatedTemplate((doc) => {
      const subList = cellSubList(firstDataRowCell(doc, DIRECTOR_COL))
      const clone = directChildren(subList, 'p')[0].cloneNode(true)
      const t = clone.getElementsByTagNameNS(HP_NS, 't')[0]
      if (t) t.textContent = '추가문단잔존QQQ'
      subList.appendChild(clone)
    })
    expect(res.status).toBe(200)
    const { doc } = await toZipDoc(res)
    expect(getAllText(doc).join('|')).not.toContain('추가문단잔존QQQ')
  })

  // ── 실패는 항상 ZIP 갱신 이전에 일어난다 (spy 확인) ────────────────────────────
  //
  // adm-zip의 updateFile은 prototype이 아니라 인스턴스 속성이라 직접 spy할 수 없다(확인함).
  // 대신 프로덕션 경로가 `zip.updateFile('Contents/section0.xml', Buffer.from(new
  // XMLSerializer().serializeToString(doc)))` 형태이므로, serializeToString이 아예 호출되지
  // 않았다면 updateFile도 문서 내용으로 호출된 적이 없다는 뜻이다 — 이걸 주입 경계로 쓴다.
  // (템플릿 변형은 spy 설치 전에 끝내 하베스 자신의 호출이 섞이지 않게 한다.)
  async function expectNoSerializationDuringPost(mutate: (doc: any) => void) {
    injectMutatedTemplate(mutate) // 변형본 생성은 spy 설치 전에 끝난다
    const serializeSpy = vi.spyOn(XMLSerializer.prototype, 'serializeToString')
    try {
      const res: any = await POST(mockRequest(monthlyReq([perfItem('개찰', 'A용역')])))
      await expectStructureRejection(res)
      expect(serializeSpy).not.toHaveBeenCalled()
    } finally {
      serializeSpy.mockRestore()
    }
  }

  it('구조 위반 시 문서 직렬화(=ZIP 갱신) 이전에 중단된다', async () => {
    await expectNoSerializationDuringPost((doc) => {
      projectTableOf(doc).setAttribute('rowCnt', '99')
    })
  })

  it('달력 cellSpan 위반 시에도 문서 직렬화 이전에 중단된다', async () => {
    await expectNoSerializationDuringPost((doc) => {
      const header = directChildren(calendarTableOf(doc), 'tr')[0]
      directChildren(header, 'tc')[0].getElementsByTagNameNS(HP_NS, 'cellSpan')[0].setAttribute('colSpan', '2')
    })
  })

  it('셀 기록 실패 시에도 문서 직렬화 이전에 중단된다', async () => {
    await expectNoSerializationDuringPost((doc) => {
      const para = directChildren(cellSubList(firstDataRowCell(doc, DIRECTOR_COL)), 'p')[0]
      for (const run of directChildren(para, 'run')) para.removeChild(run)
    })
  })

  it('정상 요청에서는 문서 직렬화가 실제로 일어난다(위 not.toHaveBeenCalled가 무의미하지 않음을 확인)', async () => {
    injectMutatedTemplate(() => {})
    const serializeSpy = vi.spyOn(XMLSerializer.prototype, 'serializeToString')
    try {
      const res: any = await POST(mockRequest(monthlyReq([perfItem('개찰', 'A용역')])))
      expect(res.status).toBe(200)
      expect(serializeSpy).toHaveBeenCalled()
    } finally {
      serializeSpy.mockRestore()
    }
  })

  it('변형 템플릿 주입은 디스크의 실제 템플릿 파일을 건드리지 않는다', async () => {
    await postWithMutatedTemplate((doc) => { projectTableOf(doc).setAttribute('rowCnt', '99') })
    vi.restoreAllMocks()
    expect(fs.readFileSync(templatePath).equals(originalTemplate)).toBe(true)
  })
})

// ── P1-2: 12개 셀 전체 postcondition이 실제로 전 필드를 비교하는지 (정상 경로 확인) ────
describe('POST /api/hwpx — 월간 12개 셀 전체 값 검증', () => {
  const IDX = {
    name: 0, client: 1, chief: 2, fee: 3, period: 4, pages: 5,
    taskDesc: 6, siteCheck: 7, submit: 8, interview: 9, bid: 10, note: 11,
  }

  function cellLines(tc: any): string[] {
    const subList = Array.from(tc.childNodes || []).find((n: any) => n.nodeType === 1 && n.localName === 'subList') as any
    if (!subList) return []
    return (Array.from(subList.childNodes || []).filter((n: any) => n.nodeType === 1 && n.localName === 'p') as any[])
      .map((p: any) => Array.from(p.getElementsByTagNameNS(HP_NS, 't') as any[]).map((t: any) => t.textContent ?? '').join(''))
  }
  const cellText = (tc: any) => cellLines(tc).join('\n')

  function dataRowCells(doc: any): any[][] {
    const projTbl = Array.from(doc.getElementsByTagNameNS(HP_NS, 'tbl') as any[])
      .find((t: any) => Number(t.getAttribute('colCnt')) === 12)
    const rows = Array.from(projTbl.childNodes || []).filter((n: any) => n.nodeType === 1 && n.localName === 'tr') as any[]
    return rows.slice(1).map((tr: any) => getTcs(tr))
  }

  it('모든 필드가 12개 셀에 정확히 기록된다(빈 열은 정확히 빈 값)', async () => {
    const performing = [{
      status: '개찰', name: '가나다 사업', director: '김단장', fee: 12.5,
      submit_date: '5.19', interview_date: '5.20', result_date: '5.22', note: '비고내용',
    }]
    const res: any = await POST(mockRequest(monthlyReq(performing)))
    expect(res.status).toBe(200)
    const { doc } = await toZipDoc(res)
    const cells = dataRowCells(doc)[0]

    expect(cells.length).toBe(12)
    expect(cellText(cells[IDX.name])).toBe('가나다 사업')
    expect(cellText(cells[IDX.chief])).toBe('김단장')
    expect(cellText(cells[IDX.fee])).toBe('12.5')
    expect(cellText(cells[IDX.submit])).toBe('5.19')
    expect(cellText(cells[IDX.interview])).toBe('5.20')
    expect(cellText(cells[IDX.bid])).toBe('5.22')
    expect(cellText(cells[IDX.note])).toBe('비고내용')
    // 의도적으로 빈 열 — 템플릿 예시 텍스트가 잔존하지 않아야 한다.
    for (const col of [IDX.client, IDX.period, IDX.pages, IDX.taskDesc, IDX.siteCheck]) {
      expect(cellText(cells[col])).toBe('')
    }
  })

  it('multiline note는 문단으로 나뉘고 전체 텍스트가 입력과 일치한다', async () => {
    const performing = [{
      status: '개찰', name: 'A용역', director: '김단장', fee: 1,
      submit_date: '', interview_date: '', result_date: '', note: '첫째 줄\n둘째 줄\n셋째 줄',
    }]
    const res: any = await POST(mockRequest(monthlyReq(performing)))
    expect(res.status).toBe(200)
    const { doc } = await toZipDoc(res)
    const cells = dataRowCells(doc)[0]
    expect(cellLines(cells[IDX.note])).toEqual(['첫째 줄', '둘째 줄', '셋째 줄'])
    expect(cellText(cells[IDX.note])).toBe('첫째 줄\n둘째 줄\n셋째 줄')
  })

  it('값이 없는 필드는 빈 문자열로 기록되고 템플릿 예시 텍스트가 남지 않는다', async () => {
    const performing = [{ status: '개찰', name: 'A용역' }]
    const res: any = await POST(mockRequest(monthlyReq(performing)))
    expect(res.status).toBe(200)
    const { doc } = await toZipDoc(res)
    const cells = dataRowCells(doc)[0]
    expect(cellText(cells[IDX.name])).toBe('A용역')
    for (const col of [IDX.client, IDX.chief, IDX.fee, IDX.period, IDX.pages,
      IDX.taskDesc, IDX.siteCheck, IDX.submit, IDX.interview, IDX.bid, IDX.note]) {
      expect(cellText(cells[col])).toBe('')
    }
  })

  it('0건이면 빈 데이터 행의 12개 셀이 모두 정확히 빈 값이다', async () => {
    const res: any = await POST(mockRequest(monthlyReq([])))
    expect(res.status).toBe(200)
    const { doc } = await toZipDoc(res)
    const rows = dataRowCells(doc)
    expect(rows.length).toBe(1)
    expect(rows[0].length).toBe(12)
    for (const tc of rows[0]) expect(cellText(tc)).toBe('')
  })

  it('여러 건이 입력 순서대로 각 행 12개 셀에 기록된다', async () => {
    const performing = [1, 2, 3].map((n) => ({
      status: '개찰', name: `사업${n}`, director: `단장${n}`, fee: n,
      submit_date: `5.1${n}`, interview_date: `5.2${n}`, result_date: `5.3${n}`, note: `비고${n}`,
    }))
    const res: any = await POST(mockRequest(monthlyReq(performing)))
    expect(res.status).toBe(200)
    const { doc } = await toZipDoc(res)
    const rows = dataRowCells(doc)
    expect(rows.length).toBe(3)
    rows.forEach((cells, i) => {
      const n = i + 1
      expect(cellText(cells[IDX.name])).toBe(`사업${n}`)
      expect(cellText(cells[IDX.chief])).toBe(`단장${n}`)
      expect(cellText(cells[IDX.fee])).toBe(String(n))
      expect(cellText(cells[IDX.submit])).toBe(`5.1${n}`)
      expect(cellText(cells[IDX.interview])).toBe(`5.2${n}`)
      expect(cellText(cells[IDX.bid])).toBe(`5.3${n}`)
      expect(cellText(cells[IDX.note])).toBe(`비고${n}`)
    })
  })
})
