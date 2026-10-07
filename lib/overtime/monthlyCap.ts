import type { SupabaseClient } from '@supabase/supabase-js'
import { payPeriodRange } from './summary'
import { findWeeklyCapViolation, type WeeklyCapChange } from './weeklyCap'

/**
 * 월 목표시간 = 급여기간(전월 21일 ~ 당월 20일) 직원별 총 연장근무 한도.
 * 수동 입력 3경로(셀 팝오버·일괄 입력·직원별 모달)가 저장 전에 쓰고, 같은 규칙을 DB 트리거
 * (supabase/migration_overtime_monthly_target_guard.sql의 private.overtime_assert_monthly_target)가 최종 강제한다.
 *
 * 근무일이 속한 급여기간(도착 기간)마다 before(변경 전 합계)·after(변경 후 합계)를 계산한다 — 수동·자동확정, 모든 프로젝트 합산.
 *   목표 행 없음 → after < before일 때만 허용, 아니면 OVERTIME_MONTHLY_TARGET_MISSING
 *   after ≤ 목표 → 허용 (같아도 허용)
 *   after > 목표 → after < before(초과 상태에서 줄이는 수정)일 때만 허용, 아니면 OVERTIME_MONTHLY_TARGET_EXCEEDED
 * 수정에서 직원·날짜·시간이 그대로면 검사하지 않는다. 다른 급여기간으로 옮기면 출발 기간은 줄기만 하므로 보지 않는다.
 */

export type MonthlyCapCode = 'OVERTIME_MONTHLY_TARGET_MISSING' | 'OVERTIME_MONTHLY_TARGET_EXCEEDED'

export interface MonthRecord {
  id: string
  employee_id: string
  work_date: string
  hours: number
}

export interface MonthlyTargetRow {
  employee_id: string
  period_label: string
  target_hours: number | null
}

export interface MonthlyCapResult {
  employee_id: string
  period_label: string
  start: string
  end: string
  target: number | null
  before: number
  after: number
  ok: boolean
  code: MonthlyCapCode | null
}

const round = (n: number) => Math.round(n * 100) / 100

/** 근무일 → 급여기간. 21일부터는 다음 달 라벨 (DB private.overtime_pay_period_label과 같은 규칙) */
export function payPeriodOf(date: string): { label: string; start: string; end: string } {
  let year = Number(date.slice(0, 4))
  let month0 = Number(date.slice(5, 7)) - 1
  if (Number(date.slice(8, 10)) >= 21) {
    month0 += 1
    if (month0 > 11) { month0 = 0; year += 1 }
  }
  const { start, end } = payPeriodRange(year, month0)
  return { label: `${year}-${String(month0 + 1).padStart(2, '0')}`, start, end }
}

/**
 * records: 바뀌는 날짜들이 속한 급여기간의 기록 전부(그 직원들). 수정하는 행이 다른 기간에 있으면 없어도 된다.
 * changes의 replacing_id가 가리키는 기록이 직원·날짜·시간 그대로면 그 변경은 검사하지 않는다.
 */
