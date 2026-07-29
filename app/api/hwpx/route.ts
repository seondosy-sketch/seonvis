// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server'
import path from 'node:path'
import fs from 'node:fs'
import { validateWeeklyCapacity, formatCapacityViolations } from '@/lib/hwpx/capacity'
import { formatProjectNameForReport } from '@/lib/hwpx/projectName'
import { estimateWeeklyPageBudget, type WeeklyPageBudgetInput } from '@/lib/hwpx/pageBudget'
import {
  parseMonthlyReportDate, InvalidMonthlyReportDateError,
  formatMonthlyAsOfCaption, formatMonthlyFilename,
  type MonthlyReportDate,
} from '@/lib/hwpx/monthlyReportDate'
import {
  matchesHeaderFingerprint,
  MONTHLY_PROJECT_HEADER_FINGERPRINT, MONTHLY_CALENDAR_HEADER_FINGERPRINT,
} from '@/lib/hwpx/monthlyHeaderFingerprint'
import {
  estimateMonthlyPageBudget, MONTHLY_PAGE_BUDGET_EXCEEDED_MESSAGE, MONTHLY_RENDER_SAFETY_RESERVE,
  MONTHLY_VERIFIED_MAX_PROJECT_COUNT, MONTHLY_MAX_PROJECT_COUNT_EXCEEDED_CODE,
  formatMonthlyMaxProjectCountExceededMessage,
  type MonthlyPageBudgetInput,
} from '@/lib/hwpx/monthlyPageBudget'

const HP_NS = 'http://www.hancom.co.kr/hwpml/2011/paragraph'

// 템플릿(weekly.hwpx/montly.hwpx)의 실제 구조가 코드가 가정한 표 개수·열 수·행 수·기준 문구와
// 다를 때 던진다. 이 예외는 데이터를 절반만 채운 문서를 만들지 않기 위한 것 — 조용히 진행하지 않고
// 여기서 멈춘다. code는 선택적 내부 진단 코드(예: 'INVALID_TABLE_LAYOUT') — 사용자 응답에는
// 노출하지 않고 서버 로그·자동 테스트에서만 쓴다.
class TemplateStructureError extends Error {
  code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.code = code
  }
}

// Monthly 입력량이 lib/hwpx/monthlyPageBudget.ts의 산술 예산을 넘을 때 던진다.
// Weekly는 더 이상 이 예외를 쓰지 않는다 — 1페이지에 들어가지 않으면 차단하지 않고 2페이지
// 이상으로 생성한다(pageBreak="CELL" + repeatHeader="1"로 한글이 자동 분할·헤더 반복).
class PageBudgetExceededError extends Error {}

// 월간 입력 건수가 "사람이 한글로 직접 열어 확인한 최대 건수"를 넘을 때 던진다.
// PageBudgetExceededError와 의도적으로 별개다 — 산술 예산은 통과하더라도 검증되지 않은
// 범위의 문서를 만들지 않겠다는 정책이기 때문이다(둘 중 어느 쪽에 걸렸는지 구분 가능해야 한다).
class MonthlyProjectCountExceededError extends Error {
  code = MONTHLY_MAX_PROJECT_COUNT_EXCEEDED_CODE
}

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

// ── 표 wrapper 오버헤드 실측 ─────────────────────────────────────────────────
//
// 표가 실제 차지하는 세로 공간은 표의 hp:sz(행 높이 합)보다 크다. 실측 분해:
//   wrapper 문단 lineseg.vertsize = 표 hp:sz + outMargin(top+bottom)  ← 정확히 일치 확인
//   wrapper 문단 실제 점유        = vertsize + lineseg.spacing
// 따라서 예산에는 hp:sz 외에 outMargin과 wrapper spacing을 각각 한 번씩만 더해야 한다.
// vertsize를 그대로 쓰면 hp:sz·outMargin이 중복되므로 여기서는 아예 읽지 않는다.
// inMargin은 셀 내부 여백이라 행 높이에 이미 반영되어 있어 더하지 않는다.
//
// 값은 반드시 "해당 표의 직계 outMargin"과 "그 표를 직접 담은 wrapper 문단"에서만 읽는다
// (descendant 탐색 금지 — 셀 안에 중첩 표가 있으면 다른 표의 값을 읽게 된다).

/** 표의 직계 hp:outMargin에서 top+bottom을 읽는다. */
function readTableOutMargins(tbl: XmlElement, label: string): number {
  const om = findDirectChild(tbl, 'outMargin')
  if (!om) {
    throw new TemplateStructureError(
      `weekly.hwpx 템플릿 구조가 예상과 다릅니다: ${label}에 직계 hp:outMargin이 없습니다.`,
      'MISSING_TABLE_OUT_MARGIN'
    )
  }
  const raw = { top: om.getAttribute('top'), bottom: om.getAttribute('bottom') }
  const parsed = { top: Number(raw.top), bottom: Number(raw.bottom) }
  for (const side of ['top', 'bottom'] as const) {
    const v = parsed[side]
    if (raw[side] == null || !Number.isInteger(v) || v < 0) {
      throw new TemplateStructureError(
        `weekly.hwpx 템플릿 구조가 예상과 다릅니다: ${label}의 outMargin ${side} 값(${raw[side]})이 0 이상 정수가 아닙니다.`,
        'INVALID_TABLE_OUT_MARGIN'
      )
    }
  }
  return parsed.top + parsed.bottom
}

/** 표를 hp:run 직계로 담은 wrapper 문단을 찾는다 — 정확히 1개여야 한다. */
function findTableWrapperParagraph(doc: XmlDocument, tbl: XmlElement, label: string): XmlElement {
  const candidates = elementsOf(doc, 'p').filter((p) =>
    getDirectChildren(p, 'run').some((run) => getDirectChildren(run, 'tbl').includes(tbl))
  )
  if (candidates.length !== 1) {
    throw new TemplateStructureError(
      `weekly.hwpx 템플릿 구조가 예상과 다릅니다: ${label}을 직접 담은 문단을 정확히 하나 찾아야 하는데 ${candidates.length}개 발견했습니다.`,
      'AMBIGUOUS_TABLE_WRAPPER'
    )
  }
  return candidates[0]
}

/** wrapper 문단의 직계 linesegarray/lineseg에서 spacing을 읽는다. */
function readWrapperSpacing(wrapper: XmlElement, label: string): number {
  const lsa = findDirectChild(wrapper, 'linesegarray')
  if (!lsa) {
    throw new TemplateStructureError(
      `weekly.hwpx 템플릿 구조가 예상과 다릅니다: ${label}의 wrapper 문단에 hp:linesegarray가 없습니다.`,
      'MISSING_WRAPPER_LINESEG'
    )
  }
  const segs = getDirectChildren(lsa, 'lineseg')
  if (segs.length === 0) {
    throw new TemplateStructureError(
      `weekly.hwpx 템플릿 구조가 예상과 다릅니다: ${label}의 wrapper 문단에 hp:lineseg가 없습니다.`,
      'MISSING_WRAPPER_LINESEG'
    )
  }
  // 표를 담은 문단은 한 줄(=표 한 덩어리)이므로 첫 lineseg의 spacing이 그 문단의 줄간격이다.
  const raw = segs[0].getAttribute('spacing')
  const spacing = Number(raw)
  if (raw == null || !Number.isInteger(spacing) || spacing < 0) {
    throw new TemplateStructureError(
      `weekly.hwpx 템플릿 구조가 예상과 다릅니다: ${label}의 wrapper spacing 값(${raw})이 0 이상 정수가 아닙니다.`,
      'INVALID_WRAPPER_SPACING'
    )
  }
  return spacing
}

// ── 마지막 문단(문서 하단 판정용) ────────────────────────────────────────────
//
// lineseg.spacing은 "그 줄 아래쪽 여백"이다. 중간 문단에서는 다음 문단을 실제로 밀어내지만
// (실측: 다음 문단 vertpos = 이전 vertsize + spacing 정확 일치), 문서 마지막 문단의 spacing은
// 밀어낼 대상이 없어 페이지에 들어갈 필요가 없다. 그래서 문서 하단은 그만큼 위다.
// 고정값을 쓰지 않고 매번 템플릿에서 실측한다.

/** 표 안에 들어 있지 않은(=문단 흐름에 노출된) 마지막 문단. */
function findTrailingOuterParagraph(doc: XmlDocument): XmlElement | null {
  const tbls = elementsOf(doc, 'tbl')
  const insideAnyTable = (p: XmlElement) => tbls.some((t) => elementsOf(t, 'p').includes(p))
  const outer = elementsOf(doc, 'p').filter((p) => !insideAnyTable(p))
  return outer[outer.length - 1] ?? null
}

