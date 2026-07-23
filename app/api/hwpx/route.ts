// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server'
import path from 'node:path'
import fs from 'node:fs'

const HP_NS = 'http://www.hancom.co.kr/hwpml/2011/paragraph'

function getTcs(tr: any): any[] {
  return Array.from((tr.childNodes as any) || []).filter(
    (n: any) => n.nodeType === 1 && n.localName === 'tc'
  )
}

function getSubList(tc: any): any {
  return (Array.from((tc.childNodes as any) || []) as any[]).find(
    (n: any) => n.nodeType === 1 && n.localName === 'subList'
  ) ?? null
}

function setText(tc: any, text: string): void {
  let t = tc.getElementsByTagNameNS(HP_NS, 't')[0]
  if (!t) {
    const run = tc.getElementsByTagNameNS(HP_NS, 'run')[0]
    if (run) {
      t = tc.ownerDocument.createElementNS(HP_NS, 'hp:t')
      run.appendChild(t)
    }
  }
  if (t) t.textContent = text
}

function setTextMultiLine(tc: any, text: string): void {
  const parts = text.split('\n')
  if (parts.length <= 1) { setText(tc, text); return }
  const sl = getSubList(tc)
  if (!sl) { setText(tc, parts.join(' ')); return }
  const existParas: any[] = Array.from((sl.childNodes as any) || []).filter(
    (n: any) => n.nodeType === 1 && n.localName === 'p'
  )
  if (existParas.length === 0) { setText(tc, parts.join(' ')); return }
  existParas.slice(1).forEach((p: any) => sl.removeChild(p))
  const basePara = existParas[0]
  let t0 = basePara.getElementsByTagNameNS(HP_NS, 't')[0]
  if (!t0) {
    const run = basePara.getElementsByTagNameNS(HP_NS, 'run')[0]
    if (run) { t0 = tc.ownerDocument.createElementNS(HP_NS, 'hp:t'); run.appendChild(t0) }
  }
  if (t0) t0.textContent = parts[0]
  for (let i = 1; i < parts.length; i++) {
    const newPara = basePara.cloneNode(true)
    const ti = newPara.getElementsByTagNameNS(HP_NS, 't')[0]
    if (ti) ti.textContent = parts[i]
    sl.appendChild(newPara)
  }
}

function getText(tc: any): string {
  return Array.from(tc.getElementsByTagNameNS(HP_NS, 't') as any[])
    .map((t: any) => t.textContent ?? '').join('')
}

function clearCell(tc: any): void {
  setText(tc, '')
  const sl = getSubList(tc)
  if (!sl) return
  const paras: any[] = Array.from((sl.childNodes as any) || []).filter(
    (n: any) => n.nodeType === 1 && n.localName === 'p'
  )
  paras.slice(1).forEach((p: any) => sl.removeChild(p))
}

function removeLinesegarray(node: any): void {
  const items: any[] = Array.from(node.getElementsByTagNameNS(HP_NS, 'linesegarray') as any[])
  for (const el of items) el.parentNode?.removeChild(el)
}

// ── 발주예상 Project 표 채우기 (8열: 연번/Project/발주청/단장/사업비(억)/발주(월)/용역비(억)/내용, 템플릿 고정 2행) ──
function fillExpectedTable(doc: any, expected: any[]): void {
  const tbls: any[] = Array.from(doc.getElementsByTagNameNS(HP_NS, 'tbl') as any[])
  const tbl = tbls[1]
  if (!tbl) return
  const rows: any[] = Array.from(tbl.getElementsByTagNameNS(HP_NS, 'tr') as any[])
  const dataRows = rows.slice(1).map(r => getTcs(r)) // 헤더 행 제외
  const IDX = { num: 0, name: 1, client: 2, chief: 3, cost: 4, month: 5, fee: 6, note: 7 }

  for (let i = 0; i < dataRows.length; i++) {
    const dtcs = dataRows[i]
    if (i < expected.length) {
      const e = expected[i]
      setText(dtcs[IDX.num],    String(i + 1))
      setText(dtcs[IDX.name],   e.name || '')
      setText(dtcs[IDX.client], e.client || '')
      setText(dtcs[IDX.chief],  e.director || '')
      setText(dtcs[IDX.cost],   e.project_cost || '')
      setText(dtcs[IDX.month],  e.order_month || '')
      setText(dtcs[IDX.fee],    e.fee || '')
      setTextMultiLine(dtcs[IDX.note], e.note || '')
    } else {
      for (const dtc of dtcs) clearCell(dtc)
    }
  }
}

