import { describe, expect, it } from 'vitest'
import { validateForClose, type ProjectForValidation } from './closeValidation'
import type { AttendanceRecord, ProjectChangeHistory, ProjectParticipant } from './types'

const periodStart = '2026-07-21'
const periodEnd = '2026-08-20'

function makeProject(overrides: Partial<ProjectForValidation> = {}): ProjectForValidation {
  return {
    id: 'proj-1',
    announce_date: '2026-06-01',
    interview_date: '2026-08-10',
    director: '홍길동',
    isCancelled: false,
    ...overrides,
  }
}

function makeParticipant(overrides: Partial<ProjectParticipant> = {}): ProjectParticipant {
  return {
    id: 'part-1',
    project_id: 'proj-1',
    engineer_id: 'eng-1',
    role: '단장',
    specialty_id: 'spec-1',
    is_director: true,
    participation_start: '2026-06-01',
    participation_end: null,
    status: '진행중',
    sort_order: 0,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    ...overrides,
  }
}

function makeRecord(overrides: Partial<AttendanceRecord> = {}): AttendanceRecord {
  return {
    id: 'rec-1',
    project_id: 'proj-1',
    engineer_id: 'eng-1',
    participant_id: 'part-1',
    work_date: '2026-08-01',
    status: 'present',
    created_by: 'a@seon.co.kr',
    updated_by: 'a@seon.co.kr',
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    note: '',
    ...overrides,
  }
}

function emptyInput() {
  return { periodStart, periodEnd, projects: [], participants: [], attendanceRecords: [], changeHistory: [] as ProjectChangeHistory[] }
}

describe('validateForClose — 오류', () => {
  it('정상 데이터는 오류/경고가 없다', () => {
    const result = validateForClose({
      ...emptyInput(),
      projects: [makeProject()],
      participants: [makeParticipant()],
      attendanceRecords: [makeRecord()],
    })
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it('동일 (project, engineer, date) 출근기록 중복 → 오류', () => {
    const result = validateForClose({
      ...emptyInput(),
      projects: [makeProject()],
      participants: [makeParticipant()],
      attendanceRecords: [makeRecord({ id: 'r1' }), makeRecord({ id: 'r2' })],
    })
    expect(result.errors.some(e => e.code === 'duplicate_attendance_record')).toBe(true)
  })

  it('참여기술인 정보를 찾을 수 없는 출근기록 → 오류(필수 식별정보 누락)', () => {
    const result = validateForClose({
      ...emptyInput(),
      projects: [makeProject()],
      participants: [],
      attendanceRecords: [makeRecord()],
    })
    expect(result.errors.some(e => e.code === 'missing_identifying_info')).toBe(true)
  })

  it('같은 프로젝트에 동일 기술인의 진행중 참여가 중복 → 오류', () => {
    const result = validateForClose({
      ...emptyInput(),
      projects: [makeProject()],
      participants: [makeParticipant({ id: 'p1' }), makeParticipant({ id: 'p2' })],
      attendanceRecords: [],
    })
    expect(result.errors.some(e => e.code === 'duplicate_active_participant')).toBe(true)
  })

  it('취소된 프로젝트에 남은 출근기록 → 오류', () => {
    const result = validateForClose({
      ...emptyInput(),
      projects: [makeProject({ isCancelled: true })],
      participants: [makeParticipant()],
      attendanceRecords: [makeRecord()],
    })
    expect(result.errors.some(e => e.code === 'attendance_for_cancelled_project')).toBe(true)
  })

  it('프로젝트 참여 가능 기간 밖 출근기록 → 오류', () => {
    const result = validateForClose({
      ...emptyInput(),
      projects: [makeProject({ interview_date: '2026-07-01' })], // 면접일이 이번 기간 시작 전
      participants: [makeParticipant()],
      attendanceRecords: [makeRecord({ work_date: '2026-08-01' })], // 면접일 이후 체크
    })
    expect(result.errors.some(e => e.code === 'attendance_out_of_period')).toBe(true)
  })
})

describe('validateForClose — 경고', () => {
  it('면접일 미입력 → 경고', () => {
    const result = validateForClose({
      ...emptyInput(),
      projects: [makeProject({ interview_date: null })],
      participants: [makeParticipant()],
      attendanceRecords: [],
    })
    expect(result.warnings.some(w => w.code === 'schedule_date_missing')).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('참여기술인 직책/분야 누락 → 경고', () => {
    const result = validateForClose({
      ...emptyInput(),
      projects: [makeProject()],
      participants: [makeParticipant({ role: '', specialty_id: null })],
      attendanceRecords: [],
    })
    expect(result.warnings.some(w => w.code === 'participant_field_missing')).toBe(true)
  })

  it('이번 기간 중 참여자 변경이 있었는데 변경이력이 없으면 → 경고', () => {
    const result = validateForClose({
      ...emptyInput(),
      projects: [makeProject()],
      participants: [makeParticipant({ participation_start: '2026-08-01' })], // 이번 기간 중 신규 참여
      attendanceRecords: [],
      changeHistory: [],
    })
    expect(result.warnings.some(w => w.code === 'change_note_missing')).toBe(true)
  })

  it('변경이력이 이미 기록돼 있으면 경고가 사라진다', () => {
    const history: ProjectChangeHistory = {
      id: 'h1', project_id: 'proj-1', change_type: 'participant_change', change_date: '2026-08-01',
      before_value: null, after_value: '홍길동', memo: '', created_by: 'a@seon.co.kr', created_at: '2026-08-01T00:00:00Z',
    }
    const result = validateForClose({
      ...emptyInput(),
      projects: [makeProject()],
      participants: [makeParticipant({ participation_start: '2026-08-01' })],
      attendanceRecords: [],
      changeHistory: [history],
    })
    expect(result.warnings.some(w => w.code === 'change_note_missing')).toBe(false)
  })

  it('Project List 단장 정보와 참여기술인 목록이 불일치하면 → 경고', () => {
    const result = validateForClose({
      ...emptyInput(),
      projects: [makeProject({ director: '홍길동' })],
      participants: [makeParticipant({ is_director: false, role: '팀원' })],
      attendanceRecords: [],
    })
    expect(result.warnings.some(w => w.code === 'director_mismatch')).toBe(true)
  })
})
