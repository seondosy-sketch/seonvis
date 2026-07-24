/* eslint-disable @typescript-eslint/no-explicit-any -- route.ts 자체가 @ts-nocheck로 처리하는
   xmldom(타입 미비 라이브러리) DOM 순회를 그대로 검증하는 테스트라 동일하게 any를 쓴다. */
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { DOMParser } from '@xmldom/xmldom'
import { POST } from './route'
import { PAGE_BUDGET_EXCEEDED_MESSAGE } from '@/lib/hwpx/pageBudget'

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
    const res: any = await POST(mockRequest({ type: 'monthly', week: '2026-W22', performing: [] }))
    expect(res.status).toBe(200)
    const { zip } = await toZipDoc(res)
    expect(zip.getEntry('Contents/section0.xml')).not.toBeNull()
  })

  it('월간: 프로젝트 11건(현재 문서 양식의 출력 공간과 정확히 일치)이면 200과 zip 바이너리를 반환한다', async () => {
    const performing = Array.from({ length: 11 }, (_, i) => perfItem('개찰', `월간${i + 1}`))
    const res: any = await POST(mockRequest({ type: 'monthly', week: '2026-W22', performing }))
    expect(res.status).toBe(200)
    const { doc } = await toZipDoc(res)
    const all = getAllText(doc).join('|')
    expect(all).toContain('월간1')
    expect(all).toContain('월간11')
  })

  it('월간: 프로젝트 12건이면 400과 구체적인 오류 메시지를 반환한다(월간은 이번 단계에서 고정 11건 유지)', async () => {
    const performing = Array.from({ length: 12 }, (_, i) => perfItem('개찰', `월간${i + 1}`))
    const res: any = await POST(mockRequest({ type: 'monthly', week: '2026-W22', performing }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('출력 공간은 11건')
    expect(json.error).toContain('12건이 입력되어')
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

  it('월간: note에 기준일과 같은 패턴("N월 N일 현재")이 있어도 note는 그대로 유지되고, 기준일 표시 위치만 갱신된다', async () => {
    const today = new Date()
    const expectedMonthStr = `${today.getMonth() + 1}월 ${today.getDate()}일 현재`
    const pollutedNote = '이 사업은 4월 3일 현재 설계 진행 중'
    const performing = [{ ...perfItem('개찰', 'A용역'), note: pollutedNote }]
    const res: any = await POST(mockRequest({ type: 'monthly', week: '2026-W22', performing }))
    expect(res.status).toBe(200)
    const { doc } = await toZipDoc(res)
    const texts = getAllText(doc)

    // 1) 사용자가 입력한 note 전체가 그대로 유지된다
    expect(texts).toContain(pollutedNote)

    // 2) 기준일은 지정된 위치에서 오늘 날짜로 정확히 하나만 바뀐다
    const dateMatches = texts.filter(t => t.trim() === expectedMonthStr)
    expect(dateMatches.length).toBe(1)

    // 3) note 안의 "4월 3일 현재" 문자열은 오늘 날짜로 바뀌지 않는다(오염되지 않는다)
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
    const res: any = await POST(mockRequest({ type: 'monthly', week: '2026-W22', performing }))
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
