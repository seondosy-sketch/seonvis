import { describe, expect, it } from 'vitest'
import {
  AUTO_OWNED,
  applyProjectSelection,
  canReloadFromProject,
  initialOwnership,
  markEdited,
  preservedNotice,
  projectValues,
  reloadFromProject,
  type AutofillValues,
} from './projectAutofill'

const PROJECT_A = {
  name: '154kV 당수변전소 토건공사 감독권한대행 등 건설사업관리용역',
  client: '한국전력공사 경인건설본부 경기건설지사',
  interview_date: '2026-08-19',
}
const PROJECT_B = {
  name: '26-A-00부대 건설사업관리용역(A166)',
  client: '국군재정관리단',
  interview_date: '2026-08-13',
}
const EMPTY: AutofillValues = { projectName: '', client: '', evaluationDate: '' }

describe('projectValues — 없는 값은 빈 문자열', () => {
  it('평가일이 없는 프로젝트', () => {
    expect(projectValues({ name: 'X', client: 'Y', interview_date: null }))
      .toEqual({ projectName: 'X', client: 'Y', evaluationDate: '' })
  })
})

describe('initialOwnership — 폼을 열 때', () => {
  it('신규 작성(빈 칸)은 자동입력이 소유한다', () => {
    expect(initialOwnership({ client: '', evaluationDate: '' })).toEqual(AUTO_OWNED)
  })

  it('기존 기록을 수정하면 저장돼 있던 값은 사용자 소유다(프로젝트 연결로 날아가지 않게)', () => {
    expect(initialOwnership({ client: '한국전력공사', evaluationDate: '2025-03-04' }))
      .toEqual({ client: false, evaluationDate: false })
  })

  it('한쪽만 값이 있으면 그 칸만 사용자 소유다', () => {
    expect(initialOwnership({ client: '한국전력공사', evaluationDate: '' }))
      .toEqual({ client: false, evaluationDate: true })
  })
})

describe('applyProjectSelection — 프로젝트 A → B', () => {
  it('처음 프로젝트를 고르면 세 칸이 모두 채워진다', () => {
    const r = applyProjectSelection(EMPTY, AUTO_OWNED, PROJECT_A)
    expect(r.values).toEqual({
      projectName: PROJECT_A.name,
      client: PROJECT_A.client,
      evaluationDate: '2026-08-19',
    })
    expect(r.preserved).toEqual([])
  })

  it('자동입력 상태였던 값은 B 정보로 모두 교체된다', () => {
    const a = applyProjectSelection(EMPTY, AUTO_OWNED, PROJECT_A)
    const b = applyProjectSelection(a.values, a.ownership, PROJECT_B)
    expect(b.values).toEqual({
      projectName: PROJECT_B.name,
      client: '국군재정관리단',
      evaluationDate: '2026-08-13',
    })
    expect(b.ownership).toEqual(AUTO_OWNED)
    expect(b.preserved).toEqual([])
  })

  it('사용자가 고친 발주처는 프로젝트를 바꿔도 보존된다', () => {
    const a = applyProjectSelection(EMPTY, AUTO_OWNED, PROJECT_A)
    const edited = { ...a.values, client: '한국전력공사 경기본부(직접 확인)' }
    const ownership = markEdited(a.ownership, 'client', edited.client)

    const b = applyProjectSelection(edited, ownership, PROJECT_B)
    expect(b.values.client).toBe('한국전력공사 경기본부(직접 확인)')
    // 용역명과 평가일은 갱신된다
    expect(b.values.projectName).toBe(PROJECT_B.name)
    expect(b.values.evaluationDate).toBe('2026-08-13')
    expect(b.preserved).toEqual(['client'])
  })

  it('사용자가 고친 평가일도 보존된다', () => {
    const a = applyProjectSelection(EMPTY, AUTO_OWNED, PROJECT_A)
    const edited = { ...a.values, evaluationDate: '2026-09-01' }
    const ownership = markEdited(a.ownership, 'evaluationDate', edited.evaluationDate)

    const b = applyProjectSelection(edited, ownership, PROJECT_B)
    expect(b.values.evaluationDate).toBe('2026-09-01')
    expect(b.values.client).toBe('국군재정관리단')
    expect(b.preserved).toEqual(['evaluationDate'])
  })

  it('둘 다 고쳤으면 둘 다 보존하고 용역명만 갱신한다', () => {
    const values: AutofillValues = { projectName: PROJECT_A.name, client: '직접입력', evaluationDate: '2026-01-01' }
    const b = applyProjectSelection(values, { client: false, evaluationDate: false }, PROJECT_B)
    expect(b.values).toEqual({ projectName: PROJECT_B.name, client: '직접입력', evaluationDate: '2026-01-01' })
    expect(b.preserved).toEqual(['client', 'evaluationDate'])
  })

  it('용역명은 사용자가 뭘 적어놨든 항상 새 프로젝트명이 된다', () => {
    const values: AutofillValues = { projectName: '내가 적은 용역명', client: '', evaluationDate: '' }
    expect(applyProjectSelection(values, AUTO_OWNED, PROJECT_B).values.projectName).toBe(PROJECT_B.name)
  })

  it('평가일이 없는 프로젝트로 바꾸면 자동입력 상태의 평가일은 비워진다', () => {
    const a = applyProjectSelection(EMPTY, AUTO_OWNED, PROJECT_A)
    const b = applyProjectSelection(a.values, a.ownership, { name: 'C', client: 'CC', interview_date: null })
    expect(b.values.evaluationDate).toBe('')
  })

  it('평가일이 없는 프로젝트로 바꿔도 사용자가 넣은 평가일은 남는다', () => {
    const b = applyProjectSelection(
      { projectName: 'A', client: '', evaluationDate: '2026-05-05' },
      { client: true, evaluationDate: false },
      { name: 'C', client: 'CC', interview_date: null },
    )
    expect(b.values.evaluationDate).toBe('2026-05-05')
  })
})

