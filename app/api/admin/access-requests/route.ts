import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { normalizeEmail, requireAdminAccess } from '@/lib/access'
import { NextResponse } from 'next/server'

export async function GET() {
  const actor = await requireAdminAccess()
  if (!actor) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin.from('access_requests').select('*').order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PATCH(request: Request) {
  const actor = await requireAdminAccess()
  if (!actor) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id, email, status } = await request.json()
  if (!id || !status) return NextResponse.json({ error: 'id, status required' }, { status: 400 })

  const admin = createSupabaseAdminClient()

  // 신청자가 적어둔 이름/사유를 승인 시 메모 초기값으로 옮기기 위해 먼저 읽어둔다.
  const { data: requestRow } = await admin
    .from('access_requests')
    .select('name, reason')
    .eq('id', id)
    .maybeSingle()

  // 상태 업데이트
  const { error } = await admin.from('access_requests').update({
    status,
    reviewed_at: new Date().toISOString(),
    reviewed_by: actor.email,
  }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // 승인이면 allowed_users에 추가
  if (status === 'approved' && email) {
    const normalizedEmail = normalizeEmail(email)
    // 이미 있는 사용자를 다시 승인하는 경우, 관리자가 손으로 고쳐둔 메모를 신청서 내용으로
    // 덮어쓰지 않는다 — 비어 있을 때만 채운다.
    const { data: existing } = await admin
      .from('allowed_users')
      .select('note')
      .eq('email', normalizedEmail)
      .maybeSingle()

    const seededNote = [requestRow?.name, requestRow?.reason]
      .map(v => (typeof v === 'string' ? v.trim() : ''))
      .filter(Boolean)
      .join(' — ')

    await admin.from('allowed_users').upsert(
      {
        email: normalizedEmail,
        is_admin: false,
        added_by_email: actor.email,
        note: existing?.note?.trim() ? existing.note : seededNote,
      },
      { onConflict: 'email' }
    )
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(request: Request) {
  const actor = await requireAdminAccess()
  if (!actor) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await request.json()
  const admin = createSupabaseAdminClient()
  const { error } = await admin.from('access_requests').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
