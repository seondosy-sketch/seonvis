/**
 * 평가 DB — HWP/HWPX 면접후기 문서를 후기 초안으로 바꾸는 순수 로직.
 *
 * 회사의 면접후기는 원래 HWP 문서로 쓰인다. 그 문서를 사람이 화면에 다시 옮겨 적지 않게 하려고
 * 문서에서 읽어낼 수 있는 값만 뽑아 등록 폼의 초기값(초안)으로 만든다.
 *
 * ⚠ 이 파서의 결과는 **초안일 뿐 정답이 아니다.** 그래서 곧바로 DB에 저장하지 않고 등록 폼에
 * 채워서 사람이 확인·수정한 뒤 저장한다(app/(dashboard)/interviews/page.tsx). 문서 서식이 연도마다
 * 다르고 과거 자료는 표가 아니라 줄글로 적힌 것도 있어서, 자동 저장은 틀린 값을 조용히 DB에
 * 남기기 때문이다.
 *
 * 원칙:
 *   - 못 읽은 값은 추측하지 않고 비워 둔다. 라벨은 봤지만 무슨 항목인지 모르면
 *     unmatched_labels에 담아 화면이 "직접 확인하세요"라고 알릴 수 있게 한다.
 *   - 질의분류(주제)는 아예 추론하지 않는다 — 사용자가 추측해 넣은 값이 정식 분류축이 되는 것을
 *     막는 것이 이 기능의 정책이다(lib/evaluations/types.ts 주석 참고). 호출부가 '미지정'을 넣는다.
 *   - 질의그룹은 문서에 실제로 적힌 머리말(단장/안전/책임기술자 질의 …)에서만 뽑는다.
 *   - 평가일에 연도만 있으면 가짜 월·일을 만들지 않고 evaluation_year로 남긴다.
 *
 * 이 파일은 DB에 접근하지 않고 kordoc에도 의존하지 않는다(아래 ParsedBlock 모양만 받는다).
 * 마스터 id 연결(평가유형·질의그룹·프로젝트·기술인)은 lib/evaluations/importSeed.ts가 한다.
 */

// ── 입력 모양 ──────────────────────────────────────────────────────────────────
// kordoc parse()의 IRBlock 중 이 파서가 실제로 쓰는 필드만 추렸다. 구조적으로 IRBlock을 그대로
// 넣을 수 있고, 테스트는 kordoc 없이 이 모양만 만들어 넣는다.

export interface ParsedCell {
  text: string
}

export interface ParsedTable {
  cells: ParsedCell[][]
}

export interface ParsedBlock {
  type: string
  text?: string
  table?: ParsedTable
}

// ── 출력 모양 ──────────────────────────────────────────────────────────────────

export interface ImportedAttendee {
  name: string
  /** 후기에 적힌 역할 원문(단장/안전/수행 …). 표준화하지 않는다. */
  role: string
}

export interface ImportedQuestionGroup {
  /** 질의그룹 표준 이름(책임/건축/안전/토목/기계/전기/공통/타사/기타) — 모르면 null. */
  role_name: string | null
  questions: string[]
}

export interface ImportedReviewDraft {
  /**
   * 문서 제목 원문("345kV 신석문변전소 면접후기"처럼 맨 위 한 줄).
   * 실제 후기 문서에는 평가유형 칸이 없고 제목에만 "면접후기"라고 적혀 있어서, 호출부가 이
   * 제목에서 평가유형을 찾아본다(lib/evaluations/importSeed.ts).
   */
  document_title: string
  /** 문서에 적힌 평가유형 원문('면접', 'T P', 'SOQ' 등). 표준 유형 연결은 호출부가 한다. */
  evaluation_type_source: string
  client: string
  project_name: string
  facility_type: string
  /** YYYY-MM-DD. 연도만 아는 문서는 null이고 evaluation_year가 채워진다. */
  evaluation_date: string | null
  evaluation_year: number | null
  /** "13:30~" 같은 원문 표기 그대로. */
  evaluation_time: string
  location: string
  evaluator_count: number | null
  participant_company_count: number | null
  presentation_order: number | null
  participant_companies: string
  evaluation_method: string
  special_notes: string
  attendees: ImportedAttendee[]
  groups: ImportedQuestionGroup[]
  /** 문서에 있었지만 어느 항목인지 모른 라벨. 값을 버렸다는 사실을 화면에 알리는 용도. */
  unmatched_labels: string[]
}

