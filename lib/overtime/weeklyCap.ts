import type { SupabaseClient } from '@supabase/supabase-js'
import { addDays, weekStartOf } from './assign/calendar'
import { WEEKLY_CAP_HOURS } from './assign/types'

/**
 * 주 12시간 사전검증 — 수동 입력 3경로(셀 팝오버·일괄 입력·직원별 모달)가 저장 전에 쓴다.
 *
 * 규칙은 DB 트리거(supabase/migration_overtime_planning_b_activate.sql의 private.overtime_assert_weekly_cap)와 같다:
 *   주 = 월~일, 모든 프로젝트 합산
 *   변경 후 합계 ≤ 12 → 허용
 *   변경 후 합계 > 12 이고 변경 전 합계보다 커짐 → 거부 (과거에 이미 넘은 주는 줄이거나 그대로면 허용)
 * 화면이 먼저 친절하게 막고, DB 트리거는 최종 방어선이다.
 */

export interface WeekRecord {
  id: string
  employee_id: string
  work_date: string
  hours: number
}

export interface WeeklyCapChange {
  employee_id: string
  work_date: string
  hours: number
  /** 수정이면 바뀌기 전 기록 id (그 기록의 시간은 빼고 계산) */
  replacing_id?: string | null
}

export interface WeeklyCapResult {
  employee_id: string
  week_start: string
  week_end: string
  before: number
  after: number
  ok: boolean
}

/** 기록을 조회할 범위 — 바뀌는 날짜들이 속한 주 전체(급여기간 밖 날짜 포함) */
export function weekQueryRange(dates: readonly string[]): { from: string; to: string } {
  const sorted = [...dates].sort()
  return { from: weekStartOf(sorted[0]), to: addDays(weekStartOf(sorted[sorted.length - 1]), 6) }
}

export function checkWeeklyCap(records: readonly WeekRecord[], changes: readonly WeeklyCapChange[]): WeeklyCapResult[] {
  const replaced = new Set(changes.map(c => c.replacing_id).filter((x): x is string => !!x))
  const keyOf = (employee: string, date: string) => `${employee}|${weekStartOf(date)}`
  const before = new Map<string, number>()
  const after = new Map<string, number>()
  for (const r of records) {
    const k = keyOf(r.employee_id, r.work_date)
    before.set(k, (before.get(k) ?? 0) + Number(r.hours))
    if (!replaced.has(r.id)) after.set(k, (after.get(k) ?? 0) + Number(r.hours))
  }
  const touched = new Set<string>()
  for (const c of changes) {
    const k = keyOf(c.employee_id, c.work_date)
    after.set(k, (after.get(k) ?? 0) + c.hours)
    touched.add(k)
  }
  return [...touched].sort().map(k => {
    const [employee_id, week_start] = k.split('|')
    const b = Math.round((before.get(k) ?? 0) * 100) / 100
    const a = Math.round((after.get(k) ?? 0) * 100) / 100
    return { employee_id, week_start, week_end: addDays(week_start, 6), before: b, after: a, ok: !(a > WEEKLY_CAP_HOURS && a > b) }
  })
}

/** "10/26(월)~11/1(일) 주 합계가 13시간이 되어 12시간 한도를 넘습니다" */
export function weeklyCapMessage(r: WeeklyCapResult): string {
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`
  return `${md(r.week_start)}(월)~${md(r.week_end)}(일) 주 합계가 ${r.after}시간이 되어 주 ${WEEKLY_CAP_HOURS}시간 한도를 넘습니다`
}

/**
 * 저장 전 사전검증 — 바뀌는 날짜가 속한 주의 기록을 전부(급여기간 밖 포함) 읽어 checkWeeklyCap을 돌린다.
 * 위반이 있으면 사용자 문구, 없으면 null. 기록을 읽지 못하면 null(최종 판단은 DB 트리거가 한다).
 */
export async function findWeeklyCapViolation(supabase: SupabaseClient, changes: readonly WeeklyCapChange[]): Promise<string | null> {
  if (changes.length === 0) return null
  const { from, to } = weekQueryRange(changes.map(c => c.work_date))
  const employees = [...new Set(changes.map(c => c.employee_id))]
  const { data, error } = await supabase
    .from('overtime_work_records')
    .select('id, employee_id, work_date, hours')
    .in('employee_id', employees)
    .gte('work_date', from)
    .lte('work_date', to)
  if (error || !data) return null
  const bad = checkWeeklyCap(data as WeekRecord[], changes).find(r => !r.ok)
  return bad ? weeklyCapMessage(bad) : null
}
