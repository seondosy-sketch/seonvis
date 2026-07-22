import { describe, expect, it } from 'vitest'
import { confirmParticipantLinkErrorMessage, reassignEngineerErrorMessage } from './reassignEngineer'

describe('reassignEngineerErrorMessage', () => {
  it('단장 재배정 시도를 안내 문구로 바꾼다', () => {
    expect(reassignEngineerErrorMessage({ message: 'director reassignment must use attendance_replace_director' }))
      .toBe('단장은 이 방법으로 바꿀 수 없습니다. 단장교체 기능을 사용하세요.')
  })

  it('동일 기술인 재지정을 안내 문구로 바꾼다', () => {
    expect(reassignEngineerErrorMessage({ message: 'new engineer is already assigned to this participant' }))
      .toContain('이미 이 참여자로 지정된')
  })

  it('다른 슬롯 중복 참여를 안내 문구로 바꾼다', () => {
    expect(reassignEngineerErrorMessage({ message: 'new engineer already an active participant in this project' }))
      .toContain('다른 역할로 참여 중')
  })

  it('참여자 상태 불일치를 안내 문구로 바꾼다', () => {
    expect(reassignEngineerErrorMessage({ message: 'participant is not active' })).toContain('최신 상태')
    expect(reassignEngineerErrorMessage({ message: 'participant not found' })).toContain('최신 상태')
  })

  it('알 수 없는 에러는 일반 실패 문구', () => {
    expect(reassignEngineerErrorMessage({ message: 'boom' })).toBe('기술인 재배정에 실패했습니다.')
  })

  it('null/undefined는 빈 문자열', () => {
    expect(reassignEngineerErrorMessage(null)).toBe('')
    expect(reassignEngineerErrorMessage(undefined)).toBe('')
  })
})

describe('confirmParticipantLinkErrorMessage', () => {
  it('이미 확정된 슬롯 재확정 시도를 안내 문구로 바꾼다', () => {
    expect(confirmParticipantLinkErrorMessage({ message: 'slot already linked; use attendance_reassign_engineer instead' }))
      .toContain('이미 연결이 확정된 슬롯')
  })

  it('알 수 없는 에러는 일반 실패 문구', () => {
    expect(confirmParticipantLinkErrorMessage({ message: 'boom' })).toBe('연결 확정에 실패했습니다.')
  })
})
