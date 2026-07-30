/**
 * 주차 계산 + 이번 주 프로젝트 일정 추출 — 대시보드(app/(dashboard)/page.tsx)와
 * 홈화면 위젯(app/api/widget/summary)이 공유하는 순수 함수 모음.
 *
 * 원래 대시보드 페이지 안에 있던 로컬 함수들을 그대로 옮겨왔다. 위젯이 "대시보드와 같은
 * 화면"을 보여줘야 하므로 두 곳이 같은 계산을 쓰는 게 중요하다 — 복사해두면 한쪽만 고쳐져
 * 위젯 숫자와 웹 화면이 어긋난다.
 *
 * 주차 규칙: ISO 8601이 아니라 "1월 4일이 포함된 주의 월요일"을 W01의 시작으로 잡는 기존
 * 방식을 유지한다(실제로 ISO와 결과가 같지만, 계산식을 바꾸면 저장된 performing_projects.week
 * 값과 어긋날 수 있어 손대지 않는다).
 *
 * 날짜는 전부 "달력 날짜"로만 다룬다 — 시:분이 없는 로컬 자정 Date. 그래서 서버(UTC)에서
 * 돌려도 넘겨주는 기준 시각만 KST로 맞춰주면(lib/widget/summary.ts의 kstToday) 결과가 같다.
 */
import type { PerformingProject } from '@/lib/supabase'

export interface ScheduleItem { name: string; date: string }
export interface WeekSchedule { submit: ScheduleItem[]; interview: ScheduleItem[]; result: ScheduleItem[] }

/**
 * 기준 시각이 속한 주차 문자열(예: '2026-W31').
 * now를 주입할 수 있게 한 건 서버에서 KST 기준 날짜를 넣어야 하기 때문 —
 * 인자를 비우면 기존 대시보드처럼 실행 환경의 현재 시각을 쓴다.
 */
export function getCurrentWeek(now: Date = new Date()): string {
  const jan4 = new Date(now.getFullYear(), 0, 4)
  const startOfWeek1 = new Date(jan4)
  startOfWeek1.setDate(jan4.getDate() - jan4.getDay() + 1)
  const diff = now.getTime() - startOfWeek1.getTime()
  const week = Math.ceil((diff / 86400000 + 1) / 7)
  return `${now.getFullYear()}-W${String(week).padStart(2, '0')}`
}

export function getWeekBounds(week: string): { start: Date; end: Date } {
  const [year, w] = week.split('-W')
  const jan4 = new Date(parseInt(year), 0, 4)
  const startOfW1 = new Date(jan4)
  startOfW1.setDate(jan4.getDate() - jan4.getDay() + 1)
  const start = new Date(startOfW1)
  start.setDate(start.getDate() + (parseInt(w) - 1) * 7)
  const end = new Date(start); end.setDate(end.getDate() + 6)
  return { start, end }
}

export function parseDate(raw: string | null | undefined, refYear: number): Date | null {
  if (!raw || raw === '추후' || raw === '-') return null
  const m1 = raw.match(/^(\d{1,2})\/(\d{1,2})$/)
  if (m1) return new Date(refYear, parseInt(m1[1]) - 1, parseInt(m1[2]))
  const m2 = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m2) return new Date(parseInt(m2[1]), parseInt(m2[2]) - 1, parseInt(m2[3]))
  return null
}

export function fmtDate(raw: string | null | undefined): string {
  if (!raw || raw === '추후' || raw === '-') return '추후'
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) return `${parseInt(m[2])}/${parseInt(m[3])}`
  return raw
}

export function buildSchedule(performing: PerformingProject[], start: Date, end: Date): WeekSchedule {
  const refYear = start.getFullYear()
  const submit: ScheduleItem[] = []
  const interview: ScheduleItem[] = []
  const result: ScheduleItem[] = []
  for (const p of performing) {
    if (!p.name) continue
    const sd = parseDate(p.submit_date, refYear)
    const id = parseDate(p.interview_date, refYear)
    const rd = parseDate(p.result_date, refYear)
    if (sd && sd >= start && sd <= end) submit.push({ name: p.name, date: fmtDate(p.submit_date) })
    if (id && id >= start && id <= end) interview.push({ name: p.name, date: fmtDate(p.interview_date) })
    if (rd && rd >= start && rd <= end) result.push({ name: p.name, date: fmtDate(p.result_date) })
  }
  return { submit, interview, result }
}