/** 이 파서가 다루는 항목 키. */
type Field =
  | 'type' | 'client' | 'project' | 'facility' | 'datetime' | 'location'
  | 'attendees' | 'companies' | 'evaluators' | 'order' | 'method' | 'notes'
  /** 실제질의 — 표 한 칸에 질문 전체가 들어 있는 서식(실제 후기 문서가 이 모양이다). */
  | 'questions'

/**
 * 라벨 사전. 공백을 지운 형태로 비교한다 — HWP는 "발 주 처", "일   시"처럼 글자 사이를 벌려
 * 적는 경우가 많다.
 *
 * 같은 항목에 여러 표기를 넣어 둔 이유는 문서 서식이 연도·작성자마다 다르기 때문이다.
 * 사전에 없는 라벨은 추측하지 않고 unmatched_labels로 넘긴다.
 */

/** 실제질의 라벨/머리말 — 표 라벨로도 쓰이고 줄글 머리말로도 쓰이므로 한 곳에 둔다. */
const QUESTION_KEYS: readonly string[] = [
  '실제질의', '실제질의응답', '주요질의내용', '주요질의', '질의응답', '질의내용',
  '질문내용', '질의사항', '질의답변', '질의',
]
const METHOD_KEYS: readonly string[] = [
  '면접방법', '면접방식', '진행방법', '진행방식', '진행절차', '평가방법', '평가방식',
  '심사방법', '발표방법',
]
const NOTES_KEYS: readonly string[] = ['특이사항', '참고사항', '기타사항', '비고']

/**
 * 라벨 사전. 공백을 지운 형태로 비교한다 — 실제 후기 문서는 "발 주 처", "일    시"처럼
 * 글자 사이를 벌려 적는다.
 *
 * ⚠ '구분'·'유형'·'내용'처럼 표 머리글로 흔한 낱말은 넣지 않는다. 실제 후기 표의 머리행이
 * `구 분 | 내 용`이라서, 그것을 항목 라벨로 인정하면 머리행 값("내 용")이 평가유형으로
 * 저장돼 버린다. 라벨은 뜻이 분명한 표기만 받는다(IGNORED_LABELS 참고).
 */
const LABELS: ReadonlyArray<{ field: Field; keys: readonly string[] }> = [
  { field: 'type', keys: ['평가유형', '평가구분', '평가자료'] },
  { field: 'client', keys: ['발주처', '발주기관', '발주청', '발주자', '발주'] },
  { field: 'project', keys: ['용역명', '사업명', '공사명', '과업명', '프로젝트명', '대상사업', '용역'] },
  { field: 'facility', keys: ['시설용도', '시설물용도', '시설구분', '용도'] },
  { field: 'datetime', keys: ['일시', '일자', '날짜', '평가일시', '평가일', '면접일시', '면접일', '발표일', '심사일'] },
  { field: 'location', keys: ['장소', '평가장소', '면접장소', '발표장소', '위치'] },
  { field: 'attendees', keys: ['참석자', '참석', '참석인원', '참석기술인', '참여기술인', '참가자', '참석위원'] },
  { field: 'companies', keys: ['참가업체', '참여업체', '참가사', '경쟁업체', '참가업체수', '업체'] },
  { field: 'evaluators', keys: ['면접관', '면접위원', '평가위원', '평가위원수', '심사위원', '심의위원'] },
  { field: 'order', keys: ['발표순서', '발표순번', '면접순서', '순서', '순번'] },
  { field: 'method', keys: METHOD_KEYS },
  { field: 'notes', keys: NOTES_KEYS },
  { field: 'questions', keys: QUESTION_KEYS },
]

/**
 * 표 머리글로 흔해서 항목 라벨로 보지 않는 낱말. 사전에 없다고 "읽지 못한 항목"으로 알리지도
 * 않는다 — 머리행은 값이 아니기 때문이다.
 */
const IGNORED_LABELS: readonly string[] = ['구분', '내용', '항목', '번호', '연번']

/** 줄글 문서에서 "여기부터 이 항목"을 뜻하는 머리말. */
type Section = 'none' | 'method' | 'notes' | 'questions'

const SECTION_HEADERS: ReadonlyArray<{ section: Section; keys: readonly string[] }> = [
  { section: 'questions', keys: QUESTION_KEYS },
  { section: 'method', keys: METHOD_KEYS },
  { section: 'notes', keys: NOTES_KEYS },
]

