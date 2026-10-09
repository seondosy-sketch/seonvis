import type { AssignmentInput, AssignmentResult } from '../assign/types'
import type { PlanningScope } from './input'

/**
 * 미리보기 ↔ 저장 사이에 엔진 입력이 바뀌었는지 판별한다. 순수 함수.
 *
 * 화면은 미리보기를 만들 때 쓴 입력(input)·범위(scope)·지문(fingerprint)을 결과와 함께 보관하고,
 * 저장 직전에 지금 상태로 다시 만든 입력의 지문과 비교한다. 다르면 저장을 막는다(설정·기존 기록이 바뀐 미리보기를
 * 그대로 저장하면 DB 검증에서 통째로 실패하거나, 화면에서 본 것과 다른 결과가 남는다).
 *
 * 지문 규칙:
 * - 순서가 의미 없는 집합(직원, 직원별 참여 프로젝트, 업무 지정 task_ids, 프로젝트, 잠금 기록, 공휴일, 공휴일 연도)은
 *   정렬해 넣는다 — DB가 같은 행을 다른 순서로 돌려줘도 같은 지문.
 * - 업무는 엔진이 쓰는 우선순위 순서(sort_order 오름차순, null은 뒤, 같으면 입력 순서)대로 직원별로 넣고
 *   sort_order 값도 함께 넣는다 — 우선순위를 바꾸면 지문이 바뀐다.
 * - seed는 넣는다: 저장하는 실행(run)의 seed가 미리보기를 만든 seed와 같아야 기록이 재현된다.
 * - as_of(배정 기준일)는 넣지 않는다: 엔진은 실행 정보로만 남기고 배정에 쓰지 않으므로, 자정을 넘겼다고
 *   미리보기를 무효로 만들지 않는다. 저장 기록(input_snapshot)에는 미리보기 입력의 as_of를 그대로 쓴다.
 * - 범위(scope)는 엔진 입력에 없지만 DB가 대체할 초안을 정하므로 함께 넣는다.
 */

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

function orderedTasks(tasks: AssignmentInput['tasks']) {
  return tasks
    .map((t, index) => ({ t, index }))
    .sort((a, b) => {
      const byEmp = cmp(a.t.employee_id, b.t.employee_id)
      if (byEmp !== 0) return byEmp
      const sa = a.t.sort_order ?? null
      const sb = b.t.sort_order ?? null
      if (sa !== sb) {
        if (sa === null) return 1
        if (sb === null) return -1
        return sa - sb
      }
      return a.index - b.index
    })
    .map(({ t }) => [t.employee_id, t.task_id, t.task_name, t.sort_order ?? null])
}

export function inputFingerprint(input: AssignmentInput, scope: PlanningScope): string {
  const canonical = {
    scope: scope.kind === 'all' ? ['all'] : scope.kind === 'employee' ? ['employee', scope.employee_id] : ['project', scope.project_id],
    period: [input.period.label, input.period.start, input.period.end],
    seed: input.seed,
    rule_version: input.rule_version,
    holidays: input.holidays.map(h => [h.date, h.name]).sort((a, b) => cmp(a[0], b[0]) || cmp(a[1], b[1])),
    holiday_data_years: [...new Set(input.holiday_data_years)].sort((a, b) => a - b),
    employees: input.employees
      .map(e => [
        e.employee_id,
        e.active,
        e.target_hours,
        e.projects
          .map(p => [p.project_id, p.task_ids === null ? null : [...p.task_ids].sort(cmp)] as const)
          .sort((a, b) => cmp(a[0], b[0])),
      ] as const)
      .sort((a, b) => cmp(a[0], b[0])),
    projects: input.projects
      .map(p => [p.project_id, p.project_number, p.announce_date, p.submit_date, p.period_start, p.period_end, p.auto_assignable] as const)
      .sort((a, b) => cmp(a[0], b[0])),
    tasks: orderedTasks(input.tasks),
    locked_records: input.locked_records
      .map(r => [r.employee_id, r.work_date, r.project_id, r.hours, r.source, r.task_name] as const)
      .map(r => JSON.stringify(r))
      .sort(cmp),
  }
  return JSON.stringify(canonical)
}

/** 화면이 보관하는 미리보기 — 결과와, 그 결과를 만든 입력·범위·지문 */
export interface StoredPreview {
  input: AssignmentInput
  scope: PlanningScope
  fingerprint: string
  result: AssignmentResult
}

export function makePreview(input: AssignmentInput, scope: PlanningScope, result: AssignmentResult): StoredPreview {
  return { input, scope, fingerprint: inputFingerprint(input, scope), result }
}

/** 지금 상태로 만든 입력이 미리보기를 만든 입력과 같을 때만 저장할 수 있다 */
export function canSavePreview(preview: StoredPreview | null, currentInput: AssignmentInput, currentScope: PlanningScope): boolean {
  if (!preview) return false
  return preview.fingerprint === inputFingerprint(currentInput, currentScope)
}
