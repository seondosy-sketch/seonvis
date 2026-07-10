export interface ProjectRef {
  name: string
  director: string
  client: string
  fee: number | null
  submit_date: string | null
  interview_date: string | null
  bid_date: string | null
  result_score: string
  evaluation: string
  participants: string
  status_override: string | null
  staff_arch: string
  staff_civil: string
  staff_mech: string
  staff_safety: string
}

export function getCurrentWeek(): string {
  const now = new Date()
  const jan4 = new Date(now.getFullYear(), 0, 4)
  const startOfWeek1 = new Date(jan4)
  startOfWeek1.setDate(jan4.getDate() - jan4.getDay() + 1)
  const diff = now.getTime() - startOfWeek1.getTime()
  const week = Math.ceil((diff / 86400000 + 1) / 7)
  return `${now.getFullYear()}-W${String(week).padStart(2, '0')}`
}

export function getWeekRange(week: string): { start: Date; end: Date } {
  const [year, w] = week.split('-W')
  const jan4 = new Date(parseInt(year), 0, 4)
  const startOfW1 = new Date(jan4)
  startOfW1.setDate(jan4.getDate() - jan4.getDay() + 1)
  const start = new Date(startOfW1)
  start.setDate(start.getDate() + (parseInt(w) - 1) * 7)
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  return { start, end }
}

export function parseLocalDate(d: string | null | undefined): Date | null {
  if (!d) return null
  const iso = d.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) return new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]))
  const md = d.match(/^(\d{1,2})\/(\d{1,2})$/)
  if (md) return new Date(new Date().getFullYear(), parseInt(md[1]) - 1, parseInt(md[2]))
  return null
}

function isEmpty(v: string | null | undefined) {
  return !v || v.trim() === '' || v.trim().toLowerCase() === 'nan'
}

export function computeProjectStatus(p: ProjectRef): string {
  if (p.status_override) return p.status_override
  if (p.participants?.includes('드랍') || p.participants?.includes('드롭')) return '취소'
  if (p.evaluation === '선') return '수주'
  if (isEmpty(p.result_score) || isEmpty(p.evaluation)) return '진행중'
  return '탈락'
}

export function categorizeProject(r: ProjectRef, weekStart: Date): '진행중' | '개찰' | '제외' {
  if (computeProjectStatus(r) === '취소') return '제외'

  // 1. 제출일이 이번주 이전이 아니면 → 진행중
  const submit = parseLocalDate(r.submit_date)
  if (!submit || submit >= weekStart) return '진행중'

  // 2. 발표/면접일: 공란·추후 → 진행중 / 서면 → 개찰로 / 날짜가 이번주 이후 → 진행중
  const ivRaw = r.interview_date?.trim() ?? ''
  if (ivRaw !== '서면') {
    const interview = parseLocalDate(ivRaw)
    if (!interview || interview >= weekStart) return '진행중'
  }

  // 3. 개찰일: 공란·추후 → 개찰 / 이번주 이전 → 제외 / 이번주 이후 → 개찰
  const bid = parseLocalDate(r.bid_date)
  if (bid && bid < weekStart) return '제외'
  return '개찰'
}
