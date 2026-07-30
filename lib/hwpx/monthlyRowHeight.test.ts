import { describe, it, expect } from 'vitest'
import {
  estimateLineCount, cellHeightForLines, estimateMonthlyRowHeight, estimateMonthlyRowsHeight,
  describeMonthlyRowLines, charWidth,
  MONTHLY_WRAP_COLUMNS, MONTHLY_CELL_VERTICAL_MARGIN,
} from './monthlyRowHeight'

const DECLARED = 1818 // montly.hwpx 선언 데이터 행 높이
const CLIENT = MONTHLY_WRAP_COLUMNS.client   // 폭 4,276 / 8pt / 줄간격 0
const NAME = MONTHLY_WRAP_COLUMNS.name       // 폭 22,720 / 11pt / 줄간격 332

describe('charWidth', () => {
  it('한글은 글자 높이, ASCII는 절반', () => {
    expect(charWidth('가', 800)).toBe(800)
    expect(charWidth('A', 800)).toBe(400)
    expect(charWidth('2', 800)).toBe(400)
    expect(charWidth(' ', 800)).toBe(400)
    expect(charWidth('(', 800)).toBe(400)
  })
})

// 아래 줄 수는 한글 렌더 실측(발주처 열)과 대조한 값이다.
describe('estimateLineCount — 발주처 열(폭 4,276 / 8pt)', () => {
  const lines = (t: string) => estimateLineCount(t, CLIENT.textWidth, CLIENT.charHeight)

  it('짧은 기관명은 1줄', () => {
    for (const t of ['안산시', '화성시', '진주시', '음성군', '국군재정']) expect(lines(t)).toBe(1)
  })
  it('국군재정관리단(7자) → 2줄', () => {
    expect(lines('국군재정관리단')).toBe(2)
  })
  it('수자원공사 금강유역본부(12자) → 3줄', () => {
    expect(lines('수자원공사 금강유역본부')).toBe(3)
  })
  it('한국전력공사 중부건설본부(13자) → 4줄', () => {
    expect(lines('한국전력공사 중부건설본부')).toBe(4)
  })
  it('한국전력공사 경인건설본부 경기건설지사(20자) → 6줄', () => {
    expect(lines('한국전력공사 경인건설본부 경기건설지사')).toBe(6)
  })
  it('축약 표시명은 모두 2줄 이내', () => {
    for (const t of ['국군재정', '한전(중부)', '한전(경인)', '한국수자원', 'LH', '한전']) {
      expect(lines(t), t).toBeLessThanOrEqual(2)
    }
  })
  it('빈 값도 1줄로 센다', () => {
    expect(lines('')).toBe(1)
    expect(lines('   ')).toBe(1)
  })
})

describe('estimateLineCount — 용역명 열(폭 22,720 / 11pt)', () => {
  const lines = (t: string) => estimateLineCount(t, NAME.textWidth, NAME.charHeight)

  it('실측과 같은 줄 수를 낸다', () => {
    expect(lines('2652_안산 성포지구 주상복합 개발사업')).toBe(1)
    expect(lines('2654_26-U-왜관 캠프캐롤 전술장비정비시설(E008)')).toBe(2)
    expect(lines('2659_대소읍 박장대소 복합거점센터 외 2개소 통합')).toBe(2)
    expect(lines('2651_345kV 신석문변전소')).toBe(1)
  })
})

describe('estimateLineCount — 줄바꿈 규칙', () => {
  it('공백에서 먼저 끊는다', () => {
    // 폭 4,276(8pt) = 한글 5자. "가나다 라마바사" → "가나다" / "라마바사"
    expect(estimateLineCount('가나다 라마바사', 4276, 800)).toBe(2)
  })
  it('한 단어가 줄보다 길면 단어 안에서 끊는다', () => {
    expect(estimateLineCount('가나다라마바사', 4276, 800)).toBe(2)
    expect(estimateLineCount('가나다라마바사아자차카', 4276, 800)).toBe(3)
  })
  it('개행이 있으면 문단별로 세서 합한다', () => {
    expect(estimateLineCount('제안서 10P\n자소서 각3P', MONTHLY_WRAP_COLUMNS.pages.textWidth, 800)).toBe(2)
  })
})