describe('markEdited — 소유자 전환', () => {
  it('값을 입력하면 사용자 소유가 된다', () => {
    expect(markEdited(AUTO_OWNED, 'client', 'LH공사')).toEqual({ client: false, evaluationDate: true })
  })

  it('칸을 비우면 다시 자동입력이 소유한다', () => {
    const owned = markEdited(AUTO_OWNED, 'client', 'LH공사')
    expect(markEdited(owned, 'client', '')).toEqual(AUTO_OWNED)
    expect(markEdited(owned, 'client', '   ')).toEqual(AUTO_OWNED)
  })

  it('비운 뒤 프로젝트를 바꾸면 새 프로젝트 값이 들어온다', () => {
    let values: AutofillValues = { projectName: PROJECT_A.name, client: 'LH공사', evaluationDate: '' }
    let ownership = markEdited(AUTO_OWNED, 'client', values.client)
    values = { ...values, client: '' }
    ownership = markEdited(ownership, 'client', '')

    const b = applyProjectSelection(values, ownership, PROJECT_B)
    expect(b.values.client).toBe('국군재정관리단')
    expect(b.preserved).toEqual([])
  })
})

describe('reloadFromProject — 프로젝트 정보 다시 불러오기', () => {
  it('세 칸을 프로젝트 원본값으로 되돌리고 자동입력 소유로 만든다', () => {
    const r = reloadFromProject(PROJECT_B)
    expect(r.values).toEqual({
      projectName: PROJECT_B.name,
      client: '국군재정관리단',
      evaluationDate: '2026-08-13',
    })
    expect(r.ownership).toEqual(AUTO_OWNED)
  })

  it('되돌린 뒤에는 프로젝트를 또 바꿔도 자동으로 갱신된다', () => {
    const reloaded = reloadFromProject(PROJECT_B)
    const next = applyProjectSelection(reloaded.values, reloaded.ownership, PROJECT_A)
    expect(next.values.client).toBe(PROJECT_A.client)
    expect(next.preserved).toEqual([])
  })
})

describe('canReloadFromProject — 버튼 표시 조건', () => {
  it('프로젝트가 없으면 보여주지 않는다', () => {
    expect(canReloadFromProject({ client: 'X', evaluationDate: '' }, { client: false, evaluationDate: true }, null))
      .toBe(false)
  })

  it('자동입력 상태면 되돌릴 것이 없다', () => {
    expect(canReloadFromProject(
      { client: PROJECT_A.client, evaluationDate: '2026-08-19' }, AUTO_OWNED, PROJECT_A)).toBe(false)
  })

  it('사용자 값이 프로젝트 원본과 다르면 보여준다', () => {
    expect(canReloadFromProject(
      { client: '직접입력', evaluationDate: '2026-08-19' },
      { client: false, evaluationDate: true }, PROJECT_A)).toBe(true)
  })

  it('사용자 값이 프로젝트 원본과 같으면 보여주지 않는다(앞뒤 공백 무시)', () => {
    expect(canReloadFromProject(
      { client: ` ${PROJECT_A.client} `, evaluationDate: '' },
      { client: false, evaluationDate: true }, PROJECT_A)).toBe(false)
  })

  it('평가일만 달라도 보여준다', () => {
    expect(canReloadFromProject(
      { client: PROJECT_A.client, evaluationDate: '2026-12-25' },
      { client: true, evaluationDate: false }, PROJECT_A)).toBe(true)
  })
})

describe('preservedNotice', () => {
  it('보존이 없으면 문구도 없다', () => {
    expect(preservedNotice([])).toBeNull()
  })

  it('보존된 칸을 이름으로 알린다', () => {
    expect(preservedNotice(['client'])).toBe('발주처 값은 직접 입력한 것을 유지했습니다.')
    expect(preservedNotice(['client', 'evaluationDate']))
      .toBe('발주처 · 평가일 값은 직접 입력한 것을 유지했습니다.')
  })
})
