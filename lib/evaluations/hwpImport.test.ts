import { describe, expect, it } from 'vitest'
import {
  buildReviewDraft,
  canonicalRoleName,
  countImportedQuestions,
  hasImportedContent,
  parseAttendees,
  parseCompanies,
  parseCount,
  parseDateTime,
  parseQuestionLines,
  type ParsedBlock,
} from './hwpImport'

/**
 * 실제 HWP 파일 대신 kordoc이 돌려주는 블록 모양을 그대로 만들어 넣는다.
 * 파서가 보는 것은 "표 셀 텍스트 + 문단 텍스트"뿐이므로 이 픽스처로 서식 차이를 재현할 수 있다.
 */
function table(rows: string[][]): ParsedBlock {
  return { type: 'table', table: { cells: rows.map(r => r.map(text => ({ text }))) } }
}

function para(text: string): ParsedBlock {
  return { type: 'paragraph', text }
}

describe('parseDateTime', () => {
  it('날짜와 시각을 나눈다', () => {
    expect(parseDateTime('2026-08-19 13:30~')).toEqual({ date: '2026-08-19', year: null, time: '13:30~' })
  })

  it('한글·점 표기와 요일 괄호를 받는다', () => {
    expect(parseDateTime('2026. 8. 19.(수) 14:00 ~ 14:20'))
      .toEqual({ date: '2026-08-19', year: null, time: '14:00 ~ 14:20' })
    expect(parseDateTime('2015년 3월 4일 오후 2시'))
      .toEqual({ date: '2015-03-04', year: null, time: '오후 2시' })
  })

  it('연도만 있으면 가짜 월·일을 만들지 않는다', () => {
    expect(parseDateTime('2015년')).toEqual({ date: null, year: 2015, time: '' })
  })

  it('시각만 적힌 칸도 받는다', () => {
    expect(parseDateTime('13:30~')).toEqual({ date: null, year: null, time: '13:30~' })
  })

  it('월·일이 범위를 벗어나면 날짜로 보지 않는다', () => {
    expect(parseDateTime('2026.13.45')).toEqual({ date: null, year: 2026, time: '13.45' })
  })

  it('빈 값은 전부 비운다', () => {
    expect(parseDateTime('  ')).toEqual({ date: null, year: null, time: '' })
  })
})

describe('parseCount', () => {
  it('인·명 표기에서 숫자만 뽑는다', () => {
    expect(parseCount('5인')).toBe(5)
    expect(parseCount('7 명')).toBe(7)
    expect(parseCount('3')).toBe(3)
  })

  it('숫자가 없으면 null이다(추측하지 않는다)', () => {
    expect(parseCount('미상')).toBeNull()
    expect(parseCount('')).toBeNull()
  })
})

describe('parseCompanies', () => {
  it('개수·순서·업체명을 나눈다', () => {
    expect(parseCompanies('7개 중 1번째 (A사, B사, C사)'))
      .toEqual({ count: 7, order: 1, names: 'A사, B사, C사' })
  })

  it('개수·순서만 있으면 업체명을 만들어내지 않는다', () => {
    expect(parseCompanies('7개 중 3번째')).toEqual({ count: 7, order: 3, names: '' })
  })

  it('업체명만 있으면 그대로 남긴다', () => {
    expect(parseCompanies('A사, B사')).toEqual({ count: null, order: null, names: 'A사, B사' })
  })
})

describe('parseAttendees', () => {
  it('이름(역할) 표기를 나눈다', () => {
    expect(parseAttendees('홍길동(단장), 김철수(안전), 이영희 차장(수행)')).toEqual([
      { name: '홍길동', role: '단장' },
      { name: '김철수', role: '안전' },
      { name: '이영희 차장', role: '수행' },
    ])
  })

  it('역할이 먼저 적힌 표기도 받는다', () => {
    expect(parseAttendees('단장: 홍길동\n안전: 김철수')).toEqual([
      { name: '홍길동', role: '단장' },
      { name: '김철수', role: '안전' },
    ])
  })

  it('역할이 없으면 이름만 남긴다', () => {
    expect(parseAttendees('홍길동, 김철수')).toEqual([
      { name: '홍길동', role: '' },
      { name: '김철수', role: '' },
    ])
  })
})

