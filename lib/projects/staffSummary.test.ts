import { describe, expect, it } from 'vitest'
import {
  buildStaffSummary,
  participantLabel,
  type ProjectParticipantRef,
  type StaffTextFields,
} from './staffSummary'

function row(patch: Partial<ProjectParticipantRef> = {}): ProjectParticipantRef {
  return {
    engineer_contact_id: patch.name ?? 'e1',
    name: '김철수',
    role: '',
    specialty_name: null,
    is_director: false,
    sort_order: 0,
    ...patch,
  }
}

const EMPTY_TEXT: StaffTextFields = { staff_arch: '', staff_civil: '', staff_mech: '', staff_safety: '' }

describe('participantLabel', () => {
  it('단장은 role 원문을 쓴다(분야로 쓰면 자동연계 때문에 건축으로 잘못 보인다)', () => {
    expect(participantLabel(row({ is_director: true, role: '책임', specialty_name: '건축' }))).toBe('책임')
  })

  it('단장인데 role이 비었으면 단장으로 적는다', () => {
    expect(participantLabel(row({ is_director: true, role: '', specialty_name: '건축' }))).toBe('단장')
  })

  it('일반 기술인은 분야를 쓰고, 없으면 role, 둘 다 없으면 기술인', () => {
    expect(participantLabel(row({ specialty_name: '토목', role: '토목 담당' }))).toBe('토목')
    expect(participantLabel(row({ specialty_name: null, role: '안전 담당' }))).toBe('안전 담당')
    expect(participantLabel(row({ specialty_name: null, role: '' }))).toBe('기술인')
  })
})

describe('buildStaffSummary', () => {
  it('단장을 맨 앞에 놓고 그다음 sort_order 순으로 놓는다', () => {
    const out = buildStaffSummary([
      row({ name: '이영희', specialty_name: '안전', sort_order: 2 }),
      row({ name: '조장연', is_director: true, role: '책임', sort_order: 5 }),
      row({ name: '박세진', specialty_name: '건축', sort_order: 1 }),
    ], EMPTY_TEXT)

    expect(out).toEqual([
      { name: '조장연', label: '책임', source: 'participant' },
      { name: '박세진', label: '건축', source: 'participant' },
      { name: '이영희', label: '안전', source: 'participant' },
    ])
  })

  it('행에 없는 손입력 이름만 분야 표기로 뒤에 붙인다', () => {
    const out = buildStaffSummary(
      [row({ name: '박세진', specialty_name: '건축' })],
      { ...EMPTY_TEXT, staff_arch: '박세진', staff_safety: '손만호' },
    )

    // 박세진은 행에 있으므로 텍스트로 또 나오지 않는다.
    expect(out).toEqual([
      { name: '박세진', label: '건축', source: 'participant' },
      { name: '손만호', label: '안전', source: 'text' },
    ])
  })

  it('행이 없으면 손입력 칸만으로 목록을 만든다(78건 중 절반이 이 경우다)', () => {
    const out = buildStaffSummary([], {
      staff_arch: '김건축', staff_civil: '이토목', staff_mech: '', staff_safety: '박안전',
    })
    expect(out.map(e => [e.name, e.label, e.source])).toEqual([
      ['김건축', '건축', 'text'],
      ['이토목', '토목', 'text'],
      ['박안전', '안전', 'text'],
    ])
  })

  it('한 칸에 여러 명이 적혀 있으면 나눠 담는다', () => {
    const out = buildStaffSummary([], { ...EMPTY_TEXT, staff_arch: '김철수/이영희, 박세진' })
    expect(out.map(e => e.name)).toEqual(['김철수', '이영희', '박세진'])
  })

  it('표기가 조금 달라도 같은 사람은 한 번만 담는다', () => {
    const out = buildStaffSummary(
      [row({ name: '이상원(65)' })],
      { ...EMPTY_TEXT, staff_arch: '이상원 (65)' },
    )
    expect(out).toHaveLength(1)
    expect(out[0].source).toBe('participant')
  })

  it('같은 이름이 여러 칸에 적혀 있으면 처음 것만 남긴다', () => {
    const out = buildStaffSummary([], { ...EMPTY_TEXT, staff_arch: '김철수', staff_civil: '김철수' })
    expect(out).toEqual([{ name: '김철수', label: '건축', source: 'text' }])
  })

  it('둘 다 비어 있으면 빈 목록이다', () => {
    expect(buildStaffSummary([], EMPTY_TEXT)).toEqual([])
    expect(buildStaffSummary([], null)).toEqual([])
  })
})
