// 주간/월간 HWPX 생성 시점의 입력값 검증.
//
// 주간(개찰/진행중/발주예상)은 이제 고정 행 수 제한이 없다 — app/api/hwpx/route.ts가 실제
// 데이터 수에 맞춰 표 행을 동적으로 늘리거나 줄이고, 대신 lib/hwpx/pageBudget.ts의 "자동 문서
// 높이 예산" 검사로 과도한 입력을 막는다. 여기 남은 validateWeeklyCapacity는 행 수 제한이
// 아니라 "수행 프로젝트 status 값이 개찰/진행중이 아닌 경우"만 검증한다 — status가 이상한
// 값이면 기존 코드는 개찰·진행중 어느 쪽에도 안 걸려서 조용히 문서에서 빠져버리기 때문이다.
//
// 월간은 이번 단계에서 동적 행을 구현하지 않아 여전히 고정 출력 공간(11건)을 검증한다.
export const MONTHLY_TEMPLATE_OUTPUT_SPACE = {
  performing: 11,
} as const

export interface CapacityViolation {
  field: string
  max: number
  actual: number
  message: string
}

interface PerformingLike {
  status?: string | null
}

// 주간: status 값 유효성만 검증한다(행 수 제한 없음 — 위 설명 참고).
export function validateWeeklyCapacity(performing: PerformingLike[]): CapacityViolation[] {
  const violations: CapacityViolation[] = []

  const invalidStatusValues = [...new Set(
    performing
      .filter(p => p?.status !== '개찰' && p?.status !== '진행중')
      .map(p => String(p?.status))
  )]

  if (invalidStatusValues.length > 0) {
    violations.push({
      field: 'status',
      max: 0,
      actual: invalidStatusValues.length,
      message: `수행 프로젝트의 상태값은 '개찰' 또는 '진행중'만 허용됩니다. 알 수 없는 값: ${invalidStatusValues.join(', ')}`,
    })
  }

  return violations
}

export function validateMonthlyCapacity(performing: unknown[]): CapacityViolation[] {
  const violations: CapacityViolation[] = []

  if (performing.length > MONTHLY_TEMPLATE_OUTPUT_SPACE.performing) {
    violations.push({
      field: '월간 수행 프로젝트',
      max: MONTHLY_TEMPLATE_OUTPUT_SPACE.performing,
      actual: performing.length,
      message: `현재 월간 문서 양식의 프로젝트 출력 공간은 ${MONTHLY_TEMPLATE_OUTPUT_SPACE.performing}건이지만, ${performing.length}건이 입력되어 문서를 생성할 수 없습니다.`,
    })
  }

  return violations
}

export function formatCapacityViolations(violations: CapacityViolation[]): string {
  return violations.map(v => v.message).join('\n')
}
