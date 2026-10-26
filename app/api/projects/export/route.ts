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
import { canUseMenu } from '@/lib/auth/menuAccess'
import { buildDownloadResponse } from '@/lib/export/response'
import { computeProjectStatus } from '@/lib/projectStatus'
import { kstToday } from '@/lib/kstDate'
import { buildProjectLedgerWorkbook } from '@/lib/projects/export/projectLedgerWorkbook'
import type { LedgerProject } from '@/lib/projects/export/ledgerRows'
import { buildArchiveParticipationSheet, type ArchiveStaffRow } from '@/lib/projects/archive'

const LEDGER_COLUMNS =
  'project_number,type,client,name,fee,tp_score,duration_days,submit_date,interview_date,interview_written,' +
  'result_score,evaluation,participants,note,director,staff_arch,staff_civil,staff_mech,staff_safety,status_override'

interface ExportFilters {
  search?: string
  status?: string
  type?: string
}

async function assertProjectExportAccess(): Promise<boolean> {
  // 출력은 데이터를 바꾸지 않으므로 read 이상 허용(none만 403)
  // 관리자(DB allowed_users.is_admin)는 전체 허용, 미승인·비로그인은 거부 — 화면(requireMenu)과 같은 판정(lib/auth/menuAccess.ts)
  return canUseMenu('projects', 'read')
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

    // 과거 연도 — 보관 표(project_archive)에 그 연도가 있으면 거기서 읽는다. 2시트는 계산하지 않고
    // 저장된 엑셀 2시트 원본을 쓴다(과거 대장은 1시트에 분야 인력 칸이 없다). 필터는 1시트에만 건다 —
    // 2시트 원본 줄은 사람 단위라 프로젝트 필터와 1:1로 대응하지 않는다.
    const { data: archived, error: archiveError } = await admin
      .from('project_archive')
      .select(`id,${LEDGER_COLUMNS}`)
      .eq('ledger_year', year)
      .order('project_number', { ascending: true })
    if (archiveError && archiveError.code !== '42P01') throw new Error(archiveError.message) // 42P01 = 보관 표 미생성

    let buffer: Buffer
    if (archived && archived.length > 0) {
      const { data: staff, error: staffError } = await admin
        .from('project_archive_staff')
        .select('section,person_seq,name,field,line_no,project_text,archive_project_id')
        .eq('ledger_year', year)
      if (staffError) throw new Error(staffError.message)
      const all = archived as unknown as (LedgerProject & { id: string })[]
      const sheet = buildArchiveParticipationSheet((staff ?? []) as ArchiveStaffRow[], all)
      buffer = await buildProjectLedgerWorkbook(year, applyFilters(all, filters), sheet)
    } else {
      const { data, error } = await admin
        .from('projects')
        .select(LEDGER_COLUMNS)
        .order('project_number', { ascending: true })
      if (error) throw new Error(error.message)
      buffer = await buildProjectLedgerWorkbook(year, applyFilters((data ?? []) as unknown as LedgerProject[], filters))
    }

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
