/**
 * 숙박관리 — 대표 이용자 통합 검색.
 *
 * 화면은 기술인/직원 구분 입력란을 두지 않고 engineer_contacts + overtime_employees를 합쳐
 * 하나의 검색 목록으로 제공한다(사용자 확정). 동일 이름이 두 테이블에 있을 수 있으므로 이름만으로
 * 병합하지 않고, 검색 결과에 분야·소속/직급 같은 보조정보(subLabel)를 표시해 사용자가 정확한
 * 사람을 고르게 한다. typeahead 패턴은 attendance의 ParticipantManagerModal과 동일
 * (공백 제거 소문자 정규화, 상위 20개).
 */
import { GuestCandidate } from './types'

interface EngineerContactLike {
  id: string
  name: string
  company: string
  rank: string
}

interface OvertimeEmployeeLike {
  id: string
  name: string
  position: string
  is_active: boolean
}

export function buildGuestDirectory(
  engineers: EngineerContactLike[],
  employees: OvertimeEmployeeLike[],
): GuestCandidate[] {
  const engineerCandidates: GuestCandidate[] = engineers.map(e => ({
    source: 'engineer_contact',
    id: e.id,
    name: e.name,
    subLabel: [e.rank, e.company].filter(Boolean).join(' · '),
  }))
  const employeeCandidates: GuestCandidate[] = employees
    .filter(e => e.is_active)
    .map(e => ({
      source: 'overtime_employee',
      id: e.id,
      name: e.name,
      subLabel: e.position,
    }))
  return [...engineerCandidates, ...employeeCandidates]
}

function normalize(s: string): string {
  return s.replace(/\s+/g, '').toLowerCase()
}

/** 검색어로 상위 20개 후보를 반환 — 빈 검색어면 빈 배열(입력 전에는 목록을 펼치지 않음). */
export function searchGuestDirectory(candidates: GuestCandidate[], query: string): GuestCandidate[] {
  const normalizedQuery = normalize(query.trim())
  if (!normalizedQuery) return []
  return candidates.filter(c => normalize(c.name).includes(normalizedQuery)).slice(0, 20)
}
