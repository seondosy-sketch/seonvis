// 이 파일은 이제 주간보고 도메인 타입만 제공한다.
// 예전에 여기 있던 레거시 anon 클라이언트(createClient, localStorage 세션)는 제거했다 —
// 앱 로그인은 쿠키에만 세션을 저장하므로, 레거시 클라이언트는 토큰이 만료되면 RLS(authenticated
// 전용)에 걸려 "오류 없이 빈 결과"를 돌려줬다 (주간보고 발주예상이 사라져 보이던 버그의 원인).
// Supabase 접근은 항상 lib/supabase-browser.ts(클라이언트) 또는 lib/supabase-server.ts(서버)를 쓸 것.

export type ProjectStatus = '개찰' | '진행중'

export interface PerformingProject {
  id?: string
  status: ProjectStatus
  name: string
  director: string
  submit_date: string
  interview_date: string
  result_date: string
  fee: number | null
  note: string
  sort_order: number
  week: string
}

export interface ExpectedProject {
  id?: string
  name: string
  client: string
  director: string
  project_cost: string
  order_month: string
  fee: string
  note: string
  sort_order: number
  week: string
}

export interface WeeklyMeta {
  id?: string
  week: string
  education_note: string
  edu_chief: string
  edu_arch: string
  edu_civil: string
  edu_safety: string
  edu_mech: string
  other_note: string
}