describe('canonicalRoleName', () => {
  it('문서 표기를 표준 그룹 이름으로 바꾼다', () => {
    expect(canonicalRoleName('단장')).toBe('책임')
    expect(canonicalRoleName('책임기술자 질의')).toBe('책임')
    expect(canonicalRoleName('기계설비')).toBe('기계')
    expect(canonicalRoleName('전기통신')).toBe('전기')
  })

  it('모르는 표기는 null이다', () => {
    expect(canonicalRoleName('조경')).toBeNull()
    expect(canonicalRoleName('')).toBeNull()
  })
})

describe('parseQuestionLines', () => {
  it('머리말로 그룹을 나누고 번호를 떼어낸다', () => {
    const groups = parseQuestionLines([
      '[단장]',
      '1. 품질관리 계획을 설명해주세요.',
      '2. 공정 지연 시 대응방안은?',
      '[안전]',
      '- 중대재해처벌법 대응 방안',
    ])
    expect(groups).toEqual([
      { role_name: '책임', questions: ['품질관리 계획을 설명해주세요.', '공정 지연 시 대응방안은?'] },
      { role_name: '안전', questions: ['중대재해처벌법 대응 방안'] },
    ])
  })

  it('▷책임기술자 질의 같은 머리말도 받는다', () => {
    const groups = parseQuestionLines(['▷책임기술자 질의', '1) 감리 경험을 말해보세요.'])
    expect(groups).toEqual([{ role_name: '책임', questions: ['감리 경험을 말해보세요.'] }])
  })

  it('번호 없는 이어지는 줄은 앞 질문에 붙인다', () => {
    const groups = parseQuestionLines([
      '[안전]',
      '1. 현장 안전관리 조직을',
      '어떻게 구성할 계획인가',
      '2. 위험성평가 절차는?',
    ])
    expect(groups[0].questions).toEqual([
      '현장 안전관리 조직을 어떻게 구성할 계획인가',
      '위험성평가 절차는?',
    ])
  })

  it('머리말 없이 시작하는 문서는 그룹 미지정으로 담는다', () => {
    const groups = parseQuestionLines(['품질관리 방안은?', '공정관리 방안은?'])
    expect(groups).toEqual([{ role_name: null, questions: ['품질관리 방안은?', '공정관리 방안은?'] }])
  })

  it('모르는 머리말은 그룹을 비워 둔다(질문은 살린다)', () => {
    const groups = parseQuestionLines(['[조경]', '- 수목 이식 계획은?'])
    expect(groups).toEqual([{ role_name: null, questions: ['수목 이식 계획은?'] }])
  })

  it('질문이 없는 그룹은 버린다', () => {
    expect(parseQuestionLines(['[단장]', '[안전]', '- 질문 하나'])).toEqual([
      { role_name: '안전', questions: ['질문 하나'] },
    ])
  })
})

