import { describe, expect, it } from 'vitest'
import { TIME_TYPE_PRESETS } from '../time'
import { eachDate, isWeekend, weekStartOf } from './calendar'
import { evaluateContinuity } from './continuity'
import { runAssignment } from './engine'
import { createRng } from './rng'
import { validateSchedule } from './validate'
import {
  ASSIGNMENT_RULE_VERSION,
  WEEKEND_REASONS,
  type AssignmentInput,
  type AssignmentProjectInput,
  type AssignmentResult,
  type GeneratedAssignment,
  type LockedRecordInput,
} from './types'

/**
 * 독립 검토(REVISE) MAJOR 1·2 회귀시험 — 검토가 재현한 반례와, 수정 전 엔진(906b8fe)의 실제 출력을 그대로 고정한다.
 * 마지막 묶음은 엔진과 무관한 완전 탐색(brute force)으로 작은 입력의 최적값을 다시 계산해 엔진 결과와 비교한다.
 */

const PERIOD = { label: '2026-10', start: '2026-09-21', end: '2026-10-20' }
const proj = (id: string, start: string, end: string, submit: string | null = end): AssignmentProjectInput => ({
  project_id: id, project_number: id, announce_date: start, submit_date: submit, period_start: start, period_end: end, auto_assignable: true,
})
const input = (target: number, projects: AssignmentProjectInput[], over: Partial<AssignmentInput> = {}): AssignmentInput => ({
  period: PERIOD, as_of: '2026-09-20', seed: 1, rule_version: ASSIGNMENT_RULE_VERSION, holidays: [], holiday_data_years: [2026],
  employees: [{ employee_id: 'e1', active: true, target_hours: target, projects: projects.map(p => ({ project_id: p.project_id, task_ids: null })) }],
  projects, tasks: [{ task_id: 't1', employee_id: 'e1', task_name: '검토', sort_order: 1 }], locked_records: [],
  ...over,
})
const pattern = (r: AssignmentResult) => r.assignments.map(a => `${a.work_date.slice(5)}:${a.project_id}${a.hours}`)
const daysOf = (r: AssignmentResult, pid: string) => r.assignments.filter(a => a.project_id === pid).length
const revisits = (r: AssignmentResult) => evaluateContinuity(r.assignments.map(a => ({ date: a.work_date, project_id: a.project_id })), () => false, () => []).revisits
const singleReasons = (r: AssignmentResult) =>
  Object.fromEntries(r.issues.filter(i => i.code === 'SINGLE_DAY_PROJECT_BLOCK').map(i => [i.project_id, (i.detail as { reason: string }).reason]))

/** 수정 전 엔진 출력을 GeneratedAssignment로 되살린다(검증기가 잡는지 보기 위해) */
function rebuild(i: AssignmentInput, rows: Array<[string, string, 2 | 3, string?]>): GeneratedAssignment[] {
  return rows.map(([date, pid, hours, reason]) => {
    const preset = TIME_TYPE_PRESETS[hours === 2 ? '2h' : '3h']
    const holiday = i.holidays.find(h => h.date === date)?.name ?? null
    return {
      employee_id: 'e1', project_id: pid, task_id: 't1', task_name: '검토', work_date: date, hours,
      time_type: hours === 2 ? '2h' : '3h', start_time: preset.start, end_time: preset.end, break_hours: preset.breakH,
      is_weekend: isWeekend(date), is_holiday: holiday !== null, holiday_name: holiday,
      exception_reason: reason ?? null, seed: i.seed, rule_version: i.rule_version,
    }
  })
}

// 검토 반례 R1: A 9/24~29(제출 10/17), B 9/26~28(10/24), C 10/5~7(10/23), 목표 10시간
const R1 = input(10, [proj('A', '2026-09-24', '2026-09-29', '2026-10-17'), proj('B', '2026-09-26', '2026-09-28', '2026-10-24'), proj('C', '2026-10-05', '2026-10-07', '2026-10-23')])
// R2: 목표 8시간, 같은 기간 A·B / R3: 목표 12시간, 같은 기간 A·B·C
const R2 = input(8, [proj('A', '2026-09-21', '2026-10-20', '2026-10-10'), proj('B', '2026-09-21', '2026-10-20', '2026-10-12')])
const R3 = input(12, [proj('A', '2026-09-21', '2026-10-20', '2026-10-10'), proj('B', '2026-09-21', '2026-10-20', '2026-10-12'), proj('C', '2026-09-21', '2026-10-20', '2026-10-14')])

