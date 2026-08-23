import { expect, test, type Locator, type Page } from '@playwright/test'

/**
 * 홈 브랜드 Hero(app/components/FutureTeamHero.tsx) UI 검증.
 *
 * 전부 읽기 전용이다 — 이 화면의 쓰기 경로(팀일정 추가·삭제)는 건드리지 않으므로 운영
 * Supabase에 아무것도 남기지 않는다.
 *
 * 재생 여부는 localStorage 한 칸으로 갈린다. storageState에 이전 실행 값이 남아 있을 수
 * 있으므로 각 테스트는 addInitScript로 그 칸을 원하는 상태로 맞춰놓고 시작한다
 * (goto 이전에 실행되어야 컴포넌트의 첫 판정에 반영된다).
 */
const STORAGE_KEY = 'futurehub:hero:last-played'
const POSTER = 'img[alt="SEON 미래사업팀"]'
const REPLAY = 'button[aria-label="미래사업팀 소개 영상 다시 재생"]'
const VIDEO = 'video'

/** KST 기준 오늘/어제 — lib/kstDate.ts와 같은 규약(UTC+9). */
function kstKey(offsetDays = 0): string {
  const d = new Date(Date.now() + 9 * 3600_000 + offsetDays * 86400_000)
  return d.toISOString().slice(0, 10)
}

/** localStorage를 원하는 상태로 두고 홈을 연다. value가 null이면 키를 지운다. */
async function openHome(page: Page, value: string | null) {
  await page.addInitScript(
    ([key, val]) => {
      try {
        if (val === null) window.localStorage.removeItem(key as string)
        else window.localStorage.setItem(key as string, val as string)
      } catch { /* 저장이 막힌 환경 */ }
    },
    [STORAGE_KEY, value] as const,
  )
  await page.goto('/')
  await expect(page.locator(POSTER).first()).toBeVisible()
}

/**
 * useIsMobile()은 첫 렌더에서 무조건 false라 좁은 화면에서도 데스크톱 레이아웃이 한 번
 * 그려졌다가 모바일로 갈아끼워진다. 그 사이에 재려고 하면 요소가 떨어져 나가 boundingBox()가
 * null이 된다 — 모바일 전용 상단바가 뜰 때까지 기다려 레이아웃을 확정시킨다.
 */
async function settleMobileLayout(page: Page) {
  await expect(page.getByRole('button', { name: '☰' })).toBeVisible()
}

/** 리렌더 도중이면 boundingBox()가 null이다. 값이 잡힐 때까지 다시 잰다. */
async function stableBox(locator: Locator) {
  let box: Awaited<ReturnType<Locator['boundingBox']>> = null
  await expect.poll(async () => {
    box = await locator.boundingBox()
    return box !== null
  }).toBe(true)
  return box!
}

test.describe('홈 Hero — 하루 1회 자동재생', () => {
  test('최초 접속이면 자동재생한다', async ({ page }) => {
    await openHome(page, null)
    const video = page.locator(VIDEO).first()
    await expect(video).toBeAttached()
    await expect.poll(
      () => video.evaluate((v: HTMLVideoElement) => !v.paused && v.currentTime > 0),
      { timeout: 15_000 },
    ).toBe(true)
    // muted가 아니면 브라우저가 자동재생을 막는다 — 실제로 muted인지 확인한다.
    expect(await video.evaluate((v: HTMLVideoElement) => v.muted)).toBe(true)
    expect(await video.evaluate((v: HTMLVideoElement) => v.loop)).toBe(false)
  })

  test('재생이 시작되면 오늘 날짜를 localStorage에 남긴다', async ({ page }) => {
    await openHome(page, null)
    await expect.poll(
      () => page.evaluate(key => window.localStorage.getItem(key), STORAGE_KEY),
      { timeout: 15_000 },
    ).toBe(kstKey())
  })

  test('같은 날 재진입이면 video를 마운트하지 않고 mp4도 받지 않는다', async ({ page }) => {
    const videoRequests: string[] = []
    page.on('request', r => { if (r.url().includes('future-team-hero.mp4')) videoRequests.push(r.url()) })

    await openHome(page, kstKey())
    await expect(page.locator(POSTER).first()).toBeVisible()
    await expect(page.locator(VIDEO)).toHaveCount(0)
    await expect(page.locator(REPLAY).first()).toBeVisible()

    await page.waitForTimeout(1500)
    expect(videoRequests).toEqual([])
  })

  test('어제가 마지막이면 다시 자동재생한다', async ({ page }) => {
    await openHome(page, kstKey(-1))
    await expect.poll(
      () => page.locator(VIDEO).first().evaluate((v: HTMLVideoElement) => !v.paused && v.currentTime > 0),
      { timeout: 15_000 },
    ).toBe(true)
  })
})

