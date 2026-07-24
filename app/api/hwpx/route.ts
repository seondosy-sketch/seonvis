// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server'
import path from 'node:path'
import fs from 'node:fs'
import { validateWeeklyCapacity, validateMonthlyCapacity, formatCapacityViolations } from '@/lib/hwpx/capacity'
import { formatProjectNameForReport } from '@/lib/hwpx/projectName'
import { estimateWeeklyPageBudget, PAGE_BUDGET_EXCEEDED_MESSAGE, type WeeklyPageBudgetInput } from '@/lib/hwpx/pageBudget'

const HP_NS = 'http://www.hancom.co.kr/hwpml/2011/paragraph'

// 템플릿(weekly.hwpx/montly.hwpx)의 실제 구조가 코드가 가정한 표 개수·열 수·행 수·기준 문구와
// 다를 때 던진다. 이 예외는 데이터를 절반만 채운 문서를 만들지 않기 위한 것 — 조용히 진행하지 않고
// 여기서 멈춘다.
class TemplateStructureError extends Error {}

// 주간 입력량이 lib/hwpx/pageBudget.ts의 산술 예산(현재 서식을 전혀 줄이지 않은 기준)을 넘을 때
// 던진다. "1페이지를 보장한다"는 뜻이 아니라 "이 상태로는 안전하게 생성을 시도하지 않는다"는
// 뜻이다 — 실제 페이지 수는 한글 프로그램으로 열어봐야만 확정된다.
class PageBudgetExceededError extends Error {}

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

// ── 동적 행(개찰/진행중/발주예상) 조작에 쓰는 저수준 헬퍼 ──────────────────────────────

// 행 안에서 rowSpan===1(병합 안 된) 셀을 찾아 그 cellSz height를 그 행의 실제 높이로 쓴다.
// 병합 라벨 셀(rowSpan>1)의 cellSz height는 표마다 관례가 달라(개별 행 높이 vs 병합 범위 합)
// 신뢰할 수 없다는 걸 실측으로 확인했다 — 반드시 rowSpan=1 셀 기준으로 재야 한다.
function rowHeight(tr: any): number {
  const tcs: any[] = getTcs(tr)
  const cell = tcs.find((tc: any) => {
    const span = tc.getElementsByTagNameNS(HP_NS, 'cellSpan')[0]
    return !span || Number(span.getAttribute('rowSpan') || 1) === 1
  })
  const sz = cell?.getElementsByTagNameNS(HP_NS, 'cellSz')[0]
  return Number(sz?.getAttribute('height') || 0)
}

// 표 전체의 <hp:tr>을 순서대로 훑어 각 셀의 cellAddr rowAddr을 0부터 다시 매긴다.
// colAddr은 열 위치라 바뀌지 않으므로 손대지 않는다.
function renumberRowAddr(tbl: any): void {
  const rows: any[] = Array.from(tbl.getElementsByTagNameNS(HP_NS, 'tr') as any[])
  rows.forEach((tr: any, rowIdx: number) => {
    for (const tc of getTcs(tr)) {
      const addr = tc.getElementsByTagNameNS(HP_NS, 'cellAddr')[0]
      if (addr) addr.setAttribute('rowAddr', String(rowIdx))
    }
  })
}

// rowSpan=1 셀 기준 행 높이의 합. 실측 결과 <hp:tbl>의 <hp:sz height>가 항상 이 합과 정확히
// 일치했다 — 행을 추가/삭제한 뒤에는 반드시 이 값으로 다시 맞춰야 표 흐름 뒤의 발주예상·
// 교육참가자·기타 영역이 밀리지 않는다(표가 treatAsChar="1"로 문단에 문자처럼 얹혀 있어,
// 한글이 이 크기를 기준으로 뒤 내용을 배치하기 때문).
function sumRowSpan1Heights(tbl: any): number {
  const rows: any[] = Array.from(tbl.getElementsByTagNameNS(HP_NS, 'tr') as any[])
  return rows.reduce((sum: number, tr: any) => sum + rowHeight(tr), 0)
}

function setTableHeight(tbl: any, height: number): void {
  const sz = Array.from(tbl.childNodes || []).find((n: any) => n.nodeType === 1 && n.localName === 'sz')
  if (sz) sz.setAttribute('height', String(height))
}

