import type { AssignmentIssueCode, AssignmentResult, GeneratedAssignment } from '../assign/types'

/**
 * 부분 자동배정 — 문제 있는 직원만 빼고 나머지는 저장할 수 있게 나눈다. 순수 함수.
 *
 * 제외(저장 대상 아님): 그 직원에게 붙은 error 이슈, 또는 아래 코드
 *   - OVERTIME_MONTHLY_TARGET_MISSING  월 목표 미입력
 *   - TARGET_BELOW_LOCKED_HOURS        이미 입력된 시간이 목표를 넘음(목표 초과 상태)
 *   - EMPLOYEE_INACTIVE                재직(활성) 아님
 * 나머지는 배정 0시간이어도(목표 달성·배정 가능 프로젝트 없음 등) "정상"이다.
 * 저장 가능 = 엔진 전체 결과가 정상(ok) && 정상 직원이 1명 이상. 저장하는 초안은 정상 직원 것만.
 */

const EXCLUDING: ReadonlySet<AssignmentIssueCode> = new Set<AssignmentIssueCode>([
  'OVERTIME_MONTHLY_TARGET_MISSING',
  'TARGET_BELOW_LOCKED_HOURS',
  'EMPLOYEE_INACTIVE',
])

export interface ExcludedEmployee {
  employee_id: string
  code: AssignmentIssueCode
  message: string
}

export interface PartialPlan {
  included: string[]
  excluded: ExcludedEmployee[]
  canSave: boolean
  drafts: GeneratedAssignment[]
}

export function splitPartialPlan(result: AssignmentResult): PartialPlan {
  const excludedBy = new Map<string, ExcludedEmployee>()
  for (const i of result.issues) {
    if (!i.employee_id || excludedBy.has(i.employee_id)) continue
    if (i.severity === 'error' || EXCLUDING.has(i.code)) {
      excludedBy.set(i.employee_id, { employee_id: i.employee_id, code: i.code, message: i.message })
    }
  }
  const order = result.employees.map(e => e.employee_id)
  const included = order.filter(id => !excludedBy.has(id))
  const excluded = order.filter(id => excludedBy.has(id)).map(id => excludedBy.get(id)!)
  const keep = new Set(included)
  return {
    included,
    excluded,
    canSave: result.ok && included.length > 0,
    drafts: result.assignments.filter(a => keep.has(a.employee_id)),
  }
}