describe('buildReviewDraft — 라벨/값 표 서식', () => {
  const blocks: ParsedBlock[] = [
    para('면접후기'),
    table([
      ['평가유형', '면접', '발 주 처', '충청북도 청주시'],
      ['용역명', '청주시 복합문화센터 건립공사 건설사업관리', '시설용도', '문화 및 집회시설'],
      ['일   시', '2026. 8. 19.(수) 13:30~', '장  소', '청주시청 3층 회의실'],
      ['면접관', '5인', '참가업체', '7개 중 1번째 (A사, B사, C사)'],
      ['참석자', '홍길동(단장), 김철수(안전)', '', ''],
      ['진행방법', 'PT 발표 10분 후 분야별 기술인 질의응답', '', ''],
      ['특이사항', '발표 자료는 현장에서 배포됨', '', ''],
    ]),
    para('실제질의'),
    para('[단장]\n1. 품질관리 계획을 설명해주세요.\n2. 공정 지연 시 대응방안은?'),
    para('[안전]\n- 중대재해처벌법 대응 방안'),
  ]

  const draft = buildReviewDraft(blocks)

  it('개요 항목을 읽는다', () => {
    expect(draft.evaluation_type_source).toBe('면접')
    expect(draft.client).toBe('충청북도 청주시')
    expect(draft.project_name).toBe('청주시 복합문화센터 건립공사 건설사업관리')
    expect(draft.facility_type).toBe('문화 및 집회시설')
    expect(draft.location).toBe('청주시청 3층 회의실')
  })

  it('일시를 날짜와 시각으로 나눈다', () => {
    expect(draft.evaluation_date).toBe('2026-08-19')
    expect(draft.evaluation_year).toBeNull()
    expect(draft.evaluation_time).toBe('13:30~')
  })

  it('숫자 항목과 참가업체를 나눈다', () => {
    expect(draft.evaluator_count).toBe(5)
    expect(draft.participant_company_count).toBe(7)
    expect(draft.presentation_order).toBe(1)
    expect(draft.participant_companies).toBe('A사, B사, C사')
  })

  it('참석자·진행방법·특이사항을 읽는다', () => {
    expect(draft.attendees).toEqual([
      { name: '홍길동', role: '단장' },
      { name: '김철수', role: '안전' },
    ])
    expect(draft.evaluation_method).toBe('PT 발표 10분 후 분야별 기술인 질의응답')
    expect(draft.special_notes).toBe('발표 자료는 현장에서 배포됨')
  })

  it('실제질의를 그룹으로 읽는다', () => {
    expect(draft.groups).toEqual([
      { role_name: '책임', questions: ['품질관리 계획을 설명해주세요.', '공정 지연 시 대응방안은?'] },
      { role_name: '안전', questions: ['중대재해처벌법 대응 방안'] },
    ])
    expect(countImportedQuestions(draft)).toBe(3)
  })
})

describe('buildReviewDraft — 줄글 서식', () => {
  const draft = buildReviewDraft([
    para('○ 발주처 : 한국토지주택공사'),
    para('○ 용역명 : OO지구 아파트 건설사업관리'),
    para('○ 일시 : 2015년'),
    para('진행방법'),
    para('서면 평가 후 대면 질의'),
    para('추가 질의는 없었음'),
    para('특이사항'),
    para('경쟁 3개사'),
    para('실제 질의'),
    para('▷ 건축 질의'),
    para('1. 마감재 선정 기준은?'),
  ])

  it('라벨: 값 형태의 줄을 읽는다', () => {
    expect(draft.client).toBe('한국토지주택공사')
    expect(draft.project_name).toBe('OO지구 아파트 건설사업관리')
  })

  it('연도만 아는 자료는 연도로 남긴다', () => {
    expect(draft.evaluation_date).toBeNull()
    expect(draft.evaluation_year).toBe(2015)
  })

  it('머리말 아래 여러 줄을 한 항목으로 모은다', () => {
    expect(draft.evaluation_method).toBe('서면 평가 후 대면 질의\n추가 질의는 없었음')
    expect(draft.special_notes).toBe('경쟁 3개사')
  })

  it('실제질의 머리말 뒤의 질문을 읽는다', () => {
    expect(draft.groups).toEqual([{ role_name: '건축', questions: ['마감재 선정 기준은?'] }])
  })
})

/**
 * 실제 회사 면접후기 HWP의 서식을 그대로 옮긴 회귀 테스트.
 *
 * 값은 익명으로 바꿨지만 **구조는 실제 문서와 동일**하다 — 제목만 든 1행 표 + `구 분 | 내 용`
 * 머리행을 가진 2열 표 하나에 개요와 질의가 함께 들어 있고, 라벨은 "발 주 처"처럼 글자 사이를
 * 벌려 적고, 특이사항 라벨에는 줄바꿈과 괄호 설명이 붙고, 질의는 한 칸 안에 여러 줄로 들어 있다.
 *
 * 이 서식에서 특히 조심할 것 두 가지:
 *   1. 머리행 `구 분 | 내 용`을 항목 라벨로 인정하면 개요 표 전체가 질문으로 읽힌다.
 *   2. 평가유형 칸이 아예 없다 — 제목의 "면접후기"가 유일한 근거다(importSeed가 읽는다).
 */