describe('MAJOR 1 — 왕복·불필요한 주말·주말 사유', () => {
  it('R1 (seed 1): 수정 후 A 9/24·25 → B 9/28 → C 10/6·7, 주말 0, 왕복 0, 블록 1개씩', () => {
    const r = runAssignment(R1)
    expect(pattern(r)).toEqual(['09-24:A2', '09-25:A2', '09-28:B2', '10-06:C2', '10-07:C2'])
    expect(r.assignments.some(a => a.is_weekend || a.is_holiday)).toBe(false)
    expect(revisits(r)).toBe(0)
    expect(r.projects.map(p => [p.project_id, p.block_count])).toEqual([['A', 1], ['C', 1], ['B', 1]])
    // B는 기간 평일이 9/28 하루뿐 → 1일 블록, 사유는 기간
    expect(singleReasons(r)).toEqual({ B: 'PERIOD_TOO_SHORT' })
    expect(r.violations).toEqual([])
  })

  it('R1 수정 전 출력(9/25 A → 9/26(토) B → 9/28 A → 10/6 C)은 검증기가 왕복·사유 불일치로 잡는다', () => {
    const before = rebuild(R1, [['2026-09-25', 'A', 2], ['2026-09-26', 'B', 2, WEEKEND_REASONS.periodShort], ['2026-09-28', 'A', 3], ['2026-10-06', 'C', 3]])
    const v = validateSchedule(R1, before)
    expect(v.find(x => x.code === 'PROJECT_REVISIT')).toMatchObject({ employee_id: 'e1', project_id: 'A', date: '2026-09-28' })
    // B의 기간 평일(9/28)은 A가 쓰고 있었다 → 실제 원인은 "다른 프로젝트 배정"
    expect(v.find(x => x.code === 'EXCEPTION_REASON_MISMATCH')).toMatchObject({
      project_id: 'B', date: '2026-09-26', actual: WEEKEND_REASONS.periodShort, limit: WEEKEND_REASONS.otherProject,
    })
  })

  it('seed 1~30: R1·R2·R3 모두 왕복 0, 주말 0, 검증 위반 0, 프로젝트별 일수는 seed와 무관', () => {
    for (const base of [R1, R2, R3]) {
      const counts = new Set<string>()
      for (let seed = 1; seed <= 30; seed++) {
        const r = runAssignment({ ...base, seed })
        expect(revisits(r)).toBe(0)
        expect(r.assignments.filter(a => a.is_weekend || a.is_holiday)).toEqual([])
        expect(r.violations).toEqual([])
        counts.add(base.projects.map(p => daysOf(r, p.project_id)).join(','))
      }
      expect(counts.size).toBe(1)
    }
  })

  it('평일 대안이 있으면 주말을 쓰지 않는다 — 그 평일이 다른 프로젝트에 필요 없으면', () => {
    // B 기간 9/26(토)~9/28(월): 평일은 9/28. A가 9/28을 가져가면 B가 주말을 써야 한다 → A는 9/24·25로
    const r = runAssignment(R1)
    expect(r.assignments.find(a => a.project_id === 'B')?.work_date).toBe('2026-09-28')
    // 검증기: 같은 프로젝트의 빈 평일로 옮길 수 있는 주말 배정 → UNNECESSARY_WEEKEND
    const moved = r.assignments.map(a => (a.project_id === 'B' ? { ...a, work_date: '2026-09-27', is_weekend: true, exception_reason: WEEKEND_REASONS.periodShort } : a))
    expect(validateSchedule(R1, moved).map(v => v.code)).toContain('UNNECESSARY_WEEKEND')
  })

  it('주말 사유 = 실제 원인: 다른 프로젝트 / 주 12시간 / 제출일까지 평일 소진', () => {
    // 다른 프로젝트: A·B 모두 평일은 10/9(금) 하루, B만 주말 포함 → A가 금요일, B는 주말
    const other = runAssignment(input(4, [proj('A', '2026-10-09', '2026-10-09'), proj('B', '2026-10-09', '2026-10-11')]))
    expect(other.assignments.find(a => a.project_id === 'B')).toMatchObject({ is_weekend: true, exception_reason: WEEKEND_REASONS.otherProject })
    // 주 12시간: A 기간 10/8~10/12, 10/8 잠금, 10/12가 속한 주는 다른 기록 12시간 → 월요일은 빈 평일이지만 주 한도
    const locked: LockedRecordInput[] = [
      { employee_id: 'e1', project_id: 'X', work_date: '2026-10-08', hours: 2, task_name: '기존', source: 'manual' },
      { employee_id: 'e1', project_id: 'X', work_date: '2026-10-13', hours: 12, task_name: '기존', source: 'manual' },
    ]
    const cap = runAssignment(input(18, [proj('A', '2026-10-08', '2026-10-12', '2026-10-30')], { locked_records: locked }))
    expect(cap.assignments.map(a => [a.work_date, a.exception_reason])).toEqual([['2026-10-09', null], ['2026-10-10', WEEKEND_REASONS.weeklyCap]])
    // 평일 소진 + 종료일 = 제출일
    const submit = runAssignment(input(6, [proj('A', '2026-10-09', '2026-10-11')]))
    expect(submit.assignments.map(a => [a.work_date, a.exception_reason])).toEqual([['2026-10-09', null], ['2026-10-10', WEEKEND_REASONS.untilSubmit]])
    for (const r of [other, cap, submit]) expect(r.violations).toEqual([])
    // 검증기는 사유 문구를 바꾸면 잡는다
    const tampered = other.assignments.map(a => (a.project_id === 'B' ? { ...a, exception_reason: WEEKEND_REASONS.untilSubmit } : a))
    expect(validateSchedule(input(4, [proj('A', '2026-10-09', '2026-10-09'), proj('B', '2026-10-09', '2026-10-11')]), tampered).map(v => v.code)).toContain('EXCEPTION_REASON_MISMATCH')
  })
})

