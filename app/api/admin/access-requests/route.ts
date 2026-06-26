import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { NextResponse } from 'next/server'

function getAdminEmails() {
  return (process.env.ADMIN_EMAILS ?? '').split(',').map(e => e.trim()).filter(Boolean)
}

async function assertAdmin() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email || !getAdminEmails().includes(user.email)) return null
  return user
}

export async function GET() {
  const user = await assertAdmin()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin.from('access_requests').select('*').order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PATCH(request: Request) {
  const user = await assertAdmin()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id, email, status } = await request.json()
  if (!id || !status) return NextResponse.json({ error: 'id, status required' }, { status: 400 })

  const admin = createSupabaseAdminClient()

  // 상태 업데이트
  const { error } = await admin.from('access_requests').update({
    status,
    reviewed_at: new Date().toISOString(),
    reviewed_by: user.email,
  }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // 승인이면 allowed_users에 추가
  if (status === 'approved' && email) {
    await admin.from('allowed_users').upsert(
      { email: email.toLowerCase().trim(), is_admin: false, added_by_email: user.email },
      { onConflict: 'email' }
    )
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(request: Request) {
  const user = await assertAdmin()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await request.json()
  const admin = createSupabaseAdminClient()
  const { error } = await admin.from('access_requests').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
