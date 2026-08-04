/**
 * 기술인 출근부 — 월별 출근명부 xlsx 출력 API (Phase 5, docs/attendance/06-implementation-plan.md).
 *
 * UI 권한만 믿지 않고 서버에서 세션과 menu_permissions.attendance를 다시 확인한다
 * (app/api/lodging/export/route.ts와 같은 패턴). 출력은 데이터를 바꾸지 않으므로 read도 허용하고
 * none만 막는다.
 *
 * "보이는 대로 출력"이 성립하도록 화면이 쓰는 필터 함수(lib/attendance/gridFilters.ts)를 서버에서
 * 그대로 다시 적용한다 — 화면이 계산한 결과를 클라이언트가 통째로 올려보내는 방식은 쓰지 않는다.
 * 출력물의 근거는 항상 DB여야 하기 때문이다.
 */
import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { permissionFor } from '@/lib/menuConfig'
import { buildDownloadResponse } from '@/lib/export/response'
import { getPayPeriodForLabel, getPayPeriodRangeForLabel, todayKST } from '@/lib/attendance/period'
import { filterParticipantRows, filterVisibleProjects } from '@/lib/attendance/gridFilters'
import { currentClosureStatus, latestVersion } from '@/lib/attendance/closureLifecycle'
import { buildMonthlyExportBlocks } from '@/lib/attendance/export/monthlyRows'
import { buildMonthlyAttendanceWorkbook } from '@/lib/attendance/export/monthlyWorkbook'
import type {
  AttendanceMonthClosure,
  AttendanceRecord,
  ProjectChangeHistory,
  ProjectParticipant,
} from '@/lib/attendance/types'

const PROJECT_COLUMNS =
  'id,project_number,name,announce_date,interview_date,bid_date,status,director,staff_arch,staff_civil,staff_mech,staff_safety'

interface ExportFilters {
  projectSearch?: string
  statusFilter?: string
  specialtyFilter?: string
  engineerSearch?: string
}

interface ProjectRow {
  id: string
  project_number: string
  name: string
  announce_date: string | null
  interview_date: string | null
  bid_date: string | null
  status: string
}

async function assertAttendanceExportAccess(): Promise<boolean> {
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

  return permissionFor(row.menu_permissions, 'attendance') !== 'none'
}

/** 마감 상태 문구 — 마감 이력이 없으면 "미마감"이라고 그대로 적는다(빈칸으로 두지 않는다). */
function closureLabel(closures: AttendanceMonthClosure[]): string {
  if (currentClosureStatus(closures) !== 'closed') {
    return closures.length === 0 ? '미마감' : '미마감 (마감취소됨)'
  }
  const latest = latestVersion(closures)
  if (!latest) return '미마감'
  const closedOn = latest.closed_at?.slice(0, 10) ?? ''
  return `완료 (${closedOn} ${latest.closed_by})`
}

export async function POST(request: Request) {
  if (!(await assertAttendanceExportAccess())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const year = Number(body.year)
  const periodMonth = Number(body.periodMonth)
  const filters = (body.filters ?? {}) as ExportFilters

  if (!year || !periodMonth || periodMonth < 1 || periodMonth > 12) {
    return NextResponse.json({ error: 'year, periodMonth(1~12)은 필수입니다.' }, { status: 400 })
  }

  try {
    const admin = createSupabaseAdminClient()
    const days = getPayPeriodForLabel(year, periodMonth)
    const { start: periodStart, end: periodEnd } = getPayPeriodRangeForLabel(year, periodMonth)

    const [projectsRes, participantsRes, recordsRes, engineersRes, specialtiesRes, historyRes, holidaysRes, closuresRes] =
      await Promise.all([
        admin.from('projects').select(PROJECT_COLUMNS).order('project_number', { ascending: true }),
        admin.from('project_participants').select('*').order('sort_order', { ascending: true }),
        admin.from('attendance_records').select('*').gte('work_date', periodStart).lte('work_date', periodEnd),
        admin.from('engineer_contacts').select('id,name').limit(5000),
        admin.from('engineer_specialties').select('id,name'),
        admin.from('project_change_history').select('*'),
        admin.from('holidays').select('holiday_date').gte('holiday_date', periodStart).lte('holiday_date', periodEnd),
        admin.from('attendance_month_closures').select('*').eq('period_year', year).eq('period_month', periodMonth),
      ])

    const projects = (projectsRes.data ?? []) as ProjectRow[]
    const participants = (participantsRes.data ?? []) as ProjectParticipant[]
    const records = (recordsRes.data ?? []) as AttendanceRecord[]
    const changeHistory = (historyRes.data ?? []) as ProjectChangeHistory[]
    const closures = (closuresRes.data ?? []) as AttendanceMonthClosure[]

    const engineerNameById = new Map(
      ((engineersRes.data ?? []) as { id: string; name: string }[]).map(e => [e.id, e.name]),
    )
    const specialtyNameById = new Map(
      ((specialtiesRes.data ?? []) as { id: string; name: string }[]).map(s => [s.id, s.name]),
    )
    const holidays = new Set(
      ((holidaysRes.data ?? []) as { holiday_date: string }[]).map(h => h.holiday_date),
    )

    // 화면과 같은 필터를 서버에서 다시 적용한다(lib/attendance/gridFilters.ts).
    const specialtyFilter = filters.specialtyFilter ?? '전체'
    const engineerSearch = filters.engineerSearch ?? ''
    const participantsOf = (projectId: string) => {
      const recordedParticipantIds = new Set(
        records.filter(r => r.project_id === projectId).map(r => r.participant_id),
      )
      return filterParticipantRows({
        participants,
        projectId,
        recordedParticipantIds,
        specialtyFilter,
        specialtyNameById,
        engineerSearch,
        engineerNameById,
      })
    }

    const visibleProjects = filterVisibleProjects({
      projects,
      periodStart,
      periodEnd,
      statusFilter: filters.statusFilter ?? '전체',
      search: filters.projectSearch ?? '',
      projectIdsWithActiveParticipants: new Set(
        participants.filter(p => p.status === '진행중').map(p => p.project_id),
      ),
      projectIdsWithRecords: new Set(records.map(r => r.project_id)),
      rowParticipantCount: projectId => participantsOf(projectId).length,
      hasParticipantFilter: specialtyFilter !== '전체' || !!engineerSearch.trim(),
    })

    const blocks = buildMonthlyExportBlocks({
      days,
      projects: visibleProjects,
      participantsOf,
      engineerNameById,
      specialtyNameById,
      records,
      changeHistory,
      periodStart,
      periodEnd,
    })

    const buffer = await buildMonthlyAttendanceWorkbook({
      year,
      periodMonth,
      days,
      periodStart,
      periodEnd,
      blocks,
      holidays,
      closureLabel: closureLabel(closures),
      printedOn: todayKST(),
    })

    const filename = `기술인출근명부_${year}${String(periodMonth).padStart(2, '0')}.xlsx`
    return buildDownloadResponse(buffer, filename, 'xlsx')
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '출력 생성에 실패했습니다.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
