import { expect, test, type Locator, type Page } from '@playwright/test'

/**
 * 면접 DB(/interviews) 읽기 전용 UI 검증.
 *
 * 운영 Supabase를 그대로 바라보므로 여기서는 **아무것도 쓰지 않는다** — 등록 화면도 열어보고
 * 취소까지만 한다. 생성/수정/삭제는 interviews.mutation.spec.ts에서 명시적으로 허용할 때만 돈다.
 *
 * 이 화면에는 test id가 없어(다른 페이지들과 같은 스타일) 역할·문구 기반 선택자를 쓴다.
 * 필터칸 라벨은 <label>이 아니라 <div>라서 select는 필터 패널 안의 순서로 집는다:
 *   0 = 평가유형, 1 = 질의그룹, 2 = 질의분류, 3 = 연도(시작), 4 = 연도(끝)
 *
 * 건수는 DB에서 오고 검색어는 300ms debounce가 걸려 있으므로, 화면 숫자를 바로 읽지 않고
 * expect.poll로 "값이 조건을 만족할 때까지" 기다린다 — 그러지 않으면 직전 상태를 읽는다.
 */
const QUESTION_CARD = '[title="이 질문이 나온 후기 보기"]'
const GROUP_NAMES = ['책임', '건축', '안전', '토목', '기계', '전기']

const countLabel = (page: Page) => page.getByText(/^검색결과/)
const filterSelect = (page: Page, index: number) => page.locator('select').nth(index)
const searchBox = (page: Page) => page.getByPlaceholder('질문 내용 · 용역명 · 발주처 · 시설용도')
const clientBox = (page: Page) => page.getByPlaceholder('예: 한국전력공사 (산하 본부·지사 포함)')
const facilityBox = (page: Page) => page.getByPlaceholder('예: 변전소')

async function openQuestionTab(page: Page) {
  await page.goto('/interviews')
  await page.getByRole('button', { name: '질의', exact: true }).click()
  await expect(countLabel(page)).toBeVisible()
}

/**
 * "검색결과 1,119건 (1~100 표시)" → 1119.
 * 조회 중인 동안은 직전 건수가 남아 있으므로, 확정될 때까지 기다린 뒤 읽는다.
 */
async function totalCount(page: Page): Promise<number> {
  await expect(countLabel(page)).not.toContainText('조회 중', { timeout: 15_000 })
  const text = (await countLabel(page).innerText()).replace(/,/g, '')
  return Number(text.match(/검색결과\s+(\d+)건/)?.[1] ?? -1)
}

/** 건수가 조건을 만족할 때까지 기다린다(debounce + DB 조회 시간을 흡수). */
function pollTotal(page: Page) {
  return expect.poll(() => totalCount(page), { timeout: 15_000 })
}

/** "3 / 12" 표시. 결과가 한 페이지에 다 들어가면 표시 자체가 없다. */
function pageIndicator(page: Page): Locator {
  return page.locator('span').filter({ hasText: /^\d+ \/ \d+$/ })
}

function pageIs(page: Page, current: number): Locator {
  return page.locator('span').filter({ hasText: new RegExp(`^${current} / \\d+$`) })
}

async function totalPagesShown(page: Page): Promise<number> {
  const text = await pageIndicator(page).first().innerText()
  return Number(text.split('/')[1].trim())
}

test.describe('면접 DB — 진입과 탭', () => {
  test('두 탭이 모두 열린다', async ({ page }) => {
    await page.goto('/interviews')
    await expect(page.getByRole('button', { name: '면접후기', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '질의', exact: true })).toBeVisible()

    // 면접후기 탭 — 목록 행 수와 건수 문구가 맞아야 한다.
    const countText = await page.getByText(/^후기 \d/).innerText()
    const listed = Number(countText.replace(/[^\d]/g, ''))
    expect(listed).toBeGreaterThan(0)
    await expect(page.locator('tbody tr')).toHaveCount(listed)

    await page.getByRole('button', { name: '질의', exact: true }).click()
    await expect(countLabel(page)).toBeVisible()
  })
})

