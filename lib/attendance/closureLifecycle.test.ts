import { describe, expect, it } from 'vitest'
import {
  canClose,
  canReopen,
  currentClosureStatus,
  nextClosureVersion,
  periodLabelForDate,
} from './closureLifecycle'
import type { AttendanceMonthClosure } from './types'

function makeClosure(overrides: Partial<AttendanceMonthClosure> = {}): AttendanceMonthClosure {
  return {
    id: 'c1', period_year: 2026, period_month: 8, version: 1, status: 'closed',
    closed_by: 'a@seon.co.kr', closed_at: '2026-08-19T00:00:00Z',
    reopened_by: null, reopened_at: null, reopen_reason: null,
    created_at: '2026-08-19T00:00:00Z',
    ...overrides,
  }
}

describe('periodLabelForDate — work_date → 회계기간 라벨 역산', () => {
  it('20일은 그 달 라벨(예: 8/20 → 8월분)', () => {
    expect(periodLabelForDate('2026-08-20')).toEqual({ year: 2026, periodMonth: 8 })
  })

  it('21일은 다음 달 라벨(예: 8/21 → 9월분)', () => {
    expect(periodLabelForDate('2026-08-21')).toEqual({ year: 2026, periodMonth: 9 })
  })

  it('12/21은 다음 연도 1월분으로 넘어간다(연도 경계)', () => {
    expect(periodLabelForDate('2026-12-21')).toEqual({ year: 2027, periodMonth: 1 })
  })

  it('12/20은 그 해 12월분', () => {
    expect(periodLabelForDate('2026-12-20')).toEqual({ year: 2026, periodMonth: 12 })
  })
})

describe('반복 마감/마감취소 — 버전 관리 (사용자 검토 지시 #3 시나리오)', () => {
  it('한 번도 마감한 적 없으면 open, 다음 버전은 1', () => {
    expect(currentClosureStatus([])).toBe('open')
    expect(nextClosureVersion([])).toBe(1)
    expect(canClose([])).toBe(true)
    expect(canReopen([])).toBe(false)
  })

  it('최초 마감(version 1, closed) → 잠김, 재마감 불가, 마감취소는 가능', () => {
    const closures = [makeClosure({ version: 1, status: 'closed' })]
    expect(currentClosureStatus(closures)).toBe('closed')
    expect(canClose(closures)).toBe(false)
    expect(canReopen(closures)).toBe(true)
    expect(nextClosureVersion(closures)).toBe(2)
  })

  it('마감취소(같은 버전 행의 status만 reopened로 변경) → 열림, 재마감 가능', () => {
    const closures = [
      makeClosure({ version: 1, status: 'reopened', reopened_by: 'b@seon.co.kr', reopened_at: '2026-08-25T00:00:00Z', reopen_reason: '오류 수정' }),
    ]
    expect(currentClosureStatus(closures)).toBe('open')
    expect(canClose(closures)).toBe(true)
    expect(nextClosureVersion(closures)).toBe(2)
    // version 1 행 자체는 지워지지 않고 그대로 남아있다 — 이전 마감 이력 보존
    expect(closures).toHaveLength(1)
  })

  it('재마감(version 2, closed) → 다시 잠김. version 1 행은 여전히 배열에 남아 이력이 보존된다', () => {
    const closures = [
      makeClosure({ version: 1, status: 'reopened', reopened_by: 'b@seon.co.kr', reopened_at: '2026-08-25T00:00:00Z', reopen_reason: '오류 수정' }),
      makeClosure({ id: 'c2', version: 2, status: 'closed', closed_by: 'a@seon.co.kr', closed_at: '2026-08-26T00:00:00Z' }),
    ]
    expect(currentClosureStatus(closures)).toBe('closed')
    expect(nextClosureVersion(closures)).toBe(3)
    // 두 버전 모두 배열에 남아있다 — "이전 스냅샷을 단순 삭제하지 않는다" 원칙
    expect(closures.map(c => c.version)).toEqual([1, 2])
  })

  it('전체 시나리오: 최초마감 → 마감취소 → 재마감 → 재차마감취소 → 두번째재마감(version 3)까지 전부 배열에 누적된다', () => {
    const closures: AttendanceMonthClosure[] = [
      makeClosure({ id: 'v1', version: 1, status: 'reopened', reopened_by: 'b@seon.co.kr', reopened_at: '2026-08-25T00:00:00Z', reopen_reason: '1차 취소' }),
      makeClosure({ id: 'v2', version: 2, status: 'reopened', reopened_by: 'b@seon.co.kr', reopened_at: '2026-08-27T00:00:00Z', reopen_reason: '2차 취소' }),
      makeClosure({ id: 'v3', version: 3, status: 'closed', closed_by: 'a@seon.co.kr', closed_at: '2026-08-28T00:00:00Z' }),
    ]
    expect(currentClosureStatus(closures)).toBe('closed')
    expect(nextClosureVersion(closures)).toBe(4)
    expect(closures).toHaveLength(3) // v1, v2 모두 보존됨
    expect(closures.every(c => c.reopen_reason || c.status === 'closed')).toBe(true)
  })
})
