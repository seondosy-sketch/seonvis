import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

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