test.describe('홈 Hero — 다시보기', () => {
  test('다시보기를 누르면 재생되고, 재생 중에는 버튼이 사라진다', async ({ page }) => {
    await openHome(page, kstKey())
    await expect(page.locator(VIDEO)).toHaveCount(0)

    await page.locator(REPLAY).first().click()

    const video = page.locator(VIDEO).first()
    await expect(video).toBeAttached()
    await expect.poll(
      () => video.evaluate((v: HTMLVideoElement) => !v.paused && v.currentTime > 0),
      { timeout: 15_000 },
    ).toBe(true)
    await expect(page.locator(REPLAY)).toHaveCount(0)
  })
})

test.describe('홈 Hero — 접근성 / 저사양 환경', () => {
  test('prefers-reduced-motion이면 자동재생하지 않고 poster를 유지한다', async ({ page }) => {
    // 컴포넌트는 마운트 후 matchMedia를 보므로 goto 전에 걸어두면 첫 판정에 반영된다.
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openHome(page, null)
    await page.waitForTimeout(1500)
    await expect(page.locator(VIDEO)).toHaveCount(0)
    await expect(page.locator(POSTER).first()).toBeVisible()
    // 명시적 클릭은 motion preference보다 우선한다.
    await expect(page.locator(REPLAY).first()).toBeVisible()
  })
})

test.describe('홈 Hero — 실패 fallback', () => {
  test('mp4 요청이 실패해도 poster가 남고 Hero 크기가 유지된다', async ({ page }) => {
    await page.route('**/brand/future-team-hero.mp4', route => route.abort())
    await openHome(page, null)

    const poster = page.locator(POSTER).first()
    await expect(poster).toBeVisible()
    const box = await stableBox(poster)
    expect(box.height).toBeGreaterThan(80)
    expect(box.width).toBeGreaterThan(150)

    // 재생이 불가능해졌으니 다시보기 버튼으로 돌아와야 한다.
    await expect(page.locator(REPLAY).first()).toBeVisible({ timeout: 15_000 })
  })
})

test.describe('홈 Hero — 레이아웃', () => {
  test('데스크톱: Hero가 금주 일정 위에 있고 세로 스크롤이 생기지 않는다', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 })
    await openHome(page, kstKey())

    const hero = await stableBox(page.locator(POSTER).first())
    const weekly = await stableBox(page.getByText('금주 일정').first())
    expect(hero.y).toBeLessThan(weekly.y)
    // 우측 컬럼 = 화면 오른쪽 절반. 전체폭 밴드가 아님을 확인한다.
    expect(hero.x).toBeGreaterThan(960)

    const overflow = await page.evaluate(() =>
      document.documentElement.scrollHeight - document.documentElement.clientHeight)
    expect(overflow).toBeLessThanOrEqual(1)
  })

  test('모바일 375x812: Hero가 최상단이고 가로 overflow가 없다', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await openHome(page, kstKey())
    await settleMobileLayout(page)

    const hero = await stableBox(page.locator(POSTER).first())
    const weekly = await stableBox(page.getByText('금주 일정').first())
    expect(hero.y).toBeLessThan(weekly.y)
    expect(hero.height).toBeLessThanOrEqual(200)

    const overflowX = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflowX).toBeLessThanOrEqual(0)
  })

  test('기존 대시보드 섹션이 모두 그대로 있다', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 })
    await openHome(page, kstKey())

    await expect(page.getByText('금주 일정')).toBeVisible()
    await expect(page.getByText('미래봇').first()).toBeVisible()
    await expect(page.getByText('CM업계소식')).toBeVisible()
    await expect(page.getByText('참고 자료')).toBeVisible()
    await expect(page.getByRole('button', { name: '이번주' })).toBeVisible()
  })
})
