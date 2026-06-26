import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const { email, name, reason, type = 'request' } = await request.json()
  if (!email) return NextResponse.json({ error: '이메일은 필수입니다' }, { status: 400 })
  if (type === 'request' && !name) return NextResponse.json({ error: '이름과 이메일은 필수입니다' }, { status: 400 })

  const admin = createSupabaseAdminClient()
  const cleanEmail = email.toLowerCase().trim()

  // 이미 승인된 사용자인지 확인
  const { data: existing } = await admin.from('allowed_users').select('email').eq('email', cleanEmail).maybeSingle()
  if (existing) return NextResponse.json({ error: '이미 승인된 계정입니다. 로그인해 주세요.' }, { status: 409 })

  // 중복 확인
  const { data: dup } = await admin.from('access_requests').select('id,status,type').eq('email', cleanEmail).eq('status', 'pending').maybeSingle()
  if (dup) {
    // 기존이 attempt이고 직접 요청(request)이 들어오면 업그레이드
    if (dup.type === 'attempt' && type === 'request') {
      await admin.from('access_requests').update({ type: 'request', name: name?.trim() ?? '', reason: reason?.trim() ?? '' }).eq('id', dup.id)
      return NextResponse.json({ ok: true })
    }
    if (type === 'attempt') return NextResponse.json({ ok: true }) // 중복 시도는 조용히 무시
    return NextResponse.json({ error: '이미 승인 대기 중인 요청이 있습니다.' }, { status: 409 })
  }

  const { error } = await admin.from('access_requests').insert({
    email: cleanEmail,
    name: name?.trim() ?? '',
    reason: reason?.trim() ?? '',
    type,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
