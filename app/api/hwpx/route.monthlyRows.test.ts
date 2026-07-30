/* eslint-disable @typescript-eslint/no-explicit-any */
// 월간 프로젝트 표의 "행 동적 재구성" 검증 — 예산 판정을 우회한다.
//
// A4 가로 실제 사용 가능 높이(55,276)로 예산을 바로잡은 뒤에는 12건 이상이 예산 단계에서
// 차단된다(실제로 2페이지 — 한글 렌더 확인). 그래서 공개 POST 경로로는 12건 이상의 행 복제
// 로직을 더 이상 실행할 수 없다. 행 재구성 자체는 건수와 무관하게 옳아야 하므로, 이 파일에서만
// 예산을 통과시켜 rowCnt·rowAddr·hp:sz·데이터 누락 없음을 계속 검증한다.
import { describe, it, expect, vi } from 'vitest'
import AdmZip from 'adm-zip'
import { DOMParser } from '@xmldom/xmldom'

vi.mock('@/lib/hwpx/monthlyPageBudget', async () => {
  const actual: any = await vi.importActual('@/lib/hwpx/monthlyPageBudget')
  return {
    ...actual,
    // 계산은 실제 함수로 하고 판정만 통과시킨다 — 계산식 자체를 우회하지 않는다.
    estimateMonthlyPageBudget: (input: any) => ({ ...actual.estimateMonthlyPageBudget(input), fits: true }),
  }
})

const { POST } = await import('./route')

const HP_NS = 'http://www.hancom.co.kr/hwpml/2011/paragraph'
const mockRequest = (body: unknown) => ({ json: async () => body }) as any
const dc = (p: any, n: string): any[] =>
  Array.from(p.childNodes || []).filter((x: any) => x.nodeType === 1 && x.localName === n)
const els = (s: any, n: string): any[] => Array.from(s.getElementsByTagNameNS(HP_NS, n) as any[])

async function toDoc(res: any) {
  const zip = new AdmZip(Buffer.from(await res.arrayBuffer()))
  return new DOMParser().parseFromString(zip.readAsText('Contents/section0.xml'), 'text/xml') as any
}
const projTable = (doc: any) => els(doc, 'tbl').find((t: any) => Number(t.getAttribute('colCnt')) === 12)

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({
  status: '개찰', name: `월${i + 1}`, director: `단장${i + 1}`, fee: '1.00',
  project_number: String(9000 + i), client: '안산시', duration_days: '12', score_dist: '3',
}))
const req = (n: number) => ({
  type: 'monthly', performing: rows(n), reportYear: 2026, reportMonth: 7, asOfDate: '2026-07-24',
})

describe('월간 프로젝트 표 행 재구성 (예산 우회)', () => {
  for (const n of [1, 11, 13, 20, 23, 30]) {
    it(`${n}건 — rowCnt·rowAddr·hp:sz가 맞고 데이터가 누락되지 않는다`, async () => {
      const res: any = await POST(mockRequest(req(n)))
      expect(res.status).toBe(200)
      const doc = await toDoc(res)
      const tbl = projTable(doc)
      const trs = dc(tbl, 'tr')

      // 행 수 = 헤더 1 + 데이터 n
      expect(trs.length).toBe(n + 1)
      expect(Number(tbl.getAttribute('rowCnt'))).toBe(n + 1)

      // rowAddr/colAddr가 위치와 일치
      trs.forEach((tr: any, ri: number) => {
        dc(tr, 'tc').forEach((tc: any, ci: number) => {
          const addr = dc(tc, 'cellAddr')[0]
          expect(Number(addr.getAttribute('rowAddr'))).toBe(ri)
          expect(Number(addr.getAttribute('colAddr'))).toBe(ci)
        })
      })

      // hp:sz = 행 높이 합
      const rowHeight = (tr: any) => Number(dc(dc(tr, 'tc')[0], 'cellSz')[0].getAttribute('height'))
      const sum = trs.reduce((s: number, tr: any) => s + rowHeight(tr), 0)
      expect(Number(dc(tbl, 'sz')[0].getAttribute('height'))).toBe(sum)

      // 데이터 누락 없음
      const all = els(doc, 't').map((t: any) => t.textContent ?? '').join('|')
      for (let i = 1; i <= n; i++) expect(all, `월${i} 누락`).toContain(`월${i}`)
    })
  }

  it('0건이면 빈 데이터 행 1개만 남는다', async () => {
    const res: any = await POST(mockRequest({ ...req(0), performing: [] }))
    expect(res.status).toBe(200)
    const trs = dc(projTable(await toDoc(res)), 'tr')
    expect(trs.length).toBe(2)
  })

  it('새로 복제된 행에도 프로젝트명 정제가 적용된다', async () => {
    const performing = [
      ...rows(12),
      { status: '개찰', name: '○○센터 신축공사 건설사업관리용역', director: '김단장', fee: '1.00', project_number: '9999', client: '안산시', duration_days: '12', score_dist: '3' },
    ]
    const res: any = await POST(mockRequest({ ...req(0), performing }))
    expect(res.status).toBe(200)
    const all = els(await toDoc(res), 't').map((t: any) => t.textContent ?? '').join('|')
    expect(all).toContain('○○센터')
    expect(all).not.toContain('건설사업관리용역')
  })

  it('달력 21개 셀 합계가 일정 총수와 일치한다(누락·중복 없음)', async () => {
    const performing = Array.from({ length: 12 }, (_, i) => ({
      status: '진행중', name: `프로젝트${i + 1}`, director: 'd', fee: '1.00',
      project_number: String(8000 + i), client: '안산시', duration_days: '12', score_dist: '3',
      list_submit_date: `2026-07-${String(20 + (i % 5)).padStart(2, '0')}`,
      list_interview_date: `2026-07-${String(26 + (i % 5)).padStart(2, '0')}`,
      list_bid_date: `2026-08-${String(1 + (i % 5)).padStart(2, '0')}`,
    }))
    const res: any = await POST(mockRequest({ ...req(0), performing }))
    expect(res.status).toBe(200)
    const doc = await toDoc(res)
    const cal = els(doc, 'tbl').find((t: any) => Number(t.getAttribute('colCnt')) === 7)
    const entries = dc(cal, 'tr').slice(1).flatMap((tr: any) =>
      dc(tr, 'tc').flatMap((tc: any) => dc(dc(tc, 'subList')[0], 'p').slice(1)))
    expect(entries.length).toBe(12 * 3)
  })
})