describe('buildReviewDraft — 실제 후기 문서 서식', () => {
  const blocks: ParsedBlock[] = [
    table([['345kV ○○변전소 면접후기', '', '', '', '', '']]),
    table([
      ['구    분', '내    용'],
      ['발 주 처', '한국전력공사 ○○건설본부'],
      ['용 역 명', '345kV ○○변전소 토건공사 감독권한대행 등 건설사업관리용역'],
      ['일    시', '2026년 9월 2일 (화) 13:00~'],
      ['장    소', '○○건설본부 3층 대회의실'],
      ['참 석 자', '김하나 상무(단장), 이두울(65) 상무(건축), 박세엣 상무(안전), 최네엣 차장(수행)'],
      ['참가업체', '3개 중 1번째 (가사, 나사, 다사)'],
      ['면 접 관', '9인'],
      ['면접방법', '책임기술인 10분 PT 발표\n질문지는 A4용지 인쇄하여 배부\n면접질의 각 2문항 5분 내 답변'],
      ['특이사항\n(분위기, 좌석배치 등)', '평가위원장 중심 좌, 우측 4명씩 배석\n다른 기술인들은 옆에 착석'],
      ['주요질의내용', '<제안서 질의응답>\n1. 사급자재의 종류 및 자재관리방안\n2. 중대재해 발생 시 관리방안\n<개별질문>\n책임 기술인\n1. 책임 기술인의 역할\n2. 가압일정 준수를 위한 공기단축방안\n건축 기술인\n1. 확인점의 품질관리방안\n안전 기술인\n1. 수직개구부 안전관리방안'],
    ]),
  ]

  const draft = buildReviewDraft(blocks)

  it('머리행(구 분 | 내 용)을 항목으로 읽지 않는다', () => {
    // 이것이 깨지면 개요 표 전체가 질문으로 들어오고 항목은 전부 비게 된다.
    expect(draft.evaluation_type_source).toBe('')
    expect(draft.unmatched_labels).toEqual([])
    expect(draft.groups.every(g => g.questions.every(q => !q.includes('한국전력공사')))).toBe(true)
  })

  it('제목을 남긴다(평가유형 칸이 없는 문서라 유일한 근거다)', () => {
    expect(draft.document_title).toBe('345kV ○○변전소 면접후기')
  })

  it('글자를 벌려 적은 라벨을 읽는다', () => {
    expect(draft.client).toBe('한국전력공사 ○○건설본부')
    expect(draft.project_name).toBe('345kV ○○변전소 토건공사 감독권한대행 등 건설사업관리용역')
    expect(draft.location).toBe('○○건설본부 3층 대회의실')
    expect(draft.evaluator_count).toBe(9)
  })

  it('"2026년 9월 2일 (화) 13:00~"을 날짜와 시각으로 나눈다', () => {
    expect(draft.evaluation_date).toBe('2026-09-02')
    expect(draft.evaluation_time).toBe('13:00~')
  })

  it('참가업체를 개수·순서·업체명으로 나눈다', () => {
    expect(draft.participant_company_count).toBe(3)
    expect(draft.presentation_order).toBe(1)
    expect(draft.participant_companies).toBe('가사, 나사, 다사')
  })

  it('동명이인 구분 괄호가 붙은 참석자도 맨 뒤 괄호를 역할로 읽는다', () => {
    expect(draft.attendees).toEqual([
      { name: '김하나 상무', role: '단장' },
      { name: '이두울(65) 상무', role: '건축' },
      { name: '박세엣 상무', role: '안전' },
      { name: '최네엣 차장', role: '수행' },
    ])
  })

  it('면접방법과 줄바꿈·괄호가 붙은 특이사항 라벨을 읽는다', () => {
    expect(draft.evaluation_method).toContain('책임기술인 10분 PT 발표')
    expect(draft.evaluation_method).toContain('면접질의 각 2문항 5분 내 답변')
    expect(draft.special_notes).toContain('평가위원장 중심 좌, 우측 4명씩 배석')
  })

  it('한 칸에 든 주요질의내용을 그룹으로 나눈다', () => {
    expect(draft.groups).toEqual([
      // <제안서 질의응답>은 누구에게 나온 질문인지 문서에 없다 — 그룹을 비워 둔다(추측 금지).
      { role_name: null, questions: ['사급자재의 종류 및 자재관리방안', '중대재해 발생 시 관리방안'] },
      { role_name: '책임', questions: ['책임 기술인의 역할', '가압일정 준수를 위한 공기단축방안'] },
      { role_name: '건축', questions: ['확인점의 품질관리방안'] },
      { role_name: '안전', questions: ['수직개구부 안전관리방안'] },
    ])
    expect(countImportedQuestions(draft)).toBe(6)
  })

  it('두 번째 서식(단장/안전만 적힌 질의)도 같은 경로로 읽는다', () => {
    const other = buildReviewDraft([
      table([
        ['구    분', '내    용'],
        ['발 주 처', '한국전력공사 ○○건설본부 ○○건설지사'],
        ['용 역 명', '154kV ○○변전소 토건공사 감독권한대행 등 건설사업관리용역'],
        ['특이사항\n(분위기, 좌석배치 등)', ''],
        ['주요질의내용', '단장\n1. 시공계획서에 포함되어야 할 사항은?\n안전\n1. 작업계획서 대상은?'],
      ]),
    ])
    expect(other.special_notes).toBe('')
    expect(other.groups).toEqual([
      { role_name: '책임', questions: ['시공계획서에 포함되어야 할 사항은?'] },
      { role_name: '안전', questions: ['작업계획서 대상은?'] },
    ])
  })
})

