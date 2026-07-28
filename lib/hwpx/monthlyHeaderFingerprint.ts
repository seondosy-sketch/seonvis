// 월간 프로젝트/달력 표를 "고정 인덱스"가 아니라 헤더 텍스트 fingerprint로 식별하기 위한
// 순수 정규화 함수. XML을 다루지 않는다 — app/api/hwpx/route.ts가 실제 셀 텍스트를 뽑아
// 여기 넘긴다.
//
// 문제(Codex P1-1): "첫 번째 12열 표 + 그 다음 표" 같은 위치 기반 식별은, 다른 표가 앞에
// 추가되거나 두 표 사이에 표가 삽입되면 잘못된 표를 선택한다. 유효한 HWPX가 만들어지되
// 내용이 잘못되는 조용한 오류로 이어질 수 있다.
//
// 실측(lib/templates/montly.hwpx, Contents/section0.xml 직접 확인): 프로젝트 표 첫 번째
// 헤더 셀의 원본 텍스트는 "용     역     명"처럼 시각적 정렬을 위한 다중 공백을 포함한다.
// 연속 공백을 1칸으로 축소하면 "용역명"이 아니라 "용 역 명"(공백 2개 유지)이 된다 — 이
// 정규화 결과를 그대로 계약값으로 쓴다(임의로 "용역명"으로 맞추지 않음).
export function normalizeHeaderText(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/ /g, ' ') // NBSP → 일반 공백
    .replace(/[\r\n]/g, ' ') // 줄바꿈 → 공백
    .replace(/\t/g, ' ') // 탭 → 공백
    .replace(/ +/g, ' ') // 연속 공백 → 1칸
    .trim()
}

// 실측 결과를 그대로 계약값으로 확정 — lib/templates/montly.hwpx의 프로젝트 표 헤더 12칸을
// normalizeHeaderText()에 통과시킨 값과 정확히 일치해야 한다. 순서도 고정.
export const MONTHLY_PROJECT_HEADER_FINGERPRINT: readonly string[] = [
  '용 역 명',
  '발주처',
  '단장',
  '금액(억원)',
  '기간(개월)',
  '쪽수',
  '과업설명도서열람',
  '현장조사',
  '제출일',
  '발표/면접',
  '개찰일(낙찰자)',
  '비고',
] as const

export const MONTHLY_CALENDAR_HEADER_FINGERPRINT: readonly string[] = [
  '일', '월', '화', '수', '목', '금', '토',
] as const

export function matchesHeaderFingerprint(rawHeaderTexts: string[], fingerprint: readonly string[]): boolean {
  if (rawHeaderTexts.length !== fingerprint.length) return false
  return rawHeaderTexts.every((raw, i) => normalizeHeaderText(raw) === fingerprint[i])
}
