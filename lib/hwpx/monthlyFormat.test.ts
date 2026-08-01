import { describe, it, expect } from 'vitest'
import {
  EMPTY_CELL, orEmptyCell,
  formatMonthlyFee, formatMonthlyDurationMonths, formatMonthlyPages,
  parseIsoDate, formatMonthlyDate, formatMonthlyInterview, formatMonthlyBid,
  formatMonthlyStaff, formatMonthlyNote, formatMonthlyProjectTitle,
} from './monthlyFormat'

// 기준값은 CM본부월업무계획(7.24).hwpx 실측 표기다.

describe('orEmptyCell', () => {
  it('빈 값은 "-"가 된다', () => {
    for (const v of [null, undefined, '', '   ']) expect(orEmptyCell(v)).toBe('-')
    expect(EMPTY_CELL).toBe('-')
  })
  it('값이 있으면 앞뒤 공백만 제거한다', () => {
    expect(orEmptyCell('  국군재정관리단 ')).toBe('국군재정관리단')
  })
})

describe('formatMonthlyFee — projects.fee는 이미 억 단위(numeric(10,2))', () => {
  it('뒤따르는 0만 정리한다', () => {
    expect(formatMonthlyFee('75.60')).toBe('75.6')
    expect(formatMonthlyFee('126.90')).toBe('126.9')
    expect(formatMonthlyFee('18.00')).toBe('18')
  })
  it('유효 소수점 2자리는 잘리지 않는다', () => {
    expect(formatMonthlyFee('115.44')).toBe('115.44')
    expect(formatMonthlyFee(115.44)).toBe('115.44')
    expect(formatMonthlyFee('32.45')).toBe('32.45')
  })
  it('억 환산을 하지 않는다 — 입력 숫자를 키우거나 줄이지 않는다', () => {
    expect(formatMonthlyFee('75.6')).toBe('75.6')
    expect(formatMonthlyFee('12')).toBe('12')
  })
  it('빈 값은 "-", 숫자가 아니면 원문 유지', () => {
    expect(formatMonthlyFee('')).toBe('-')
    expect(formatMonthlyFee(null)).toBe('-')
    expect(formatMonthlyFee('미정')).toBe('미정')
  })
})

describe('formatMonthlyDurationMonths — duration_days는 운영상 개월 수', () => {
  it('숫자만 남긴다', () => {
    expect(formatMonthlyDurationMonths('54')).toBe('54')
    expect(formatMonthlyDurationMonths('40.6')).toBe('40.6')
    expect(formatMonthlyDurationMonths('11.6개월')).toBe('11.6')
    expect(formatMonthlyDurationMonths('21')).toBe('21')
  })
  it('일수를 개월로 환산하지 않는다', () => {
    expect(formatMonthlyDurationMonths('365')).toBe('365')
  })
  it('빈 값은 "-", 숫자가 없으면 원문 유지', () => {
    expect(formatMonthlyDurationMonths('')).toBe('-')
    expect(formatMonthlyDurationMonths('추후')).toBe('추후')
  })
})