// 구분(개찰/진행중) 섹션을 desiredCount(0이면 1로 취급 — 빈 행 1개는 남긴다. rowSpan=0은
// 절대 만들지 않는다)에 맞춰 재구성한다.
//
// - labelRow는 항상 그대로 유지한다(제거·재생성하지 않음) — 원본 템플릿에서 라벨 행 자신이
//   이미 그 섹션 첫 번째 프로젝트의 데이터 칸(라벨 칸 제외 8칸)을 겸하고 있어서다.
// - "추가 행"(라벨 행 다음부터, 2번째 프로젝트 이후)만 지우고 다시 만든다. middleRow는 원본
//   템플릿의 "중간" 스타일 행, lastRow는 그 섹션의 원래 "마지막"(다음 섹션과 맞닿는 경계 스타일)
//   행이다 — 진행중처럼 표의 마지막 섹션이라 경계 구분이 없는 경우엔 middleRow===lastRow를
//   그대로 넘기면 된다.
// - 라벨 셀 자체의 서식(테두리 등)은 절대 바꾸지 않는다 — desiredCount가 1이 되어 라벨 행이
//   그 섹션의 유일한 행이 되어도 라벨 행 고유의 스타일을 그대로 쓴다(실제 파일 어디에도
//   "라벨 행이 곧 마지막 행"인 사례가 없어 올바른 경계 스타일을 추정할 근거가 없기 때문 —
//   이 경우 시각적으로 완벽한 마감선이 아닐 수 있음을 알려둔다. 데이터 누락은 없다).
//
// 반환값은 라벨 행(0번째) + 새로 만든 추가 행들을, 각각 8칸으로 슬라이스한 데이터 셀 배열로
// 돌려준다 — fillSection이 순서대로 그대로 채워 넣는다.
function rebuildSection(
  tbl: any,
  labelRow: any,
  middleRow: any,
  lastRow: any,
  oldAdditionalRows: any[],
  insertBeforeAnchor: any | null,
  desiredCount: number
): any[][] {
  const n = Math.max(desiredCount, 1)
  const additionalCount = n - 1

  for (const old of oldAdditionalRows) tbl.removeChild(old)

  const newAdditionalRows: any[] = []
  if (additionalCount === 1) {
    newAdditionalRows.push(lastRow.cloneNode(true))
  } else if (additionalCount >= 2) {
    for (let i = 0; i < additionalCount - 1; i++) newAdditionalRows.push(middleRow.cloneNode(true))
    newAdditionalRows.push(lastRow.cloneNode(true))
  }

  for (const nr of newAdditionalRows) {
    if (insertBeforeAnchor) tbl.insertBefore(nr, insertBeforeAnchor)
    else tbl.appendChild(nr)
  }

  const labelCell = getTcs(labelRow)[0]
  const span = labelCell.getElementsByTagNameNS(HP_NS, 'cellSpan')[0]
  if (span) span.setAttribute('rowSpan', String(n))

  // 라벨 셀 자체의 cellSz height도 병합 범위 전체 합으로 갱신한다(기준 파일의 관례를 따름 —
  // 개발 템플릿은 병합 셀에 개별 행 높이를 그대로 쓰는 다른 관례였지만, 표 전체 높이(hp:sz)는
  // rowSpan=1 셀 기준으로 별도 계산하므로 이 값 자체가 문서 배치에 영향을 주지는 않는다).
  const labelSz = labelCell.getElementsByTagNameNS(HP_NS, 'cellSz')[0]
  if (labelSz) {
    const total = rowHeight(labelRow) + newAdditionalRows.reduce((sum, r) => sum + rowHeight(r), 0)
    labelSz.setAttribute('height', String(total))
  }

  const labelRowDataCells = getTcs(labelRow).slice(1)
  return [labelRowDataCells, ...newAdditionalRows.map(r => getTcs(r))]
}

// 표 밖(문단 흐름) 문단 하나의 자기 자신 높이만 잰다 — descendant 검색이 아니라 직계 자식
// <hp:linesegarray>만 본다. (이전에 getElementsByTagNameNS로 descendant까지 훑어서, 표를
// 감싸는 문단의 높이를 셀 때 표 내부 전체 셀의 lineseg까지 합산되는 버그가 있었다 — 이 방식으로
// 그 문제를 피한다.)
function directLineHeight(p: any): number {
  const lsa = Array.from(p.childNodes || []).find((n: any) => n.nodeType === 1 && n.localName === 'linesegarray')
  if (!lsa) return 0
  const segs: any[] = Array.from(lsa.childNodes || []).filter((n: any) => n.nodeType === 1 && n.localName === 'lineseg')
  return segs.reduce((sum: number, s: any) => sum + Number(s.getAttribute('vertsize') || 0) + Number(s.getAttribute('spacing') || 0), 0)
}