describe('MAJOR 2 — 1일 블록 최소·최소 2일', () => {
  it('R2: 목표 8시간 A·B → A 2+2, B 2+2 (수정 전 A 3+3, B 2)', () => {
    const r = runAssignment(R2)
    expect(pattern(r)).toEqual(['09-25:A2', '09-28:A2', '10-09:B2', '10-12:B2'])
    expect(singleReasons(r)).toEqual({})
    const before = rebuild(R2, [['2026-09-25', 'A', 3], ['2026-09-28', 'A', 3], ['2026-10-09', 'B', 2]])
    expect(validateSchedule(R2, before).find(v => v.code === 'AVOIDABLE_SINGLE_DAY')).toMatchObject({ project_id: 'B', date: '2026-10-09' })
  })

  it('검증기: 같은 프로젝트 블록 안에 빈 평일을 두고 끊긴 배치를 잡는다(PROJECT_BLOCK_SPLIT)', () => {
    const r = runAssignment(R2)
    // A 9/25(금)·9/28(월)은 주말만 사이에 있어 이어진 블록 → 9/28을 9/30으로 바꾸면 9/28·29가 비어 끊긴다
    const split = r.assignments.map(a => (a.work_date === '2026-09-28' ? { ...a, work_date: '2026-09-30' } : a))
    expect(validateSchedule(R2, r.assignments).map(v => v.code)).not.toContain('PROJECT_BLOCK_SPLIT')
    expect(validateSchedule(R2, split).find(v => v.code === 'PROJECT_BLOCK_SPLIT')).toMatchObject({ project_id: 'A', actual: 1 })
  })

  it('R3: 목표 12시간 프로젝트 3개 → 프로젝트마다 2일 (수정 전 C 1일)', () => {
    const r = runAssignment(R3)
    expect(['A', 'B', 'C'].map(p => daysOf(r, p))).toEqual([2, 2, 2])
    expect(r.assignments.every(a => a.hours === 2)).toBe(true)
    expect(singleReasons(r)).toEqual({})
    const before = rebuild(R3, [['2026-09-25', 'A', 3], ['2026-09-28', 'A', 3], ['2026-10-05', 'B', 2], ['2026-10-06', 'B', 2], ['2026-10-14', 'C', 2]])
    expect(validateSchedule(R3, before).find(v => v.code === 'AVOIDABLE_SINGLE_DAY')).toMatchObject({ project_id: 'C' })
  })

  it('정말 2일을 확보할 수 없을 때만 1일 블록 — 사유별', () => {
    // 목표 하루뿐
    expect(singleReasons(runAssignment(input(3, [proj('A', '2026-09-21', '2026-10-20')])))).toEqual({ A: 'TARGET_TOO_SMALL' })
    // 기간 평일 1일
    expect(singleReasons(runAssignment(input(6, [proj('A', '2026-10-09', '2026-10-09')])))).toEqual({ A: 'PERIOD_TOO_SHORT' })
    // 목표로 만들 수 있는 일수가 프로젝트마다 2일씩에 모자람(10시간, 3개 → 5일: 2·2·1)
    const few = runAssignment(input(10, [proj('A', '2026-09-21', '2026-10-20', '2026-10-01'), proj('B', '2026-09-21', '2026-10-20', '2026-10-12'), proj('C', '2026-09-21', '2026-10-20', '2026-10-20')]))
    expect(['A', 'B', 'C'].map(p => daysOf(few, p))).toEqual([2, 2, 1])
    expect(singleReasons(few)).toEqual({ C: 'NOT_ENOUGH_DAYS' })
    // 최소 2일을 위해 월 목표·주 12시간·기간·주말 규칙을 어기지 않는다
    for (const r of [few]) {
      expect(r.violations).toEqual([])
      expect(r.assignments.reduce((s, a) => s + a.hours, 0)).toBe(10)
    }
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 독립 기준: 작은 입력에서 가능한 모든 배치를 직접 나열해 최적값을 구한다(엔진·검증기 코드를 쓰지 않음).
// 비교 항목: 배정 시간 T(최대), 받은 프로젝트 수·제출일 우선, 주말·공휴일 수, 피할 수 있었던 1일 블록 수, 2일 이상 프로젝트 수.
// ════════════════════════════════════════════════════════════════════════════
const SMALL = { label: '2026-10', start: '2026-10-07', end: '2026-10-15' }   // 수~다음 주 목, 주말 1번(10/10·11)

function bruteForce(i: AssignmentInput) {
  const e = i.employees[0]
  const dates = eachDate(SMALL.start, SMALL.end)
  const holidays = new Set(i.holidays.map(h => h.date))
  const off = (d: string) => isWeekend(d) || holidays.has(d)
  const locked = new Set(i.locked_records.map(r => r.work_date))
  const lockedWeek = new Map<string, number>()
  for (const r of i.locked_records) lockedWeek.set(weekStartOf(r.work_date), (lockedWeek.get(weekStartOf(r.work_date)) ?? 0) + r.hours)
  const capH = (w: string) => Math.max(0, Math.floor(12 - (lockedWeek.get(w) ?? 0)))
  const lockedInPeriod = i.locked_records.filter(r => r.work_date >= SMALL.start && r.work_date <= SMALL.end).reduce((s, r) => s + r.hours, 0)
  const remaining = (e.target_hours ?? 0) - lockedInPeriod
  const usable = remaining >= 2 ? Math.floor(remaining) : 0
  // 우선순위(문서 규칙) = 제출일 → 대상기간 종료일 → 공고일 → 공사번호(여기서는 id와 같음)
  const cmp = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0)
  const ps = i.projects.filter(p => e.projects.some(m => m.project_id === p.project_id))
    .sort((a, b) => cmp(a.submit_date!, b.submit_date!) || cmp(a.period_end!, b.period_end!) || cmp(a.announce_date!, b.announce_date!) || cmp(a.project_id, b.project_id))
  const inWin = (k: number, d: string) => d >= ps[k].period_start! && d <= ps[k].period_end!
  const capable = ps.map((_, k) => {
    const perWeek = new Map<string, number>()
    for (const d of dates) if (!off(d) && !locked.has(d) && inWin(k, d)) perWeek.set(weekStartOf(d), (perWeek.get(weekStartOf(d)) ?? 0) + 1)
    let n = 0
    for (const [w, c] of perWeek) n += Math.min(c, Math.floor(capH(w) / 2))
    return n >= 2
  })
  let best: { T: number; key: number[] } | null = null
  const better = (a: number[], b: number[]) => { for (let x = 0; x < a.length; x++) if (a[x] !== b[x]) return a[x] < b[x]; return false }
  const assign: number[] = new Array(dates.length).fill(-1)
  const walk = (idx: number, cur: number, used: number) => {
    if (idx === dates.length) {
      const perWeek = new Map<string, number>()
      const cnt = ps.map(() => 0)
      let weekend = 0
      dates.forEach((d, x) => {
        if (assign[x] < 0) return
        perWeek.set(weekStartOf(d), (perWeek.get(weekStartOf(d)) ?? 0) + 1)
        cnt[assign[x]]++
        if (off(d)) weekend++
      })
      let lo = 0
      let hi = 0
      for (const [w, k] of perWeek) {
        if (2 * k > capH(w)) return
        lo += 2 * k
        hi += Math.min(3 * k, capH(w))
      }
      const T = Math.min(hi, usable)
      if (T < lo || (T === 0 && lo === 0 && usable > 0 && false)) return
      if (lo > usable) return
      const covered = cnt.filter(c => c > 0).length
      const prio = cnt.reduce((s, c, k) => s + (c > 0 ? 2 ** (ps.length - 1 - k) : 0), 0)
      const singles = cnt.filter((c, k) => c === 1 && capable[k]).length
      const twoPlus = cnt.filter(c => c >= 2).length
      const key = [-T, -covered, -prio, weekend, singles, -twoPlus]
      if (!best || better(key, best.key)) best = { T, key }
      return
    }
    const d = dates[idx]
    assign[idx] = -1
    walk(idx + 1, cur, used)
    if (locked.has(d)) return
    if (cur >= 0 && inWin(cur, d)) { assign[idx] = cur; walk(idx + 1, cur, used); assign[idx] = -1 }
    for (let k = 0; k < ps.length; k++) {
      if (used & (1 << k) || !inWin(k, d)) continue
      assign[idx] = k
      walk(idx + 1, k, used | (1 << k))
      assign[idx] = -1
    }
  }
  walk(0, -1, 0)
  return { best: best as { T: number; key: number[] } | null, ps, capable, off }
}

describe('무작위 소규모 — 엔진 결과가 완전 탐색 최적값과 같다 (왕복·평일 우선·최소 2일)', () => {
  it('200개 시나리오: 시간·받은 프로젝트·주말 수·1일 블록·2일 이상 프로젝트 수가 최적, 왕복 0, 검증 위반 0', () => {
    const rng = createRng(20261007)
    const dates = eachDate(SMALL.start, SMALL.end)
    let compared = 0
    for (let n = 0; n < 200; n++) {
      const count = 1 + rng.int(3)
      const projects = Array.from({ length: count }, (_, k) => {
        const s = dates[rng.int(dates.length)]
        const e = dates[Math.min(dates.length - 1, dates.indexOf(s) + rng.int(7))]
        return proj(`p${k}`, s, e, `2026-10-${String(16 + rng.int(10)).padStart(2, '0')}`)
      })
      const locked = Array.from({ length: rng.int(3) }, () => ({
        employee_id: 'e1', project_id: 'X', work_date: dates[rng.int(dates.length)], hours: 1 + rng.int(6), task_name: '기존', source: 'manual' as const,
      })).filter((l, x, all) => all.findIndex(y => y.work_date === l.work_date) === x)
      const holidays = dates.filter(() => rng.int(10) === 0).map(d => ({ date: d, name: '휴일' }))
      const i = input(2 + rng.int(22), projects, { period: SMALL, seed: n, locked_records: locked, holidays })
      const r = runAssignment(i)
      expect(r.violations).toEqual([])
      expect(revisits(r)).toBe(0)
      const ref = bruteForce(i)
      const T = r.assignments.reduce((s, a) => s + a.hours, 0)
      if (!ref.best) { expect(T).toBe(0); continue }
      const cnt = ref.ps.map(p => daysOf(r, p.project_id))
      const key = [
        -T,
        -cnt.filter(c => c > 0).length,
        -cnt.reduce((s, c, k) => s + (c > 0 ? 2 ** (ref.ps.length - 1 - k) : 0), 0),
        r.assignments.filter(a => ref.off(a.work_date)).length,
        cnt.filter((c, k) => c === 1 && ref.capable[k]).length,
        -cnt.filter(c => c >= 2).length,
      ]
      expect({ n, key }).toEqual({ n, key: ref.best.key })
      compared++
    }
    expect(compared).toBeGreaterThan(100)
  })
})

describe('무작위 전체 기간 — 왕복·평일 우선·최소 2일 조건', () => {
  it('300개 시나리오: 왕복 0, 검증기의 새 검사(왕복·불필요한 주말·사유 불일치·끊김·피할 수 있었던 1일 블록) 위반 0', () => {
    const rng = createRng(99)
    const dates = eachDate(PERIOD.start, PERIOD.end)
    for (let n = 0; n < 300; n++) {
      const projects = Array.from({ length: 1 + rng.int(5) }, (_, k) => {
        const s = dates[rng.int(dates.length)]
        const e = dates[Math.min(dates.length - 1, dates.indexOf(s) + rng.int(25))]
        return proj(`p${k}`, s, e, rng.int(3) ? e : '2026-10-30')
      })
      const locked = Array.from({ length: rng.int(5) }, () => ({
        employee_id: 'e1', project_id: 'X', work_date: dates[rng.int(dates.length)], hours: 1 + rng.int(8), task_name: '기존', source: 'manual' as const,
      })).filter((l, x, all) => all.findIndex(y => y.work_date === l.work_date) === x)
      const holidays = dates.filter(() => rng.int(12) === 0).map(d => ({ date: d, name: '휴일' }))
      const i = input(rng.int(48), projects, { seed: n, locked_records: locked, holidays })
      const r = runAssignment(i)
      expect({ n, v: r.violations }).toEqual({ n, v: [] })
      expect(revisits(r)).toBe(0)
      for (const a of r.assignments) if (a.is_weekend || a.is_holiday) expect(Object.values(WEEKEND_REASONS)).toContain(a.exception_reason)
    }
  })
})
