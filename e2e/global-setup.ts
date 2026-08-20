import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { request, type FullConfig } from '@playwright/test'
import { STORAGE_STATE, loadEnvLocal, requireTestAuthEnv, testAuthEmail } from './env'

/**
 * Test Auth로 한 번 로그인해서 세션을 storageState 파일에 저장한다.
 * 이후 모든 테스트는 이 파일을 재사용하므로 테스트마다 로그인하지 않는다.
 *
 * Google OAuth 화면은 거치지 않지만, 권한은 우회하지 않는다 — 전용 Supabase Auth 사용자로
 * 실제 로그인하므로 allowed_users · menu_permissions · RLS가 그대로 적용된다.
 * (docs/testing/test-auth.md)
 */
export default async function globalSetup(config: FullConfig) {
  loadEnvLocal()
  requireTestAuthEnv()

  const baseURL = config.projects[0]?.use?.baseURL ?? process.env.E2E_BASE_URL ?? 'http://localhost:3000'
  const context = await request.newContext({ baseURL })

  const res = await context.post('/api/test-auth/login')
  if (!res.ok()) {
    // 응답 본문에 자격증명이 담기지 않는 설계지만, 그래도 상태코드와 reason만 옮긴다.
    let reason = ''
    try { reason = String(((await res.json()) as { reason?: unknown })?.reason ?? '') } catch { /* 본문 없음 */ }
    await context.dispose()
    throw new Error(
      `Test Auth 로그인 실패 (http ${res.status()}${reason ? `, reason=${reason}` : ''}).\n`
      + 'production 빌드에서는 의도적으로 404입니다. 개발 서버(npm run dev)인지, '
      + '.env.local 설정과 테스트 사용자 등록이 되어 있는지 확인하세요 — docs/testing/test-auth.md.',
    )
  }

  const body = (await res.json()) as { email?: string; hasSession?: boolean }
  if (!body.hasSession) {
    await context.dispose()
    throw new Error('Test Auth 응답에 세션이 없습니다.')
  }
  if ((body.email ?? '').toLowerCase() !== testAuthEmail()) {
    await context.dispose()
    throw new Error('Test Auth가 예상과 다른 사용자로 로그인했습니다.')
  }

  mkdirSync(path.dirname(path.resolve(STORAGE_STATE)), { recursive: true })
  await context.storageState({ path: STORAGE_STATE })
  await context.dispose()

  // 토큰·쿠키 값은 출력하지 않는다 — 성공 여부와 파일 위치만 알린다.
  console.log(`[test-auth] 세션 준비 완료 (${STORAGE_STATE})`)
}
