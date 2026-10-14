/**
 * 연속성 평가 — 직원 1명의 배정을 날짜순으로 보고 블록·전환·왕복을 센다.
 *
 * 연속의 기준은 "그 직원이 일할 수 있었던 근무일"이다. 두 배정 사이에 주말·공휴일·잠금일만 있으면
 * (금요일 → 월요일, 공휴일 다음 날) 같은 블록으로 본다. 사이에 쓰지 않은 평일이 있거나 다른 프로젝트가
 * 끼면 블록이 끊긴다. 엔진은 이 값을 프로젝트 요약(block_count)에 쓰고, 테스트는 A→B→A가 없는지 검사한다.
 */

export interface ContinuityEntry {
  date: string
  project_id: string
  task_id?: string
}

export interface ContinuityReport {
  /** 프로젝트가 바뀌거나 사이에 놓친 평일이 있으면 새 블록 */
  blocks: number
  blocksByProject: Map<string, number>
  /** 날짜순으로 인접한 두 배정의 프로젝트가 다른 횟수 */
  switches: number
  /** A→B→A처럼 이미 했던 프로젝트로 되돌아온 횟수 */
  revisits: number
  /** 같은 프로젝트 블록 안에서 업무가 바뀐 횟수 */
  taskSwitches: number
}

/**
 * @param isMissedWorkday 두 배정 사이의 날짜가 "쓸 수 있었는데 쓰지 않은 근무일"인지 — 그렇다면 블록이 끊긴다
 */
export function evaluateContinuity(
  entries: readonly ContinuityEntry[],
  isMissedWorkday: (date: string) => boolean,
  datesBetween: (from: string, to: string) => string[],
): ContinuityReport {
  const sorted = [...entries].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  const blocksByProject = new Map<string, number>()
  let blocks = 0
  let switches = 0
  let taskSwitches = 0
  const runsByProject = new Map<string, number>()

  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i]
    const prev = i > 0 ? sorted[i - 1] : null
    const sameProject = prev !== null && prev.project_id === cur.project_id
    if (prev && !sameProject) switches++
    if (!sameProject) runsByProject.set(cur.project_id, (runsByProject.get(cur.project_id) ?? 0) + 1)
    const gapBroken = prev !== null && datesBetween(prev.date, cur.date).some(isMissedWorkday)
    if (!sameProject || gapBroken) {
      blocks++
      blocksByProject.set(cur.project_id, (blocksByProject.get(cur.project_id) ?? 0) + 1)
    } else if (prev.task_id !== undefined && cur.task_id !== undefined && prev.task_id !== cur.task_id) {
      taskSwitches++
    }
  }
  let revisits = 0
  for (const runs of runsByProject.values()) revisits += runs - 1
  return { blocks, blocksByProject, switches, revisits, taskSwitches }
}
