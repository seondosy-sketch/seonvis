/* eslint-disable @typescript-eslint/no-explicit-any */
// 월간 HWPX — Project List 연계 상단표 + 하단 달력.
//
// 기준 파일: CM본부월업무계획(7.24).hwpx (실측)
//   용역명   "2647_26-A-00부대(A138)"   관리번호_정제명
//   비고     "4(2.5+1.5)"               project_tooltips.score_dist
//   값 없음  "-"
//   달력     기준일 주의 일요일부터 3주, 일정 "*정제명-제출/면접/개찰"
//            별표 + 일반 하이픈(U+002D, 앞뒤 공백 없음), 도형 기호·범례 없음
//            제출 charPr 15(#FF0000) / 면접 13(#09D909) / 개찰 18(#0000FF)
import { describe, it, expect } from 'vitest'
import AdmZip from 'adm-zip'
import { DOMParser } from '@xmldom/xmldom'
import { POST } from './route'

const HP_NS = 'http://www.hancom.co.kr/hwpml/2011/paragraph'
const HH_NS = 'http://www.hancom.co.kr/hwpml/2011/head'

function mockRequest(body: unknown) {
  return { json: async () => body } as any
}
const dc = (p: any, n: string): any[] =>
  Array.from(p.childNodes || []).filter((x: any) => x.nodeType === 1 && x.localName === n)
const els = (s: any, n: string): any[] => Array.from(s.getElementsByTagNameNS(HP_NS, n) as any[])
const runText = (p: any) => els(p, 't').map((t: any) => t.textContent ?? '').join('')

async function toZip(res: any): Promise<{ zip: any; doc: any }> {
  const buf = Buffer.from(await res.arrayBuffer())
  const zip = new AdmZip(buf)
  return { zip, doc: new DOMParser().parseFromString(zip.readAsText('Contents/section0.xml'), 'text/xml') as any }
}

const IDX = {
  name: 0, client: 1, chief: 2, fee: 3, period: 4, pages: 5,
  taskDesc: 6, siteCheck: 7, submit: 8, interview: 9, bid: 10, note: 11,
}

const linesOf = (tc: any): string[] => {
  const sub = dc(tc, 'subList')[0]
  if (!sub) return []
  return dc(sub, 'p').map(runText)
}
const textOf = (tc: any) => linesOf(tc).join('\n')

const tableWithCols = (doc: any, cols: number): any =>
  els(doc, 'tbl').find((t: any) => Number(t.getAttribute('colCnt')) === cols)
const projRows = (doc: any): any[][] =>
  dc(tableWithCols(doc, 12), 'tr').slice(1).map((tr: any) => dc(tr, 'tc'))

/** 달력 21개 셀을 [{label, entries:[{text,charPr}]}]로 읽는다. */
const calCells = (doc: any) =>
  dc(tableWithCols(doc, 7), 'tr').slice(1).flatMap((tr: any) =>
    dc(tr, 'tc').map((tc: any) => {
      const paras = dc(dc(tc, 'subList')[0], 'p')
      return {
        label: paras.length ? runText(paras[0]) : '',
        entries: paras.slice(1).map((p: any) => ({
          text: runText(p),
          charPr: dc(p, 'run')[0]?.getAttribute('charPrIDRef'),
        })),
      }
    })
  )

/** 실제 운영 데이터 형태(projects + project_tooltips 조인 결과) */
const listRow = (over: Record<string, unknown> = {}) => ({
  status: '진행중',
  name: '345kV 신석문변전소 토건공사 감독권한대행 등 건설사업관리용역',
  director: '조장연', fee: '75.60', note: '',
  project_number: '2651', client: '한국전력공사 중부건설본부',
  duration_days: '40.6', score_dist: '60(30+30)',
  proposal_p: '50P', self_intro_p: '', ppt_p: '별도',
  interview_time: '10분+5분+각5분', evaluation: '',
  staff_arch: '이상원(65)', staff_civil: '', staff_mech: '', staff_safety: '손만호',
  list_submit_date: '2026-07-21', list_interview_date: '2026-07-23', list_bid_date: '2026-07-28',
  ...over,
})
const req = (performing: any[], over: Record<string, unknown> = {}) =>
  ({ type: 'monthly', performing, reportYear: 2026, reportMonth: 7, asOfDate: '2026-07-24', ...over })