// 표가 treatAsChar="1"로 문단 안에 "문자처럼" 얹혀 있으면, 그 문단 자신의 직계
// <hp:linesegarray>도 표 크기만큼의 값을 갖는다(실측 확인 — 개찰 표를 감싸는 문단이 표 전체
// 높이와 비슷한 자기 높이를 가짐). 표 높이는 이미 별도로(행 높이 합산) 계산하므로, 이 문단은
// 표 밖 고정 콘텐츠 높이 합산에서 반드시 제외해야 한다 — 안 그러면 표 높이가 두 번 잡힌다.
function isTableWrapperParagraph(p: any): boolean {
  const runs: any[] = Array.from(p.childNodes || []).filter((n: any) => n.nodeType === 1 && n.localName === 'run')
  return runs.some((run: any) => Array.from(run.childNodes || []).some((n: any) => n.nodeType === 1 && n.localName === 'tbl'))
}

// ── 발주예상 Project 표 채우기 (8열: 연번/Project/발주청/단장/사업비(억)/발주(월)/용역비(억)/내용) ──
// dataRows는 assertWeeklyTemplateStructure가 미리 찾아 검증해 둔, 헤더 제외 데이터 행 배열이다.
function fillExpectedTable(dataRows: any[][], expected: any[]): void {
  const IDX = { num: 0, name: 1, client: 2, chief: 3, cost: 4, month: 5, fee: 6, note: 7 }

  for (let i = 0; i < dataRows.length; i++) {
    const dtcs = dataRows[i]
    if (i < expected.length) {
      const e = expected[i]
      setText(dtcs[IDX.num],    String(i + 1))
      setText(dtcs[IDX.name],   formatProjectNameForReport(e.name || ''))
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

// paras/chiefIdx는 assertWeeklyTemplateStructure가 미리 찾아 검증해 둔 값이다.
function updateEducationSection(paras: any[], chiefIdx: number, meta: any): void {
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

// 보고기간 날짜 형식. generateWeekly는 이 패턴이 "사용자 데이터를 채우기 전" 문서 전체에서
// 정확히 1곳에서만 발견될 때만 그 노드를 보고기간 표시 위치로 확정한다 — 데이터를 채운 뒤에
// 다시 이 정규식으로 전체 문서를 훑으면, note 등 사용자 입력이 우연히 같은 패턴이 됐을 때
// 그 데이터를 보고기간 날짜로 덮어써버리는 사고가 난다(실제로 재현된 문제).
const WEEKLY_DATE_REGEX = /\(\d{4}\.\d{1,2}\.\d{1,2}\.\s*~\s*\d{4}\.\d{1,2}\.\d{1,2}\.\)/

function assertCellsHaveAddrAndSize(tr: any, label: string): void {
  for (const tc of getTcs(tr)) {
    if (!tc.getElementsByTagNameNS(HP_NS, 'cellAddr')[0]) {
      throw new TemplateStructureError(`weekly.hwpx 템플릿 구조가 예상과 다릅니다: ${label}의 셀에 cellAddr가 없습니다.`)
    }
    if (!tc.getElementsByTagNameNS(HP_NS, 'cellSz')[0]) {
      throw new TemplateStructureError(`weekly.hwpx 템플릿 구조가 예상과 다릅니다: ${label}의 셀에 cellSz가 없습니다.`)
    }
  }
}

function assertLabelCellSpan(tr: any, label: string): void {
  const labelCell = getTcs(tr)[0]
  if (!labelCell?.getElementsByTagNameNS(HP_NS, 'cellSpan')[0]) {
    throw new TemplateStructureError(`weekly.hwpx 템플릿 구조가 예상과 다릅니다: ${label}의 첫 셀에 cellSpan이 없습니다.`)
  }
}

// weekly.hwpx의 실제 구조를 코드가 가정한 것과 대조한다. 표 개수/열 수/기준 문구/복제용 행
// 확보 가능 여부 중 하나라도 어긋나면 데이터를 채우거나 행을 조작하지 않고 즉시 던진다
// (TemplateStructureError) — 개찰·진행중·발주예상 데이터 행 수는 이제 동적으로 맞추므로
// "정확히 N개"라는 고정 검증은 하지 않는다.
// 반환값은 이후 rebuildSection/fillExpectedTable/updateEducationSection과 페이지 예산 계산이
// 재탐색 없이 그대로 쓴다.
function assertWeeklyTemplateStructure(doc: any) {
  const tbls: any[] = Array.from(doc.getElementsByTagNameNS(HP_NS, 'tbl') as any[])
  if (tbls.length < 2) {
    throw new TemplateStructureError(`weekly.hwpx 템플릿 구조가 예상과 다릅니다: 표가 최소 2개 있어야 하는데 ${tbls.length}개만 찾았습니다.`)
  }

  const perfTbl = tbls[0]
  const perfColCnt = Number(perfTbl.getAttribute('colCnt'))
  if (perfColCnt !== 9) {
    throw new TemplateStructureError(`weekly.hwpx 템플릿 구조가 예상과 다릅니다: 수행 프로젝트 표의 열 수가 9여야 하는데 ${perfColCnt}입니다.`)
  }

  const rows: any[] = Array.from(perfTbl.getElementsByTagNameNS(HP_NS, 'tr') as any[])

  let gaeyalIdx = -1, jinhaengIdx = -1
  for (let i = 0; i < rows.length; i++) {
    const t0 = getText(getTcs(rows[i])[0]).trim()
    if (t0 === '개찰')   gaeyalIdx   = i
    if (t0 === '진행중') jinhaengIdx = i
  }
  if (gaeyalIdx < 0) {
    throw new TemplateStructureError(`weekly.hwpx 템플릿 구조가 예상과 다릅니다: '개찰' 기준 행을 찾지 못했습니다.`)
  }
  if (jinhaengIdx < 0) {
    throw new TemplateStructureError(`weekly.hwpx 템플릿 구조가 예상과 다릅니다: '진행중' 기준 행을 찾지 못했습니다.`)
  }

  const gaeyalLabelRow = rows[gaeyalIdx]
  const gaeyalAdditionalRows = rows.slice(gaeyalIdx + 1, jinhaengIdx)
  const jinhaengLabelRow = rows[jinhaengIdx]
  const jinhaengAdditionalRows = rows.slice(jinhaengIdx + 1, rows.length)

  if (gaeyalAdditionalRows.length < 1) {
    throw new TemplateStructureError(`weekly.hwpx 템플릿 구조가 예상과 다릅니다: 개찰 섹션에 복제할 데이터 행이 하나도 없습니다(라벨 행만 있음).`)
  }
  if (jinhaengAdditionalRows.length < 1) {
    throw new TemplateStructureError(`weekly.hwpx 템플릿 구조가 예상과 다릅니다: 진행중 섹션에 복제할 데이터 행이 하나도 없습니다(라벨 행만 있음).`)
  }

  assertLabelCellSpan(gaeyalLabelRow, '개찰 라벨 행')
  assertLabelCellSpan(jinhaengLabelRow, '진행중 라벨 행')
  assertCellsHaveAddrAndSize(rows[0], '수행 프로젝트 표 헤더 행')
  assertCellsHaveAddrAndSize(gaeyalLabelRow, '개찰 라벨 행')
  for (const r of gaeyalAdditionalRows) assertCellsHaveAddrAndSize(r, '개찰 섹션의 데이터 행')
  assertCellsHaveAddrAndSize(jinhaengLabelRow, '진행중 라벨 행')
  for (const r of jinhaengAdditionalRows) assertCellsHaveAddrAndSize(r, '진행중 섹션의 데이터 행')

  // 개찰은 바로 아래 진행중 섹션과 맞닿으므로 "중간"(middle)과 "경계"(last, 다음 섹션과
  // 맞닿는 마지막 행) 스타일을 구분해 확보한다. 진행중은 표의 마지막 섹션이라 전 행이
  // 균일한 스타일이므로(실측 확인) 구분 없이 같은 행을 재사용한다.
  const gaeyalMiddleRow = gaeyalAdditionalRows[0]
  const gaeyalLastRow = gaeyalAdditionalRows[gaeyalAdditionalRows.length - 1]
  const jinhaengRow = jinhaengAdditionalRows[0]

  const perfHeaderHeight = rowHeight(rows[0])
  const gaeyalMiddleRowHeight = rowHeight(gaeyalMiddleRow)
  const gaeyalLastRowHeight = rowHeight(gaeyalLastRow)
  const jinhaengRowHeight = rowHeight(jinhaengRow)
  if (perfHeaderHeight <= 0 || gaeyalMiddleRowHeight <= 0 || gaeyalLastRowHeight <= 0 || jinhaengRowHeight <= 0) {
    throw new TemplateStructureError(`weekly.hwpx 템플릿 구조가 예상과 다릅니다: 수행 프로젝트 표의 행 높이(cellSz height)를 읽을 수 없습니다.`)
  }

  const expTbl = tbls[1]
  const expColCnt = Number(expTbl.getAttribute('colCnt'))
  if (expColCnt !== 8) {
    throw new TemplateStructureError(`weekly.hwpx 템플릿 구조가 예상과 다릅니다: 발주예상 표의 열 수가 8이어야 하는데 ${expColCnt}입니다.`)
  }
  const expRows: any[] = Array.from(expTbl.getElementsByTagNameNS(HP_NS, 'tr') as any[])
  const expHeaderRow = expRows[0]
  const expDataRowNodes = expRows.slice(1)
  if (expDataRowNodes.length < 1) {
    throw new TemplateStructureError(`weekly.hwpx 템플릿 구조가 예상과 다릅니다: 발주예상 표에 복제할 데이터 행이 하나도 없습니다.`)
  }
  assertCellsHaveAddrAndSize(expHeaderRow, '발주예상 표 헤더 행')
  for (const r of expDataRowNodes) assertCellsHaveAddrAndSize(r, '발주예상 표의 데이터 행')

  const expHeaderHeight = rowHeight(expHeaderRow)
  const expRowHeight = rowHeight(expDataRowNodes[0])
  if (expHeaderHeight <= 0 || expRowHeight <= 0) {
    throw new TemplateStructureError(`weekly.hwpx 템플릿 구조가 예상과 다릅니다: 발주예상 표의 행 높이(cellSz height)를 읽을 수 없습니다.`)
  }

  const paras: any[] = Array.from(doc.getElementsByTagNameNS(HP_NS, 'p') as any[])
  const hasPhrase = (phrase: string) =>
    paras.some(p => Array.from(p.getElementsByTagNameNS(HP_NS, 't') as any[]).some((t: any) => (t.textContent || '').includes(phrase)))

  if (!hasPhrase('3) 교육참가자')) {
    throw new TemplateStructureError(`weekly.hwpx 템플릿 구조가 예상과 다릅니다: '3) 교육참가자' 문구를 찾지 못했습니다.`)
  }
  if (!hasPhrase('4) 기  타')) {
    throw new TemplateStructureError(`weekly.hwpx 템플릿 구조가 예상과 다릅니다: '4) 기  타' 문구를 찾지 못했습니다.`)
  }
  const chiefIdx = paras.findIndex((p: any) =>
    Array.from(p.getElementsByTagNameNS(HP_NS, 't') as any[]).some((t: any) => (t.textContent || '').includes('책  임 기술자'))
  )
  if (chiefIdx < 0) {
    throw new TemplateStructureError(`weekly.hwpx 템플릿 구조가 예상과 다릅니다: '책  임 기술자' 기준 문단을 찾지 못했습니다.`)
  }
  if (chiefIdx + 3 >= paras.length) {
    throw new TemplateStructureError(`weekly.hwpx 템플릿 구조가 예상과 다릅니다: 교육참가자 기준 문단 다음에 필요한 문단(분야별 2줄 + 여백)이 부족합니다.`)
  }

  // 보고기간 날짜 노드 — 사용자 데이터를 채우기 전 시점에 정확히 1곳이어야 한다.
  const allTs: any[] = Array.from(doc.getElementsByTagNameNS(HP_NS, 't') as any[])
  const dateMatches = allTs.filter((t: any) => WEEKLY_DATE_REGEX.test(t.textContent || ''))
  if (dateMatches.length !== 1) {
    throw new TemplateStructureError(`weekly.hwpx 템플릿 구조가 예상과 다릅니다: 보고기간 날짜 표시 위치를 정확히 하나 찾아야 하는데 ${dateMatches.length}개 발견했습니다.`)
  }

  // 페이지 높이 예산 계산에 쓸 "표 밖(문단 흐름)" 고정 콘텐츠 높이 — 교육참가자의 책임/분야별
  // 줄(chiefIdx, chiefIdx+1, chiefIdx+2)은 실제 값에 따라 줄 수가 달라지므로 여기서는 빼고
  // eduLineHeight × eduLineCount로 따로 계산한다(아래 estimateWeeklyPageBudget 호출부 참고).
  const isInsideAnyTable = (p: any) => tbls.some(t => Array.from(t.getElementsByTagNameNS(HP_NS, 'p') as any[]).includes(p))
  const outerParas = paras.filter((p: any) => !isInsideAnyTable(p))
  let fixedContentHeight = 0
  for (const p of outerParas) {
    if (p === paras[chiefIdx] || p === paras[chiefIdx + 1] || p === paras[chiefIdx + 2]) continue
    if (isTableWrapperParagraph(p)) continue // 표 자신의 높이는 별도(행 높이 합산)로 계산 — 중복 방지
    fixedContentHeight += directLineHeight(p)
  }
  const eduLineHeight = directLineHeight(paras[chiefIdx])

  const pagePr = doc.getElementsByTagNameNS(HP_NS, 'pagePr')[0]
  const margin = pagePr?.getElementsByTagNameNS(HP_NS, 'margin')[0]
  if (!pagePr || !margin) {
    throw new TemplateStructureError(`weekly.hwpx 템플릿 구조가 예상과 다릅니다: 페이지 설정(pagePr/margin)을 찾지 못했습니다.`)
  }
  const usableHeight = Number(pagePr.getAttribute('height')) - Number(margin.getAttribute('top')) - Number(margin.getAttribute('bottom'))

  return {
    perfTbl, expTbl,
    gaeyalLabelRow, gaeyalAdditionalRows, gaeyalMiddleRow, gaeyalLastRow,
    jinhaengLabelRow, jinhaengAdditionalRows, jinhaengRow,
    expDataRowNodes,
    paras, chiefIdx, reportPeriodNode: dateMatches[0],
    measurements: {
      usableHeight, fixedContentHeight, eduLineHeight,
      perfHeaderHeight, gaeyalMiddleRowHeight, gaeyalLastRowHeight, jinhaengRowHeight,
      expHeaderHeight, expRowHeight,
    },
  }
}

// 발주예상 표는 병합 라벨이 없어 모든 데이터 행이 동등하다(실측 확인) — 기존 데이터 행을
// 전부 지우고 desiredCount(0이면 1)만큼 template 행을 복제해 다시 채운다.
function rebuildExpectedRows(tbl: any, oldDataRows: any[], desiredCount: number): any[][] {
  const n = Math.max(desiredCount, 1)
  const template = oldDataRows[0]
  for (const old of oldDataRows) tbl.removeChild(old)
  const newRows: any[] = []
  for (let i = 0; i < n; i++) newRows.push(template.cloneNode(true))
  for (const nr of newRows) tbl.appendChild(nr)
  return newRows.map(r => getTcs(r))
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

  // 구조를 먼저 검증하고(데이터를 채우기 전 시점), 그 결과(행/문단 참조·치수)를 그대로 재사용한다.
  const structure = assertWeeklyTemplateStructure(doc)

  // IDX: 8-cell data row 기준 (라벨 병합셀 제외 후)
  const IDX = { num: 0, name: 1, chief: 2, submit: 3, interview: 4, bid: 5, fee: 6, content: 7 }

  const gaeyalProjects   = data.performing.filter((p: any) => p.status === '개찰')
  const jinhaengProjects = data.performing.filter((p: any) => p.status === '진행중')
  const expectedProjects = data.expected || []

  // 자동 문서 높이 예산 확인 — 행을 실제로 만들거나 데이터를 채우기 전에 먼저 판정한다.
  // "1페이지 보장"이 아니라 "지금 서식을 전혀 줄이지 않은 기준으로 안전하게 생성 가능한가"다.
  const eduLineCount = 1 + EDU_FIELD_ORDER.filter(k => splitNames(data.meta?.[k]).length > 0).length
  const budget = estimateWeeklyPageBudget({
    usableHeight: structure.measurements.usableHeight,
    fixedContentHeight: structure.measurements.fixedContentHeight,
    eduLineHeight: structure.measurements.eduLineHeight,
    eduLineCount,
    perfHeaderHeight: structure.measurements.perfHeaderHeight,
    perfGaeyalMiddleRowHeight: structure.measurements.gaeyalMiddleRowHeight,
    perfGaeyalLastRowHeight: structure.measurements.gaeyalLastRowHeight,
    perfGaeyalRowCount: gaeyalProjects.length,
    perfJinhaengRowHeight: structure.measurements.jinhaengRowHeight,
    perfJinhaengRowCount: jinhaengProjects.length,
    expHeaderHeight: structure.measurements.expHeaderHeight,
    expRowHeight: structure.measurements.expRowHeight,
    expRowCount: expectedProjects.length,
  } satisfies WeeklyPageBudgetInput)
  if (!budget.fitsHeightBudget) {
    // 상세 수치는 사용자 응답(PAGE_BUDGET_EXCEEDED_MESSAGE)에는 넣지 않고 서버 로그에만 남긴다
    // — 개발 로그·완료 보고·수동 검증 판단용.
    console.error('[HWPX Page Budget Exceeded]', {
      gaeyal: gaeyalProjects.length, jinhaeng: jinhaengProjects.length, expected: expectedProjects.length,
      eduLineCount,
      ...budget,
    })
    throw new PageBudgetExceededError(PAGE_BUDGET_EXCEEDED_MESSAGE)
  }

  // 개찰/진행중 섹션을 실제 데이터 수에 맞춰 재구성 — rowSpan·rowAddr·표 높이까지 함께 갱신.
  const gaeyalDataRows = rebuildSection(
    structure.perfTbl, structure.gaeyalLabelRow, structure.gaeyalMiddleRow, structure.gaeyalLastRow,
    structure.gaeyalAdditionalRows, structure.jinhaengLabelRow, gaeyalProjects.length
  )
  const jinhaengDataRows = rebuildSection(
    structure.perfTbl, structure.jinhaengLabelRow, structure.jinhaengRow, structure.jinhaengRow,
    structure.jinhaengAdditionalRows, null, jinhaengProjects.length
  )
  renumberRowAddr(structure.perfTbl)
  structure.perfTbl.setAttribute('rowCnt', String(Array.from(structure.perfTbl.getElementsByTagNameNS(HP_NS, 'tr') as any[]).length))
  setTableHeight(structure.perfTbl, sumRowSpan1Heights(structure.perfTbl))

  // 발주예상 표도 동일하게 실제 건수에 맞춰 재구성.
  const expDataRows = rebuildExpectedRows(structure.expTbl, structure.expDataRowNodes, expectedProjects.length)
  renumberRowAddr(structure.expTbl)
  structure.expTbl.setAttribute('rowCnt', String(Array.from(structure.expTbl.getElementsByTagNameNS(HP_NS, 'tr') as any[]).length))
  setTableHeight(structure.expTbl, sumRowSpan1Heights(structure.expTbl))

  // 수행 프로젝트 연번은 개찰·진행중을 합쳐 전체 기준 연속 번호로 매긴다.
  function fillPerformingRows(dataRows: any[][], projects: any[], startNum: number) {
    for (let i = 0; i < dataRows.length; i++) {
      const dtcs = dataRows[i]
      if (i < projects.length) {
        const p = projects[i]
        setText(dtcs[IDX.num],       String(startNum + i))
        setText(dtcs[IDX.name],      formatProjectNameForReport(p.name || ''))
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

  fillPerformingRows(gaeyalDataRows, gaeyalProjects, 1)
  fillPerformingRows(jinhaengDataRows, jinhaengProjects, gaeyalProjects.length + 1)
  fillExpectedTable(expDataRows, expectedProjects)
  updateEducationSection(structure.paras, structure.chiefIdx, data.meta)

  // 보고기간 날짜 — assertWeeklyTemplateStructure가 데이터 채우기 전에 미리 특정해 둔
  // 그 노드 하나만 갱신한다(전체 문서 재검색 없음 — note 등 사용자 데이터를 건드리지 않는다).
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

  structure.reportPeriodNode.textContent = newDateStr

  removeLinesegarray(doc)

  zip.updateFile('Contents/section0.xml', Buffer.from(new XMLSerializer().serializeToString(doc), 'utf8'))

  return zip.toBuffer()
}

// "N월 N일 현재" 기준일 캡션 형식. generateMonthly는 이 패턴이 "사용자 데이터를 채우기 전"
// 문서 전체에서 정확히 1곳에서만 발견될 때만 그 노드를 기준일 표시 위치로 확정한다 — 주간의
// 보고기간 날짜와 동일한 이유(사용자 note에 우연히 같은 패턴이 있어도 덮어쓰지 않기 위해).
const MONTHLY_DATE_REGEX = /\d+월\s*\d+일\s*현재/

// montly.hwpx의 실제 구조를 코드가 가정한 것과 대조한다(파일명은 저장소의 실제 오탈자를 그대로 따름).
function assertMonthlyTemplateStructure(doc: any) {
  const tbls: any[] = Array.from(doc.getElementsByTagNameNS(HP_NS, 'tbl') as any[])
  if (tbls.length < 2) {
    throw new TemplateStructureError(`montly.hwpx 템플릿 구조가 예상과 다릅니다: 표가 최소 2개 있어야 하는데 ${tbls.length}개만 찾았습니다.`)
  }

  const projTbl = tbls[0]
  const colCnt = Number(projTbl.getAttribute('colCnt'))
  if (colCnt !== 12) {
    throw new TemplateStructureError(`montly.hwpx 템플릿 구조가 예상과 다릅니다: 프로젝트 표의 열 수가 12여야 하는데 ${colCnt}입니다.`)
  }

  const rows: any[] = Array.from(projTbl.getElementsByTagNameNS(HP_NS, 'tr') as any[])
  const tcs = rows.map(r => getTcs(r))
  const dataRows = tcs.slice(1) // 헤더 행 제외
  if (dataRows.length !== 11) {
    throw new TemplateStructureError(`montly.hwpx 템플릿 구조가 예상과 다릅니다: 데이터 행 11개를 찾지 못했습니다 (실제 ${dataRows.length}개).`)
  }

  // 기준일 캡션 노드 — 사용자 데이터를 채우기 전 시점에 정확히 1곳이어야 한다.
  const allTs: any[] = Array.from(doc.getElementsByTagNameNS(HP_NS, 't') as any[])
  const asOfDateMatches = allTs.filter((t: any) => MONTHLY_DATE_REGEX.test(t.textContent || ''))
  if (asOfDateMatches.length !== 1) {
    throw new TemplateStructureError(`montly.hwpx 템플릿 구조가 예상과 다릅니다: 기준일 캡션("N월 N일 현재") 표시 위치를 정확히 하나 찾아야 하는데 ${asOfDateMatches.length}개 발견했습니다.`)
  }

  return { dataRows, asOfDateNode: asOfDateMatches[0] }
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

  const structure = assertMonthlyTemplateStructure(doc)

  // 월간 컬럼 인덱스 (12열): 용역명, 발주처, 단장, 금액, 기간, 쪽수, 과업설명, 현장조사, 제출일, 발표/면접, 개찰일, 비고
  const IDX = { name: 0, client: 1, chief: 2, fee: 3, period: 4, pages: 5, taskDesc: 6, siteCheck: 7, submit: 8, interview: 9, bid: 10, note: 11 }

  const dataRows = structure.dataRows
  const projects = data.performing

  for (let i = 0; i < dataRows.length; i++) {
    const dtcs = dataRows[i]
    if (i < projects.length) {
      const p = projects[i]
      setText(dtcs[IDX.name],      formatProjectNameForReport(p.name || ''))
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

  // 기준일 캡션 — assertMonthlyTemplateStructure가 데이터 채우기 전에 미리 특정해 둔
  // 그 노드 하나만 갱신한다(전체 문서 재검색 없음 — note 등 사용자 데이터를 건드리지 않는다).
  const today = new Date()
  const monthStr = `${today.getMonth() + 1}월 ${today.getDate()}일 현재`
  structure.asOfDateNode.textContent = monthStr

  removeLinesegarray(doc)

  zip.updateFile('Contents/section0.xml', Buffer.from(new XMLSerializer().serializeToString(doc), 'utf8'))

  return zip.toBuffer()
}

// ── Route Handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { type = 'weekly', week, performing = [], expected = [], meta } = body

    // 입력 수량 검증 — 템플릿 고정 행 수를 넘는 데이터는 조용히 잘리는 대신 여기서 막는다.
    const violations = type === 'monthly'
      ? validateMonthlyCapacity(performing)
      : validateWeeklyCapacity(performing)
    if (violations.length > 0) {
      return NextResponse.json({ error: formatCapacityViolations(violations) }, { status: 400 })
    }

    const templatesDir = path.join(process.cwd(), 'lib', 'templates')
    const templateFile = type === 'monthly' ? 'montly.hwpx' : 'weekly.hwpx'
    const templatePath = path.join(templatesDir, templateFile)

    if (!fs.existsSync(templatePath)) {
      return NextResponse.json({ error: `템플릿 파일 없음: ${templateFile}` }, { status: 500 })
    }

    let buffer: Buffer
    try {
      if (type === 'monthly') {
        buffer = await generateMonthly(templatePath, { week, performing })
      } else {
        buffer = await generateWeekly(templatePath, { week, performing, expected, meta })
      }
    } catch (err: any) {
      if (err instanceof TemplateStructureError) {
        console.error('[HWPX Template Structure Error]', err)
        return NextResponse.json(
          { error: '문서 양식이 예상 구조와 달라 생성할 수 없습니다. 관리자에게 문의하세요.' },
          { status: 500 }
        )
      }
      if (err instanceof PageBudgetExceededError) {
        return NextResponse.json({ error: err.message }, { status: 400 })
      }
      throw err
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
    return NextResponse.json({ error: '문서 생성 중 오류가 발생했습니다.' }, { status: 500 })
  }
}
