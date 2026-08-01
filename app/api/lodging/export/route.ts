/**
 * 숙박관리 — 출력(Export) API. UI 권한만 신뢰하지 않고 서버에서 직접 세션과
 * menu_permissions.lodging을 검증한다(app/api/admin/users/route.ts의 assertAdmin() 패턴 재사용).
 * none → 403, read/write → 출력 진행(출력은 데이터를 변경하지 않으므로 read에도 허용).
 */
import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { permissionFor } from '@/lib/menuConfig'
import { buildDownloadResponse } from '@/lib/export/response'
import { monthOverlapQuery } from '@/lib/lodging/monthRange'
import { buildFinancialSummary, buildOccupancySummary } from '@/lib/lodging/summary'
import { LodgingRecord } from '@/lib/lodging/types'
import { buildRecordListWorkbook } from '@/lib/lodging/export/recordListWorkbook'
import { buildRecordListPdf } from '@/lib/lodging/export/recordListPdf'
import { buildMonthlySummaryWorkbook } from '@/lib/lodging/export/monthlySummaryWorkbook'
import { buildMonthlySummaryPdf } from '@/lib/lodging/export/monthlySummaryPdf'

type ExportKind = 'monthly-ledger' | 'record-list' | 'monthly-summary'
type ExportFormat = 'xlsx' | 'pdf'

interface ExportFilters {
  projectId?: string
  purpose?: string
  hotelId?: string
  guestQuery?: string
}

async function assertLodgingExportAccess(): Promise<boolean> {
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

  const perm = permissionFor(row.menu_permissions, 'lodging')
  return perm !== 'none'
}

async function fetchOverlappingRecords(year: number, month: number, filters?: ExportFilters): Promise<LodgingRecord[]> {
  const admin = createSupabaseAdminClient()
  const { monthStart, nextMonthStart } = monthOverlapQuery(year, month)
  let query = admin
    .from('lodging_records')
    .select('*')
    .lt('check_in', nextMonthStart)
    .gt('check_out', monthStart)
    .order('check_in', { ascending: true })

  if (filters?.projectId) query = query.eq('project_id', filters.projectId)
  if (filters?.purpose) query = query.eq('purpose', filters.purpose)
  if (filters?.hotelId) query = query.eq('hotel_id', filters.hotelId)
  if (filters?.guestQuery) query = query.ilike('guest_name_snapshot', `%${filters.guestQuery}%`)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []) as LodgingRecord[]
}

export async function POST(request: Request) {
  const allowed = await assertLodgingExportAccess()
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const kind = body.kind as ExportKind
  const format = body.format as ExportFormat
  const year = Number(body.year)
  const month = Number(body.month)
  const filters = body.filters as ExportFilters | undefined

  if (!kind || !format || !year || !month) {
    return NextResponse.json({ error: 'kind, format, year, month은 필수입니다.' }, { status: 400 })
  }

  if (kind === 'monthly-ledger') {
    return NextResponse.json(
      { error: 'monthly-ledger는 accommodation.xlsx 원본 분석 후 구현 예정으로 아직 지원하지 않습니다.' },
      { status: 501 },
    )
  }

  try {
    const records = await fetchOverlappingRecords(year, month, filters)
    const title = `숙박관리 ${kind === 'record-list' ? '숙박 내역' : '월별 정산서'} (${year}년 ${month}월)`

    if (kind === 'record-list') {
      const buffer = format === 'xlsx'
        ? await buildRecordListWorkbook(records, title)
        : await buildRecordListPdf(records, title)
      return buildDownloadResponse(buffer, `숙박관리_숙박내역_${year}${String(month).padStart(2, '0')}.${format}`, format)
    }

    // monthly-summary
    const occupancy = buildOccupancySummary(records, year, month)
    const financial = buildFinancialSummary(records, year, month)
    const buffer = format === 'xlsx'
      ? await buildMonthlySummaryWorkbook(occupancy, financial, year, month)
      : await buildMonthlySummaryPdf(occupancy, financial, year, month)
    return buildDownloadResponse(buffer, `숙박관리_월별정산서_${year}${String(month).padStart(2, '0')}.${format}`, format)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '출력 생성에 실패했습니다.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
