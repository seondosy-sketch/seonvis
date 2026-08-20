import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { resolveTestAuth } from '@/lib/testAuth'

/**
 * 개발환경 전용 로그인 — Google OAuth 화면만 건너뛴다(권한은 건너뛰지 않는다).
 *
 * 전용 Supabase Auth 사용자로 signInWithPassword를 호출하므로, 평소 Google 로그인과 똑같은
 * 쿠키 세션이 만들어지고 JWT에 실제 email이 들어간다. 그래서 allowed_users · menu_permissions ·
 * RLS가 그대로 적용된다. 세션을 위조하거나 service role로 UI를 대신 여는 방식이 아니다.
 *
 * production에서는 lib/testAuth.ts의 게이트가 404를 돌려주므로 경로가 없는 것처럼 보인다.
 * 응답에는 access token / refresh token / 쿠키 값을 절대 담지 않는다(존재 여부만 boolean).
 */
export const dynamic = 'force-dynamic'

async function requestedEmailOf(request: Request): Promise<string | null> {
  const fromQuery = new URL(request.url).searchParams.get('email')
  if (fromQuery) return fromQuery
  if (request.method !== 'POST') return null
  try {
    const body = await request.json()
    const email = (body as { email?: unknown })?.email
    return typeof email === 'string' ? email : null
  } catch {
    return null
  }
}

async function handle(request: Request) {
  const decision = resolveTestAuth(process.env, await requestedEmailOf(request))
  if (!decision.ok) {
    // 404는 "이 경로는 없다"는 뜻으로 쓴다 — production에서 존재를 알리지 않기 위함이다.
    if (decision.status === 404) return new NextResponse('Not Found', { status: 404 })
    return NextResponse.json({ ok: false, reason: decision.reason }, { status: 403 })
  }

  // 승인된 사용자만 — allowed_users(또는 ADMIN_EMAILS)에 없는 이메일로는 세션을 만들지 않는다.
  // dashboard layout도 같은 검사를 하지만, 여기서 먼저 막아 쓸모없는 세션이 남지 않게 한다.
  const adminEmails = (process.env.ADMIN_EMAILS ?? '')
    .split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
  const isAdmin = adminEmails.includes(decision.email)

  const admin = createSupabaseAdminClient()
  const { data: allowed } = await admin
    .from('allowed_users')
    .select('email, is_admin, menu_permissions')
    .eq('email', decision.email)
    .maybeSingle()

  if (!allowed && !isAdmin) {
    return NextResponse.json({ ok: false, reason: 'not-in-allowed-users' }, { status: 403 })
  }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.auth.signInWithPassword({
    email: decision.email,
    password: decision.password,
  })

  if (error || !data.session) {
    // 오류 메시지에 자격증명이 섞이지 않도록 Supabase 메시지를 그대로 흘리지 않는다.
    return NextResponse.json({ ok: false, reason: 'sign-in-failed' }, { status: 502 })
  }

  return NextResponse.json({
    ok: true,
    email: decision.email,
    hasSession: true,
    isAdmin: isAdmin || allowed?.is_admin === true,
    menuPermissions: allowed?.menu_permissions ?? {},
  })
}

export const GET = handle
export const POST = handle