describe('월간 상단표 — Project List 연계', () => {
  it('12열이 Project List 값으로 채워진다', async () => {
    const res: any = await POST(mockRequest(req([listRow()])))
    expect(res.status).toBe(200)
    const cells = projRows((await toZip(res)).doc)[0]
    expect(textOf(cells[IDX.name])).toBe('2651_345kV 신석문변전소')
    expect(textOf(cells[IDX.client])).toBe('한전(중부)') // 월간 표시명(7.24 기준 파일 실측)
    expect(textOf(cells[IDX.chief])).toBe('조장연')
    expect(textOf(cells[IDX.fee])).toBe('75.6')
    expect(textOf(cells[IDX.period])).toBe('40.6')
    expect(textOf(cells[IDX.pages])).toBe('제안서 50P PPT 별도')
    expect(textOf(cells[IDX.taskDesc])).toBe('-')
    expect(textOf(cells[IDX.siteCheck])).toBe('-')
    expect(textOf(cells[IDX.submit])).toBe('7/21')
    expect(textOf(cells[IDX.interview])).toBe('7/23')
    expect(textOf(cells[IDX.bid])).toBe('7/28')
    expect(textOf(cells[IDX.note])).toBe('60(30+30)')
  })

  it('유효 소수점 2자리 금액이 잘리지 않는다', async () => {
    const res: any = await POST(mockRequest(req([listRow({ fee: '115.44' })])))
    expect(textOf(projRows((await toZip(res)).doc)[0][IDX.fee])).toBe('115.44')
  })

  it('기간은 "11.6개월"에서 숫자만 남는다', async () => {
    const res: any = await POST(mockRequest(req([listRow({ duration_days: '11.6개월' })])))
    expect(textOf(projRows((await toZip(res)).doc)[0][IDX.period])).toBe('11.6')
  })

  it('비고는 score_dist → 분야별 기술인 → note 순이고 병기하지 않는다', async () => {
    const res: any = await POST(mockRequest(req([
      listRow(),
      listRow({ score_dist: '' }),
      listRow({ score_dist: '', staff_arch: '', staff_safety: '', note: '특이사항' }),
      listRow({ score_dist: '', staff_arch: '', staff_safety: '', note: '' }),
    ])))
    const rows = projRows((await toZip(res)).doc)
    expect(textOf(rows[0][IDX.note])).toBe('60(30+30)')
    expect(textOf(rows[1][IDX.note])).toBe('-건축 이상원(65) -안전 손만호')
    expect(textOf(rows[2][IDX.note])).toBe('특이사항')
    expect(textOf(rows[3][IDX.note])).toBe('-')
  })

  it('발표/면접 열은 날짜 → 서면평가 → 추후 → "-" 순으로 정해진다', async () => {
    const res: any = await POST(mockRequest(req([
      listRow(),
      listRow({ list_interview_date: null, interview_time: '서면평가' }),
      listRow({ list_interview_date: null, interview_time: '추후' }),
      listRow({ list_interview_date: null, interview_time: '10분/10분' }),
    ])))
    const rows = projRows((await toZip(res)).doc)
    expect(textOf(rows[0][IDX.interview])).toBe('7/23')
    expect(textOf(rows[1][IDX.interview])).toBe('서면평가')
    expect(textOf(rows[2][IDX.interview])).toBe('추후')
    expect(textOf(rows[3][IDX.interview])).toBe('-')
  })

  it('개찰일에 낙찰자가 있으면 괄호로 붙는다', async () => {
    const res: any = await POST(mockRequest(req([listRow({ evaluation: '선' })])))
    expect(textOf(projRows((await toZip(res)).doc)[0][IDX.bid])).toBe('7/28(선)')
  })

  it('매핑에 없는 발주처는 원문을 그대로 출력한다(절단·축약 없음)', async () => {
    const long = '한국토지주택공사 경기지역본부 주택사업처' // 매핑 목록에 없는 원문
    const res: any = await POST(mockRequest(req([listRow({ client: long })])))
    expect(textOf(projRows((await toZip(res)).doc)[0][IDX.client])).toBe(long)
  })

  it('발주처 표시명 매핑이 월간 출력에만 적용된다', async () => {
    const res: any = await POST(mockRequest(req([
      listRow({ client: '국군재정관리단' }),
      listRow({ client: '수자원공사 금강유역본부' }),
      listRow({ client: '한국전력공사 경인건설본부 경기건설지사' }),
      listRow({ client: '한국토지주택공사' }),
      listRow({ client: '안산시' }),
    ])))
    const rows = projRows((await toZip(res)).doc)
    expect(rows.map((c) => textOf(c[IDX.client])))
      .toEqual(['국군재정', '한국수자원', '한전(경인)', 'LH', '안산시'])
  })

  it('Project List 연계 필드가 없는 구 요청도 200이고 해당 열은 "-"다', async () => {
    const res: any = await POST(mockRequest(req([{ status: '개찰', name: 'A용역', director: '김단장' }])))
    expect(res.status).toBe(200)
    const cells = projRows((await toZip(res)).doc)[0]
    for (const col of [IDX.client, IDX.period, IDX.pages, IDX.taskDesc, IDX.siteCheck]) {
      expect(textOf(cells[col])).toBe('-')
    }
  })
})