describe('buildReviewDraft — 그 밖의 서식', () => {
  it('머리글이 첫 행에 있는 세로 표를 읽는다', () => {
    const draft = buildReviewDraft([
      table([
        ['발주처', '용역명', '평가일'],
        ['서울시', '한강 보행교 설계', '2024-05-02'],
      ]),
    ])
    expect(draft.client).toBe('서울시')
    expect(draft.project_name).toBe('한강 보행교 설계')
    expect(draft.evaluation_date).toBe('2024-05-02')
  })

  it('질의가 표로 정리된 문서를 읽는다(빈 그룹 칸은 위 행을 잇는다)', () => {
    const draft = buildReviewDraft([
      table([
        ['구분', '질의내용'],
        ['단장', '품질관리 방안은?'],
        ['', '공정 만회대책은?'],
        ['안전', '위험성평가 절차는?'],
      ]),
    ])
    expect(draft.groups).toEqual([
      { role_name: '책임', questions: ['품질관리 방안은?', '공정 만회대책은?'] },
      { role_name: '안전', questions: ['위험성평가 절차는?'] },
    ])
  })

  it('사전에 없는 라벨은 unmatched_labels로 알린다', () => {
    const draft = buildReviewDraft([
      table([['발주처', '서울시'], ['입회자', '감사팀 3명']]),
    ])
    expect(draft.client).toBe('서울시')
    expect(draft.unmatched_labels).toContain('입회자')
  })

  it('빈 값 칸은 앞 값을 덮어쓰지 않는다', () => {
    const draft = buildReviewDraft([
      table([['발주처', '서울시']]),
      table([['발주처', '']]),
    ])
    expect(draft.client).toBe('서울시')
  })

  it('아무것도 못 읽으면 hasImportedContent가 false다', () => {
    const draft = buildReviewDraft([para('안녕하세요'), para('이 문서는 후기가 아닙니다')])
    expect(hasImportedContent(draft)).toBe(false)
  })
})
