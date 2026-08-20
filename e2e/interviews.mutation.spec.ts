import { expect, test, type Page } from '@playwright/test'

/**
 * 면접 DB 생성/삭제까지 확인하는 테스트 — **운영 Supabase에 실제로 씁니다.**
 *
 * 그래서 기본값은 실행하지 않음이다. 돌리려면 명시적으로 허용해야 한다:
 *   E2E_ALLOW_MUTATION=true npx playwright test e2e/interviews.mutation.spec.ts
 *
 * 남는 데이터가 없도록:
 *   - 제목/질문에 [E2E-DELETE-ME] 표시를 넣는다(사람이 눈으로도 구분할 수 있게).
 *   - 검증 직후 같은 테스트에서 삭제한다.
 *   - 삭제 후 질문까지 함께 지워졌는지(cascade) 화면에서 다시 확인한다.
 */
const MARK = '[E2E-DELETE-ME]'
const QUESTION_CARD = '[title="이 질문이 나온 후기 보기"]'

test.skip(
  process.env.E2E_ALLOW_MUTATION !== 'true',
  '운영 DB에 쓰는 테스트입니다. E2E_ALLOW_MUTATION=true 로만 실행하세요.',
)

const countLabel = (page: Page) => page.getByText(/^검색결과/)

/** 건수는 debounce + DB 조회를 거쳐 확정되므로, 확정된 값을 읽는다. */
async function totalCount(page: Page): Promise<number> {
  await expect(countLabel(page)).not.toContainText('조회 중', { timeout: 15_000 })
  const text = (await countLabel(page).innerText()).replace(/,/g, '')
  return Number(text.match(/검색결과\s+(\d+)건/)?.[1] ?? -1)
}

/** 질의 탭에서 term으로 검색해 결과 수가 expected가 될 때까지 기다린다. */
async function expectQuestionCount(page: Page, term: string, expected: number): Promise<void> {
  await page.goto('/interviews')
  await page.getByRole('button', { name: '질의', exact: true }).click()
  await expect(countLabel(page)).toBeVisible()
  await page.getByPlaceholder('질문 내용 · 용역명 · 발주처 · 시설용도').fill(term)
  await expect.poll(() => totalCount(page), { timeout: 15_000 }).toBe(expected)
}

test('후기를 만들고 질의 탭에서 찾은 뒤 삭제하면 질문까지 사라진다', async ({ page }) => {
  const stamp = `${MARK} ${process.env.E2E_RUN_TAG ?? 'local'}`

  // ── 생성 ────────────────────────────────────────────────────────────────────
  await page.goto('/interviews')
  await page.getByRole('button', { name: '면접후기 등록' }).click()

  await page.locator('select').first().selectOption({ label: '면접' })
  await page.getByPlaceholder('한국전력공사 경인건설본부 경기건설지사').fill(`${stamp} 발주처`)
  await page.getByPlaceholder('변전소 / 공동주택 / 군시설 ...').fill(`${stamp} 시설용도`)
  await page.getByPlaceholder('실제로 받은 질문 1개').first().fill(`${stamp} 질문 1`)
  await page.getByRole('button', { name: '저장' }).click()

  // 저장 직후 상세가 열린다.
  await expect(page.getByText('저장했습니다.')).toBeVisible()
  await page.getByRole('button', { name: '✕' }).first().click()

  // ── 질의 탭에서 조회 ────────────────────────────────────────────────────────
  await expectQuestionCount(page, stamp, 1)
  await expect(page.locator(QUESTION_CARD).first()).toContainText(`${stamp} 질문 1`)

  // ── 삭제 (질문은 cascade) ───────────────────────────────────────────────────
  page.once('dialog', d => d.accept())
  await page.locator(QUESTION_CARD).first().click()
  await page.getByRole('button', { name: '삭제' }).first().click()
  await expect(page.getByText('삭제했습니다.')).toBeVisible()

  // ── 잔여 0건 확인 ───────────────────────────────────────────────────────────
  await expectQuestionCount(page, stamp, 0)
  await expect(page.getByText('조건에 맞는 질문이 없습니다.')).toBeVisible()

  await page.goto('/interviews')
  await page.getByPlaceholder('용역명 · 발주처 · 시설용도 · 참석자 검색').fill(stamp)
  await expect(page.locator('tbody tr')).toHaveCount(0)
})