// ── 교육참가자(OSG팀) 문단 채우기 — 책임 1줄 + 분야별(건축/토목/안전/기계, 값 있는 항목만) N줄 ──────────
const EDU_LABELS: Record<string, string> = { edu_arch: '건축', edu_civil: '토목', edu_safety: '안전', edu_mech: '기계' }
const EDU_FIELD_ORDER = ['edu_arch', 'edu_civil', 'edu_safety', 'edu_mech']

function splitNames(v: any): string[] {
  return String(v || '').split(',').map(s => s.trim()).filter(Boolean)
}

function updateEducationSection(doc: any, meta: any): void {
  const paras: any[] = Array.from(doc.getElementsByTagNameNS(HP_NS, 'p') as any[])
  const chiefIdx = paras.findIndex((p: any) =>
    Array.from(p.getElementsByTagNameNS(HP_NS, 't') as any[]).some((t: any) => (t.textContent || '').includes('책  임 기술자'))
  )
  if (chiefIdx < 0) return

  // 책임 기술자
  const chiefPara = paras[chiefIdx]
  const chiefRuns: any[] = Array.from(chiefPara.childNodes || []).filter((n: any) => n.nodeType === 1 && n.localName === 'run')
  const chiefNames = splitNames(meta?.edu_chief)
  const t0 = chiefRuns[0]?.getElementsByTagNameNS(HP_NS, 't')[0]
  if (t0) t0.textContent = `   - 책  임 기술자 : ${chiefNames.join(', ')}`
  const t1 = chiefRuns[1]?.getElementsByTagNameNS(HP_NS, 't')[0]
  if (t1) t1.textContent = chiefNames.length ? ` - ${chiefNames.length}명` : ''

  // 분야별 기술자 — 템플릿에는 예시 2줄이 고정돼 있으나, 값이 있는 분야 수만큼 줄을 새로 구성
  const firstFieldPara = paras[chiefIdx + 1]
  const secondFieldPara = paras[chiefIdx + 2]
  const anchor = paras[chiefIdx + 3] // 다음 여백 문단 — 이 앞에 새 줄들을 삽입
  const parent = firstFieldPara.parentNode

  const lines = EDU_FIELD_ORDER
    .map(key => ({ label: EDU_LABELS[key], names: splitNames(meta?.[key]) }))
    .filter(g => g.names.length > 0)
    .map((g, i) => {
      const prefix = i === 0 ? '   - 분야별 기술자 : ' : '                     '
      return `${prefix}${g.names.join(', ')} – ${g.label} ${g.names.length}명`
    })

  for (const lineText of lines) {
    const clone = firstFieldPara.cloneNode(true)
    const run = Array.from(clone.childNodes || []).find((n: any) => n.nodeType === 1 && n.localName === 'run')
    const t = run?.getElementsByTagNameNS(HP_NS, 't')[0]
    if (t) t.textContent = lineText
    parent.insertBefore(clone, anchor)
  }
  parent.removeChild(firstFieldPara)
  parent.removeChild(secondFieldPara)
}

