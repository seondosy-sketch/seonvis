/**
 * 프로젝트 List — "○○년 참여프로젝트 관리" xlsx 출력 API.
 *
 * UI 권한만 믿지 않고 서버에서 세션과 menu_permissions.projects를 다시 확인한다
 * (app/api/lodging/export/route.ts와 같은 패턴). 출력은 데이터를 바꾸지 않으므로 read도 허용하고
 * none만 막는다.
 *
 * "보이는 대로 출력"이 성립하도록 화면이 쓰는 검색·상태·유형 필터를 서버에서 그대로 다시 적용한다
 * — 화면이 만든 행을 통째로 올려받지 않는다. 출력물의 근거는 항상 DB여야 하기 때문이다.
 */
import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { permissionFor } from '@/lib/menuConfig'
import { buildDownloadResponse } from '@/lib/export/response'
import { computeProjectStatus } from '@/lib/projectStatus'
import { kstToday } from '@/lib/kstDate'
import { buildProjectLedgerWorkbook } from '@/lib/projects/export/projectLedgerWorkbook'
import type { LedgerProject } from '@/lib/projects/export/ledgerRows'

const LEDGER_COLUMNS =
  'project_number,type,client,name,fee,tp_score,duration_days,submit_date,interview_date,interview_written,' +
  'result_score,evaluation,participants,note,director,staff_arch,staff_civil,staff_mech,staff_safety,status_override'

interface ExportFilters {
  search?: string
  status?: string
  type?: string
}

async function assertProjectExportAccess(): Promise<boolean> {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return false

  const admin = createSupabaseAdminClient()
  const { data: row } = await admin
    .from('allowed_users')
    .select('is_admin, menu_permissions')
    .eq('email', user.email)
    .single()
  if (!row) return false
  if (row.is_admin) return true

  return permissionFor(row.menu_permissions, 'projects') !== 'none'
}

/** 화면(app/(dashboard)/projects/page.tsx)의 filtered와 같은 조건. */
function applyFilters(projects: LedgerProject[], filters: ExportFilters): LedgerProject[] {
  const q = (filters.search ?? '').trim().toLowerCase()
  const status = filters.status ?? '전체'
  const type = filters.type ?? '전체'

  return projects.filter(p => {
    const matchSearch = !q
      || p.name.toLowerCase().includes(q)
      || p.client.toLowerCase().includes(q)
      || p.director.toLowerCase().includes(q)
      || p.project_number.includes(q)
    const matchStatus = status === '전체' || computeProjectStatus(p) === status
    const matchType = type === '전체' || p.type === type
    return matchSearch && matchStatus && matchType
  })
}

export async function POST(request: Request) {
  if (!(await assertProjectExportAccess())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const filters = (body.filters ?? {}) as ExportFilters
  const year = Number(body.year) || kstToday().getFullYear()

  try {
    const admin = createSupabaseAdminClient()
    const { data, error } = await admin
      .from('projects')
      .select(LEDGER_COLUMNS)
      .order('project_number', { ascending: true })
    if (error) throw new Error(error.message)

    const projects = applyFilters((data ?? []) as unknown as LedgerProject[], filters)
    const buffer = await buildProjectLedgerWorkbook(year, projects)

    const filename = `${year}년 참여프로젝트 관리_${kstTodayStamp()}.xlsx`
    return buildDownloadResponse(buffer, filename, 'xlsx')
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '출력 생성에 실패했습니다.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/** 파일명 꼬리표 — 같은 날 여러 번 받아도 덮어쓰기 걱정이 없게 날짜를 붙인다. */
function kstTodayStamp(): string {
  const d = kstToday()
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}
