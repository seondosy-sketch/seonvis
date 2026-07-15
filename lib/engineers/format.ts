/**
 * 기술인 주소록 — 전화번호 포맷/비교, 지역 추출 순수 함수
 * (docs/engineer-address-book/04-search-and-filter.md)
 */

import { REGIONS } from './types'

/** 하이픈·공백·괄호 제거 — 중복 비교와 전화번호 검색은 항상 이 값으로 한다 */
export function normalizePhone(phone: string): string {
  return phone.replace(/[^\d]/g, '')
}

/**
 * 숫자만 입력해도 하이픈 자동 삽입. 휴대폰(010)·서울(02)·지역번호(031 등) 규칙.
 * 규칙에 안 맞는 길이는 입력값을 그대로 돌려준다 — 내선·해외 번호도 저장은 허용.
 */
export function formatPhone(input: string): string {
  const d = normalizePhone(input)
  if (d.length === 11 && d.startsWith('0')) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`
  if (d.startsWith('02')) {
    if (d.length === 10) return `02-${d.slice(2, 6)}-${d.slice(6)}`
    if (d.length === 9) return `02-${d.slice(2, 5)}-${d.slice(5)}`
  }
  if (d.length === 10 && d.startsWith('0')) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`
  if (d.length === 8) return `${d.slice(0, 4)}-${d.slice(4)}`
  return input
}

/** 휴대폰 형식(010-####-####)인지 — 형식 경고는 휴대폰 패턴일 때만 */
export function looksLikeMobile(phone: string): boolean {
  return /^01[016789]/.test(normalizePhone(phone))
}

// 시·도가 생략된 주소의 도시명 → 시·도 매핑 (초기 시드 스크립트와 같은 규칙 유지)
const CITY_TO_SIDO: Record<string, string> = {
  수원: '경기', 성남: '경기', 용인: '경기', 화성: '경기', 평택: '경기', 안산: '경기',
  안양: '경기', 부천: '경기', 고양: '경기', 김포: '경기', 파주: '경기', 의정부: '경기',
  남양주: '경기', 하남: '경기', 광명: '경기', 시흥: '경기', 군포: '경기', 오산: '경기',
  이천: '경기', 여주: '경기', 양평: '경기', 구리: '경기', 동두천: '경기', 포천: '경기',
  양주: '경기', 의왕: '경기', 과천: '경기', 안성: '경기', 가평: '경기', 연천: '경기',
  춘천: '강원', 원주: '강원', 강릉: '강원', 동해: '강원', 속초: '강원',
  청주: '충북', 충주: '충북', 제천: '충북', 음성: '충북', 진천: '충북', 옥천: '충북', 증평: '충북',
  천안: '충남', 아산: '충남', 서산: '충남', 당진: '충남', 공주: '충남', 보령: '충남',
  논산: '충남', 계룡: '충남', 홍성: '충남', 예산: '충남', 부여: '충남', 태안: '충남',
  전주: '전북', 군산: '전북', 익산: '전북', 정읍: '전북', 완주: '전북',
  목포: '전남', 여수: '전남', 순천: '전남', 광양: '전남', 나주: '전남', 무안: '전남',
  포항: '경북', 구미: '경북', 경주: '경북', 안동: '경북', 김천: '경북', 경산: '경북', 칠곡: '경북',
  창원: '경남', 김해: '경남', 양산: '경남', 진주: '경남', 거제: '경남', 통영: '경남',
}

/**
 * 주소에서 시·도 자동 추출 (best-effort). 시·도로 시작하지 않으면 도시명으로 추정.
 * "광주시 ..."(경기 광주)는 광역시와 구분해 경기로 처리. 못 찾으면 빈 값 — 화면에서 수정.
 */
export function extractRegion(address: string): string {
  const a = address.trim()
  if (!a) return ''
  if (a.startsWith('광주광역시')) return '광주'
  if (a.startsWith('광주시')) return '경기'
  if (a.startsWith('충청북도')) return '충북'
  if (a.startsWith('충청남도')) return '충남'
  if (a.startsWith('전라북도') || a.startsWith('전북')) return '전북'
  if (a.startsWith('전라남도')) return '전남'
  if (a.startsWith('경상북도')) return '경북'
  if (a.startsWith('경상남도')) return '경남'
  for (const r of REGIONS) if (a.startsWith(r)) return r
  const head = a.split(/\s/)[0] ?? ''
  for (const [city, sido] of Object.entries(CITY_TO_SIDO)) {
    if (head.startsWith(city)) return sido
  }
  return ''
}
