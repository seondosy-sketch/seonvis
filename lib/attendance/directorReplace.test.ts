import { describe, expect, it } from 'vitest'
import { directorReplaceErrorMessage } from './directorReplace'

describe('directorReplaceErrorMessage', () => {
  it('에러가 없으면 빈 문자열', () => {
    expect(directorReplaceErrorMessage(null)).toBe('')
    expect(directorReplaceErrorMessage(undefined)).toBe('')
  })

  it('RPC의 "기존 단장이 활성 상태가 아님" 예외는 재시도 안내 문구로 변환된다(중복/재시도 요청)', () => {
    const msg = directorReplaceErrorMessage({ message: 'old director is not currently active' })
    expect(msg).toMatch(/최신 상태를 다시 불러온/)
  })

  it('RPC의 "old director row not found" 예외도 동일한 재시도 안내 문구로 변환된다', () => {
    const msg = directorReplaceErrorMessage({ message: 'old director row not found' })
    expect(msg).toMatch(/최신 상태를 다시 불러온/)
  })

  it('같은 사람을 다시 단장으로 지정하려는 예외는 전용 문구로 변환된다', () => {
    const msg = directorReplaceErrorMessage({ message: 'new director candidate is already the current director' })
    expect(msg).toBe('이미 이 프로젝트의 단장으로 지정되어 있습니다.')
  })

  it('유니크 위반(23505)은 중복 등록 안내 문구로 변환된다', () => {
    const msg = directorReplaceErrorMessage({ code: '23505' })
    expect(msg).toMatch(/이미 처리되었거나 중복/)
  })

  it('그 외 에러는 일반 실패 문구', () => {
    expect(directorReplaceErrorMessage({ code: '99999', message: '알수없는 오류' })).toBe('단장 교체에 실패했습니다.')
  })
})
