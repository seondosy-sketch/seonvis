/**
 * 프로젝트 정렬 기준 — 공사번호(`projects.project_number`) 오름차순 하나로 통일한다.
 *
 * 프로젝트 List 화면이 보여주는 순서가 팀이 실제로 쓰는 순서라, 주간/월간보고·출장지원·
 * 출근부·숙소·달력·미래봇까지 프로젝트를 늘어놓는 모든 화면과 HWPX 출력물이 같은 순서를
 * 따라야 한다. 예전에는 화면마다 제각각이었다(대부분 공사번호 내림차순, 출장지원은 발표일순,
 * 숙소는 용역명순).
 *
 * 공사번호는 text 컬럼이라 지금은 4자리 숫자("2647")만 들어있지만 자릿수가 늘거나 접두어가
 * 붙어도 사람이 기대하는 순서가 나오도록 숫자 인식 비교(`numeric: true`)를 쓴다 — 그래야
 * "999"가 "1000"보다 앞에 온다. 번호가 없는 행(주간보고에서 손으로 추가한 행)은 항상 맨 뒤로
 * 보낸다. 번호까지 같으면 용역명으로 갈라 순서가 매번 뒤바뀌지 않게 한다.
 */

const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' })

export function compareProjectNumber(
  a: string | null | undefined,
  b: string | null | undefined
): number {
  const x = (a ?? '').trim()
  const y = (b ?? '').trim()
  if (x === '' && y === '') return 0
  if (x === '') return 1
  if (y === '') return -1
  return collator.compare(x, y)
}

/**
 * 공사번호 → 용역명 순으로 비교하는 정렬 함수를 만든다.
 * 행에서 번호·이름을 어떻게 꺼낼지는 호출부가 정한다(테이블마다 필드가 달라서).
 */
export function byProjectNumber<T>(
  getNumber: (row: T) => string | null | undefined,
  getName: (row: T) => string | null | undefined = () => ''
): (a: T, b: T) => number {
  return (a, b) => {
    const byNumber = compareProjectNumber(getNumber(a), getNumber(b))
    if (byNumber !== 0) return byNumber
    return collator.compare((getName(a) ?? '').trim(), (getName(b) ?? '').trim())
  }
}