describe('월간 하단 달력', () => {
  it('기준일 주의 일요일부터 3주가 채워진다 (7.24 → 7/19~8/8)', async () => {
    const res: any = await POST(mockRequest(req([])))
    expect(res.status).toBe(200)
    const cells = calCells((await toZip(res)).doc)
    expect(cells.length).toBe(21)
    expect(cells.map((c) => c.label)).toEqual([
      '19', '20', '21', '22', '23', '24', '25',
      '26', '27', '28', '29', '30', '31', '8/1',
      '2', '3', '4', '5', '6', '7', '8',
    ])
  })

  it('일정이 날짜 칸에 "*정제명-종류"로 들어가고 종류별 charPr이 적용된다', async () => {
    const res: any = await POST(mockRequest(req([listRow()])))
    const cells = calCells((await toZip(res)).doc)
    const at = (label: string) => cells.find((c) => c.label === label)!
    expect(at('21').entries).toEqual([{ text: '*345kV 신석문변전소-제출', charPr: '15' }])
    expect(at('23').entries).toEqual([{ text: '*345kV 신석문변전소-면접', charPr: '13' }])
    expect(at('28').entries).toEqual([{ text: '*345kV 신석문변전소-개찰', charPr: '18' }])
    // 일정이 없는 칸은 날짜 문단 하나만 — 빈 문단을 넣지 않는다
    expect(at('19').entries).toEqual([])
    expect(at('8/1').entries).toEqual([])
  })

  it('관리번호는 달력에 넣지 않고 군 시설 식별번호는 유지한다', async () => {
    const res: any = await POST(mockRequest(req([listRow({
      project_number: '2647', name: '26-A-00부대 건설사업관리용역(A138)',
      list_submit_date: '2026-07-22', list_interview_date: null, list_bid_date: null,
    })])))
    const cells = calCells((await toZip(res)).doc)
    const entry = cells.find((c) => c.label === '22')!.entries[0]
    // 여는 괄호 앞 공백은 월간 전용 후처리로 제거한다(공유 함수는 그대로).
    expect(entry.text).toBe('*26-A-00부대(A138)-제출')
    expect(entry.text).toContain('(A138)') // 군 시설 식별번호 유지
    expect(entry.text).not.toContain('2647') // 관리번호는 달력에 넣지 않는다
  })

  it('서면평가·추후·날짜 미정 일정은 달력에 표시하지 않는다', async () => {
    const res: any = await POST(mockRequest(req([listRow({
      list_interview_date: null, interview_time: '서면평가', list_bid_date: null,
    })])))
    const all = calCells((await toZip(res)).doc).flatMap((c) => c.entries.map((e) => e.text))
    expect(all).toEqual(['*345kV 신석문변전소-제출'])
    expect(all.join('|')).not.toContain('서면평가')
    expect(all.join('|')).not.toContain('추후')
  })

  it('같은 날 여러 일정은 제출 → 면접 → 개찰 순으로 쌓인다', async () => {
    const res: any = await POST(mockRequest(req([
      listRow({ name: 'A', list_submit_date: null, list_interview_date: null, list_bid_date: '2026-07-22' }),
      listRow({ name: 'B', list_submit_date: null, list_interview_date: '2026-07-22', list_bid_date: null }),
      listRow({ name: 'C', list_submit_date: '2026-07-22', list_interview_date: null, list_bid_date: null }),
    ])))
    const entries = calCells((await toZip(res)).doc).find((c) => c.label === '22')!.entries
    expect(entries.map((e) => e.text)).toEqual(['*C-제출', '*B-면접', '*A-개찰'])
    expect(entries.map((e) => e.charPr)).toEqual(['15', '13', '18'])
  })

  it('달력 범위 밖 일정은 표시하지 않는다', async () => {
    const res: any = await POST(mockRequest(req([listRow({
      list_submit_date: '2026-07-18', list_interview_date: '2026-08-09', list_bid_date: '2026-08-08',
    })])))
    const cells = calCells((await toZip(res)).doc)
    expect(cells.flatMap((c) => c.entries.map((e) => e.text))).toEqual(['*345kV 신석문변전소-개찰'])
    expect(cells.find((c) => c.label === '8')!.entries.length).toBe(1)
  })

  it('일정 문구에 EN DASH와 도형 기호가 없다', async () => {
    const res: any = await POST(mockRequest(req([listRow()])))
    const all = calCells((await toZip(res)).doc).flatMap((c) => c.entries.map((e) => e.text))
    const joined = all.join('|')
    expect(joined).not.toContain('–')
    expect(joined).not.toContain('—')
    for (const sym of ['■', '▲', '◆', '▶', '●']) expect(joined).not.toContain(sym)
    for (const t of all) expect(t).toMatch(/^\*.+-(제출|면접|개찰)$/u)
  })

  it('달력 표 구조(4행 × 7열)와 헤더 행은 그대로 유지된다', async () => {
    const res: any = await POST(mockRequest(req([listRow()])))
    const cal = tableWithCols((await toZip(res)).doc, 7)
    const rows = dc(cal, 'tr')
    expect(rows.length).toBe(4)
    expect(Number(cal.getAttribute('rowCnt'))).toBe(4)
    expect(cal.getAttribute('pageBreak')).toBe('NONE')
    for (const tr of rows) expect(dc(tr, 'tc').length).toBe(7)
    expect(dc(rows[0], 'tc').map(textOf)).toEqual(['일', '월', '화', '수', '목', '금', '토'])
  })

  it('날짜 문단의 charPr(요일 색상)은 일정이 있어도 바뀌지 않는다', async () => {
    const dateCharPr = async (performing: any[]) => {
      const res: any = await POST(mockRequest(req(performing)))
      const rows = dc(tableWithCols((await toZip(res)).doc, 7), 'tr').slice(1)
      return rows.flatMap((tr: any) => dc(tr, 'tc').map((tc: any) =>
        dc(dc(dc(tc, 'subList')[0], 'p')[0], 'run')[0]?.getAttribute('charPrIDRef')))
    }
    expect(await dateCharPr([listRow()])).toEqual(await dateCharPr([]))
  })

  it('달력 일정용 charPr이 기준 파일 색상·크기·이탤릭·굵기·자간과 일치한다', async () => {
    const res: any = await POST(mockRequest(req([listRow()])))
    const { zip } = await toZip(res)
    const hdr: any = new DOMParser().parseFromString(zip.readAsText('Contents/header.xml'), 'text/xml')
    const charPrs: any[] = Array.from(hdr.getElementsByTagNameNS(HH_NS, 'charPr') as any[])
    const spec = {
      15: { color: '#FF0000', spacing: '-1' }, // 제출
      13: { color: '#09D909', spacing: '0' },  // 면접
      18: { color: '#0000FF', spacing: '0' },  // 개찰
    }
    for (const [id, want] of Object.entries(spec)) {
      const c = charPrs.find((x: any) => x.getAttribute('id') === id)
      expect(c, `charPr ${id}`).toBeTruthy()
      expect(c.getAttribute('height')).toBe('900')
      expect(c.getAttribute('textColor')).toBe(want.color)
      expect(Array.from(c.getElementsByTagNameNS(HH_NS, 'italic')).length).toBe(1)
      expect(Array.from(c.getElementsByTagNameNS(HH_NS, 'bold')).length).toBe(1)
      const sp: any = Array.from(c.getElementsByTagNameNS(HH_NS, 'spacing'))[0]
      expect(sp.getAttribute('hangul')).toBe(want.spacing)
    }
  })

})
