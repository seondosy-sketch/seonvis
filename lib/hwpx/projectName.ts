// HWPX(주간/월간 보고서) 출력 전용 프로젝트명 정제.
//
// 이 함수는 항상 새 문자열을 반환한다 — DB/화면에 저장된 원본 프로젝트명은 절대 바꾸지 않으며,
// 호출부는 원본 대신 이 반환값만 문서에 쓴다.
//
// 제거 대상은 아래 지정된 문구뿐이다. "공사"/"용역"/"사업" 같은 개별 단어는 절대 통째로 지우지
// 않고, 지정 문구가 더 큰 단어의 일부일 때(예: "신축공사비"의 "신축공사")도 건드리지 않는다 —
// 그래서 각 문구를 한글/영문/숫자가 아닌 경계로만 감싸 매칭한다.

const WORD_CHAR = '가-힣a-zA-Z0-9'
const NOT_WORD_BEFORE = `(?<![${WORD_CHAR}])`
const NOT_WORD_AFTER = `(?![${WORD_CHAR}])`

// 각 문구는 실제 표기 변형(붙여쓰기/띄어쓰기)을 허용하기 위해 형태소 사이에 \s*를 둔다.
// 신축공사/건립공사/토건공사는 표기 변형 사례가 제시되지 않아 고정 문자열로 둔다.
const REMOVAL_PHRASES = [
  '건설\\s*사업\\s*관리\\s*용역', // 건설사업관리용역 / 건설 사업관리용역 / 건설사업관리 용역
  '신축공사',
  '건립공사',
  '토건공사',
  '감독\\s*권한\\s*대행\\s*등', // 감독권한대행 등 / 감독권한대행등 / 감독 권한대행 등 / 감독권한 대행 등
]

const REMOVAL_REGEX = new RegExp(
  `${NOT_WORD_BEFORE}(?:${REMOVAL_PHRASES.join('|')})${NOT_WORD_AFTER}`,
  'g'
)

const SEPARATOR_CHARS = '\\-_/·,'
const EMPTY_BRACKET_REGEX = /[([{]\s*[)\]}]/g
const BOUNDARY_TRIM_REGEX = new RegExp(`^[\\s${SEPARATOR_CHARS}]+|[\\s${SEPARATOR_CHARS}]+$`, 'g')
const DUP_SEPARATOR_REGEX = new RegExp(`([${SEPARATOR_CHARS}])\\1+`, 'g')

export function formatProjectNameForReport(originalName: string): string {
  if (!originalName) return originalName

  let s = originalName.replace(REMOVAL_REGEX, ' ')

  // 문구를 제거하고 남은 속 빈 괄호 — 예: "센터(신축공사)" → "센터( )" — 정리.
  // 중첩된 빈 괄호(드묾)까지 대비해 변화가 없을 때까지 몇 차례 반복한다.
  for (let i = 0; i < 3; i++) {
    const next = s.replace(EMPTY_BRACKET_REGEX, ' ')
    if (next === s) break
    s = next
  }

  s = s.replace(/\s+/g, ' ')
  s = s.replace(BOUNDARY_TRIM_REGEX, '')
  s = s.replace(DUP_SEPARATOR_REGEX, '$1')
  s = s.trim()

  // 정제 결과가 비면(예: 원본이 제거 대상 문구뿐이었던 경우) 원본을 그대로 쓴다.
  return s || originalName
}