test.describe('질의 탭 — 건수와 페이지네이션', () => {
  test('건수는 DB 전체 기준이고 100건씩 나눠 보여준다', async ({ page }) => {
    await openQuestionTab(page)
    // 1,000행 응답 상한에 잘리던 구간을 넘어야 한다.
    await pollTotal(page).toBeGreaterThan(1000)

    const total = await totalCount(page)
    await expect(pageIs(page, 1).first()).toBeVisible()
    expect(await totalPagesShown(page)).toBe(Math.ceil(total / 100))
    await expect(page.locator(QUESTION_CARD)).toHaveCount(100)
    await expect(countLabel(page)).toContainText('(1~100 표시)')
  })

  test('다음 / 이전으로 페이지를 넘긴다', async ({ page }) => {
    await openQuestionTab(page)
    await pollTotal(page).toBeGreaterThan(100)
    await expect(page.getByRole('button', { name: '이전' })).toBeDisabled()

    await page.getByRole('button', { name: '다음' }).click()
    await expect(countLabel(page)).toContainText('(101~200 표시)')
    await expect(pageIs(page, 2).first()).toBeVisible()
    await expect(page.getByRole('button', { name: '이전' })).toBeEnabled()

    await page.getByRole('button', { name: '이전' }).click()
    await expect(countLabel(page)).toContainText('(1~100 표시)')
    await expect(pageIs(page, 1).first()).toBeVisible()
  })

  test('마지막 페이지에는 나머지 건수만 남고 다음이 잠긴다', async ({ page }) => {
    await openQuestionTab(page)
    await pollTotal(page).toBeGreaterThan(1000)

    const total = await totalCount(page)
    const pages = Math.ceil(total / 100)
    const remainder = total % 100 === 0 ? 100 : total % 100

    const next = page.getByRole('button', { name: '다음' })
    for (let current = 1; current < pages; current += 1) {
      await expect(next).toBeEnabled()
      await next.click()
      await expect(pageIs(page, current + 1).first()).toBeVisible()
    }

    // 잘려서 볼 수 없었던 마지막 구간이 실제로 화면에 나온다.
    await expect(countLabel(page)).toContainText(`${(pages - 1) * 100 + 1}`.replace(/\B(?=(\d{3})+(?!\d))/g, ','))
    await expect(page.locator(QUESTION_CARD)).toHaveCount(remainder)
    await expect(next).toBeDisabled()
  })
})

