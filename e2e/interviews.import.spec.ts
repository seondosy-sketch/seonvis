import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'

/**
 * 면접 DB — HWP 후기 올리기 UI 검증(읽기 전용).
 *
 * 문서를 읽어 등록 폼에 채우는 것까지만 확인하고 **저장하지 않는다** — 운영 Supabase를 그대로
 * 바라보기 때문이다(interviews.spec.ts와 같은 원칙).
 *
 * fixtures/interview-review-sample.hwpx는 실제 회사 문서가 아니라 서식만 흉내 낸 합성 문서다
 * (kordoc markdownToHwpx로 만들었다). 담긴 값:
 *   발주처 충청북도 청주시 / 용역명 청주시 복합문화센터 건립공사 건설사업관리
 *   시설용도 문화 및 집회시설 / 일시 2026. 8. 19.(수) 13:30~ / 장소 청주시청 3층 회의실
 *   면접관 5인 / 참가업체 7개 중 1번째 (A사, B사, C사) / 참석자 홍길동(단장), 김철수(안전)
 *   실제질의 [단장] 2건 + [안전] 1건
 */
const FIXTURE = path.join(__dirname, 'fixtures', 'interview-review-sample.hwpx')

async function openImportModal(page: Page) {
  await page.goto('/interviews')
  await page.getByRole('button', { name: 'HWP 후기 올리기' }).click()
  await expect(page.getByText('면접후기 HWP 올리기')).toBeVisible()
}

/** 파일 고르기 버튼은 숨겨진 input을 대신 누르므로 input에 직접 넣는다. */
async function uploadFixture(page: Page) {
  await page.locator('input[type="file"]').setInputFiles(FIXTURE)
  await expect(page.getByText(/질문 \d+건 읽음/)).toBeVisible({ timeout: 30_000 })
}

test.describe('면접후기 HWP 올리기 — 저장하지 않고 확인만', () => {
  test('파일을 고르기 전에는 확인 화면으로 넘어갈 수 없다', async ({ page }) => {
    await openImportModal(page)
    await expect(page.getByRole('button', { name: /확인 화면으로/ })).toBeDisabled()
    await page.getByRole('button', { name: '닫기' }).click()
    await expect(page.getByText('면접후기 HWP 올리기')).toHaveCount(0)
  })

  test('문서를 읽어 질문 건수를 알려준다', async ({ page }) => {
    await openImportModal(page)
    await uploadFixture(page)

    await expect(page.getByText('질문 3건 읽음')).toBeVisible()
    await expect(page.getByRole('button', { name: '확인 화면으로 (1건)' })).toBeEnabled()

    await page.getByRole('button', { name: '닫기' }).click()
  })

  test('읽어낸 값이 등록 폼에 채워지고, 저장 전임을 알린다', async ({ page }) => {
    await openImportModal(page)
    await uploadFixture(page)
    await page.getByRole('button', { name: /확인 화면으로/ }).click()

    // 아직 저장되지 않았다는 사실을 폼에서 먼저 알린다.
    await expect(page.getByText(/에서 읽어온 초안입니다 — 아직 저장되지 않았습니다/)).toBeVisible()

    await expect(page.locator('input[value="충청북도 청주시"]')).toHaveCount(1)
    await expect(page.locator('input[value="문화 및 집회시설"]')).toHaveCount(1)
    await expect(page.locator('input[value="2026-08-19"]')).toHaveCount(1)
    await expect(page.locator('input[value="13:30~"]')).toHaveCount(1)
    await expect(page.locator('input[value="청주시청 3층 회의실"]')).toHaveCount(1)
    await expect(page.locator('input[value="A사, B사, C사"]')).toHaveCount(1)

    // 평가유형은 문서의 '면접'이 표준 유형으로 이어져 선택돼 있어야 한다.
    await expect(page.locator('select').first()).toHaveValue(/.+/)

    // 질문 3건이 질의그룹(책임/안전) 두 개로 들어온다.
    const questionBoxes = page.getByPlaceholder('실제로 받은 질문 1개')
    await expect(questionBoxes).toHaveCount(3)
    await expect(questionBoxes.nth(0)).toHaveValue('품질관리 계획을 설명해주세요.')
    await expect(questionBoxes.nth(1)).toHaveValue('공정 지연 시 대응방안은?')
    await expect(questionBoxes.nth(2)).toHaveValue('중대재해처벌법 대응 방안')

    // 참석자는 주소록에 없으면 기타 참석자로 이름·역할만 들어온다.
    await expect(page.locator('input[value="홍길동"]')).toHaveCount(1)
    await expect(page.locator('input[value="김철수"]')).toHaveCount(1)

    // 저장하지 않고 닫는다 — 운영 DB에는 아무것도 남지 않는다.
    await page.getByRole('button', { name: '취소' }).click()
    await expect(page.getByRole('button', { name: '저장' })).toHaveCount(0)
  })
})