/** 마지막 문단의 마지막 lineseg.spacing을 읽는다. */
function readTrailingParagraphSpacing(doc: XmlDocument): { paragraph: XmlElement; spacing: number } {
  const para = findTrailingOuterParagraph(doc)
  if (!para) {
    throw new TemplateStructureError(
      `weekly.hwpx 템플릿 구조가 예상과 다릅니다: 표 밖 마지막 문단을 찾지 못했습니다.`,
      'MISSING_TRAILING_PARAGRAPH'
    )
  }
  const lsa = findDirectChild(para, 'linesegarray')
  if (!lsa) {
    throw new TemplateStructureError(
      `weekly.hwpx 템플릿 구조가 예상과 다릅니다: 마지막 문단에 hp:linesegarray가 없습니다.`,
      'MISSING_TRAILING_LINESEG'
    )
  }
  const segs = getDirectChildren(lsa, 'lineseg')
  if (segs.length === 0) {
    throw new TemplateStructureError(
      `weekly.hwpx 템플릿 구조가 예상과 다릅니다: 마지막 문단에 hp:lineseg가 없습니다.`,
      'MISSING_TRAILING_LINESEG'
    )
  }
  // 여러 줄이면 "마지막 줄"의 아래 여백만 문서 하단 밖에 있다.
  const raw = segs[segs.length - 1].getAttribute('spacing')
  const spacing = Number(raw)
  if (raw == null || !Number.isInteger(spacing) || spacing < 0) {
    throw new TemplateStructureError(
      `weekly.hwpx 템플릿 구조가 예상과 다릅니다: 마지막 문단의 spacing 값(${raw})이 0 이상 정수가 아닙니다.`,
      'INVALID_TRAILING_SPACING'
    )
  }
  return { paragraph: para, spacing }
}

// 생성이 끝난 뒤에도 그 문단이 여전히 문서의 마지막 표 밖 문단인지 확인한다. 교육참가자 블록
// 재구성은 anchor 앞에 삽입하므로 순서가 유지되지만, 나중에 생성 로직이 바뀌어 마지막 뒤에
// 문단이 추가되면 예산 판정 근거가 무너지므로 계약으로 못박아 둔다.
function assertTrailingParagraphStillLast(doc: XmlDocument, expected: XmlElement): void {
  const actual = findTrailingOuterParagraph(doc)
  if (actual !== expected) {
    throw new TemplateStructureError(
      `생성 결과가 예상과 다릅니다: 예산 계산 기준으로 삼은 마지막 문단이 더 이상 문서의 마지막 문단이 아닙니다.`,
      'INVALID_TRAILING_PARAGRAPH_POSITION'
    )
  }
}

// ── 발주예상 데이터 행의 2줄 필요 높이 ───────────────────────────────────────
//
// HWP는 cellSz height를 "최소 높이"로만 쓰고 내용이 넘치면 행을 자동으로 늘린다. 발주처명이
// 6~8자면 발주청 열(약 5자 폭)에서 2줄이 되어 선언 높이 1,700을 넘어 확장되는데, 선언 높이만
// 세던 예산은 이 확장을 보지 못해 실제로는 2페이지인 조합을 통과시켰다(UAT 확인).
//
// 여기서는 UAT가 입증한 "2줄 확장"만 실측한다 — 문자폭 추정이나 줄 수 계산은 하지 않는다.
// 2줄 필요 높이 = 2×본문높이(vertsize) + 1×줄간격(spacing). 마지막 줄의 아래 여백은 점유하지
// 않는다(문단 레벨 trailingParagraphSpacing과 동일한 규칙 — 템플릿 캐시 좌표로 확인).
//
// 특정 셀 하나에 의존하지 않는다: 데이터 행의 rowSpan=1 셀을 전부 검사해 하나라도 구조가
// 어긋나면 던지고, 행 높이는 셀 중 가장 큰 값이 결정하므로 최댓값을 쓴다. 셀마다 줄간격이
// 다르므로(실측: 120% / 130% 혼재) 최댓값이 곧 그 행의 2줄 필요 높이다.
const EXPECTED_ROW_BUDGET_LINE_COUNT = 2

function measureExpectedRowTwoLineHeight(expDataRows: readonly XmlElement[]): number {
  let maxHeight = 0
  let inspected = 0

  expDataRows.forEach((tr, rowIdx) => {
    const cells = getDirectChildren(tr, 'tc').filter((tc) => {
      const span = findDirectChild(tc, 'cellSpan')
      return !span || Number(span.getAttribute('rowSpan') || 1) === 1
    })
    cells.forEach((tc, colIdx) => {
      const label = `발주예상 표 ${rowIdx}번째 데이터 행 ${colIdx}열`
      const subList = findDirectChild(tc, 'subList')
      const para = subList ? getDirectChildren(subList, 'p')[0] ?? null : null
      const lsa = para ? findDirectChild(para, 'linesegarray') : null
      const seg = lsa ? getDirectChildren(lsa, 'lineseg')[0] ?? null : null
      if (!seg) {
        throw new TemplateStructureError(
          `weekly.hwpx 템플릿 구조가 예상과 다릅니다: ${label}에서 줄 높이를 읽을 hp:lineseg를 찾지 못했습니다.`,
          'MISSING_EXPECTED_ROW_LINESEG'
        )
      }
      const rawVert = seg.getAttribute('vertsize')
      const vertsize = Number(rawVert)
      if (rawVert == null || !Number.isInteger(vertsize) || vertsize <= 0) {
        throw new TemplateStructureError(
          `weekly.hwpx 템플릿 구조가 예상과 다릅니다: ${label}의 vertsize 값(${rawVert})이 양의 정수가 아닙니다.`,
          'INVALID_EXPECTED_ROW_LINE_HEIGHT'
        )
      }
      const rawSpacing = seg.getAttribute('spacing')
      const spacing = Number(rawSpacing)
      if (rawSpacing == null || !Number.isInteger(spacing) || spacing < 0) {
        throw new TemplateStructureError(
          `weekly.hwpx 템플릿 구조가 예상과 다릅니다: ${label}의 spacing 값(${rawSpacing})이 0 이상 정수가 아닙니다.`,
          'INVALID_EXPECTED_ROW_LINE_SPACING'
        )
      }
      const needed =
        EXPECTED_ROW_BUDGET_LINE_COUNT * vertsize +
        (EXPECTED_ROW_BUDGET_LINE_COUNT - 1) * spacing
      if (needed > maxHeight) maxHeight = needed
      inspected++
    })
  })

  if (inspected === 0) {
    throw new TemplateStructureError(
      `weekly.hwpx 템플릿 구조가 예상과 다릅니다: 발주예상 표 데이터 행에서 줄 높이를 읽을 셀을 찾지 못했습니다.`,
      'MISSING_EXPECTED_ROW_LINESEG'
    )
  }
  return maxHeight
}

