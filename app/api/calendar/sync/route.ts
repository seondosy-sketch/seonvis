/**
 * 동기화 실행 (Hub → Google 단방향).
 *
 * 세 가지 용도를 한 라우트로 처리한다.
 *   { projectId }        프로젝트 저장·삭제 직후 자동 호출 (승인 사용자 허용)
 *   {}                   오늘 이후 일정 전체 동기화 (관리자)
 *   { failedOnly: true } 실패 건만 다시 시도 (관리자)
 *
 * 호출부(프로젝트 화면)는 이 요청을 **결과를 기다리지 않고** 보낸다 — Google이 실패해도 Hub 저장
 * 자체는 이미 끝난 상태이고, 실패는 표에 남아 나중에 다시 돌릴 수 있다.
 */
import { NextResponse } from 'next/server'
import { requireAdmin, requireAllowedUser } from '@/lib/googleCalendar/guard'
import { NotConnectedError, reconcileCalendar } from '@/lib/googleCalendar/reconcile'

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { projectId?: string; failedOnly?: boolean }
  const scoped = !!body.projectId

  // 단건(저장 직후)은 승인 사용자까지, 전체·재시도는 관리자만.
  const email = scoped ? await requireAllowedUser() : await requireAdmin()
  if (!email) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const result = await reconcileCalendar({
      projectId: body.projectId,
      failedOnly: !!body.failedOnly,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    if (e instanceof NotConnectedError) {
      // 연결 전에는 조용히 넘긴다 — 프로젝트 저장 흐름에 오류를 띄우지 않는다.
      return NextResponse.json({ ok: false, notConnected: true }, { status: 200 })
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : '동기화 실패' }, { status: 500 })
  }
}
