import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { resolveTestAuth } from '@/lib/testAuth'

/**
 * 개발환경 전용 로그아웃 — 테스트가 끝난 뒤 쿠키 세션을 정리한다.
 * 게이트는 로그인 경로와 같다(production에서는 404).
 */
export const dynamic = 'force-dynamic'

async function handle() {
  const decision = resolveTestAuth(process.env)
  if (!decision.ok) {
    if (decision.status === 404) return new NextResponse('Not Found', { status: 404 })
    return NextResponse.json({ ok: false, reason: decision.reason }, { status: 403 })
  }

  const supabase = await createSupabaseServerClient()
  await supabase.auth.signOut()
  const { data } = await supabase.auth.getUser()
  return NextResponse.json({ ok: true, hasSession: !!data.user })
}

export const GET = handle
export const POST = handle