test.describe('질의 탭 — 필터', () => {
  test('질의그룹으로 좁히면 결과가 그 그룹만 남고 1페이지로 돌아간다', async ({ page }) => {
    await openQuestionTab(page)
    await pollTotal(page).toBeGreaterThan(1000)
    const all = await totalCount(page)

    // 먼저 2페이지로 이동해 두고 필터를 걸어 page reset을 확인한다.
    await page.getByRole('button', { name: '다음' }).click()
    await expect(pageIs(page, 2).first()).toBeVisible()

    await filterSelect(page, 1).selectOption({ label: '건축' })
    await pollTotal(page).toBeLessThan(all)
    expect(await totalCount(page)).toBeGreaterThan(0)
    await expect(pageIs(page, 1).first()).toBeVisible()

    for (const card of await page.locator(QUESTION_CARD).all()) {
      await expect(card).toContainText('건축 · ')
    }
  })

  test('전체검색은 질문 본문·용역명·발주처·시설용도를 훑는다', async ({ page }) => {
    await openQuestionTab(page)
    await pollTotal(page).toBeGreaterThan(1000)
    const all = await totalCount(page)

    await searchBox(page).fill('변전소')
    await pollTotal(page).toBeLessThan(all)
    expect(await totalCount(page)).toBeGreaterThan(0)

    // 질문 본문에 없어도 기록(용역명/발주처/시설용도)에 있으면 잡힌다.
    await expect(page.locator(QUESTION_CARD).first()).toContainText('변전소')
  })

  test('복합필터(검색 + 그룹 + 발주처 + 연도)가 모두 AND로 걸린다', async ({ page }) => {
    await openQuestionTab(page)
    await pollTotal(page).toBeGreaterThan(1000)
    const all = await totalCount(page)

    await searchBox(page).fill('변전소')
    await filterSelect(page, 1).selectOption({ label: '건축' })
    await clientBox(page).fill('한국전력공사')
    await filterSelect(page, 3).selectOption({ label: '2020' })

    await pollTotal(page).toBeLessThan(all)
    const count = await totalCount(page)
    expect(count).toBeGreaterThan(0)
    await expect(page.locator(QUESTION_CARD)).toHaveCount(Math.min(count, 100))

    for (const card of await page.locator(QUESTION_CARD).all()) {
      await expect(card).toContainText('건축 · ')
      await expect(card).toContainText('한국전력공사')
    }
  })

  test('조건에 맞는 결과가 없으면 그 사실을 알린다(등록된 질문이 없다고 하지 않는다)', async ({ page }) => {
    await openQuestionTab(page)
    await clientBox(page).fill('존재하지않는발주처명')
    await pollTotal(page).toBe(0)
    await expect(page.getByText('조건에 맞는 질문이 없습니다.')).toBeVisible()
  })

  test('필터 초기화가 모든 축을 되돌린다', async ({ page }) => {
    await openQuestionTab(page)
    await pollTotal(page).toBeGreaterThan(1000)
    const all = await totalCount(page)

    await filterSelect(page, 1).selectOption({ label: '건축' })
    await facilityBox(page).fill('변전소')
    await pollTotal(page).toBeLessThan(all)
    await expect(page.getByRole('button', { name: '필터 초기화' })).toBeVisible()

    await page.getByRole('button', { name: '필터 초기화' }).click()
    await expect(page.getByRole('button', { name: '필터 초기화' })).toHaveCount(0)
    await pollTotal(page).toBe(all)
    await expect(searchBox(page)).toHaveValue('')
    await expect(facilityBox(page)).toHaveValue('')
  })

  test('필터 후보 목록은 현재 페이지가 아니라 전체 데이터 기준이다', async ({ page }) => {
    await openQuestionTab(page)
    await pollTotal(page).toBeGreaterThan(1000)

    // 평가유형·질의그룹·질의분류는 마스터에서 온다. 마스터에도 `미지정` 행이 있어서 그대로 그리면
    // 사용자에게 `미지정`이 두 번 보였다 — 마스터의 `미지정`은 목록에서 빼고, 합친 `미지정` 한 칸이
    // 마스터 미지정 + NULL 을 함께 찾는다(lib/evaluations/questionFilters.ts UNSPECIFIED_NAME).
    await expect(filterSelect(page, 0).locator('option')).toHaveCount(9)  // 전체 + 마스터 7 + 미지정
    await expect(filterSelect(page, 1).locator('option')).toHaveCount(11) // 전체 + 마스터 9 + 미지정
    await expect(filterSelect(page, 2).locator('option')).toHaveCount(15) // 전체 + 마스터 13 + 미지정
    for (const i of [0, 1, 2]) {
      await expect(filterSelect(page, i).locator('option', { hasText: /^미지정$/ })).toHaveCount(1)
    }

    // 발주처·시설용도 후보는 한 페이지(100건)에서 뽑은 것보다 많아야 한다.
    // 후보는 별도 집계 조회로 오므로(페이지 조회와 병렬) 채워질 때까지 기다린다.
    await expect.poll(() => page.locator('#question-client-options option').count(), { timeout: 15_000 })
      .toBeGreaterThan(50)
    expect(await page.locator('#question-facility-options option').count()).toBeGreaterThan(20)
    expect(await filterSelect(page, 3).locator('option').count()).toBeGreaterThan(5)

    // 2페이지로 넘겨도 후보 수가 그대로여야 한다(페이지에 종속되지 않는다).
    const before = await page.locator('#question-client-options option').count()
    await page.getByRole('button', { name: '다음' }).click()
    await expect(pageIs(page, 2).first()).toBeVisible()
    expect(await page.locator('#question-client-options option').count()).toBe(before)
  })
})

test.describe('질의 탭 — 후기 Drawer 연동', () => {
  test('질문을 누르면 그 질문이 나온 후기가 열리고 해당 질문만 강조된다', async ({ page }) => {
    await openQuestionTab(page)
    await pollTotal(page).toBeGreaterThan(1000)

    const card = page.locator(QUESTION_CARD).first()
    const questionText = (await card.innerText()).split('\n')[0]
    await card.click()

    // Drawer가 열릴 때까지 기다린다(후기 1건을 따로 읽어 온다).
    await expect(page.getByText('개요')).toBeVisible()
    await expect(page.getByRole('button', { name: '수정' })).toBeVisible()

    // 강조 배경(#fffbeb)이 정확히 하나이고, 그게 눌렀던 질문이다.
    await expect.poll(() => page.evaluate(() =>
      [...document.querySelectorAll('div')]
        .filter(d => getComputedStyle(d).backgroundColor === 'rgb(255, 251, 235)').length,
    ), { timeout: 10_000 }).toBe(1)

    const highlighted = await page.evaluate(() =>
      [...document.querySelectorAll('div')]
        .filter(d => getComputedStyle(d).backgroundColor === 'rgb(255, 251, 235)')
        .map(d => d.textContent ?? '')[0])
    expect(highlighted).toContain(questionText)

    await page.getByRole('button', { name: '✕' }).first().click()
  })
})