describe('formatMonthlyPages', () => {
  it('세 필드를 순서대로 이어 붙인다', () => {
    expect(formatMonthlyPages('12P', '', '')).toBe('제안서 12P')
    expect(formatMonthlyPages('', '각 2p', '')).toBe('자소서 각 2p')
    expect(formatMonthlyPages('', '', '20p')).toBe('PPT 20p')
    expect(formatMonthlyPages('50P', '', '별도')).toBe('제안서 50P PPT 별도')
  })
  it('값에 자기 슬롯의 종류 이름이 이미 있으면 라벨을 덧붙이지 않는다', () => {
    expect(formatMonthlyPages('제안서15p', '', '')).toBe('제안서15p')
    expect(formatMonthlyPages('', '자기소개서 각 3p', '')).toBe('자기소개서 각 3p')
    expect(formatMonthlyPages('', '', 'PPT 20p')).toBe('PPT 20p')
  })
  // 확정사항: PPT 표현이 중복되지 않게 한다.
  it('proposal_p가 PPT 이야기면 PPT 쪽으로만 표기한다', () => {
    // ppt_p에 구체적인 쪽수가 있으면 그것이 더 정확하다 — "PPT 대체"는 버린다.
    expect(formatMonthlyPages('PPT 대체', '', '20p')).toBe('PPT 20p')
    // ppt_p가 없으면 원문을 그대로 쓴다.
    expect(formatMonthlyPages('PPT 대체', '', '')).toBe('PPT 대체')
  })
  it('제안서와 PPT는 한 줄, 자소서는 별도 줄로 구성한다(최소 줄 수)', () => {
    expect(formatMonthlyPages('25P', '', '별도')).toBe('제안서 25P PPT 별도')
    expect(formatMonthlyPages('10P', '각3P', '')).toBe(['제안서 10P', '자소서 각3P'].join('\n'))
    expect(formatMonthlyPages('', '각 2p', '')).toBe('자소서 각 2p')
    expect(formatMonthlyPages('50P', '각 2p', '별도'))
      .toBe(['제안서 50P PPT 별도', '자소서 각 2p'].join('\n'))
  })
  it('같은 라벨이 두 번 나오지 않는다', () => {
    for (const out of [
      formatMonthlyPages('PPT 대체', '', '20p'),
      formatMonthlyPages('제안서15p', '자기소개서 각3P', 'PPT 별도'),
    ]) {
      expect((out.match(/PPT/g) ?? []).length).toBeLessThanOrEqual(1)
      expect((out.match(/제안서/g) ?? []).length).toBeLessThanOrEqual(1)
      expect((out.match(/자소서|자기소개서/g) ?? []).length).toBeLessThanOrEqual(1)
    }
  })
  it('모두 비면 "-"', () => {
    expect(formatMonthlyPages('', '', '')).toBe('-')
    expect(formatMonthlyPages(null, undefined, '')).toBe('-')
  })
})

describe('parseIsoDate', () => {
  it('YYYY-MM-DD만 받아들인다', () => {
    expect(parseIsoDate('2026-08-19')).toEqual({ year: 2026, month: 8, day: 19 })
    expect(parseIsoDate('2026-8-19')).toBeNull()
    expect(parseIsoDate('8/19')).toBeNull()
    expect(parseIsoDate('서면평가')).toBeNull()
    expect(parseIsoDate('')).toBeNull()
    expect(parseIsoDate(null)).toBeNull()
  })
  it('실제로 없는 날짜는 거절한다', () => {
    expect(parseIsoDate('2026-02-30')).toBeNull()
    expect(parseIsoDate('2026-13-01')).toBeNull()
  })
})

describe('formatMonthlyDate', () => {
  it('같은 연도는 M/D', () => {
    expect(formatMonthlyDate('2026-07-21', 2026)).toBe('7/21')
    expect(formatMonthlyDate('2026-09-02', 2026)).toBe('9/2')
  })
  it('다른 연도는 YY.M/D', () => {
    expect(formatMonthlyDate('2027-01-05', 2026)).toBe('27.1/5')
    expect(formatMonthlyDate('2025-12-31', 2026)).toBe('25.12/31')
  })
  it('ISO가 아니면 원문을 살리고, 빈 값은 "-"', () => {
    expect(formatMonthlyDate('~8/10', 2026)).toBe('~8/10')
    expect(formatMonthlyDate('추후', 2026)).toBe('추후')
    expect(formatMonthlyDate('', 2026)).toBe('-')
  })
})

