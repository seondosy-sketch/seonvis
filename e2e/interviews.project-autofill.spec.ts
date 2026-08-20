import { expect, test, type Page } from '@playwright/test'

/**
 * 프로젝트 연동 자동입력 규칙을 실제 브라우저에서 확인한다 (읽기 전용 — 저장하지 않는다).
 *
 * 규칙(lib/evaluations/projectAutofill.ts):
 *   - 용역명은 프로젝트를 바꾸면 항상 새 프로젝트명
 *   - 발주처·평가일은 자동입력으로 채워진 값일 때만 갱신, 사용자가 고친 값은 보존
 *   - 참여기술인은 새 프로젝트 기준으로 다시 로드하고 체크는 초기화, 기타 참석자는 유지
 *   - "프로젝트 정보 다시 불러오기"로 발주처·평가일을 프로젝트 원본값으로 되돌릴 수 있다
 *
 * 프로젝트는 Project List의 실제 데이터를 쓴다 — 발주처가 서로 다른 두 건을 골랐다.
 */
const PROJECT_A = { number: '2658', keyword: '당수변전소' }
const PROJECT_B = { number: '2657', keyword: '26-A-00부대 건설사업관리용역(A166)' }
const MANUAL_CLIENT = '직접 확인한 발주처(저장하지 않음)'
const EXTRA_NAME = '수행직원 검증용'

interface ModalState {
  projectQuery: string
  projectName: string
  client: string
  evaluationDate: string
  participants: string[]
  checked: boolean[]
  extras: string[]
  notice: string | null
  hasReloadButton: boolean
}

/** 모달 상태를 한 번에 읽는다 — 이 화면에는 test id가 없어 구조 기반으로 모은다. */
async function readModal(page: Page): Promise<ModalState> {
  return page.evaluate(() => {
    const fixed = [...document.querySelectorAll('div')].filter(d => getComputedStyle(d).position === 'fixed')
    const modal = fixed.find(d => d.innerText.includes('면접후기 등록'))
    if (!modal) throw new Error('등록 모달이 열려 있지 않습니다')
    const inputs = [...modal.querySelectorAll('input')]
    const boxes = inputs.filter(i => i.type === 'checkbox')
    const pick = (ph: string) => inputs.find(i => i.placeholder === ph)?.value ?? ''
    return {
      projectQuery: pick('용역명 또는 공사번호로 검색 (선택)'),
      // 용역명 칸만 placeholder가 없다.
      projectName: inputs.find(i => i.type === 'text' && !i.placeholder)?.value ?? '',
      client: pick('한국전력공사 경인건설본부 경기건설지사'),
      evaluationDate: inputs.find(i => i.type === 'date')?.value ?? '',
      participants: boxes.map(b => (b.closest('label') ?? b.parentElement)?.innerText.replace(/\n/g, ' | ') ?? ''),
      checked: boxes.map(b => b.checked),
      extras: inputs.filter(i => i.placeholder === '성명 (주소록 검색 또는 직접 입력)').map(i => i.value),
      // 문구를 담은 잎 노드만 본다 — 상위 컨테이너 텍스트까지 잡으면 검증이 헐거워진다.
      notice: [...modal.querySelectorAll('div')]
        .filter(d => d.children.length === 0 && (d.textContent ?? '').includes('직접 입력한 것을 유지했습니다'))
        .map(d => (d.textContent ?? '').trim())[0] ?? null,
      hasReloadButton: [...modal.querySelectorAll('button')]
        .some(b => b.textContent?.trim() === '프로젝트 정보 다시 불러오기'),
    }
  })
}

async function selectProject(page: Page, p: { number: string; keyword: string }) {
  await page.getByPlaceholder('용역명 또는 공사번호로 검색 (선택)').fill(p.number)
  await page.getByText(p.keyword, { exact: false }).last().click()
  // 참여기술인은 별도 조회라 목록이 채워질 때까지 기다린다.
  await expect.poll(async () => (await readModal(page)).projectName, { timeout: 10_000 })
    .toContain(p.keyword.slice(0, 8))
  await page.waitForTimeout(600)
}

