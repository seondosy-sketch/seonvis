// 월간 HWPX 상단 프로젝트 현황표의 셀 값 포맷터 — 순수 함수, XML을 다루지 않는다.
//
// 표현 기준은 CM본부월업무계획(7.24).hwpx 실측이다:
//   용역명   "2647_26-A-00부대(A138)"   (관리번호_정제명)
//   발주처   "국군재정"                  ← 기준 파일은 수동 축약이지만 우리는 원문을 그대로 쓴다
//   금액     "18.1" "75.6" "126.9"       유효 소수점만 남긴다(115.44는 잘리지 않는다)
//   기간     "29" "40" "11.6"            개월 수
//   쪽수     "제안서 12P" "제안서 50PPT별도" "-"
//   과업설명·도서열람 / 현장조사          "7/7" "-"   ← 대응 필드가 없어 항상 "-"
//   제출일   "7/15"                      제출 charPr(빨강)
//   발표/면접 "7/23" "~8/10"             면접 charPr(초록)
//   개찰일   "7/28"                      개찰 charPr(파랑)
//   비고     "4(2.5+1.5)" "30(20+10)" "3"  ← score_dist
//
// 값이 없는 칸은 빈칸이 아니라 EMPTY_CELL("-")이다(기준 파일 실측).

/** 값이 없는 칸에 넣는 문자. 기준 파일이 빈칸 대신 "-"를 쓴다. */
export const EMPTY_CELL = '-'

/** 과업설명·도서열람 / 현장조사 — Project List에 대응 필드가 없어 항상 "-"로 출력한다. */
export const NO_FIELD_CELL = EMPTY_CELL

function trimText(value: unknown): string {
  if (value == null) return ''
  return String(value).trim()
}

/** 빈 값을 "-"로 바꾼다. */
export function orEmptyCell(value: unknown): string {
  const s = trimText(value)
  return s === '' ? EMPTY_CELL : s
}

// ── 금액(억원) ────────────────────────────────────────────────────────────────
//
// projects.fee는 numeric(10,2)이라 "75.60" "126.90" "115.44"처럼 소수 2자리로 온다.
// 원 단위가 아니므로 억으로 환산하지 않는다(실측 확인). 뒤따르는 0만 정리해서
// 75.60 → "75.6", 126.90 → "126.9", 115.44 → "115.44"로 만든다.

export function formatMonthlyFee(fee: unknown): string {
  const s = trimText(fee)
  if (s === '') return EMPTY_CELL
  if (!/^-?\d+(\.\d+)?$/.test(s)) return s // 숫자로 해석 불가한 값은 원문 유지
  if (!s.includes('.')) return s
  const trimmed = s.replace(/0+$/, '').replace(/\.$/, '')
  return trimmed === '' || trimmed === '-' ? EMPTY_CELL : trimmed
}

// ── 기간(개월) ────────────────────────────────────────────────────────────────
//
// projects.duration_days는 컬럼명과 달리 운영상 개월 수를 담는다(확정사항). 값 형식이
// 뒤섞여 있어("54" "40.6" "11.6개월") 숫자만 남긴다. 일수를 개월로 환산하지 않는다.

export function formatMonthlyDurationMonths(duration: unknown): string {
  const s = trimText(duration)
  if (s === '') return EMPTY_CELL
  const m = /-?\d+(?:\.\d+)?/.exec(s)
  if (!m) return s // 숫자가 전혀 없으면 원문 유지
  return formatMonthlyFee(m[0])
}

// ── 쪽수 ─────────────────────────────────────────────────────────────────────
//
// project_tooltips의 세 필드를 조합한다. 규칙(확정사항):
//   proposal_p "PPT 대체" + ppt_p "20p"  →  "PPT 20p"        (PPT 표현 중복 제거)
//   proposal_p "PPT 대체" + ppt_p 없음    →  "PPT 대체"
//   proposal_p "25P"      + ppt_p "별도"  →  "제안서 25P PPT 별도"
//   self_intro_p "각 2p"                 →  별도 줄 "자소서 각 2p"
// 같은 라벨(제안서/자소서/PPT)이 두 번 나오지 않게 하고, 행 높이가 불필요하게 커지지 않도록
// 자소서만 줄을 나눈다(제안서·PPT는 한 문단에 두고 셀 폭에서 자연 줄바꿈 — 기준 파일과 같은 방식).