describe('cellHeightForLines — 실측 대조', () => {
  it('발주처 열: n×800 + 상하 여백 282', () => {
    expect(cellHeightForLines(1, CLIENT)).toBe(1082)
    expect(cellHeightForLines(2, CLIENT)).toBe(1882) // 실측 1,880
    expect(cellHeightForLines(3, CLIENT)).toBe(2682) // 실측 2,690
    expect(cellHeightForLines(4, CLIENT)).toBe(3482) // 실측 3,480
    expect(cellHeightForLines(6, CLIENT)).toBe(5082) // 실측 5,080
  })
  it('용역명 열: n×1100 + (n-1)×332 + 282', () => {
    expect(cellHeightForLines(1, NAME)).toBe(1382)
    expect(cellHeightForLines(2, NAME)).toBe(2814) // 실측 2,810~2,820
    expect(cellHeightForLines(3, NAME)).toBe(4246)
  })
  it('상하 여백 상수는 실측값이다', () => {
    expect(MONTHLY_CELL_VERTICAL_MARGIN).toBe(282)
  })
})

describe('estimateMonthlyRowHeight', () => {
  const row = (over: Partial<Record<'name' | 'client' | 'pages' | 'note', string>> = {}) => ({
    name: '2652_안산 성포지구 주상복합 개발사업', client: '안산시', pages: '-', note: '3', ...over,
  })

  it('네 열 모두 1줄이면 선언 높이를 그대로 쓴다', () => {
    expect(estimateMonthlyRowHeight(row(), DECLARED)).toBe(DECLARED)
  })
  it('선언 높이보다 작아지지 않는다', () => {
    expect(estimateMonthlyRowHeight(row({ name: '가', client: '가', pages: '-', note: '-' }), DECLARED))
      .toBe(DECLARED)
  })
  it('가장 줄이 많은 열을 기준으로 높이가 정해진다', () => {
    // 발주처 6줄 → 5,082
    expect(estimateMonthlyRowHeight(row({ client: '한국전력공사 경인건설본부 경기건설지사' }), DECLARED))
      .toBe(5082)
    // 용역명 2줄(2,814)이 발주처 2줄(1,882)보다 높다
    expect(estimateMonthlyRowHeight(
      row({ name: '2654_26-U-왜관 캠프캐롤 전술장비정비시설(E008)', client: '국군재정관리단' }), DECLARED
    )).toBe(2814)
  })
  it('발주처를 축약하면 행 높이가 선언 높이로 돌아온다', () => {
    expect(estimateMonthlyRowHeight(row({ client: '한국전력공사 중부건설본부' }), DECLARED)).toBe(3482)
    expect(estimateMonthlyRowHeight(row({ client: '한전(중부)' }), DECLARED)).toBe(DECLARED)
  })
  it('쪽수·비고 줄바꿈도 반영한다', () => {
    // 쪽수 2문단 → 2줄 → 2×800 + 282 = 1,882 (선언 높이 1,818보다 크다)
    expect(estimateMonthlyRowHeight(row({ pages: '제안서 10P\n자소서 각3P' }), DECLARED)).toBe(1882)
    expect(estimateMonthlyRowHeight(
      row({ note: '-건축 원성훈 -토목 오인환 -기계 엄신영 -안전 손만호' }), DECLARED
    )).toBeGreaterThan(DECLARED)
  })
})

describe('estimateMonthlyRowsHeight', () => {
  it('0건이면 빈 행 하나가 선언 높이만큼 차지한다', () => {
    expect(estimateMonthlyRowsHeight([], DECLARED)).toBe(DECLARED)
  })
  it('행별 추정 높이를 합한다', () => {
    const rows = [
      { name: 'A', client: '안산시', pages: '-', note: '-' },
      { name: 'B', client: '한국전력공사 경인건설본부 경기건설지사', pages: '-', note: '-' },
    ]
    expect(estimateMonthlyRowsHeight(rows, DECLARED)).toBe(DECLARED + 5082)
  })
})

describe('describeMonthlyRowLines — 진단용', () => {
  it('열별 줄 수를 돌려준다', () => {
    expect(describeMonthlyRowLines({
      name: '2652_안산 성포지구 주상복합 개발사업',
      client: '한국전력공사 중부건설본부', pages: '-', note: '3',
    })).toEqual({ name: 1, client: 4, pages: 1, note: 1 })
  })
})
