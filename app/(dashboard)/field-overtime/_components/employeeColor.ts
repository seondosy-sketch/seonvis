/**
 * 달력 칩의 직원별 색 — 이 앱이 이미 쓰는 6색(amber/blue/green/orange/violet/red, 제안서팀
 * 대시보드와 동일 순서)을 직원 정렬순서대로 돌려 쓴다. 칩에는 항상 이름이 같이 적혀 있어
 * 색이 반복돼도 구분이 된다.
 */
const PALETTE = [
  { fg: '#f59e0b', bg: '#fffbeb' },
  { fg: '#3b82f6', bg: '#eff6ff' },
  { fg: '#10b981', bg: '#ecfdf5' },
  { fg: '#f97316', bg: '#fff7ed' },
  { fg: '#8b5cf6', bg: '#f5f3ff' },
  { fg: '#ef4444', bg: '#fef2f2' },
]

export function employeeColor(index: number) {
  return PALETTE[index % PALETTE.length]
}