const PPT_ALIASES = ['PPT', 'ppt', '발표자료'] as const
const SELF_INTRO_ALIASES = ['자소서', '자기소개서'] as const

function labelUnlessPresent(value: string, label: string, aliases: readonly string[]): string {
  return aliases.some((a) => value.includes(a)) ? value : `${label} ${value}`
}

export function formatMonthlyPages(
  proposalP: unknown, selfIntroP: unknown, pptP: unknown
): string {
  const proposal = trimText(proposalP)
  const selfIntro = trimText(selfIntroP)
  const ppt = trimText(pptP)

  const proposalIsPptStatement = proposal !== '' && PPT_ALIASES.some((a) => proposal.includes(a))

  // 첫 줄 — 제안서/PPT. proposal_p 자체가 PPT 이야기면 PPT 쪽으로만 표기한다.
  const first: string[] = []
  if (proposalIsPptStatement) {
    // ppt_p에 구체적인 쪽수가 있으면 그것이 더 정확하다 — "PPT 대체"는 버린다.
    first.push(ppt !== '' ? labelUnlessPresent(ppt, 'PPT', PPT_ALIASES) : proposal)
  } else {
    if (proposal !== '') first.push(labelUnlessPresent(proposal, '제안서', ['제안서']))
    if (ppt !== '') first.push(labelUnlessPresent(ppt, 'PPT', PPT_ALIASES))
  }

  const lines: string[] = []
  if (first.length > 0) lines.push(first.join(' '))
  if (selfIntro !== '') lines.push(labelUnlessPresent(selfIntro, '자소서', SELF_INTRO_ALIASES))

  return lines.length === 0 ? EMPTY_CELL : lines.join('\n')
}

// ── 날짜 ─────────────────────────────────────────────────────────────────────
//
// 같은 연도면 "M/D", 다른 연도면 "YY.M/D"(예: 2027-01-05 → "27.1/5")로 연도를 밝힌다.

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export interface YmdParts { year: number; month: number; day: number }

/** "YYYY-MM-DD"를 파싱한다. 형식이 아니거나 실제 날짜가 아니면 null. */
export function parseIsoDate(value: unknown): YmdParts | null {
  const s = trimText(value)
  const m = ISO_DATE_RE.exec(s)
  if (!m) return null
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3])
  if (month < 1 || month > 12) return null
  const last = new Date(year, month, 0).getDate()
  if (day < 1 || day > last) return null
  return { year, month, day }
}

/** ISO 날짜를 셀 표기로 바꾼다. baseYear와 연도가 같으면 "M/D", 다르면 "YY.M/D". */
export function formatMonthlyDate(value: unknown, baseYear: number): string {
  const d = parseIsoDate(value)
  if (!d) {
    // ISO가 아니면 이미 사람이 넣은 표기(예: "~8/10", "추후")일 수 있으므로 원문을 살린다.
    return orEmptyCell(value)
  }
  const md = `${d.month}/${d.day}`
  if (d.year === baseYear) return md
  return `${String(d.year % 100).padStart(2, '0')}.${md}`
}

// ── 발표/면접 ────────────────────────────────────────────────────────────────
//
// projects.interview_date는 date 하나뿐이고 발표와 면접을 구분하지 않는다(확정사항).
// 서면평가 여부는 projects.interview_written(boolean)이 정식 출처이며, 그 값이 없는 옛 요청은
// 날짜가 없을 때만 project_tooltips.interview_time의 "서면평가"/"추후"를 대신 쓴다.

export const WRITTEN_EVALUATION = '서면평가'
export const UNDECIDED = '추후'

