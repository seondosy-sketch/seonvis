import { expect, test } from '@playwright/test'
import { loadEnvLocal, testAuthEmail } from './env'

loadEnvLocal()

/**
 * Test Auth가 만든 세션이 "진짜 세션"인지 확인한다.
 * 화면만 열리고 권한 컨텍스트가 없는 허위 인증이면 여기서 걸린다.
 */
test.describe('Test Auth 세션', () => {
  test('인증이 필요한 화면에 들어가도 /login으로 튕기지 않는다', async ({ page }) => {
    const res = await page.goto('/interviews')
    expect(res?.status()).toBe(200)
    await expect(page).toHaveURL(/\/interviews$/)
  })

  test('사이드바에 로그인 사용자 이메일이 표시된다 (user email context)', async ({ page }) => {
    await page.goto('/interviews')
    await expect(page.getByText(testAuthEmail(), { exact: false }).first()).toBeVisible()
  })

  test('사이드바 메뉴가 렌더링되고 면접 DB 항목이 보인다', async ({ page }) => {
    await page.goto('/interviews')
    await expect(page.getByRole('link', { name: '면접 DB' })).toBeVisible()
  })

  test('interview_db 쓰기 권한이 적용된다 — 등록 버튼이 보인다', async ({ page }) => {
    await page.goto('/interviews')
    await expect(page.getByRole('button', { name: '면접후기 등록' })).toBeVisible()
  })

  test('읽기 전용 메뉴에서는 세션은 유효하지만 쓰기 UI가 없다', async ({ page }) => {
    // 테스트 사용자는 projects가 read 권한이다(interview_db만 write).
    const res = await page.goto('/projects')
    expect(res?.status()).toBe(200)
    await expect(page.getByRole('button', { name: '+ 추가' })).toHaveCount(0)
  })

  test('세션 없이 접근하면 여전히 /login으로 보낸다 (auth guard 그대로)', async ({ browser }) => {
    // storageState를 쓰지 않는 새 컨텍스트 — 로그인 가드가 살아 있는지 본다.
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const page = await context.newPage()
    await page.goto('/interviews')
    await expect(page).toHaveURL(/\/login$/)
    await context.close()
  })
})
