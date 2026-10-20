import { describe, it, expect } from 'vitest'
import { calculateHours, calculateRecognizedHours, isValidTimeText, TIME_TYPE_PRESETS } from './time'

/**
 * 연장근무(제안서팀) 인정시간 산출식 골든 테스트.
 *
 * 자동배정 개편(docs/overtime.md) 전후로 이 산출식은 바뀌면 안 된다 — 이 파일의 기대값은
 * 개편 전 코드의 실제 동작을 그대로 적은 것이고, 이 테스트가 깨지면 기존 기록과 새 기록의
 * 계산 기준이 달라졌다는 뜻이다. 기대값을 고치기 전에 산출식 변경이 승인됐는지 먼저 확인한다.
 */

describe('isValidTimeText — "H:mm"/"HH:mm", 24시 이상 허용', () => {
  it.each(['18:00', '7:05', '24:00', '25:30', ' 18:00 '])('%s → 유효', v => {
    expect(isValidTimeText(v)).toBe(true)
  })
  it.each(['', '18', '1800', '18:60', '18:5', 'abc', '18:00:00'])('%s → 무효', v => {
    expect(isValidTimeText(v)).toBe(false)
  })
})

describe('calculateHours — 경로 A(WorkRecordForm): 종료−시작, 12시·18시 시작이면 식사 1시간 차감, 절삭 없음', () => {
  it.each([
    // [시작, 종료, 기대 인정시간]
    ['18:00', '21:00', 2],     // 18시 시작 → 3h − 식사 1h
    ['18:00', '22:00', 3],
    ['12:00', '15:00', 2],     // 12시 시작도 차감
    ['18:30', '21:00', 1.5],   // 시(hour)만 보므로 18:30도 차감
    ['18:59', '21:00', 1.02],  // 2.0167 − 1 → 소수 둘째 자리 반올림
    ['18:00', '19:00', 1],     // 원래 시간이 1시간 이하면 차감하지 않음
    ['18:00', '18:40', 0.67],  // 1시간 미만도 차감 없음, 반올림
    ['18:00', '19:01', 0.02],  // 1시간 초과 → 차감 (1.0167 − 1)
    ['18:00', '20:20', 1.33],
    ['17:00', '21:00', 4],     // 17시 시작은 차감 없음
    ['19:00', '21:00', 2],
    ['21:00', '24:00', 3],     // 자정은 24:00으로 표기
    ['23:00', '25:30', 2.5],   // 자정 넘김
    ['13:00', '15:00', 2],     // 13시는 식사 트리거 아님
  ])('%s~%s → %s', (start, end, expected) => {
    expect(calculateHours(start, end)).toBe(expected)
  })

  it.each([
    ['18:00', '18:00'],  // 종료 = 시작
    ['21:00', '19:00'],  // 종료 < 시작 (자정 넘김을 01:00으로 적은 경우)
    ['abc', '21:00'],
    ['18:00', ''],
    ['18:60', '21:00'],
  ])('%s~%s → null (저장 불가)', (start, end) => {
    expect(calculateHours(start, end)).toBeNull()
  })
})

describe('calculateRecognizedHours — 경로 C(팝오버·일괄 "기타"): 종료−시작−휴게, 1시간 단위 절삭', () => {
  it.each([
    // [시작, 종료, 휴게, raw, recognized]
    ['18:00', '23:30', 1, 4.5, 4],     // 문서 예시
    ['18:00', '21:00', 1, 2, 2],
    ['18:00', '22:00', 1, 3, 3],
    ['18:00', '20:20', 0, 2.33, 2],    // raw는 소수 둘째 자리 반올림
    ['18:00', '20:10', 0.5, 1.67, 1],
    ['18:00', '19:30', 1, 0.5, 0],     // 절삭 결과 0 — null이 아니다(폼이 "1시간 미만"으로 막는다)
    ['09:00', '18:00', 1, 8, 8],
    ['21:00', '25:00', 0, 4, 4],       // 자정 넘김
    ['18:00', '20:59', 0, 2.98, 2],
  ])('%s~%s 휴게 %s → raw %s, 인정 %s', (start, end, breakH, raw, recognized) => {
    expect(calculateRecognizedHours(start, end, breakH)).toEqual({ raw, recognized })
  })

  it.each([
    ['18:00', '19:00', 1],    // raw 0
    ['18:00', '18:30', 1],    // raw 음수
    ['18:00', '18:00', 0],    // 종료 = 시작
    ['22:00', '21:00', 0],    // 종료 < 시작
    ['18:00', '21:00', -1],   // 휴게 음수
    ['18:00', '21:00', NaN],  // 휴게 숫자 아님 (parseFloat('') 등)
    ['x', '21:00', 1],
  ])('%s~%s 휴게 %s → null', (start, end, breakH) => {
    expect(calculateRecognizedHours(start, end, breakH)).toBeNull()
  })
})

describe('TIME_TYPE_PRESETS — 경로 B(2시간/3시간 프리셋)', () => {
  it('프리셋 값이 바뀌지 않는다', () => {
    expect(TIME_TYPE_PRESETS['2h']).toMatchObject({ start: '18:00', end: '21:00', breakH: 1, hours: 2 })
    expect(TIME_TYPE_PRESETS['3h']).toMatchObject({ start: '18:00', end: '22:00', breakH: 1, hours: 3 })
    expect(Object.keys(TIME_TYPE_PRESETS)).toEqual(['2h', '3h'])
  })

  it('프리셋의 hours는 "기타" 산출식으로 같은 시각·휴게를 넣은 결과와 같다', () => {
    for (const p of Object.values(TIME_TYPE_PRESETS)) {
      expect(calculateRecognizedHours(p.start, p.end, p.breakH)?.recognized).toBe(p.hours)
    }
  })

  it('같은 18:00~21:00이라도 경로 A(식사 자동 차감)도 2시간으로 일치한다', () => {
    expect(calculateHours(TIME_TYPE_PRESETS['2h'].start, TIME_TYPE_PRESETS['2h'].end)).toBe(2)
    expect(calculateHours(TIME_TYPE_PRESETS['3h'].start, TIME_TYPE_PRESETS['3h'].end)).toBe(3)
  })
})