test.describe('면접후기 등록 화면 — 저장하지 않고 확인만', () => {
  test('평가유형 마스터 8종이 모두 선택지로 나온다', async ({ page }) => {
    await page.goto('/interviews')
    await page.getByRole('button', { name: '면접후기 등록' }).click()

    const evaluationType = page.locator('select').first()
    await expect(evaluationType.locator('option')).toHaveCount(9) // '선택하세요' + 마스터 8종
    for (const name of ['면접', 'SOQ', 'TP', '종심제', '적격심사', '면접평가서', '기타', '미지정']) {
      await expect(evaluationType.locator('option', { hasText: name }).first()).toHaveCount(1)
    }
    await evaluationType.selectOption({ label: '면접' })
    await expect(evaluationType).toHaveValue(/.+/)

    await page.getByRole('button', { name: '취소' }).click()
  })

  test('프로젝트를 고르면 Project List의 발주처·용역명과 참여기술인이 따라온다', async ({ page }) => {
    await page.goto('/interviews')
    await page.getByRole('button', { name: '면접후기 등록' }).click()

    const projectSearch = page.getByPlaceholder('용역명 또는 공사번호로 검색 (선택)')
    await projectSearch.fill('당수변전소')

    // 검색 후보에서 고른다(후보는 클릭 가능한 항목으로 렌더된다).
    const candidate = page.locator('div').filter({ hasText: /당수변전소/ }).last()
    await expect(candidate).toBeVisible()
    await candidate.click()

    // 프로젝트가 연결되면 스냅샷 값이 채워지고 "연결 해제"가 나타난다.
    await expect(page.getByRole('button', { name: '연결 해제' })).toBeVisible()
    await expect(page.getByPlaceholder('한국전력공사 경인건설본부 경기건설지사')).toHaveValue(/.+/)

    // 참여기술인은 Project List에서 별도로 읽어오므로 나타날 때까지 기다린다.
    await expect.poll(() => page.locator('input[type=checkbox]').count(), { timeout: 10_000 })
      .toBeGreaterThan(0)

    // 각 줄에 역할 badge(책임/건축/안전/토목/기계/전기 등)가 붙는다.
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('input[type=checkbox]')]
        .map(b => (b.closest('label') ?? b.parentElement)?.textContent ?? ''))
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.some(r => /책임|건축|안전|토목|기계|전기/.test(r))).toBe(true)

    await page.getByRole('button', { name: '취소' }).click()
  })

  test('질의그룹은 고정 6종이고 이미 쓴 그룹은 다시 고를 수 없다', async ({ page }) => {
    await page.goto('/interviews')
    await page.getByRole('button', { name: '면접후기 등록' }).click()

    const groupSelects = page.locator('select').filter({ has: page.locator('option', { hasText: '토목' }) })
    await expect(groupSelects).toHaveCount(1)
    // '선택' + 6종
    await expect(groupSelects.first().locator('option')).toHaveCount(7)

    await page.getByRole('button', { name: '+ 질의그룹 추가' }).click()
    await expect(groupSelects).toHaveCount(2)

    // 두 그룹이 서로 다른 값으로 자동 선택된다(중복 방지).
    const chosen = await groupSelects.evaluateAll(nodes =>
      (nodes as HTMLSelectElement[]).map(n => n.selectedOptions[0]?.text ?? ''))
    // 마스터 sort_order 순으로 비어 있는 그룹이 차례로 잡힌다.
    expect(chosen).toEqual(['책임', '건축'])
    expect(chosen.every(t => GROUP_NAMES.includes(t))).toBe(true)

    // 이미 쓴 그룹은 다른 그룹의 선택지에서 빠진다.
    const firstOptions = await groupSelects.first().locator('option').allInnerTexts()
    expect(firstOptions).not.toContain(chosen[1])

    await page.getByRole('button', { name: '취소' }).click()
  })

  test('질의분류 마스터 14종이 질문마다 선택 가능하다', async ({ page }) => {
    await page.goto('/interviews')
    await page.getByRole('button', { name: '면접후기 등록' }).click()

    const categorySelect = page.locator('select')
      .filter({ has: page.locator('option', { hasText: '사업관리' }) }).first()
    await expect(categorySelect.locator('option')).toHaveCount(15) // 선택 + 14
    for (const name of ['품질', '안전', '공정', '사업관리']) {
      await expect(categorySelect.locator('option', { hasText: name }).first()).toHaveCount(1)
    }
    await categorySelect.selectOption({ label: '품질' })

    // 질문도 입력해 두고(저장 직전 상태) 취소한다 — 운영 DB에는 아무것도 남지 않는다.
    await page.getByPlaceholder('실제로 받은 질문 1개').first().fill('[E2E-DELETE-ME] 저장하지 않는 검증용 질문')
    await page.getByRole('button', { name: '취소' }).click()

    await expect(page.getByRole('button', { name: '저장' })).toHaveCount(0)
    await expect(page.getByText('[E2E-DELETE-ME]')).toHaveCount(0)
  })
})
