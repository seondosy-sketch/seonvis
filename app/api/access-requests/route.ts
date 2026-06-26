import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const { email, name, reason } = await request.json()
  if (!email || !name) return NextResponse.json({ error: '이름과 이메일은 필수입니다' }, { status: 400 })

  const admin = createSupabaseAdminClient()

  // 이미 승인된 사용자인지 확인
  const { data: existing } = await admin.from('allowed_users').select('email').eq('email', email.toLowerCase().trim()).maybeSingle()
  if (existing) return NextResponse.json({ error: '이미 승인된 계정입니다. 로그인해 주세요.' }, { status: 409 })

  // 중복 요청 확인
  const { data: dup } = await admin.from('access_requests').select('id,status').eq('email', email.toLowerCase().trim()).eq('status', 'pending').maybeSingle()
  if (dup) return NextResponse.json({ error: '이미 승인 대기 중인 요청이 있습니다.' }, { status: 409 })

  const { error } = await admin.from('access_requests').insert({
    email: email.toLowerCase().trim(),
    name: name.trim(),
    reason: reason?.trim() ?? '',
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
