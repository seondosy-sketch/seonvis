/**
 * 홈화면 위젯 주소(토큰) 발급·조회·해지 — 로그인한 사용자가 자기 것만 다룬다.
 * 위젯 이미지 자체는 app/api/widget/summary가 그린다.
 *
 * 응답에는 토큰만 담고 최종 URL은 클라이언트가 window.location.origin으로 조립한다
 * (프록시 뒤에서 서버가 보는 호스트와 사용자가 접속한 호스트가 다를 수 있어서).
 */
import { NextResponse } from 'next/server'
import { getMenuAccess } from '@/lib/auth/menuAccess'
import { getActiveWidgetToken, issueWidgetToken, normalizeEmail, revokeWidgetTokens } from '@/lib/widget/token'

/** 로그인 + 승인된 사용자(allowed_users 행 있음)인지 확인. app/(dashboard)/layout.tsx와 같은 판정(getMenuAccess). */
async function assertAllowedUser(): Promise<string | null> {
  const access = await getMenuAccess()
  return access?.approved ? normalizeEmail(access.email) : null
}

export async function GET() {
  const email = await assertAllowedUser()
  if (!email) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const token = await getActiveWidgetToken(email)
  return NextResponse.json({ token })
}

export async function POST() {
  const email = await assertAllowedUser()
  if (!email) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const token = await issueWidgetToken(email)
    return NextResponse.json({ token })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '발급 실패' }, { status: 500 })
  }
}

export async function DELETE() {
  const email = await assertAllowedUser()
  if (!email) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await revokeWidgetTokens(email)
  return NextResponse.json({ ok: true })
}