/** 표 하나의 예산 보정 항목(outMargin 합, wrapper spacing)을 함께 뽑는다. */
function measureTableWrapperOverhead(doc: XmlDocument, tbl: XmlElement, label: string): { outMargins: number; wrapperSpacing: number } {
  const outMargins = readTableOutMargins(tbl, label)
  const wrapper = findTableWrapperParagraph(doc, tbl, label)
  const wrapperSpacing = readWrapperSpacing(wrapper, label)
  return { outMargins, wrapperSpacing }
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

  // 표 wrapper 오버헤드 — 표 hp:sz만으로는 빠지는 outMargin과 wrapper 줄간격을 실측한다.
  // 고정 상수를 쓰지 않고 템플릿 XML에서 직접 뽑으므로, 템플릿 서식을 바꾸면 예산도 함께 따라간다.
  const perfOverhead = measureTableWrapperOverhead(doc, perfTbl, '수행 프로젝트 표')
  const expOverhead = measureTableWrapperOverhead(doc, expTbl, '발주예상 표')

  // 문서 하단 판정용 — 마지막 문단의 줄 아래 여백은 페이지에 들어갈 필요가 없다.
  const trailing = readTrailingParagraphSpacing(doc)

  return {
    perfTbl, expTbl,
    gaeyalLabelRow, gaeyalAdditionalRows, gaeyalMiddleRow, gaeyalLastRow,
    jinhaengLabelRow, jinhaengAdditionalRows, jinhaengRow,
    expDataRowNodes,
    paras, chiefIdx, reportPeriodNode: dateMatches[0],
    trailingParagraph: trailing.paragraph,
    measurements: {
      usableHeight, fixedContentHeight, eduLineHeight,
      perfHeaderHeight, gaeyalMiddleRowHeight, gaeyalLastRowHeight, jinhaengRowHeight,
      expHeaderHeight, expRowHeight,
      expectedRowTwoLineHeight: measureExpectedRowTwoLineHeight(expDataRowNodes),
      performingOutMargins: perfOverhead.outMargins,
      expectedOutMargins: expOverhead.outMargins,
      performingWrapperSpacing: perfOverhead.wrapperSpacing,
      expectedWrapperSpacing: expOverhead.wrapperSpacing,
      trailingParagraphSpacing: trailing.spacing,
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

  // 문서 높이 산술 계산 — 진단 전용이다. 여기서 생성을 막지 않는다.
  //
  // Weekly는 입력이 많아 1페이지에 들어가지 않아도 차단하지 않고 2페이지 이상으로 자연스럽게
  // 생성한다. 두 표에 pageBreak="CELL"과 repeatHeader="1"이 설정되어 있어 한글이 행 경계에서
  // 자동으로 나누고 다음 페이지에 헤더 행을 반복한다(템플릿 실측 확인). 데이터 삭제·행 누락·
  // 말줄임·강제 절단은 어떤 경우에도 하지 않는다.
  const eduLineCount = 1 + EDU_FIELD_ORDER.filter(k => splitNames(data.meta?.[k]).length > 0).length
  const budget = estimateWeeklyPageBudget({
    usableHeightPerPage: structure.measurements.usableHeight,
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
    expectedRowTwoLineHeight: structure.measurements.expectedRowTwoLineHeight,
    expRowCount: expectedProjects.length,
    performingOutMargins: structure.measurements.performingOutMargins,
    expectedOutMargins: structure.measurements.expectedOutMargins,
    performingWrapperSpacing: structure.measurements.performingWrapperSpacing,
    expectedWrapperSpacing: structure.measurements.expectedWrapperSpacing,
    trailingParagraphSpacing: structure.measurements.trailingParagraphSpacing,
  } satisfies WeeklyPageBudgetInput)
  // 진단 로그만 남긴다 — 상세 수치는 사용자 응답에 넣지 않는다(개발 로그·완료 보고·검증 판단용).
  // 1페이지를 넘어가는 경우도 오류가 아니라 정상 동작이므로 error가 아닌 info로 기록한다.
  if (!budget.fitsSinglePage) {
    console.info('[HWPX Weekly Multi-Page]', {
      gaeyal: gaeyalProjects.length, jinhaeng: jinhaengProjects.length, expected: expectedProjects.length,
      eduLineCount,
      ...budget,
    })
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

  // 예산 판정의 근거였던 "마지막 문단"이 생성 후에도 여전히 마지막인지 확인한다 —
  // 아니면 contentBottom 계산이 무효해지므로 문서를 내보내지 않는다.
  assertTrailingParagraphStillLast(doc, structure.trailingParagraph)

  removeLinesegarray(doc)

  zip.updateFile('Contents/section0.xml', Buffer.from(new XMLSerializer().serializeToString(doc), 'utf8'))

  return zip.toBuffer()
}

// ── Monthly 전용 로컬 XML 타입 ────────────────────────────────────────────────
//
// @xmldom/xmldom은 표준 DOM lib 타입과 호환되지 않는 자체 구현체다(이 파일 최상단의
// @ts-nocheck와 Weekly 코드의 광범위한 any가 그 흔적이다). 아래 타입은 라이브러리 전체를
// 타이핑하려는 게 아니라, Monthly 코드가 실제로 호출하는 멤버만 최소한으로 기술한
// 구조적(structural) 계약이다 — 새 코드로 any가 번지지 않게 막는 좁은 경계다.
// Weekly가 쓰는 기존 헬퍼(getTcs/setText/rowHeight 등)의 시그니처는 이번 범위 밖이라
// 그대로 둔다.
interface XmlNode {
  nodeType: number
  localName: string | null
  textContent: string | null
  childNodes: ArrayLike<XmlNode>
}

interface XmlElement extends XmlNode {
  getAttribute(name: string): string | null
  setAttribute(name: string, value: string): void
  getElementsByTagNameNS(namespaceURI: string, localName: string): ArrayLike<XmlElement>
  appendChild(child: XmlElement): XmlElement
  removeChild(child: XmlElement): XmlElement
  cloneNode(deep: boolean): XmlElement
  ownerDocument: XmlDocument
}

interface XmlDocument {
  getElementsByTagNameNS(namespaceURI: string, localName: string): ArrayLike<XmlElement>
  createElementNS(namespaceURI: string, qualifiedName: string): XmlElement
}

/** 프로젝트 표의 행(<hp:tr>) 하나. */
type ProjectRowElement = XmlElement
/** 프로젝트 표 한 행의 셀(<hp:tc>) 배열 — 계약상 항상 12칸. */
type ProjectRowCells = XmlElement[]

// 이 파일에서 unknown → XmlNode/XmlElement로 좁히는 유일한 두 지점이다(요구사항 8).
// 여기서 검사에 실패하면 any를 흘리는 대신 즉시 멈춘다.
function isXmlElement(node: XmlNode): node is XmlElement {
  return node.nodeType === 1
}

function toXmlDocument(parsed: unknown): XmlDocument {
  if (
    typeof parsed !== 'object' || parsed === null ||
    typeof (parsed as { getElementsByTagNameNS?: unknown }).getElementsByTagNameNS !== 'function' ||
    typeof (parsed as { createElementNS?: unknown }).createElementNS !== 'function'
  ) {
    throw new TemplateStructureError(
      `montly.hwpx 템플릿 구조가 예상과 다릅니다: 본문 XML(Contents/section0.xml)을 문서로 해석할 수 없습니다.`,
      'INVALID_XML_DOCUMENT'
    )
  }
  return parsed as XmlDocument
}

// ── Monthly 전용 헬퍼 — 직계 자식만 훑는다(getElementsByTagNameNS의 descendant 검색과 달리
// 셀 내부에 중첩 표가 생겨도 바깥 표의 행·셀 수 계산에 포함되지 않는다). Weekly는 이미 동작
// 검증이 끝난 기존 방식(getTcs 등, descendant 검색)을 그대로 쓰므로 건드리지 않는다.
function getDirectChildren(parent: XmlElement, localName: string): XmlElement[] {
  return Array.from(parent.childNodes ?? [])
    .filter(isXmlElement)
    .filter((el) => el.localName === localName)
}

function findDirectChild(parent: XmlElement, localName: string): XmlElement | null {
  return getDirectChildren(parent, localName)[0] ?? null
}

/** descendant 검색(getElementsByTagNameNS)을 타입 있는 배열로 감싼다. */
function elementsOf(scope: XmlDocument | XmlElement, localName: string): XmlElement[] {
  return Array.from(scope.getElementsByTagNameNS(HP_NS, localName))
}

// ── Monthly 전용 셀 텍스트 읽기/쓰기 ─────────────────────────────────────────────
//
// 기존 공용 setText()는 대상 셀에 hp:t도 hp:run도 없으면 "아무 일도 하지 않고" 조용히 끝난다.
// Weekly는 검증이 끝난 고정 템플릿 셀만 다루므로 지금까지 문제가 없었지만, Monthly는 데이터
// 행을 복제해 임의 개수로 늘리기 때문에 복제 원본 구조가 어긋나면 값이 조용히 빠질 수 있다.
// 그래서 Monthly는 전용 기록 함수를 쓰고, 기록 실패를 반드시 예외로 드러낸다.
// (Weekly가 쓰는 setText/setTextMultiLine/clearCell의 동작은 그대로 두었다.)

/** 셀의 문단별 텍스트를 순서대로 읽는다. 첫 hp:t만 보지 않고 문단 안의 모든 hp:t를 이어붙인다. */
function readMonthlyCellLines(tc: XmlElement): string[] {
  const subList = findDirectChild(tc, 'subList')
  if (!subList) return []
  return getDirectChildren(subList, 'p').map((p) =>
    elementsOf(p, 't').map((t) => t.textContent ?? '').join('')
  )
}

/** 셀 전체 텍스트. 여러 문단은 개행으로 이어 붙인다(기록 시의 multiline 정책과 대칭). */
function readMonthlyCellText(tc: XmlElement): string {
  return readMonthlyCellLines(tc).join('\n')
}

/** 문단 하나를 "첫 run + hp:t 1개"로 정규화하고 텍스트를 기록한다. 잔존 hp:t는 모두 제거한다. */
function writeMonthlyParagraphText(para: XmlElement, text: string, cellLabel: string): void {
  const runs = getDirectChildren(para, 'run')
  if (runs.length === 0) {
    throw new TemplateStructureError(
      `montly.hwpx 셀 구조가 예상과 다릅니다: ${cellLabel}의 문단에 hp:run이 없어 텍스트를 기록할 수 없습니다.`,
      'INVALID_CELL_TEXT_CONTAINER'
    )
  }
  // 첫 run 외의 run에 남아 있는 텍스트 노드를 모두 제거한다(서식용 run 자체는 남긴다).
  for (const run of runs.slice(1)) {
    for (const t of getDirectChildren(run, 't')) run.removeChild(t)
  }
  const firstRun = runs[0]
  const texts = getDirectChildren(firstRun, 't')
  for (const extra of texts.slice(1)) firstRun.removeChild(extra)

  let target = texts[0] ?? null
  if (!target) {
    target = para.ownerDocument.createElementNS(HP_NS, 'hp:t')
    firstRun.appendChild(target)
  }
  target.textContent = text
}

// 셀 텍스트를 value로 완전히 교체한다. 빈 문자열을 넣는 경우에도 기존 텍스트가 남지 않는다.
// 기록 후 셀 전체 텍스트가 기대값과 정확히 같은지 스스로 확인하고, 다르면 던진다 — 예상 못 한
// 중첩 구조(예: 더 깊은 곳의 hp:t) 때문에 값이 어긋나는 경우까지 여기서 걸러진다.
function replaceMonthlyCellText(tc: XmlElement, value: string, cellLabel: string): void {
  const subList = findDirectChild(tc, 'subList')
  if (!subList) {
    throw new TemplateStructureError(
      `montly.hwpx 셀 구조가 예상과 다릅니다: ${cellLabel}에 hp:subList가 없어 텍스트를 기록할 수 없습니다.`,
      'INVALID_CELL_TEXT_CONTAINER'
    )
  }
  const paras = getDirectChildren(subList, 'p')
  if (paras.length === 0) {
    throw new TemplateStructureError(
      `montly.hwpx 셀 구조가 예상과 다릅니다: ${cellLabel}에 문단(hp:p)이 없어 텍스트를 기록할 수 없습니다.`,
      'INVALID_CELL_TEXT_CONTAINER'
    )
  }

  const basePara = paras[0]
  // 첫 문단만 남기고 나머지는 제거 — 이전 값이 다른 문단에 잔존하지 않게 한다.
  for (const p of paras.slice(1)) subList.removeChild(p)

  const lines = value.split('\n')
  writeMonthlyParagraphText(basePara, lines[0], cellLabel)
  for (let i = 1; i < lines.length; i++) {
    const clone = basePara.cloneNode(true)
    writeMonthlyParagraphText(clone, lines[i], cellLabel)
    subList.appendChild(clone)
  }

  const written = readMonthlyCellText(tc)
  if (written !== value) {
    throw new TemplateStructureError(
      `montly.hwpx 셀 기록 결과가 기대값과 다릅니다: ${cellLabel} 실제=${JSON.stringify(written)} 기대=${JSON.stringify(value)}.`,
      'CELL_TEXT_WRITE_MISMATCH'
    )
  }
}

// cellAddr/cellSpan/cellSz는 hp:tc의 직계 자식이다. descendant 검색을 쓰면 셀 안에 중첩 표가
// 있을 때 그 표의 셀 속성을 잘못 읽으므로 반드시 직계로만 찾는다.
function getCellAddr(tc: XmlElement): { rowAddr: number; colAddr: number } | null {
  const a = findDirectChild(tc, 'cellAddr')
  if (!a) return null
  return { rowAddr: Number(a.getAttribute('rowAddr')), colAddr: Number(a.getAttribute('colAddr')) }
}

function getCellSpanOf(tc: XmlElement): { colSpan: number; rowSpan: number } | null {
  const s = findDirectChild(tc, 'cellSpan')
  if (!s) return null
  return { colSpan: Number(s.getAttribute('colSpan') || 1), rowSpan: Number(s.getAttribute('rowSpan') || 1) }
}

function getCellHeightOf(tc: XmlElement): number | null {
  const sz = findDirectChild(tc, 'cellSz')
  if (!sz) return null
  return Number(sz.getAttribute('height'))
}

// ── Monthly 전용 행 주소·높이 갱신 ────────────────────────────────────────────────
//
// 공용 renumberRowAddr/sumRowSpan1Heights/setTableHeight는 hp:tr을 descendant로 훑는다.
// Weekly 템플릿에는 중첩 표가 없어 문제가 없지만, Monthly는 "셀 안에 중첩 표가 생겨도 직계
// tr/tc 계산이 유지되어야 한다"는 계약을 갖는다(Codex P2-2). 그래서 Monthly는 아래 직계 전용
// 버전을 쓴다 — 공용 헬퍼와 Weekly 동작은 건드리지 않는다.
function monthlyRowHeight(tr: ProjectRowElement): number {
  const cells = getDirectChildren(tr, 'tc')
  if (cells.length === 0) return 0
  // 행 높이 균일성은 assertUniformRowHeight가 이미 강제하므로 첫 셀 값을 그대로 쓸 수 있다.
  return getCellHeightOf(cells[0]) ?? 0
}

function sumMonthlyRowHeights(tbl: XmlElement): number {
  return getDirectChildren(tbl, 'tr').reduce((sum, tr) => sum + monthlyRowHeight(tr), 0)
}

function setMonthlyTableHeight(tbl: XmlElement, height: number): void {
  const sz = findDirectChild(tbl, 'sz')
  if (!sz) {
    throw new TemplateStructureError(`montly.hwpx 템플릿 구조가 예상과 다릅니다: 표에 hp:sz가 없습니다.`, 'INVALID_TABLE_HEIGHT')
  }
  sz.setAttribute('height', String(height))
}

function renumberMonthlyRowAddr(tbl: XmlElement): void {
  getDirectChildren(tbl, 'tr').forEach((tr, rowIdx) => {
    getDirectChildren(tr, 'tc').forEach((tc, colIdx) => {
      const addr = findDirectChild(tc, 'cellAddr')
      if (!addr) {
        throw new TemplateStructureError(
          `montly.hwpx 템플릿 구조가 예상과 다릅니다: ${rowIdx}행 ${colIdx}열에 cellAddr가 없습니다.`,
          'INVALID_ROW_ADDRESS'
        )
      }
      addr.setAttribute('rowAddr', String(rowIdx))
      addr.setAttribute('colAddr', String(colIdx))
    })
  })
}

// 표 하나(tr 전체)의 셀 높이가 예외 없이 완전히 동일한지 검증한다. 첫 셀 대표값·다수결·허용
// 오차를 전혀 쓰지 않는다 — 기준 파일에 셀별로 서로 다른 높이가 실제로 존재함을 확인했기
// 때문에(대표값 방식은 그 불일치를 조용히 숨긴다), 하나라도 다르면 즉시 던진다.
function assertUniformRowHeight(tr: ProjectRowElement, rowLabel: string): number {
  const cells = getDirectChildren(tr, 'tc')
  const heights: (number | null)[] = cells.map((tc) => getCellHeightOf(tc))
  if (heights.some((h) => h == null)) {
    throw new TemplateStructureError(
      `montly.hwpx 템플릿 구조가 예상과 다릅니다: ${rowLabel}의 일부 셀에 cellSz height가 없습니다.`,
      'INVALID_ROW_HEIGHT'
    )
  }
  const known: number[] = heights.filter((h): h is number => h != null)
  const unique = [...new Set(known)]
  if (unique.length !== 1) {
    throw new TemplateStructureError(
      `montly.hwpx 템플릿 구조가 예상과 다릅니다: ${rowLabel}의 셀 높이가 균일하지 않습니다(실제: [${known.join(', ')}]).`,
      'INVALID_ROW_HEIGHT'
    )
  }
  return unique[0]
}

function findWrapperParagraph(doc: XmlDocument, tbl: XmlElement): XmlElement | null {
  return elementsOf(doc, 'p').find((p) => elementsOf(p, 'tbl').includes(tbl)) ?? null
}

function isEarlierInDocumentOrder(doc: XmlDocument, earlierTbl: XmlElement, laterTbl: XmlElement): boolean {
  const paras = elementsOf(doc, 'p')
  const earlierPara = findWrapperParagraph(doc, earlierTbl)
  const laterPara = findWrapperParagraph(doc, laterTbl)
  if (!earlierPara || !laterPara) return false
  return paras.indexOf(laterPara) > paras.indexOf(earlierPara)
}

// 후보가 정확히 1개가 아니면(0개든 2개 이상이든) 위치 기반으로 임의로 하나를 고르지 않고
// 즉시 던진다 — Codex 감사 P1-1: "첫 번째 12열 표" 같은 위치 추정은 표가 삽입/삭제되면
// 조용히 잘못된 표를 고른다.
function assertExactlyOneCandidate<T>(candidates: readonly T[], label: string, code: string): T {
  if (candidates.length === 0) {
    throw new TemplateStructureError(`montly.hwpx 템플릿 구조가 예상과 다릅니다: ${label} 후보를 찾지 못했습니다.`, code)
  }
  if (candidates.length > 1) {
    throw new TemplateStructureError(`montly.hwpx 템플릿 구조가 예상과 다릅니다: ${label} 후보가 ${candidates.length}개 발견되어 특정할 수 없습니다.`, code)
  }
  return candidates[0]
}

function findMonthlyProjectTableCandidates(doc: XmlDocument): XmlElement[] {
  return elementsOf(doc, 'tbl').filter((tbl) => {
    if (Number(tbl.getAttribute('colCnt')) !== 12) return false
    const rows = getDirectChildren(tbl, 'tr')
    if (rows.length < 1) return false
    const headerCells = getDirectChildren(rows[0], 'tc')
    if (headerCells.length !== 12) return false
    const headerTexts = headerCells.map((tc) => getText(tc))
    return matchesHeaderFingerprint(headerTexts, MONTHLY_PROJECT_HEADER_FINGERPRINT)
  })
}

function findMonthlyCalendarTableCandidates(doc: XmlDocument, projTbl: XmlElement): XmlElement[] {
  return elementsOf(doc, 'tbl').filter((tbl) => {
    if (tbl === projTbl) return false
    if (Number(tbl.getAttribute('colCnt')) !== 7) return false
    const rows = getDirectChildren(tbl, 'tr')
    if (rows.length !== 4) return false
    const headerCells = getDirectChildren(rows[0], 'tc')
    if (headerCells.length !== 7) return false
    const headerTexts = headerCells.map((tc) => getText(tc))
    if (!matchesHeaderFingerprint(headerTexts, MONTHLY_CALENDAR_HEADER_FINGERPRINT)) return false
    if (!isEarlierInDocumentOrder(doc, projTbl, tbl)) return false
    return true
  })
}

// 프로젝트 표의 Template Contract 전체를 검증한다: 열/행 수 일치, 병합 없음(1x1 고정),
// rowAddr/colAddr 연속성, treatAsChar/pageBreak, 헤더·데이터 행 높이 균일성.
// (반환값의 dataRowHeight/headerHeight/computedHeight는 이후 rebuild·page budget이 그대로 쓴다.
// 기존 hp:sz@height 값 자체는 신뢰하지 않는다 — 어차피 재계산해 덮어쓸 값이라 여기서는
// 실패 조건으로 쓰지 않는다.)
interface MonthlyProjectTableContract {
  rows: ProjectRowElement[]
  headerRow: ProjectRowElement
  dataRows: ProjectRowElement[]
  dataRowTemplate: ProjectRowElement
  headerHeight: number
  dataRowHeight: number
}

function assertMonthlyProjectTableContract(projTbl: XmlElement): MonthlyProjectTableContract {
  const rows = getDirectChildren(projTbl, 'tr')
  if (rows.length < 2) {
    throw new TemplateStructureError(`montly.hwpx 템플릿 구조가 예상과 다릅니다: 프로젝트 표에 헤더 외 데이터 행이 최소 1개 있어야 합니다.`, 'INVALID_ROW_COUNT')
  }
  const declaredRowCnt = Number(projTbl.getAttribute('rowCnt'))
  if (declaredRowCnt !== rows.length) {
    throw new TemplateStructureError(`montly.hwpx 템플릿 구조가 예상과 다릅니다: 프로젝트 표 rowCnt(${declaredRowCnt})가 실제 행 수(${rows.length})와 다릅니다.`, 'INVALID_ROW_COUNT')
  }

  const pos = findDirectChild(projTbl, 'pos')
  if (!pos || pos.getAttribute('treatAsChar') !== '1') {
    throw new TemplateStructureError(`montly.hwpx 템플릿 구조가 예상과 다릅니다: 프로젝트 표의 treatAsChar가 1이 아닙니다.`, 'INVALID_POSITIONING')
  }
  if (projTbl.getAttribute('pageBreak') !== 'CELL') {
    throw new TemplateStructureError(`montly.hwpx 템플릿 구조가 예상과 다릅니다: 프로젝트 표의 pageBreak가 CELL이 아닙니다.`, 'INVALID_PAGE_BREAK')
  }

  rows.forEach((tr, rowIdx) => {
    const cells = getDirectChildren(tr, 'tc')
    if (cells.length !== 12) {
      throw new TemplateStructureError(`montly.hwpx 템플릿 구조가 예상과 다릅니다: 프로젝트 표 ${rowIdx}행의 셀 수가 12가 아니라 ${cells.length}입니다.`, 'INVALID_TABLE_LAYOUT')
    }
    cells.forEach((tc, colIdx) => {
      const span = getCellSpanOf(tc)
      if (!span || span.colSpan !== 1 || span.rowSpan !== 1) {
        throw new TemplateStructureError(`montly.hwpx 템플릿 구조가 예상과 다릅니다: 프로젝트 표 ${rowIdx}행 ${colIdx}열의 cellSpan이 1x1이 아닙니다.`, 'INVALID_CELL_SPAN')
      }
      const addr = getCellAddr(tc)
      if (!addr || addr.rowAddr !== rowIdx || addr.colAddr !== colIdx) {
        throw new TemplateStructureError(`montly.hwpx 템플릿 구조가 예상과 다릅니다: 프로젝트 표 ${rowIdx}행 ${colIdx}열의 rowAddr/colAddr이 위치와 일치하지 않습니다.`, 'INVALID_ROW_ADDRESS')
      }
    })
  })

  const headerHeight = assertUniformRowHeight(rows[0], '프로젝트 표 헤더 행')
  const dataRowsNodes = rows.slice(1)
  const dataRowHeights = dataRowsNodes.map((tr, i) => assertUniformRowHeight(tr, `프로젝트 표 ${i + 1}번째 데이터 행`))
  const uniqueDataHeights = [...new Set(dataRowHeights)]
  if (uniqueDataHeights.length !== 1) {
    throw new TemplateStructureError(
      `montly.hwpx 템플릿 구조가 예상과 다릅니다: 프로젝트 표 데이터 행들의 높이가 서로 다릅니다(실제: [${dataRowHeights.join(', ')}]).`,
      'INVALID_ROW_HEIGHT'
    )
  }

  return {
    rows, headerRow: rows[0], dataRows: dataRowsNodes, dataRowTemplate: dataRowsNodes[0],
    headerHeight, dataRowHeight: uniqueDataHeights[0],
  }
}

const MONTHLY_CALENDAR_EXPECTED_HEADER_HEIGHT = 1680
const MONTHLY_CALENDAR_EXPECTED_DATE_ROW_HEIGHT = 7778

// 달력 표는 코드가 수정하지 않으므로(입력값에 따라 변하는 부분이 없음), 기존 hp:sz 값이
// 검증된 실측 행 높이 합과 정확히 일치하는지까지 하드 실패 조건으로 검사한다 — 이 값을 그대로
// page budget 계산에 쓰기 때문이다.
interface MonthlyCalendarTableContract {
  calendarHeight: number
  calendarVertOffset: number
  objectMarginsCalendar: number
}

function assertMonthlyCalendarTableContract(calTbl: XmlElement): MonthlyCalendarTableContract {
  const rows = getDirectChildren(calTbl, 'tr')
  if (rows.length !== 4) {
    throw new TemplateStructureError(`montly.hwpx 템플릿 구조가 예상과 다릅니다: 달력 표의 행 수가 4가 아니라 ${rows.length}입니다.`, 'INVALID_ROW_COUNT')
  }
  const declaredRowCnt = Number(calTbl.getAttribute('rowCnt'))
  if (declaredRowCnt !== 4) {
    throw new TemplateStructureError(`montly.hwpx 템플릿 구조가 예상과 다릅니다: 달력 표 rowCnt가 4가 아니라 ${declaredRowCnt}입니다.`, 'INVALID_ROW_COUNT')
  }

  rows.forEach((tr, rowIdx) => {
    const cells = getDirectChildren(tr, 'tc')
    if (cells.length !== 7) {
      throw new TemplateStructureError(`montly.hwpx 템플릿 구조가 예상과 다릅니다: 달력 표 ${rowIdx}행의 셀 수가 7이 아니라 ${cells.length}입니다.`, 'INVALID_TABLE_LAYOUT')
    }
    cells.forEach((tc, colIdx) => {
      const addr = getCellAddr(tc)
      if (!addr || addr.rowAddr !== rowIdx || addr.colAddr !== colIdx) {
        throw new TemplateStructureError(`montly.hwpx 템플릿 구조가 예상과 다릅니다: 달력 표 ${rowIdx}행 ${colIdx}열의 rowAddr/colAddr이 위치와 일치하지 않습니다.`, 'INVALID_ROW_ADDRESS')
      }
      // 달력도 프로젝트 표와 같은 1x1 계약을 요구한다 — 병합 셀이 생기면 행 높이 합산으로
      // 계산한 calendarHeight가 실제 렌더 높이와 어긋나고, 그 값을 page budget이 그대로 쓴다.
      const span = getCellSpanOf(tc)
      if (!span || span.colSpan !== 1 || span.rowSpan !== 1) {
        throw new TemplateStructureError(`montly.hwpx 템플릿 구조가 예상과 다릅니다: 달력 표 ${rowIdx}행 ${colIdx}열의 cellSpan이 1x1이 아닙니다.`, 'INVALID_CELL_SPAN')
      }
    })
  })

  const pos = findDirectChild(calTbl, 'pos')
  if (!pos || pos.getAttribute('treatAsChar') !== '1') {
    throw new TemplateStructureError(`montly.hwpx 템플릿 구조가 예상과 다릅니다: 달력 표의 treatAsChar가 1이 아닙니다.`, 'INVALID_POSITIONING')
  }
  if (calTbl.getAttribute('pageBreak') !== 'NONE') {
    throw new TemplateStructureError(`montly.hwpx 템플릿 구조가 예상과 다릅니다: 달력 표의 pageBreak가 NONE이 아닙니다.`, 'INVALID_PAGE_BREAK')
  }
  const vertOffset = Number(pos.getAttribute('vertOffset'))
  if (vertOffset !== 474) {
    throw new TemplateStructureError(`montly.hwpx 템플릿 구조가 예상과 다릅니다: 달력 표의 vertOffset이 474가 아니라 ${vertOffset}입니다.`, 'INVALID_POSITIONING')
  }

  const headerHeight = assertUniformRowHeight(rows[0], '달력 표 헤더 행')
  if (headerHeight !== MONTHLY_CALENDAR_EXPECTED_HEADER_HEIGHT) {
    throw new TemplateStructureError(`montly.hwpx 템플릿 구조가 예상과 다릅니다: 달력 표 헤더 행 높이가 ${MONTHLY_CALENDAR_EXPECTED_HEADER_HEIGHT}이 아니라 ${headerHeight}입니다.`, 'INVALID_ROW_HEIGHT')
  }
  const dateRowHeights = [1, 2, 3].map((i) => assertUniformRowHeight(rows[i], `달력 표 ${i}번째 날짜 행`))
  const uniqueDateHeights = [...new Set(dateRowHeights)]
  if (uniqueDateHeights.length !== 1 || uniqueDateHeights[0] !== MONTHLY_CALENDAR_EXPECTED_DATE_ROW_HEIGHT) {
    throw new TemplateStructureError(
      `montly.hwpx 템플릿 구조가 예상과 다릅니다: 달력 표 날짜 행 높이가 균일하게 ${MONTHLY_CALENDAR_EXPECTED_DATE_ROW_HEIGHT}이어야 하는데 실제는 [${dateRowHeights.join(', ')}]입니다.`,
      'INVALID_ROW_HEIGHT'
    )
  }

  const computedHeight = headerHeight + dateRowHeights.reduce((s, h) => s + h, 0)
  const sz = findDirectChild(calTbl, 'sz')
  const declaredHeight = Number(sz?.getAttribute('height'))
  if (declaredHeight !== computedHeight) {
    throw new TemplateStructureError(`montly.hwpx 템플릿 구조가 예상과 다릅니다: 달력 표 hp:sz(${declaredHeight})가 검증된 행 높이 합(${computedHeight})과 다릅니다.`, 'INVALID_TABLE_HEIGHT')
  }

  const outMargin = findDirectChild(calTbl, 'outMargin')
  const objectMarginsCalendar = Number(outMargin?.getAttribute('top') || 0) + Number(outMargin?.getAttribute('bottom') || 0)

  return { calendarHeight: computedHeight, calendarVertOffset: vertOffset, objectMarginsCalendar }
}

// "N월 N일 현재" 기준일 캡션 형식. generateMonthly는 이 패턴이 "사용자 데이터를 채우기 전"
// 문서 전체에서 정확히 1곳에서만 발견될 때만 그 노드를 기준일 표시 위치로 확정한다 — 주간의
// 보고기간 날짜와 동일한 이유(사용자 note에 우연히 같은 패턴이 있어도 덮어쓰지 않기 위해).
const MONTHLY_DATE_REGEX = /\d+월\s*\d+일\s*현재/

// montly.hwpx의 실제 구조를 코드가 가정한 것과 대조한다(파일명은 저장소의 실제 오탈자를 그대로 따름).
// 표는 위치가 아니라 semantic fingerprint(헤더 텍스트)로 식별하고, 후보가 정확히 1개가 아니면
// 즉시 던진다. 데이터 행 수는 더 이상 고정 11개를 요구하지 않는다(동적 생성 대상).
/** page budget 계산에 넘길 실측치 — 전부 검증을 통과한 값만 담긴다. */
interface MonthlyMeasurements {
  pageHeight: number
  topMargin: number
  bottomMargin: number
  fixedContentHeight: number
  projectHeaderHeight: number
  projectRowHeight: number
  calendarHeight: number
  objectMargins: number
  calendarVertOffset: number
}

/** 구조 검증을 통과한 문서에서 이후 생성 단계가 재탐색 없이 그대로 쓰는 참조·수치 묶음. */
interface MonthlyTemplateStructure {
  projTbl: XmlElement
  calTbl: XmlElement
  dataRows: ProjectRowElement[]
  dataRowTemplate: ProjectRowElement
  yearNode: XmlElement
  monthNode: XmlElement
  asOfDateNode: XmlElement
  measurements: MonthlyMeasurements
}

function assertMonthlyTemplateStructure(doc: XmlDocument): MonthlyTemplateStructure {
  const projectCandidates = findMonthlyProjectTableCandidates(doc)
  const projTbl = assertExactlyOneCandidate(projectCandidates, '프로젝트 표', 'INVALID_TABLE_LAYOUT')

  const calendarCandidates = findMonthlyCalendarTableCandidates(doc, projTbl)
  const calTbl = assertExactlyOneCandidate(calendarCandidates, '달력 표', 'INVALID_TABLE_LAYOUT')

  const projectContract = assertMonthlyProjectTableContract(projTbl)
  const calendarContract = assertMonthlyCalendarTableContract(calTbl)

  // 기준일 캡션 노드 — 사용자 데이터를 채우기 전 시점에 정확히 1곳이어야 한다.
  const asOfDateMatches = elementsOf(doc, 't').filter((t) => MONTHLY_DATE_REGEX.test(t.textContent ?? ''))
  if (asOfDateMatches.length !== 1) {
    throw new TemplateStructureError(`montly.hwpx 템플릿 구조가 예상과 다릅니다: 기준일 캡션("N월 N일 현재") 표시 위치를 정확히 하나 찾아야 하는데 ${asOfDateMatches.length}개 발견했습니다.`, 'INVALID_POSTCONDITION')
  }

  // 제목의 "NNNN년"/"N월" 텍스트 노드 — 두 표 밖(문단 흐름)에서 정확히 1곳씩이어야 한다.
  const isInsideAnyTable = (p: XmlElement) =>
    [projTbl, calTbl].some((t) => elementsOf(t, 'p').includes(p))
  const outerParas = elementsOf(doc, 'p').filter((p) => !isInsideAnyTable(p))
  const outerTs = outerParas.flatMap((p) => elementsOf(p, 't'))

  const yearMatches = outerTs.filter((t) => /^\d{4}년$/.test((t.textContent ?? '').trim()))
  if (yearMatches.length !== 1) {
    throw new TemplateStructureError(`montly.hwpx 템플릿 구조가 예상과 다릅니다: 제목의 연도 표시 위치를 정확히 하나 찾아야 하는데 ${yearMatches.length}개 발견했습니다.`, 'INVALID_TABLE_LAYOUT')
  }
  const monthMatches = outerTs.filter((t) => /^\d{1,2}월$/.test((t.textContent ?? '').trim()))
  if (monthMatches.length !== 1) {
    throw new TemplateStructureError(`montly.hwpx 템플릿 구조가 예상과 다릅니다: 제목의 월 표시 위치를 정확히 하나 찾아야 하는데 ${monthMatches.length}개 발견했습니다.`, 'INVALID_TABLE_LAYOUT')
  }

  // 표 밖 고정 콘텐츠 높이 — 표 wrapper 문단은 제외(표 자신의 높이는 별도로 계산해 중복 방지).
  let fixedContentHeight = 0
  for (const p of outerParas) {
    if (isTableWrapperParagraph(p)) continue
    fixedContentHeight += directLineHeight(p)
  }

  const pagePr = elementsOf(doc, 'pagePr')[0] ?? null
  const margin = pagePr ? elementsOf(pagePr, 'margin')[0] ?? null : null
  if (!pagePr || !margin) {
    throw new TemplateStructureError(`montly.hwpx 템플릿 구조가 예상과 다릅니다: 페이지 설정(pagePr/margin)을 찾지 못했습니다.`, 'INVALID_PAGE_GEOMETRY')
  }

  const projOutMargin = findDirectChild(projTbl, 'outMargin')
  const objectMarginsProject = Number(projOutMargin?.getAttribute('top') || 0) + Number(projOutMargin?.getAttribute('bottom') || 0)

  return {
    projTbl, calTbl,
    dataRows: projectContract.dataRows, dataRowTemplate: projectContract.dataRowTemplate,
    yearNode: yearMatches[0], monthNode: monthMatches[0], asOfDateNode: asOfDateMatches[0],
    measurements: {
      pageHeight: Number(pagePr.getAttribute('height')),
      topMargin: Number(margin.getAttribute('top')),
      bottomMargin: Number(margin.getAttribute('bottom')),
      fixedContentHeight,
      projectHeaderHeight: projectContract.headerHeight,
      projectRowHeight: projectContract.dataRowHeight,
      calendarHeight: calendarContract.calendarHeight,
      objectMargins: objectMarginsProject + calendarContract.objectMarginsCalendar,
      calendarVertOffset: calendarContract.calendarVertOffset,
    },
  }
}

// 프로젝트 표는 병합 셀이 전혀 없다(실측 확인) — 기존 데이터 행을 전부 지우고
// desiredCount(0이면 1로 취급 — 빈 행 1개는 남긴다)만큼 template 행을 복제해 다시 채운다.
function rebuildMonthlyProjectRows(
  tbl: XmlElement,
  oldDataRows: readonly ProjectRowElement[],
  template: ProjectRowElement,
  desiredCount: number
): ProjectRowCells[] {
  const n = Math.max(desiredCount, 1)
  for (const old of oldDataRows) tbl.removeChild(old)
  const newRows: ProjectRowElement[] = []
  for (let i = 0; i < n; i++) newRows.push(template.cloneNode(true))
  for (const nr of newRows) tbl.appendChild(nr)
  return newRows.map((r) => getDirectChildren(r, 'tc'))
}

// 월간 컬럼 인덱스(12열): 용역명, 발주처, 단장, 금액, 기간, 쪽수, 과업설명, 현장조사, 제출일,
// 발표/면접, 개찰일, 비고. 주간과 달리 별도의 번호(연번) 열이 없다(실측 확인 — 헤더 12칸 중
// 번호 칸 없음). 그래서 이 표에는 "번호가 입력 순서와 일치"라는 검증 항목이 적용되지 않는다
// — 대신 "입력 순서 그대로 배치"만 확인한다.
const MONTHLY_PROJECT_IDX = {
  name: 0, client: 1, chief: 2, fee: 3, period: 4, pages: 5,
  taskDesc: 6, siteCheck: 7, submit: 8, interview: 9, bid: 10, note: 11,
} as const

/** 요청 본문(JSON, 타입 보증 없음)에서 읽는 월간 프로젝트 한 건의 원본 형태. */
interface MonthlyProjectInput {
  name?: unknown
  director?: unknown
  fee?: unknown
  submit_date?: unknown
  interview_date?: unknown
  result_date?: unknown
  note?: unknown
}

/** 셀에 그대로 넣을 수 있게 문자열로 확정된 한 건. 표 채우기·사후 검증이 둘 다 이걸 쓴다. */
interface MonthlyProjectRow {
  name: string
  director: string
  fee: string
  submitDate: string
  interviewDate: string
  resultDate: string
  note: string
}

// 기존 동작(`p.field || ''`)과 정확히 같은 의미 — falsy면 빈 문자열.
function toReportText(value: unknown): string {
  return value ? String(value) : ''
}

// 요청 본문 → 확정 타입. unknown을 받아 이 한 곳에서만 좁히고, 이후 단계로 any를 넘기지 않는다.
function normalizeMonthlyProjects(performing: unknown): MonthlyProjectRow[] {
  const list: unknown[] = Array.isArray(performing) ? performing : []
  return list.map((raw) => {
    const p: MonthlyProjectInput = typeof raw === 'object' && raw !== null ? raw : {}
    return {
      name: formatProjectNameForReport(toReportText(p.name)),
      director: toReportText(p.director),
      fee: p.fee != null ? String(p.fee) : '',
      submitDate: toReportText(p.submit_date),
      interviewDate: toReportText(p.interview_date),
      resultDate: toReportText(p.result_date),
      note: toReportText(p.note),
    }
  })
}

// 한 데이터 행의 12개 열에 들어갈 값을 확정한다. 기록(fill)과 사후 검증(postcondition)이 둘 다
// 이 함수 하나만 쓰기 때문에 "쓴 값"과 "검사하는 값"이 어긋날 수 없다.
// project가 undefined면(0건 정책의 빈 행) 12칸 모두 빈 문자열이다.
// 의도적으로 빈 열: 발주처·기간(개월)·쪽수·과업설명도서열람·현장조사 — 현재 입력 폼에 대응하는
// 항목이 없어 비워 둔다. 월간 표에는 연번(번호) 열이 아예 없다(헤더 12칸 실측 확인).
function expectedMonthlyRowTexts(project: MonthlyProjectRow | undefined): string[] {
  const IDX = MONTHLY_PROJECT_IDX
  const values: string[] = Array.from({ length: 12 }, () => '')
  if (!project) return values
  values[IDX.name] = project.name
  values[IDX.chief] = project.director
  values[IDX.fee] = project.fee
  values[IDX.submit] = project.submitDate
  values[IDX.interview] = project.interviewDate
  values[IDX.bid] = project.resultDate
  values[IDX.note] = project.note
  return values
}

function fillMonthlyProjectRows(dataRows: readonly ProjectRowCells[], projects: readonly MonthlyProjectRow[]): void {
  for (let i = 0; i < dataRows.length; i++) {
    const cells = dataRows[i]
    if (cells.length !== 12) {
      throw new TemplateStructureError(
        `montly.hwpx 템플릿 구조가 예상과 다릅니다: ${i}번째 데이터 행의 셀 수가 12가 아니라 ${cells.length}입니다.`,
        'INVALID_TABLE_LAYOUT'
      )
    }
    const values = expectedMonthlyRowTexts(projects[i])
    cells.forEach((tc, colIdx) => {
      replaceMonthlyCellText(tc, values[colIdx], `${i}번째 데이터 행 ${colIdx}열`)
    })
  }
}

// zip.updateFile 이전에 실행하는 최종 사후 검증 — 하나라도 어긋나면 잘못된 문서를 내보내지
// 않고 던진다.
function assertMonthlyPostcondition(projTbl: XmlElement, projects: readonly MonthlyProjectRow[]): void {
  const rows = getDirectChildren(projTbl, 'tr')
  const dataRows = rows.slice(1)
  const expectedDataRowCount = Math.max(projects.length, 1)
  if (dataRows.length !== expectedDataRowCount) {
    throw new TemplateStructureError(`생성된 문서의 데이터 행 수(${dataRows.length})가 기대값(${expectedDataRowCount})과 다릅니다.`, 'INVALID_POSTCONDITION')
  }
  const declaredRowCnt = Number(projTbl.getAttribute('rowCnt'))
  if (declaredRowCnt !== rows.length) {
    throw new TemplateStructureError(`생성된 문서의 rowCnt(${declaredRowCnt})가 실제 행 수(${rows.length})와 다릅니다.`, 'INVALID_POSTCONDITION')
  }

  rows.forEach((tr, rowIdx) => {
    const cells = getDirectChildren(tr, 'tc')
    if (cells.length !== 12) {
      throw new TemplateStructureError(`생성된 문서의 ${rowIdx}행 셀 수가 12가 아니라 ${cells.length}입니다.`, 'INVALID_POSTCONDITION')
    }
    cells.forEach((tc, colIdx) => {
      const addr = getCellAddr(tc)
      if (!addr || addr.rowAddr !== rowIdx || addr.colAddr !== colIdx) {
        throw new TemplateStructureError(`생성된 문서의 ${rowIdx}행 ${colIdx}열 주소가 위치와 일치하지 않습니다.`, 'INVALID_POSTCONDITION')
      }
      const span = getCellSpanOf(tc)
      if (!span || span.colSpan !== 1 || span.rowSpan !== 1) {
        throw new TemplateStructureError(`생성된 문서의 ${rowIdx}행 ${colIdx}열의 span이 1x1이 아닙니다.`, 'INVALID_POSTCONDITION')
      }
    })
  })

  const dataHeights: number[] = dataRows.map((tr) => {
    const heights = getDirectChildren(tr, 'tc').map((tc) => getCellHeightOf(tc))
    return new Set(heights).size === 1 ? Number(heights[0]) : NaN
  })
  if (dataHeights.some((h) => Number.isNaN(h)) || new Set(dataHeights).size > 1) {
    throw new TemplateStructureError(`생성된 문서의 데이터 행 높이가 균일하지 않습니다(실제: [${dataHeights.join(', ')}]).`, 'INVALID_POSTCONDITION')
  }
  const headerHeight = monthlyRowHeight(rows[0])
  const computedHeight = headerHeight + dataHeights.reduce((s, h) => s + h, 0)
  const sz = findDirectChild(projTbl, 'sz')
  const declaredHeight = Number(sz?.getAttribute('height'))
  if (declaredHeight !== computedHeight) {
    throw new TemplateStructureError(`생성된 문서의 hp:sz(${declaredHeight})가 실제 행 높이 합(${computedHeight})과 다릅니다.`, 'INVALID_POSTCONDITION')
  }

  // 프로젝트명만 보지 않고 12개 직계 셀 전체 텍스트를 기대값과 정확히 비교한다.
  // readMonthlyCellText는 문단 안의 모든 hp:t를 이어붙이고 여러 문단은 개행으로 잇기 때문에,
  // 첫 hp:t만 갱신되고 뒤에 잔존 텍스트가 남은 경우도 여기서 불일치로 드러난다.
  // 빈 행(0건 정책)도 12칸 전부 빈 값인지 같은 방식으로 확인한다.
  dataRows.forEach((tr, i) => {
    const cells = getDirectChildren(tr, 'tc')
    const expected = expectedMonthlyRowTexts(projects[i])
    cells.forEach((tc, colIdx) => {
      const actual = readMonthlyCellText(tc)
      if (actual !== expected[colIdx]) {
        throw new TemplateStructureError(
          `생성된 문서의 ${i}번째 데이터 행 ${colIdx}열 텍스트가 기대값과 다릅니다: 실제=${JSON.stringify(actual)} 기대=${JSON.stringify(expected[colIdx])}.`,
          'INVALID_POSTCONDITION'
        )
      }
    })
  })
}

// ── Monthly HWPX 생성 ─────────────────────────────────────────────────────────
interface MonthlyGenerationRequest {
  performing: unknown
  reportYear: unknown
  reportMonth: unknown
  asOfDate?: unknown
}

// 템플릿을 경로가 아니라 이미 읽은 버퍼로 받는다 — 호출자(POST)가 파일 읽기를 담당하므로
// 테스트가 변형된 템플릿을 주입할 때 실제 파일을 건드릴 필요가 없다(Weekly는 기존 경로 방식 유지).
async function generateMonthly(
  templateBuffer: Buffer,
  data: MonthlyGenerationRequest
): Promise<Buffer> {
  // 날짜 계약 해석과 입력 정규화는 ZIP을 열기 전에 먼저 한다 — 요청 자체가 잘못됐다면 템플릿을
  // 읽을 필요조차 없다(순서: 요청 검증 → 날짜 계약 → ZIP/XML 파싱 → 구조 검증 → ...).
  const reportDate: MonthlyReportDate = parseMonthlyReportDate({
    reportYear: data.reportYear, reportMonth: data.reportMonth, asOfDate: data.asOfDate,
  })
  const projects: MonthlyProjectRow[] = normalizeMonthlyProjects(data.performing)

  // 제한 1 — 수동 검증된 최대 건수. 아래 page budget 검사와 별개이며 먼저 판정한다.
  // 산술 예산에는 들어도(예: renderSafetyReserve를 줄이면 24건도 계산상 들어간다) 사람이 한글로
  // 확인하지 않은 범위의 문서는 만들지 않는다. 템플릿을 읽기도 전에 걸러낸다.
  if (projects.length > MONTHLY_VERIFIED_MAX_PROJECT_COUNT) {
    console.error('[Monthly HWPX Max Project Count Exceeded]', {
      code: MONTHLY_MAX_PROJECT_COUNT_EXCEEDED_CODE,
      actual: projects.length, verifiedMax: MONTHLY_VERIFIED_MAX_PROJECT_COUNT,
    })
    throw new MonthlyProjectCountExceededError(formatMonthlyMaxProjectCountExceededMessage(projects.length))
  }

  const AdmZip = (await import('adm-zip')).default
  const { DOMParser, XMLSerializer } = await import('@xmldom/xmldom')

  const zip = new AdmZip(templateBuffer)
  const xml = zip.readAsText('Contents/section0.xml')
  const doc = toXmlDocument(new DOMParser().parseFromString(xml, 'text/xml'))

  const structure = assertMonthlyTemplateStructure(doc)

  // 제한 2 — 템플릿 실측치 기반 높이 예산. 위 최대 건수 정책과 합치지 않는다: 최대 건수 이내라도
  // 템플릿이 바뀌어(고정 콘텐츠 증가 등) 예산이 안 맞으면 여기서 별도 사유로 거절해야 한다.
  // 행을 실제로 만들거나 데이터를 채우기 전에 판정한다. renderSafetyReserve는 한글 수동 경계
  // 검증(0/13/20/23건)으로 확정된 값 — 근거는 lib/hwpx/monthlyPageBudget.ts 주석 참고.
  const budget = estimateMonthlyPageBudget({
    pageHeight: structure.measurements.pageHeight,
    topMargin: structure.measurements.topMargin,
    bottomMargin: structure.measurements.bottomMargin,
    fixedContentHeight: structure.measurements.fixedContentHeight,
    projectHeaderHeight: structure.measurements.projectHeaderHeight,
    projectRowHeight: structure.measurements.projectRowHeight,
    projectRowCount: projects.length,
    calendarHeight: structure.measurements.calendarHeight,
    objectMargins: structure.measurements.objectMargins,
    calendarVertOffset: structure.measurements.calendarVertOffset,
    renderSafetyReserve: MONTHLY_RENDER_SAFETY_RESERVE,
  } satisfies MonthlyPageBudgetInput)
  if (!budget.fits) {
    console.error('[Monthly HWPX Page Budget Exceeded]', { projectCount: projects.length, ...budget })
    throw new PageBudgetExceededError(MONTHLY_PAGE_BUDGET_EXCEEDED_MESSAGE)
  }

  // 프로젝트 표를 실제 건수에 맞춰 재구성 — rowAddr·rowCnt·표 높이까지 함께 갱신.
  const newDataRows = rebuildMonthlyProjectRows(structure.projTbl, structure.dataRows, structure.dataRowTemplate, projects.length)
  renumberMonthlyRowAddr(structure.projTbl)
  structure.projTbl.setAttribute('rowCnt', String(getDirectChildren(structure.projTbl, 'tr').length))
  setMonthlyTableHeight(structure.projTbl, sumMonthlyRowHeights(structure.projTbl))

  fillMonthlyProjectRows(newDataRows, projects)

  // 제목의 연·월, 기준일 캡션 — assertMonthlyTemplateStructure가 데이터 채우기 전에 미리
  // 특정해 둔 노드만 갱신한다(전체 문서 재검색 없음 — note 등 사용자 데이터를 건드리지 않는다).
  structure.yearNode.textContent = `${reportDate.reportYear}년`
  structure.monthNode.textContent = ` ${reportDate.reportMonth}월 `
  structure.asOfDateNode.textContent = formatMonthlyAsOfCaption(reportDate)

  // zip.updateFile로 실제 파일을 갱신하기 전에 마지막으로 결과 문서 자체를 검증한다.
  assertMonthlyPostcondition(structure.projTbl, projects)

  removeLinesegarray(doc)

  zip.updateFile('Contents/section0.xml', Buffer.from(new XMLSerializer().serializeToString(doc), 'utf8'))

  return zip.toBuffer()
}

// ── Route Handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { type = 'weekly', week, performing = [], expected = [], meta, reportYear, reportMonth, asOfDate } = body

    // 입력 수량 검증 — Weekly는 기존 동작 그대로(상태값 검증). Monthly는 고정 행수 제한을
    // 두지 않는다 — 아래 generateMonthly 내부의 날짜 계약 검증 + page budget 검증이 그 역할을
    // 대신한다(고정 11건 제한은 실사용 건수를 못 담아 동적 생성으로 전환한 것과 같은 이유).
    if (type !== 'monthly') {
      const violations = validateWeeklyCapacity(performing)
      if (violations.length > 0) {
        return NextResponse.json({ error: formatCapacityViolations(violations) }, { status: 400 })
      }
    }

    const templatesDir = path.join(process.cwd(), 'lib', 'templates')
    const templateFile = type === 'monthly' ? 'montly.hwpx' : 'weekly.hwpx'
    const templatePath = path.join(templatesDir, templateFile)

    if (!fs.existsSync(templatePath)) {
      return NextResponse.json({ error: `템플릿 파일 없음: ${templateFile}` }, { status: 500 })
    }

    let buffer: Buffer
    let reportDateForFilename: MonthlyReportDate | null = null
    try {
      if (type === 'monthly') {
        buffer = await generateMonthly(fs.readFileSync(templatePath), { performing, reportYear, reportMonth, asOfDate })
        reportDateForFilename = parseMonthlyReportDate({ reportYear, reportMonth, asOfDate })
      } else {
        buffer = await generateWeekly(templatePath, { week, performing, expected, meta })
      }
    } catch (err: unknown) {
      if (err instanceof InvalidMonthlyReportDateError) {
        return NextResponse.json({ error: err.message }, { status: 400 })
      }
      if (err instanceof TemplateStructureError) {
        console.error('[HWPX Template Structure Error]', err)
        return NextResponse.json(
          { error: '문서 양식이 예상 구조와 달라 생성할 수 없습니다. 관리자에게 문의하세요.' },
          { status: 500 }
        )
      }
      // 최대 건수 정책 위반과 높이 예산 초과는 둘 다 400이지만 사유가 다르다 — 코드를 함께
      // 실어 클라이언트·로그에서 구분할 수 있게 한다.
      if (err instanceof MonthlyProjectCountExceededError) {
        return NextResponse.json({ error: err.message, code: err.code }, { status: 400 })
      }
      if (err instanceof PageBudgetExceededError) {
        return NextResponse.json({ error: err.message }, { status: 400 })
      }
      throw err
    }

    const filename = type === 'monthly' && reportDateForFilename
      ? formatMonthlyFilename(reportDateForFilename)
      : `미래사업팀_주간업무_${week}.hwpx`

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    })
  } catch (err: unknown) {
    console.error('[HWPX API Error]', err)
    return NextResponse.json({ error: '문서 생성 중 오류가 발생했습니다.' }, { status: 500 })
  }
}