export function checkMonthlyTarget(
  records: readonly MonthRecord[],
  targets: readonly MonthlyTargetRow[],
  changes: readonly WeeklyCapChange[],
): MonthlyCapResult[] {
  const byId = new Map(records.map(r => [r.id, r]))
  const effective = changes.filter(c => {
    const old = c.replacing_id ? byId.get(c.replacing_id) : undefined
    return !(old && old.employee_id === c.employee_id && old.work_date === c.work_date && Number(old.hours) === Number(c.hours))
  })
  const replaced = new Set(effective.map(c => c.replacing_id).filter((x): x is string => !!x))

  const groups = new Map<string, { employee_id: string; period: ReturnType<typeof payPeriodOf>; added: number }>()
  for (const c of effective) {
    const period = payPeriodOf(c.work_date)
    const k = `${c.employee_id}|${period.label}`
    const g = groups.get(k) ?? { employee_id: c.employee_id, period, added: 0 }
    g.added += Number(c.hours)
    groups.set(k, g)
  }

  return [...groups.values()]
    .sort((a, b) => a.period.label.localeCompare(b.period.label) || a.employee_id.localeCompare(b.employee_id))
    .map(({ employee_id, period, added }) => {
      let before = 0
      let kept = 0
      for (const r of records) {
        if (r.employee_id !== employee_id || r.work_date < period.start || r.work_date > period.end) continue
        before += Number(r.hours)
        if (!replaced.has(r.id)) kept += Number(r.hours)
      }
      const after = round(kept + added)
      before = round(before)
      const row = targets.find(t => t.employee_id === employee_id && t.period_label === period.label)
      const target = row && row.target_hours !== null && row.target_hours !== undefined ? Number(row.target_hours) : null
      let code: MonthlyCapCode | null = null
      if (!(after < before)) {
        if (target === null) code = 'OVERTIME_MONTHLY_TARGET_MISSING'
        else if (after > target) code = 'OVERTIME_MONTHLY_TARGET_EXCEEDED'
      }
      return { employee_id, period_label: period.label, start: period.start, end: period.end, target, before, after, ok: code === null, code }
    })
}

/** 화면 문구 — 급여기간, 목표, 현재 합계, 입력 후 합계, 초과시간 */
export function monthlyCapMessage(r: MonthlyCapResult): string {
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`
  const period = `${r.period_label} 급여기간(${md(r.start)}~${md(r.end)})`
  if (r.code === 'OVERTIME_MONTHLY_TARGET_MISSING') {
    return `${period}의 월 목표시간이 없어 저장할 수 없습니다 — 현재 합계 ${r.before}시간, 입력 후 ${r.after}시간. 자동배정 › 설정에서 월 목표시간을 먼저 입력하세요.`
  }
  return `${period} 월 목표 ${r.target}시간을 넘어 저장할 수 없습니다 — 현재 합계 ${r.before}시간, 입력 후 ${r.after}시간 (${round(r.after - (r.target ?? 0))}시간 초과)`
}

/**
 * 저장 전 월 목표 검사 — 바뀌는 날짜의 급여기간 기록·목표를 읽어 checkMonthlyTarget을 돌린다.
 * 위반이 있으면 사용자 문구, 없으면 null. 읽지 못하면 null(최종 판단은 DB 트리거).
 */
export async function findMonthlyTargetViolation(supabase: SupabaseClient, changes: readonly WeeklyCapChange[]): Promise<string | null> {
  if (changes.length === 0) return null
  const periods = changes.map(c => payPeriodOf(c.work_date))
  const from = periods.map(p => p.start).sort()[0]
  const to = periods.map(p => p.end).sort().reverse()[0]
  const employees = [...new Set(changes.map(c => c.employee_id))]
  const labels = [...new Set(periods.map(p => p.label))]
  const [recRes, tgRes] = await Promise.all([
    supabase.from('overtime_work_records').select('id, employee_id, work_date, hours').in('employee_id', employees).gte('work_date', from).lte('work_date', to),
    supabase.from('overtime_monthly_targets').select('employee_id, period_label, target_hours').in('employee_id', employees).in('period_label', labels),
  ])
  if (recRes.error || tgRes.error || !recRes.data || !tgRes.data) return null
  const bad = checkMonthlyTarget(recRes.data as MonthRecord[], tgRes.data as MonthlyTargetRow[], changes).find(r => !r.ok)
  return bad ? monthlyCapMessage(bad) : null
}

/**
 * 수동 입력 저장 전 검사 — 순서: 월 목표 존재 → 월 목표 초과 → 주 12시간.
 * (필수 입력·시간 산출·자동확정 잠금은 각 화면이 이 함수를 부르기 전에 처리한다.)
 */
export async function precheckManualSave(supabase: SupabaseClient, changes: readonly WeeklyCapChange[]): Promise<string | null> {
  return (await findMonthlyTargetViolation(supabase, changes)) ?? (await findWeeklyCapViolation(supabase, changes))
}
