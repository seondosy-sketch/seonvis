/**
 * 면접 DB — 후기 HWP/HWPX 문서 읽기 API.
 *
 * 파일을 받아 **초안(JSON)만 돌려준다. 이 라우트는 DB에 아무것도 쓰지 않는다.**
 * 저장은 화면에서 사람이 값을 확인한 뒤 기존 경로(save_evaluation_review RPC)로만 일어난다 —
 * 문서 서식이 연도마다 달라 파싱이 틀릴 수 있고, 틀린 값을 조용히 DB에 남기지 않기 위함이다.
 *
 * UI 권한만 믿지 않고 서버에서 세션과 menu_permissions.interview_db를 다시 확인한다
 * (app/api/attendance/export/route.ts와 같은 패턴). 문서를 읽는 것 자체는 DB를 바꾸지 않지만,
 * 회사 문서를 서버에서 열어보는 경로이므로 면접 DB **쓰기** 권한자에게만 열어 둔다(등록 화면과
 * 같은 권한 = 이 기능을 실제로 쓸 수 있는 사람).
 *
 * 파싱 규칙은 lib/evaluations/hwpImport.ts(순수 함수)에 있고 여기서는 파일만 다룬다.
 */
import { NextResponse } from 'next/server'
import { parse } from 'kordoc'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { permissionFor } from '@/lib/menuConfig'
import {
  buildReviewDraft,
  countImportedQuestions,
  hasImportedContent,
  type ParsedBlock,
} from '@/lib/evaluations/hwpImport'

/** kordoc은 Node API(zip·버퍼)를 쓰므로 edge runtime에서 돌 수 없다. */
export const runtime = 'nodejs'

/** 한글 문서 한 건은 보통 수백 KB다. 그보다 크면 후기 문서가 아닐 가능성이 높다. */
const MAX_BYTES = 20 * 1024 * 1024
const ALLOWED_EXTENSIONS = ['.hwp', '.hwpx'] as const

async function assertInterviewWriteAccess(): Promise<boolean> {
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

  return permissionFor(row.menu_permissions, 'interview_db') === 'write'
}

export async function POST(request: Request) {
  if (!(await assertInterviewWriteAccess())) {
    return NextResponse.json({ error: '면접 DB 쓰기 권한이 없습니다.' }, { status: 403 })
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: '파일을 읽지 못했습니다.' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 })
  }

  const fileName = file.name || '문서'
  const lower = fileName.toLowerCase()
  if (!ALLOWED_EXTENSIONS.some(ext => lower.endsWith(ext))) {
    return NextResponse.json(
      { error: 'HWP 또는 HWPX 파일만 읽을 수 있습니다.', fileName },
      { status: 400 },
    )
  }
  if (file.size === 0) {
    return NextResponse.json({ error: '빈 파일입니다.', fileName }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: '파일이 너무 큽니다(20MB 초과).', fileName }, { status: 413 })
  }

  let blocks: ParsedBlock[]
  try {
    const result = await parse(Buffer.from(await file.arrayBuffer()))
    if (!result.success) {
      return NextResponse.json(
        { error: `문서를 읽지 못했습니다: ${result.error}`, fileName },
        { status: 422 },
      )
    }
    blocks = result.blocks as ParsedBlock[]
  } catch (e) {
    // 암호가 걸린 문서, 손상된 파일, 지원하지 않는 옛 서식 등 — 원인을 그대로 보여준다.
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: `문서를 읽지 못했습니다: ${message}`, fileName }, { status: 422 })
  }

  const draft = buildReviewDraft(blocks)
  if (!hasImportedContent(draft)) {
    return NextResponse.json(
      {
        error: '문서에서 후기 항목을 찾지 못했습니다. 면접후기 서식이 맞는지 확인해주세요.',
        fileName,
      },
      { status: 422 },
    )
  }

  return NextResponse.json({
    fileName,
    draft,
    questionCount: countImportedQuestions(draft),
  })
}
