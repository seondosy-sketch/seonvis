// 월간 HWPX 상단표의 "발주처" 표시명 — 순수 함수, 출력에만 쓴다.
//
// 배경: 발주처 열은 폭 4,558(텍스트 폭 4,276)에 8pt 글자라 한 줄에 5자 정도만 들어간다.
// Project List 원문을 그대로 쓰면 "한국전력공사 경인건설본부 경기건설지사"가 6줄로 접혀
// 데이터 행 높이가 1,818 → 5,082로 커지고, 운영 규모 10건이 2페이지가 된다(한글 렌더 실측).
//
// 그래서 월간 출력에만 적용되는 표시명을 둔다. DB(projects.client)와 Project List 화면,
// Weekly 출력은 건드리지 않는다.
//
// 매핑 원칙:
//   - 기준 파일(CM본부월업무계획(7.24).hwpx)에서 실제로 확인한 표기를 그대로 쓴다.
//   - 원문 완전 일치만 치환한다. 앞 N자 자동 절단·부분 문자열 추정은 하지 않는다.
//   - 목록에 없는 기관은 원문을 그대로 출력한다.

export interface MonthlyClientMapping {
  /** 월간 표에 출력할 이름 */
  display: string
  /** 이 표시명으로 치환할 projects.client 원문(완전 일치) */
  sources: readonly string[]
  /** 근거 — 기준 파일 실측인지, 사용자 확정인지 */
  basis: string
}

export const MONTHLY_CLIENT_MAPPINGS: readonly MonthlyClientMapping[] = [
  { display: '국군재정', sources: ['국군재정관리단'], basis: '7.24 기준 파일 실측' },
  { display: '한전(중부)', sources: ['한국전력공사 중부건설본부'], basis: '7.24 기준 파일 실측' },
  { display: '한국수자원', sources: ['수자원공사 금강유역본부', '한국수자원공사'], basis: '7.24 기준 파일 실측 + 사용자 확정' },
  { display: 'LH', sources: ['한국토지주택공사'], basis: '사용자 확정' },
  // 아래 둘은 기준 파일에 직접 나오지 않지만 "한전(중부)" 표기 규칙을 같은 계열에 적용한 것이다.
  // 경인건설본부 건은 현재 운영(진행중)에 실재하며 원문 그대로면 6줄로 접힌다.
  { display: '한전(경인)', sources: ['한국전력공사 경인건설본부 경기건설지사'], basis: '7.24 "한전(중부)" 표기 규칙 확장' },
  { display: '한전', sources: ['한국전력공사'], basis: '7.24 "한전(중부)" 표기 규칙 확장' },
]

/** 원문 → 표시명 조회표. 서로 다른 원문이 같은 표시명을 갖는 것은 같은 기관일 때만 허용된다. */
const BY_SOURCE: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>()
  for (const m of MONTHLY_CLIENT_MAPPINGS) {
    for (const source of m.sources) {
      const key = source.trim()
      const existing = map.get(key)
      if (existing != null && existing !== m.display) {
        // 같은 원문이 서로 다른 표시명에 등록된 경우 — 설계 오류이므로 즉시 드러낸다.
        throw new Error(`발주처 표시명 매핑 충돌: "${key}" → "${existing}" / "${m.display}"`)
      }
      map.set(key, m.display)
    }
  }
  return map
})()

/** 월간 표에 쓸 발주처 이름. 매핑에 없으면 원문(앞뒤 공백만 제거)을 그대로 돌려준다. */
export function formatMonthlyClient(client: unknown): string {
  const raw = client == null ? '' : String(client).trim()
  if (raw === '') return ''
  return BY_SOURCE.get(raw) ?? raw
}