export function formatMonthlyInterview(
  interviewDate: unknown, interviewTime: unknown, baseYear: number, written = false
): string {
  // 서면평가는 애초에 발표일이 없는 건이라 날짜보다 먼저 판정한다.
  if (written) return WRITTEN_EVALUATION

  const d = parseIsoDate(interviewDate)
  if (d) return formatMonthlyDate(interviewDate, baseYear)

  const raw = trimText(interviewDate)
  if (raw !== '') return raw // ISO는 아니지만 사람이 넣은 표기가 있으면 살린다

  const time = trimText(interviewTime)
  if (time.includes(WRITTEN_EVALUATION)) return WRITTEN_EVALUATION
  if (time.includes(UNDECIDED)) return UNDECIDED
  return EMPTY_CELL
}

// ── 개찰일(낙찰자) ───────────────────────────────────────────────────────────
//
// 개찰 결과(projects.evaluation)가 있으면 날짜 뒤에 괄호로 붙인다.

export function formatMonthlyBid(
  bidDate: unknown, evaluation: unknown, baseYear: number
): string {
  const dateText = formatMonthlyDate(bidDate, baseYear)
  const winner = trimText(evaluation)
  if (winner === '') return dateText
  if (dateText === EMPTY_CELL) return `(${winner})`
  return `${dateText}(${winner})`
}

// ── 비고 ─────────────────────────────────────────────────────────────────────
//
// score_dist를 최우선으로 쓰고, 없으면 분야별 기술인, 그다음 note를 쓴다.
// 여러 항목을 한 셀에 병기하지 않는다(확정사항).

export interface MonthlyNoteSource {
  scoreDist?: unknown
  staffArch?: unknown
  staffCivil?: unknown
  staffMech?: unknown
  staffSafety?: unknown
  note?: unknown
}

const STAFF_FIELDS: ReadonlyArray<{ key: keyof MonthlyNoteSource; label: string }> = [
  { key: 'staffArch', label: '건축' },
  { key: 'staffCivil', label: '토목' },
  { key: 'staffMech', label: '기계' },
  { key: 'staffSafety', label: '안전' },
]

/** 분야별 기술인을 "-건축 홍길동 -토목 김철수" 형태로 만든다. 없으면 빈 문자열. */
export function formatMonthlyStaff(source: MonthlyNoteSource): string {
  return STAFF_FIELDS
    .map(({ key, label }) => {
      const v = trimText(source[key])
      return v === '' ? '' : `-${label} ${v}`
    })
    .filter((s) => s !== '')
    .join(' ')
}

export function formatMonthlyNote(source: MonthlyNoteSource): string {
  const score = trimText(source.scoreDist)
  if (score !== '') return score
  const staff = formatMonthlyStaff(source)
  if (staff !== '') return staff
  return orEmptyCell(source.note)
}

// ── 용역명 ───────────────────────────────────────────────────────────────────
//
// 상단표는 "관리번호_정제명". 관리번호가 없으면 정제명만 쓴다. 정제는 호출부가
// formatProjectNameForReport()로 미리 끝낸 값을 넘긴다(달력과 같은 정제 함수를 공유).

export function formatMonthlyProjectTitle(projectNumber: unknown, formattedName: unknown): string {
  const num = trimText(projectNumber)
  const name = trimText(formattedName)
  if (name === '') return num === '' ? EMPTY_CELL : num
  return num === '' ? name : `${num}_${name}`
}

// ── 여는 괄호 앞 공백 정리 (월간 전용 후처리) ────────────────────────────────
//
// formatProjectNameForReport()는 제거 문구를 공백으로 바꾸기 때문에
// "26-A-00부대 건설사업관리용역(A166)" → "26-A-00부대 (A166)"처럼 괄호 앞 공백이 남는다.
// 그 함수는 Weekly도 함께 쓰므로 고치지 않고, 월간 출력에서만 이 후처리를 적용한다.
// 원래부터 공백이 있는 정상 표기(예: "센터 (신축)")까지 붙이지 않도록, 제거 대상은
// "공백 + 여는 괄호" 조합뿐이며 괄호 안 내용은 손대지 않는다.

const SPACE_BEFORE_OPEN_PAREN = /[ \t ]+(?=[(［(])/g

export function stripSpaceBeforeParen(name: string): string {
  return name.replace(SPACE_BEFORE_OPEN_PAREN, '')
}