describe('formatMonthlyInterview — 발표/면접 열', () => {
  it('날짜가 있으면 날짜', () => {
    expect(formatMonthlyInterview('2026-08-25', '10분/10분', 2026)).toBe('8/25')
  })
  it('날짜가 없고 interview_time이 서면평가면 서면평가', () => {
    expect(formatMonthlyInterview(null, '서면평가', 2026)).toBe('서면평가')
    expect(formatMonthlyInterview('', '서면평가', 2026)).toBe('서면평가')
  })
  it('날짜가 없고 추후면 추후', () => {
    expect(formatMonthlyInterview(null, '추후', 2026)).toBe('추후')
  })
  it('둘 다 없으면 "-"', () => {
    expect(formatMonthlyInterview(null, '', 2026)).toBe('-')
    expect(formatMonthlyInterview(null, '10분/10분', 2026)).toBe('-')
  })
  it('날짜가 있으면 interview_time보다 날짜가 우선한다', () => {
    expect(formatMonthlyInterview('2026-08-25', '서면평가', 2026)).toBe('8/25')
  })
  it('written 플래그(projects.interview_written)면 날짜·interview_time보다 우선한다', () => {
    expect(formatMonthlyInterview(null, '', 2026, true)).toBe('서면평가')
    expect(formatMonthlyInterview('2026-08-25', '10분/10분', 2026, true)).toBe('서면평가')
  })
})

describe('formatMonthlyBid — 개찰일(낙찰자)', () => {
  it('낙찰자가 없으면 날짜만', () => {
    expect(formatMonthlyBid('2026-07-30', '', 2026)).toBe('7/30')
  })
  it('낙찰자가 있으면 괄호로 붙인다', () => {
    expect(formatMonthlyBid('2026-07-30', '선', 2026)).toBe('7/30(선)')
  })
  it('날짜가 없고 낙찰자만 있으면 괄호만', () => {
    expect(formatMonthlyBid(null, '선', 2026)).toBe('(선)')
  })
  it('둘 다 없으면 "-"', () => {
    expect(formatMonthlyBid(null, '', 2026)).toBe('-')
  })
})

describe('formatMonthlyNote — score_dist 최우선, 병기 금지', () => {
  it('score_dist가 있으면 그것만 쓴다', () => {
    expect(formatMonthlyNote({
      scoreDist: '30(20+10)', staffArch: '박재흥', note: '특이사항',
    })).toBe('30(20+10)')
  })
  it('score_dist가 없으면 분야별 기술인', () => {
    expect(formatMonthlyNote({
      scoreDist: '', staffArch: '박재흥', staffCivil: '권해철', note: '특이사항',
    })).toBe('-건축 박재흥 -토목 권해철')
  })
  it('둘 다 없으면 note', () => {
    expect(formatMonthlyNote({ scoreDist: '', note: '특이사항' })).toBe('특이사항')
  })
  it('모두 없으면 "-"', () => {
    expect(formatMonthlyNote({})).toBe('-')
  })
  it('분야별 기술인은 건축·토목·기계·안전 순서다', () => {
    expect(formatMonthlyStaff({
      staffSafety: '손만호', staffMech: '엄신영', staffCivil: '오인환', staffArch: '원성훈',
    })).toBe('-건축 원성훈 -토목 오인환 -기계 엄신영 -안전 손만호')
  })
})

describe('formatMonthlyProjectTitle — 상단표는 관리번호_정제명', () => {
  it('관리번호가 있으면 밑줄로 잇는다', () => {
    expect(formatMonthlyProjectTitle('2647', '26-A-00부대(A138)')).toBe('2647_26-A-00부대(A138)')
  })
  it('관리번호가 없으면 이름만', () => {
    expect(formatMonthlyProjectTitle('', '345kV 신석문변전소')).toBe('345kV 신석문변전소')
    expect(formatMonthlyProjectTitle(null, '345kV 신석문변전소')).toBe('345kV 신석문변전소')
  })
  it('이름이 없으면 관리번호만, 둘 다 없으면 "-"', () => {
    expect(formatMonthlyProjectTitle('2647', '')).toBe('2647')
    expect(formatMonthlyProjectTitle('', '')).toBe('-')
  })
})
