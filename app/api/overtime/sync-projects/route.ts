import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { permissionFor } from '@/lib/menuConfig'
import { kstTodayKey } from '@/lib/kstDate'
import { isStrictIsoDate, type BidProjectSource } from '@/lib/overtime/eligibility'
import { planBidProjectSync } from '@/lib/overtime/sync'
import type { Project } from '@/lib/overtime/types'

/**
 * 연장근무 프로젝트 동기화 — 프로젝트 List(projects) → overtime_projects (docs/overtime-planning-db.md "C안").
 *
 * 1) 로그인 사용자의 연장근무 권한(none 아님)을 서버에서 확인한다 — 읽기 권한 사용자도 화면을 열면 갱신된다.
 * 2) 서버가 planBidProjectSync(대상기간 판정은 lib/overtime/eligibility.ts)로 계획을 세운다 — 규칙은 TS 한 곳.
 * 3) service role로 overtime_apply_project_sync RPC를 한 번 호출 → 한 트랜잭션으로 반영(원본 대조·멱등·직렬화는 RPC가).
 * service role key는 이 서버 코드 안에서만 쓰고 응답·로그에 내보내지 않는다. 로그에 사람 이름·이메일을 남기지 않는다.
 */
export const dynamic = 'force-dynamic'

const SOURCE_COLUMNS = 'id, project_number, name, announce_date, submit_date, interview_date, interview_written, bid_date, status'

function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
}

async function canViewOvertime(): Promise<boolean> {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const email = user?.email?.toLowerCase()
  if (!email) return false
  if (adminEmails().includes(email)) return true
  const { data: row } = await createSupabaseAdminClient()
    .from('allowed_users')
    .select('is_admin, menu_permissions')
    .eq('email', email)
    .maybeSingle()
  if (!row) return false
  if (row.is_admin) return true
  return permissionFor(row.menu_permissions, 'overtime') !== 'none'
}

export async function POST(request: Request) {
  if (!(await canViewOvertime())) return NextResponse.json({ ok: false, reason: 'forbidden' }, { status: 403 })

  let start: unknown
  let end: unknown
  try {
    ({ start, end } = (await request.json()) as { start?: unknown; end?: unknown })
  } catch {
    return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 })
  }
  if (typeof start !== 'string' || typeof end !== 'string' || !isStrictIsoDate(start) || !isStrictIsoDate(end) || start > end) {
    return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 })
  }

  const admin = createSupabaseAdminClient()
  const [sourcesRes, existingRes] = await Promise.all([
    admin.from('projects').select(SOURCE_COLUMNS),
    admin.from('overtime_projects').select('*'),
  ])
  if (sourcesRes.error || existingRes.error) {
    console.error('[overtime sync] read failed', sourcesRes.error?.code ?? existingRes.error?.code)
    return NextResponse.json({ ok: false, reason: 'read-failed' }, { status: 502 })
  }

  const plan = planBidProjectSync(sourcesRes.data as BidProjectSource[], existingRes.data as Project[], { start, end }, kstTodayKey())
  let applied = { inserted: 0, updated: 0 }
  if (plan.inserts.length > 0 || plan.updates.length > 0) {
    const { data, error } = await admin.rpc('overtime_apply_project_sync', { p_inserts: plan.inserts, p_updates: plan.updates })
    if (error) {
      console.error('[overtime sync] apply failed', error.code)
      return NextResponse.json({ ok: false, reason: 'apply-failed' }, { status: 502 })
    }
    applied = data as typeof applied
  }
  return NextResponse.json({ ok: true, ...applied, attention: plan.attention })
}