/**
 * 질의그룹 표준 이름 매핑. 왼쪽이 문서에 적히는 표기, 오른쪽이 evaluation_roles의 이름이다.
 * 긴 표기를 먼저 검사한다('기계설비'가 '기계'보다 앞).
 *
 * '단장'은 면접에서 책임기술자가 맡으므로 '책임'으로 본다 — 다만 참석자 역할(attendee_role)에는
 * 문서에 적힌 '단장'을 그대로 남긴다(두 값의 용도가 다르다).
 */
const ROLE_KEYWORDS: ReadonlyArray<{ keyword: string; name: string }> = [
  { keyword: '책임기술자', name: '책임' },
  { keyword: '책임기술인', name: '책임' },
  { keyword: '기계설비', name: '기계' },
  { keyword: '전기통신', name: '전기' },
  { keyword: '안전관리', name: '안전' },
  { keyword: '타업체', name: '타사' },
  { keyword: '책임', name: '책임' },
  { keyword: '단장', name: '책임' },
  { keyword: '총괄', name: '책임' },
  { keyword: '건축', name: '건축' },
  { keyword: '안전', name: '안전' },
  { keyword: '토목', name: '토목' },
  { keyword: '기계', name: '기계' },
  { keyword: '설비', name: '기계' },
  { keyword: '전기', name: '전기' },
  { keyword: '통신', name: '전기' },
  { keyword: '공통', name: '공통' },
  { keyword: '전체', name: '공통' },
  { keyword: '타사', name: '타사' },
  { keyword: '기타', name: '기타' },
]

/**
 * 표의 "질문" 열을 찾을 때 쓰는 머리글.
 * '내용'은 넣지 않는다 — 실제 후기 표의 머리행이 `구 분 | 내 용`이라서, 그것을 질문 열로 보면
 * 개요 표 전체(발주처·용역명·일시…)가 질문으로 읽힌다.
 */
const QUESTION_COLUMN_LABELS: readonly string[] = ['질의', '질문', '질의내용', '질문내용', '질의사항']
/** 표의 "그룹" 열을 찾을 때 쓰는 머리글. */
const GROUP_COLUMN_LABELS: readonly string[] = ['질의그룹', '그룹', '대상', '구분', '분야', '역할']

const BULLETS = '-–—•·○●◦▷▶※□■◇◆*〮ㆍ'

function stripBullet(line: string): string {
  return line.replace(new RegExp(`^[${BULLETS}\\s]+`), '').trim()
}

/**
 * 라벨 비교용 정규화 — 불릿·공백·꼬리 콜론과 **꼬리 괄호 설명**을 없앤다.
 *   "발 주 처 :"                  → "발주처"
 *   "특이사항 (분위기, 좌석배치 등)"  → "특이사항"   ← 실제 후기 문서의 라벨(줄바꿈 포함)
 */
function normalizeLabel(raw: string): string {
  let text = stripBullet(raw).replace(/\s+/g, '')
  // 콜론과 괄호가 어느 순서로 붙어 있어도 벗겨낸다.
  for (;;) {
    const next = text.replace(/[:：]+$/, '').replace(/[(（][^)）]*[)）]$/, '')
    if (next === text) break
    text = next
  }
  return text
}

function fieldForLabel(raw: string): Field | null {
  const key = normalizeLabel(raw)
  if (!key) return null
  for (const entry of LABELS) {
    if (entry.keys.includes(key)) return entry.field
  }
  return null
}

function sectionForHeader(raw: string): Section | null {
  const key = normalizeLabel(raw)
  if (!key) return null
  for (const entry of SECTION_HEADERS) {
    if (entry.keys.includes(key)) return entry.section
  }
  return null
}

/**
 * 라벨처럼 보이는 짧은 문구인지 — 사전에 없는 라벨을 unmatched로 남길지 판단한다.
 * 문장(마침표·물음표)이나 긴 텍스트는 라벨이 아니다.
 */
function looksLikeLabel(raw: string): boolean {
  const text = stripBullet(raw)
  if (!text) return false
  if (text.length > 12) return false
  if (/[?？.]$/.test(text)) return false
  return true
}

/** 질의그룹 표준 이름 — 못 찾으면 null(호출부에서 '미지정'이 된다). */
export function canonicalRoleName(raw: string): string | null {
  const text = normalizeLabel(raw).replace(/(질의응답|질의내용|질의|질문)$/, '')
  if (!text) return null
  for (const { keyword, name } of ROLE_KEYWORDS) {
    if (text.includes(keyword)) return name
  }
  return null
}