// ── Weekly HWPX 생성 ──────────────────────────────────────────────────────────
async function generateWeekly(
  templatePath: string,
  data: { week: string; performing: any[]; expected: any[]; meta: any }
): Promise<Buffer> {
  const AdmZip = (await import('adm-zip')).default
  const { DOMParser, XMLSerializer } = await import('@xmldom/xmldom')

  const zip = new AdmZip(templatePath)
  const xml = zip.readAsText('Contents/section0.xml')
  const doc = new DOMParser().parseFromString(xml, 'text/xml')

  const tbl = doc.getElementsByTagNameNS(HP_NS, 'tbl')[0]
  const rows: any[] = Array.from(tbl.getElementsByTagNameNS(HP_NS, 'tr') as any[])
  const tcs = rows.map(r => getTcs(r))

  let gaeyalIdx = -1, jinhaengIdx = -1
  for (let i = 0; i < rows.length; i++) {
    const t0 = getText(tcs[i][0]).trim()
    if (t0 === '개찰')   gaeyalIdx   = i
    if (t0 === '진행중') jinhaengIdx = i
  }

  // IDX: 8-cell data row 기준 (라벨 병합셀 제외 후)
  const IDX = { num: 0, name: 1, chief: 2, submit: 3, interview: 4, bid: 5, fee: 6, content: 7 }

  function getSectionRows(start: number, end: number): any[][] {
    const result: any[][] = []
    for (let i = start; i < end; i++) {
      result.push(tcs[i].length > 8 ? tcs[i].slice(1) : tcs[i])
    }
    return result
  }

  const gaeyalRows   = gaeyalIdx   >= 0 ? getSectionRows(gaeyalIdx,   jinhaengIdx >= 0 ? jinhaengIdx : rows.length) : []
  const jinhaengRows = jinhaengIdx >= 0 ? getSectionRows(jinhaengIdx, rows.length) : []

  const gaeyalProjects   = data.performing.filter((p: any) => p.status === '개찰')
  const jinhaengProjects = data.performing.filter((p: any) => p.status === '진행중')

  function fillSection(sectionRows: any[][], projects: any[]) {
    for (let i = 0; i < sectionRows.length; i++) {
      const dtcs = sectionRows[i]
      if (i < projects.length) {
        const p = projects[i]
        setText(dtcs[IDX.num],       String(i + 1))
        setText(dtcs[IDX.name],      p.name || '')
        setText(dtcs[IDX.chief],     p.director || '')
        setText(dtcs[IDX.submit],    p.submit_date || '')
        setText(dtcs[IDX.interview], p.interview_date || '')
        setText(dtcs[IDX.bid],       p.result_date || '')
        setText(dtcs[IDX.fee],       p.fee != null ? String(p.fee) : '')
        setTextMultiLine(dtcs[IDX.content], p.note || '')
      } else {
        for (const dtc of dtcs) clearCell(dtc)
      }
    }
  }

  fillSection(gaeyalRows,   gaeyalProjects)
  fillSection(jinhaengRows, jinhaengProjects)
  fillExpectedTable(doc, data.expected || [])
  updateEducationSection(doc, data.meta)

  // 헤더 날짜 → 해당 주 월~금
  const [yearStr, wStr] = data.week.split('-W')
  const year = parseInt(yearStr), w = parseInt(wStr)
  const jan4 = new Date(year, 0, 4)
  const startOfW1 = new Date(jan4)
  startOfW1.setDate(jan4.getDate() - jan4.getDay() + 1)
  const weekStart = new Date(startOfW1)
  weekStart.setDate(startOfW1.getDate() + (w - 1) * 7)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 4)
  const fmt = (d: Date) => `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}.`
  const newDateStr = `(${fmt(weekStart)} ~ ${fmt(weekEnd)})`
  const dateRegex = /\(\d{4}\.\d{1,2}\.\d{1,2}\.\s*~\s*\d{4}\.\d{1,2}\.\d{1,2}\.\)/

  const bodyTs: any[] = Array.from(doc.getElementsByTagNameNS(HP_NS, 't') as any[])
  for (const t of bodyTs) {
    if (dateRegex.test(t.textContent || '')) t.textContent = newDateStr
  }

  const headerXml = zip.readAsText('Contents/header.xml')
  const headerDoc = new DOMParser().parseFromString(headerXml, 'text/xml')
  const headerTs: any[] = Array.from(headerDoc.getElementsByTagNameNS(HP_NS, 't') as any[])
  for (const t of headerTs) {
    if (dateRegex.test(t.textContent || '')) t.textContent = newDateStr
  }

  removeLinesegarray(doc)

  zip.updateFile('Contents/section0.xml', Buffer.from(new XMLSerializer().serializeToString(doc), 'utf8'))
  zip.updateFile('Contents/header.xml',   Buffer.from(new XMLSerializer().serializeToString(headerDoc), 'utf8'))

  return zip.toBuffer()
}

