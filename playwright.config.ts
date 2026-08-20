import { defineConfig, devices } from '@playwright/test'

/**
 * UI 자동검증(E2E). 로그인은 개발환경 전용 Test Auth로 처리한다 —
 * docs/testing/test-auth.md 참고.
 *
 * vitest와 파일 규칙으로 분리한다: vitest는 `**\/*.test.ts`, Playwright는 `e2e/**\/*.spec.ts`.
 * 그래서 `npm test`가 브라우저 테스트를 집어가지 않고, 그 반대도 없다.
 *
 * trace / screenshot / video를 모두 끈 이유: 이 테스트는 실제 세션 쿠키를 들고 다니므로
 * 산출물에 인증정보가 남을 수 있다. 필요할 때만 커맨드라인에서 켜고, 결과물은 커밋하지 않는다.
 */
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000'

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts/,
  // 운영 Supabase를 함께 바라보기 때문에 병렬 실행으로 서로 간섭시키지 않는다.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL,
    // global-setup이 Test Auth로 만들어 둔 세션을 모든 테스트가 재사용한다(매번 로그인하지 않는다).
    storageState: '.playwright/.auth/user.json',
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