// ── 값 파싱 ────────────────────────────────────────────────────────────────────

/** "(수)", "(수요일)"처럼 요일만 들어 있는 괄호를 지운다 — 시각 표기에 섞여 들어오기 때문. */
function stripWeekday(text: string): string {
  return text.replace(/[(（]\s*[월화수목금토일](요일)?\s*[)）]/g, ' ')
}

export interface ParsedDateTime {
  date: string | null
  year: number | null
  /** 날짜를 떼어낸 나머지(시각 표기). 원문 표기를 그대로 유지한다. */
  time: string
}

/**
 * "2026. 8. 19.(수) 13:30~" → { date: '2026-08-19', time: '13:30~' }
 * "2015년" → { year: 2015, time: '' }
 *
 * 연도만 있는 문서에 가짜 월·일을 만들어 붙이지 않는다(과거 자료 수용 원칙).
 */
export function parseDateTime(raw: string): ParsedDateTime {
  const text = stripWeekday(raw).replace(/\s+/g, ' ').trim()
  if (!text) return { date: null, year: null, time: '' }

  const full = text.match(/(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*[.일]?/)
  if (full) {
    const [matched, y, m, d] = full
    const month = Number(m)
    const day = Number(d)
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const date = `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      return { date, year: null, time: cleanTime(text.slice((full.index ?? 0) + matched.length)) }
    }
  }

  const yearOnly = text.match(/(19|20)(\d{2})\s*년?/)
  if (yearOnly) {
    const year = Number(`${yearOnly[1]}${yearOnly[2]}`)
    return { date: null, year, time: cleanTime(text.slice((yearOnly.index ?? 0) + yearOnly[0].length)) }
  }

  // 날짜가 없고 시각만 적힌 칸("14:00~")도 있다.
  return { date: null, year: null, time: cleanTime(text) }
}

function cleanTime(raw: string): string {
  return raw.replace(/^[\s.,·:()]+/, '').replace(/[\s,]+$/, '').trim()
}

/** "5인", "5명", "5" → 5. 숫자가 없으면 null(추측하지 않는다). */
export function parseCount(raw: string): number | null {
  const m = raw.match(/(\d+)/)
  return m ? Number(m[1]) : null
}

export interface ParsedCompanies {
  count: number | null
  order: number | null
  names: string
}

/**
 * "7개 중 1번째 (A사, B사)" → { count: 7, order: 1, names: 'A사, B사' }
 * "A사, B사, C사"          → { count: null, order: null, names: 'A사, B사, C사' }
 *
 * 개수/순서 표기를 떼어낸 나머지를 업체명으로 본다. 나머지가 없으면 빈 문자열이다 —
 * 업체명을 개수에서 만들어내지 않는다.
 */
export function parseCompanies(raw: string): ParsedCompanies {
  const text = raw.replace(/\s+/g, ' ').trim()
  if (!text) return { count: null, order: null, names: '' }

  const countMatch = text.match(/(\d+)\s*개(사)?/)
  const orderMatch = text.match(/(\d+)\s*(번째|순위|순번|번)/)

  const paren = text.match(/[(（]([^)）]*)[)）]/)
  if (paren) {
    return {
      count: countMatch ? Number(countMatch[1]) : null,
      order: orderMatch ? Number(orderMatch[1]) : null,
      names: paren[1].trim(),
    }
  }

  let names = text
  if (countMatch) names = names.replace(countMatch[0], ' ')
  if (orderMatch) names = names.replace(orderMatch[0], ' ')
  names = names.replace(/\s*중\s*/g, ' ').replace(/\s+/g, ' ').replace(/^[,·/]+|[,·/]+$/g, '').trim()

  return {
    count: countMatch ? Number(countMatch[1]) : null,
    order: orderMatch ? Number(orderMatch[1]) : null,
    names,
  }
}

/**
 * "홍길동(단장), 김철수(안전), 이영희 차장(수행)" → 이름 + 역할 원문.
 * "단장: 홍길동" 같은 역할-먼저 표기도 받는다. 어느 쪽도 아니면 이름만 남긴다.
 *
 * 역할은 **맨 뒤 괄호**에서 읽는다. 실제 문서에 "이상원(65) 상무(건축)"처럼 동명이인 구분
 * 괄호가 앞에 하나 더 붙는 표기가 있어서, 앞 괄호를 역할로 읽으면 이름이 "이상원"으로 잘리고
 * 역할이 "65) 상무(건축"이 된다.
 */
export function parseAttendees(raw: string): ImportedAttendee[] {
  const out: ImportedAttendee[] = []
  for (const part of raw.split(/[,;\n·/]|、/)) {
    const text = stripBullet(part).replace(/\s+/g, ' ').trim()
    if (!text) continue

    const withRole = text.match(/^(.+)\s*[(（]\s*([^()（）]*?)\s*[)）]\s*$/)
    if (withRole) {
      const name = withRole[1].trim()
      if (name) out.push({ name, role: withRole[2].trim() })
      continue
    }

    const roleFirst = text.match(/^([가-힣]{2,4})\s*[:：]\s*(.+)$/)
    if (roleFirst && canonicalRoleName(roleFirst[1])) {
      out.push({ name: roleFirst[2].trim(), role: roleFirst[1].trim() })
      continue
    }

    out.push({ name: text, role: '' })
  }
  return out
}

// ── 질의 파싱 ──────────────────────────────────────────────────────────────────

const QUESTION_MARKER = new RegExp(
  `^(?:[${BULLETS}]|\\d+\\s*[.)]|[Qq]\\s*\\d*\\s*[.)]?|[가나다라마바사아자차카타파하]\\s*[.)])\\s*`,
)

/** 질문 줄에서 번호·불릿을 떼어낸다. */
function stripQuestionMarker(line: string): { text: string; hadMarker: boolean } {
  const m = line.match(QUESTION_MARKER)
  if (!m) return { text: line.trim(), hadMarker: false }
  return { text: line.slice(m[0].length).trim(), hadMarker: true }
}

/**
 * 그룹 머리말인지 판단한다.
 *   [단장] / 【안전】 / <책임기술자> / ▷책임기술자 질의 / ○ 안전
 * 괄호로 감쌌거나 "…질의"로 끝나면 머리말로 본다. 그 외에는 짧고 역할 표기만 있는 줄만 인정한다 —
 * 질문 문장을 머리말로 잘못 읽으면 그 아래 질문이 전부 엉뚱한 그룹에 들어가기 때문이다.
 */
function groupHeaderOf(line: string): { role_name: string | null } | null {
  const text = stripBullet(line)
  if (!text) return null

  const bracketed = text.match(/^[[(【<〔（]\s*(.+?)\s*[\])】>〕）]$/)
  if (bracketed) return { role_name: canonicalRoleName(bracketed[1]) }

  const suffixed = text.match(/^(.{1,15}?)\s*(질의응답|질의내용|질의|질문)\s*[:：]?$/)
  if (suffixed) return { role_name: canonicalRoleName(suffixed[1]) }

  const bare = text.replace(/[:：]\s*$/, '')
  if (bare.length <= 8 && !/[?？.]/.test(bare) && canonicalRoleName(bare)) {
    return { role_name: canonicalRoleName(bare) }
  }
  return null
}

/**
 * 실제질의 영역의 줄들을 그룹으로 묶는다.
 *
 * 줄바꿈으로 잘린 한 질문을 두 질문으로 만들지 않으려고, 번호·불릿이 붙은 질문 뒤에 오는
 * "표시 없는 줄"은 앞 질문의 이어지는 줄로 붙인다(앞 질문이 문장부호로 끝나지 않은 경우에만).
 * 문서 전체에 번호가 없으면 한 줄이 한 질문이다.
 */
export function parseQuestionLines(lines: readonly string[]): ImportedQuestionGroup[] {
  const groups: ImportedQuestionGroup[] = []
  let current: ImportedQuestionGroup | null = null
  let lastHadMarker = false

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue

    const header = groupHeaderOf(line)
    if (header) {
      current = { role_name: header.role_name, questions: [] }
      groups.push(current)
      lastHadMarker = false
      continue
    }

    const { text, hadMarker } = stripQuestionMarker(line)
    if (!text) continue

    if (!current) {
      // 머리말 없이 질문이 먼저 나오는 문서도 있다 — 그룹 미지정으로 담는다.
      current = { role_name: null, questions: [] }
      groups.push(current)
    }

    const prev = current.questions[current.questions.length - 1]
    if (!hadMarker && lastHadMarker && prev && !/[?？.!]$/.test(prev)) {
      current.questions[current.questions.length - 1] = `${prev} ${text}`
      continue
    }

    current.questions.push(text)
    lastHadMarker = hadMarker
  }

  return groups.filter(g => g.questions.length > 0)
}

// ── 표 처리 ────────────────────────────────────────────────────────────────────

interface DraftAccumulator {
  title: string
  values: Map<Field, string>
  questionLines: string[]
  tableGroups: ImportedQuestionGroup[]
  unmatched: Set<string>
}

/** 먼저 읽은 값을 지키고 뒤에 나온 같은 라벨은 무시한다(머리말/꼬리말 반복 대비). */
function assign(acc: DraftAccumulator, field: Field, value: string) {
  const text = value.trim()
  if (!text) return
  if (acc.values.has(field)) return
  acc.values.set(field, text)
}

/** 여러 줄로 이어지는 항목(진행방법/특이사항)은 이어붙인다. */
function append(acc: DraftAccumulator, field: Field, value: string) {
  const text = value.trim()
  if (!text) return
  const prev = acc.values.get(field)
  acc.values.set(field, prev ? `${prev}\n${text}` : text)
}

/** 표 셀 안의 여러 줄을 줄 단위로 나눈다(HWP는 한 칸에 여러 줄을 넣는다). */
function splitLines(value: string): string[] {
  return value.split(/\r?\n/)
}

function cellTexts(row: readonly ParsedCell[]): string[] {
  return row.map(c => (c.text ?? '').replace(/\r/g, '').trim())
}

/**
 * 라벨/값 표를 읽는다. 한 행에 "라벨|값" 또는 "라벨|값|라벨|값"이 들어 있는 서식을 모두 받는다.
 * 라벨 다음의 첫 비어 있지 않은 칸을 값으로 본다(병합 셀 때문에 빈 칸이 끼어 있는 경우가 있다).
 */
function readLabelValueRow(acc: DraftAccumulator, cells: readonly string[]) {
  for (let i = 0; i < cells.length; i += 1) {
    const label = cells[i]
    if (!label) continue

    const field = fieldForLabel(label)
    if (!field) continue

    let value = ''
    for (let j = i + 1; j < cells.length; j += 1) {
      if (fieldForLabel(cells[j])) break  // 다음 라벨을 값으로 읽지 않는다
      if (cells[j]) { value = cells[j]; break }
    }
    if (!value) continue

    assignField(acc, field, value)
  }
}

/**
 * 항목별로 값을 담는 방식이 다르다 — 한 곳에 모아 표/줄글 어느 경로로 들어와도 같게 처리한다.
 *   questions      : 칸 안의 줄들을 질의 줄 목록에 넣는다(그룹 나누기는 parseQuestionLines가 한다)
 *   method / notes : 여러 번 나오면 이어붙인다(문서가 항목을 나눠 적는 경우가 있다)
 *   나머지         : 먼저 읽은 값을 지킨다
 */
function assignField(acc: DraftAccumulator, field: Field, value: string) {
  if (field === 'questions') {
    acc.questionLines.push(...splitLines(value))
    return
  }
  if (field === 'method' || field === 'notes') {
    append(acc, field, value)
    return
  }
  assign(acc, field, value)
}

/**
 * 사전에 없는 라벨을 기록한다 — "이 항목은 자동으로 못 읽었다"를 화면에 알리기 위한 것이다.
 * 라벨처럼 짧은 칸 옆에 값이 있는데 사전에 없을 때만 남긴다.
 */
function collectUnmatchedLabels(acc: DraftAccumulator, cells: readonly string[]) {
  for (let i = 0; i < cells.length - 1; i += 1) {
    const label = cells[i]
    const value = cells[i + 1]
    if (!label || !value) continue
    if (fieldForLabel(label) || fieldForLabel(value)) continue
    if (!looksLikeLabel(label)) continue
    if (sectionForHeader(label)) continue
    // 표 머리행("구 분 | 내 용")은 값이 아니므로 못 읽은 항목으로 알리지 않는다.
    if (IGNORED_LABELS.includes(normalizeLabel(label))) continue
    if (IGNORED_LABELS.includes(normalizeLabel(value))) continue
    if (value.length < 2) continue
    acc.unmatched.add(stripBullet(label).replace(/[:：]\s*$/, ''))
  }
}

/**
 * 문서 제목 후보를 기억한다(맨 처음 나온 것 하나만).
 *
 * 실제 후기 문서는 제목을 1행 표에 넣어 두고("345kV 신석문변전소 면접후기"), 평가유형 칸은
 * 아예 없다. 라벨도 값도 아닌 첫 줄을 제목으로 본다 — 라벨/값으로 읽힌 것은 제목이 아니다.
 */
function noteTitle(acc: DraftAccumulator, text: string) {
  if (acc.title) return
  const line = text.replace(/\s+/g, ' ').trim()
  if (!line || line.length > 80) return
  if (fieldForLabel(line) || sectionForHeader(line)) return
  if (IGNORED_LABELS.includes(normalizeLabel(line))) return
  acc.title = line
}

/** 머리글이 있는 세로 표(첫 행 라벨, 둘째 행 값)인지. */
function isHeaderValueTable(rows: readonly string[][]): boolean {
  if (rows.length !== 2) return false
  const labelCount = rows[0].filter(c => fieldForLabel(c)).length
  return labelCount >= 2
}

/**
 * 첫 칸에 항목 라벨이 여러 개 있는 표 — 즉 개요(라벨/값) 표인지.
 * 실제 후기 문서가 개요와 질의를 한 표에 담기 때문에, 질의 표로 오인해 개요를 질문으로 읽는
 * 사고를 막는 가드다.
 */
function looksLikeLabelValueTable(rows: readonly string[][]): boolean {
  const labelRows = rows.filter(row => row.length >= 2 && fieldForLabel(row[0]) !== null)
  return labelRows.length >= 2
}

/** 질의가 표로 정리된 경우(그룹 열 + 질문 열)를 읽는다. */
function readQuestionTable(rows: readonly string[][]): ImportedQuestionGroup[] | null {
  if (rows.length < 2) return null
  if (looksLikeLabelValueTable(rows)) return null

  const header = rows[0].map(c => normalizeLabel(c))
  const questionCol = header.findIndex(h => QUESTION_COLUMN_LABELS.includes(h))
  if (questionCol < 0) return null
  const groupCol = header.findIndex(h => GROUP_COLUMN_LABELS.includes(h))

  const groups: ImportedQuestionGroup[] = []
  let current: ImportedQuestionGroup | null = null

  for (const row of rows.slice(1)) {
    const question = (row[questionCol] ?? '').trim()
    const groupText = groupCol >= 0 ? (row[groupCol] ?? '').trim() : ''

    // 그룹 칸이 비어 있으면 위 행의 그룹이 이어지는 것으로 본다(세로 병합된 표).
    if (groupText || !current) {
      const roleName = groupText ? canonicalRoleName(groupText) : null
      current = { role_name: roleName, questions: [] }
      groups.push(current)
    }
    if (!question) continue

    // 한 칸에 여러 질문이 줄바꿈으로 들어 있는 경우가 있다.
    for (const line of question.split('\n')) {
      const { text } = stripQuestionMarker(line.trim())
      if (text) current.questions.push(text)
    }
  }

  const filled = groups.filter(g => g.questions.length > 0)
  return filled.length > 0 ? filled : null
}

// ── 본문(줄글) 처리 ───────────────────────────────────────────────────────────

/**
 * "발주처 : OO시" 처럼 한 줄에 라벨과 값이 같이 있는 형태.
 * 콜론이 없으면(예: "발주처 OO시") 라벨로 보지 않는다 — 문장을 잘못 자르는 위험이 더 크다.
 */
function readLabelValueLine(line: string): { field: Field; value: string } | null {
  const m = stripBullet(line).match(/^(.{1,14}?)\s*[:：]\s*(.+)$/)
  if (!m) return null
  const field = fieldForLabel(m[1])
  return field ? { field, value: m[2].trim() } : null
}

// ── 본체 ──────────────────────────────────────────────────────────────────────

/**
 * 문서 블록들을 후기 초안으로 바꾼다.
 *
 * 표에서 라벨/값을 읽고, 줄글에서는 머리말(진행방법/특이사항/실제질의)로 영역을 나눠 담는다.
 * 두 서식이 한 문서에 섞여 있어도 각각 읽는다 — 과거 자료가 실제로 그렇게 섞여 있다.
 */
export function buildReviewDraft(blocks: readonly ParsedBlock[]): ImportedReviewDraft {
  const acc: DraftAccumulator = {
    title: '',
    values: new Map(),
    questionLines: [],
    tableGroups: [],
    unmatched: new Set(),
  }
  let section: Section = 'none'

  for (const block of blocks) {
    if (block.table) {
      const rows = block.table.cells.map(cellTexts)

      // 제목만 담긴 1행 표(실제 후기 문서의 제목 서식).
      if (rows.length === 1) {
        const filled = rows[0].filter(Boolean)
        if (filled.length === 1) {
          noteTitle(acc, filled[0])
          continue
        }
      }

      const questionTable = readQuestionTable(rows)
      if (questionTable) {
        acc.tableGroups.push(...questionTable)
        continue
      }

      if (isHeaderValueTable(rows)) {
        const [labels, values] = rows
        for (let i = 0; i < labels.length; i += 1) {
          const field = fieldForLabel(labels[i])
          const value = (values[i] ?? '').trim()
          if (field && value) assignField(acc, field, value)
        }
        continue
      }

      for (const row of rows) {
        readLabelValueRow(acc, row)
        collectUnmatchedLabels(acc, row)
      }

      // 실제질의 영역 안의 일반 표는 질문 목록으로 본다(머리글 없는 질의 표).
      if (section === 'questions') {
        for (const row of rows) {
          for (const cell of row) {
            if (cell) acc.questionLines.push(...cell.split('\n'))
          }
        }
      }
      continue
    }

    const text = block.text ?? ''
    if (!text.trim()) continue

    for (const rawLine of text.split('\n')) {
      const line = rawLine.replace(/\r/g, '').trim()
      if (!line) continue

      // "진행방법 : PT 발표 후 질의응답" 처럼 머리말과 값이 한 줄에 있는 경우를 먼저 처리한다.
      const inline = readLabelValueLine(line)
      if (inline) {
        assignField(acc, inline.field, inline.value)
        // 여러 줄로 이어지는 항목은 다음 줄들도 같은 항목으로 받는다.
        section = inline.field === 'method' || inline.field === 'notes' || inline.field === 'questions'
          ? inline.field
          : 'none'
        continue
      }

      const header = sectionForHeader(line)
      if (header) {
        section = header
        continue
      }

      if (section === 'questions') { acc.questionLines.push(line); continue }
      if (section === 'method') { append(acc, 'method', line); continue }
      if (section === 'notes') { append(acc, 'notes', line); continue }
      // 어느 항목인지 알 수 없는 줄이다. 맨 처음 것만 문서 제목 후보로 남기고 나머지는 버린다.
      noteTitle(acc, line)
    }
  }

  const datetime = parseDateTime(acc.values.get('datetime') ?? '')
  const companies = parseCompanies(acc.values.get('companies') ?? '')
  const lineGroups = parseQuestionLines(acc.questionLines)

  return {
    document_title: acc.title,
    evaluation_type_source: acc.values.get('type') ?? '',
    client: acc.values.get('client') ?? '',
    project_name: acc.values.get('project') ?? '',
    facility_type: acc.values.get('facility') ?? '',
    evaluation_date: datetime.date,
    evaluation_year: datetime.year,
    evaluation_time: datetime.time,
    location: acc.values.get('location') ?? '',
    evaluator_count: parseCount(acc.values.get('evaluators') ?? ''),
    participant_company_count: companies.count,
    presentation_order: companies.order ?? parseCount(acc.values.get('order') ?? ''),
    participant_companies: companies.names,
    evaluation_method: acc.values.get('method') ?? '',
    special_notes: acc.values.get('notes') ?? '',
    attendees: parseAttendees(acc.values.get('attendees') ?? ''),
    groups: [...acc.tableGroups, ...lineGroups],
    unmatched_labels: [...acc.unmatched],
  }
}

/**
 * 초안에 쓸 만한 내용이 하나라도 있는지.
 * 아무것도 못 읽었으면 빈 폼을 열어주는 대신 "읽을 수 없는 문서"라고 알리는 편이 정직하다.
 */
export function hasImportedContent(draft: ImportedReviewDraft): boolean {
  return Boolean(
    draft.client || draft.project_name || draft.facility_type
    || draft.evaluation_date || draft.evaluation_year || draft.evaluation_time
    || draft.location || draft.evaluation_method || draft.special_notes
    || draft.evaluator_count !== null || draft.participant_company_count !== null
    || draft.presentation_order !== null || draft.participant_companies
    || draft.attendees.length > 0 || draft.groups.length > 0,
  )
}

/** 초안에 담긴 질문 총 개수 — 업로드 결과 안내에 쓴다. */
export function countImportedQuestions(draft: ImportedReviewDraft): number {
  return draft.groups.reduce((sum, g) => sum + g.questions.length, 0)
}