// ── Monthly HWPX 생성 ─────────────────────────────────────────────────────────
async function generateMonthly(
  templatePath: string,
  data: { week: string; performing: any[] }
): Promise<Buffer> {
  const AdmZip = (await import('adm-zip')).default
  const { DOMParser, XMLSerializer } = await import('@xmldom/xmldom')

  const zip = new AdmZip(templatePath)
  const xml = zip.readAsText('Contents/section0.xml')
  const doc = new DOMParser().parseFromString(xml, 'text/xml')

  const tbls: any[] = Array.from(doc.getElementsByTagNameNS(HP_NS, 'tbl') as any[])
  const projTbl = tbls[0]
  const rows: any[] = Array.from(projTbl.getElementsByTagNameNS(HP_NS, 'tr') as any[])
  const tcs = rows.map(r => getTcs(r))

  // 월간 컬럼 인덱스 (12열): 용역명, 발주처, 단장, 금액, 기간, 쪽수, 과업설명, 현장조사, 제출일, 발표/면접, 개찰일, 비고
  const IDX = { name: 0, client: 1, chief: 2, fee: 3, period: 4, pages: 5, taskDesc: 6, siteCheck: 7, submit: 8, interview: 9, bid: 10, note: 11 }

  const dataRows = tcs.slice(1) // 헤더 행 제외
  const projects = data.performing

  for (let i = 0; i < dataRows.length; i++) {
    const dtcs = dataRows[i]
    if (i < projects.length) {
      const p = projects[i]
      setText(dtcs[IDX.name],      p.name || '')
      setText(dtcs[IDX.client],    '')
      setText(dtcs[IDX.chief],     p.director || '')
      setText(dtcs[IDX.fee],       p.fee != null ? String(p.fee) : '')
      setText(dtcs[IDX.period],    '')
      setText(dtcs[IDX.pages],     '')
      setText(dtcs[IDX.taskDesc],  '')
      setText(dtcs[IDX.siteCheck], '')
      setText(dtcs[IDX.submit],    p.submit_date || '')
      setText(dtcs[IDX.interview], p.interview_date || '')
      setText(dtcs[IDX.bid],       p.result_date || '')
      setTextMultiLine(dtcs[IDX.note], p.note || '')
    } else {
      for (const dtc of dtcs) clearCell(dtc)
    }
  }

  // "N월 N일 현재" 업데이트
  const today = new Date()
  const monthStr = `${today.getMonth() + 1}월 ${today.getDate()}일 현재`
  const bodyTs: any[] = Array.from(doc.getElementsByTagNameNS(HP_NS, 't') as any[])
  for (const t of bodyTs) {
    if (/\d+월\s*\d+일\s*현재/.test(t.textContent || '')) {
      t.textContent = monthStr
    }
  }

  removeLinesegarray(doc)

  zip.updateFile('Contents/section0.xml', Buffer.from(new XMLSerializer().serializeToString(doc), 'utf8'))

  return zip.toBuffer()
}

// ── Route Handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { type = 'weekly', week, performing, expected, meta } = body

    const templatesDir = path.join(process.cwd(), 'lib', 'templates')
    const templateFile = type === 'monthly' ? 'montly.hwpx' : 'weekly.hwpx'
    const templatePath = path.join(templatesDir, templateFile)

    if (!fs.existsSync(templatePath)) {
      return NextResponse.json({ error: `템플릿 파일 없음: ${templateFile}` }, { status: 500 })
    }

    let buffer: Buffer
    if (type === 'monthly') {
      buffer = await generateMonthly(templatePath, { week, performing })
    } else {
      buffer = await generateWeekly(templatePath, { week, performing, expected, meta })
    }

    const today = new Date()
    const filename = type === 'monthly'
      ? `미래사업팀_월간업무_${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}.hwpx`
      : `미래사업팀_주간업무_${week}.hwpx`

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    })
  } catch (err: any) {
    console.error('[HWPX API Error]', err)
    return NextResponse.json({ error: err.message || '알 수 없는 오류' }, { status: 500 })
  }
}