test.describe('면접후기 등록 — 프로젝트 자동입력/보존', () => {
  test('A 선택 → B 교체 → 수동 수정 후 보존 → 다시 불러오기', async ({ page }) => {
    await page.goto('/interviews')
    await page.waitForSelector('tbody tr')
    await page.getByRole('button', { name: '면접후기 등록' }).click()

    // ── 1) 프로젝트 A: 세 칸이 A 값으로 자동 채워진다 ─────────────────────────
    await selectProject(page, PROJECT_A)
    const a = await readModal(page)
    expect(a.projectName).toContain('당수변전소')
    expect(a.client).not.toBe('')
    expect(a.evaluationDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(a.participants.length).toBeGreaterThan(0)
    expect(a.hasReloadButton).toBe(false)   // 전부 자동입력 상태 → 되돌릴 것이 없다
    expect(a.notice).toBeNull()
    const clientA = a.client
    const dateA = a.evaluationDate
    const participantsA = a.participants.length

    // ── 2) 프로젝트 B: 자동입력 상태였으므로 전부 B 값으로 교체 ───────────────
    await selectProject(page, PROJECT_B)
    const b = await readModal(page)
    expect(b.projectName).toContain('26-A-00부대')
    expect(b.client).not.toBe(clientA)      // 발주처가 실제로 바뀐다 (기존 버그 지점)
    expect(b.client).not.toBe('')
    expect(b.evaluationDate).not.toBe(dateA)
    expect(b.notice).toBeNull()
    expect(b.hasReloadButton).toBe(false)
    // 참여기술인은 B 기준으로 다시 로드되고 체크는 초기화된다
    expect(b.participants.length).toBeGreaterThan(0)
    expect(b.participants.length).not.toBe(participantsA)
    expect(b.checked.every(c => c === false)).toBe(true)
    const clientB = b.client

    // ── 3) 참석자 체크 + 기타 참석자 입력 ────────────────────────────────────
    await page.locator('input[type=checkbox]').first().check()
    await page.getByRole('button', { name: '+ 기타 참석자' }).click()
    await page.getByPlaceholder('성명 (주소록 검색 또는 직접 입력)').first().fill(EXTRA_NAME)
    const withAttendee = await readModal(page)
    expect(withAttendee.checked[0]).toBe(true)
    expect(withAttendee.extras).toContain(EXTRA_NAME)

    // ── 4) 발주처를 직접 수정 ────────────────────────────────────────────────
    await page.getByPlaceholder('한국전력공사 경인건설본부 경기건설지사').fill(MANUAL_CLIENT)
    const edited = await readModal(page)
    expect(edited.client).toBe(MANUAL_CLIENT)
    expect(edited.hasReloadButton).toBe(true)   // 프로젝트 원본과 달라졌다

    // ── 5) 프로젝트를 A로 다시 변경: 수동 발주처는 보존, 나머지는 갱신 ────────
    await selectProject(page, PROJECT_A)
    const back = await readModal(page)
    expect(back.projectName).toContain('당수변전소')
    expect(back.client).toBe(MANUAL_CLIENT)     // ← 보존
    expect(back.evaluationDate).toBe(dateA)     // 평가일은 자동입력 상태였으므로 갱신
    expect(back.notice).toBe('발주처 값은 직접 입력한 것을 유지했습니다.')
    expect(back.hasReloadButton).toBe(true)
    // 참여기술인은 A 기준으로 다시 로드 + 체크 초기화, 기타 참석자는 유지
    expect(back.participants.length).toBe(participantsA)
    expect(back.checked.every(c => c === false)).toBe(true)
    expect(back.extras).toContain(EXTRA_NAME)

    // ── 6) 프로젝트 정보 다시 불러오기 ───────────────────────────────────────
    await page.getByRole('button', { name: '프로젝트 정보 다시 불러오기' }).click()
    await page.waitForTimeout(400)
    const reloaded = await readModal(page)
    expect(reloaded.client).toBe(clientA)       // A의 원본 발주처로 복원
    expect(reloaded.evaluationDate).toBe(dateA)
    expect(reloaded.hasReloadButton).toBe(false)
    expect(reloaded.notice).toBeNull()
    expect(reloaded.extras).toContain(EXTRA_NAME)

    // ── 7) 되돌린 뒤에는 다시 자동입력이 소유한다 ────────────────────────────
    await selectProject(page, PROJECT_B)
    const again = await readModal(page)
    expect(again.client).toBe(clientB)
    expect(again.hasReloadButton).toBe(false)

    // ── 저장하지 않고 취소 ──────────────────────────────────────────────────
    await page.getByRole('button', { name: '취소' }).click()
    await expect(page.getByRole('button', { name: '저장' })).toHaveCount(0)
    await expect(page.getByText(MANUAL_CLIENT)).toHaveCount(0)
  })

  test('칸을 비우면 다시 자동입력이 소유한다', async ({ page }) => {
    await page.goto('/interviews')
    await page.waitForSelector('tbody tr')
    await page.getByRole('button', { name: '면접후기 등록' }).click()

    await selectProject(page, PROJECT_A)
    const clientA = (await readModal(page)).client

    // 직접 고쳤다가 → 비운다
    await page.getByPlaceholder('한국전력공사 경인건설본부 경기건설지사').fill('임시로 적었다가 지움')
    expect((await readModal(page)).hasReloadButton).toBe(true)
    await page.getByPlaceholder('한국전력공사 경인건설본부 경기건설지사').fill('')
    expect((await readModal(page)).hasReloadButton).toBe(false)

    // 빈 칸은 자동입력이 소유하므로 프로젝트를 바꾸면 새 값이 들어온다
    await selectProject(page, PROJECT_B)
    const b = await readModal(page)
    expect(b.client).not.toBe('')
    expect(b.client).not.toBe(clientA)
    expect(b.notice).toBeNull()

    await page.getByRole('button', { name: '취소' }).click()
  })
})
