import { describe, it, expect } from 'vitest'
import { sortOvertimeProjects } from './projectOrder'

type Row = { name: string; sort_order: number; source_project_id: string | null }

// source_project_id → 프로젝트 List의 공사번호
const numbers = new Map([
  ['bid-a', '2585'],
  ['bid-b', '2601'],
  ['bid-c', '2647'],
])

const row = (name: string, sort_order: number, source_project_id: string | null): Row =>
  ({ name, sort_order, source_project_id })

describe('sortOvertimeProjects', () => {
  it('입찰 연계 행은 공사번호 순으로 선다 — 저장된 sort_order와 무관하게', () => {
    const rows = [
      row('다', 10, 'bid-c'),
      row('가', 30, 'bid-a'),
      row('나', 20, 'bid-b'),
    ]
    expect(sortOvertimeProjects(rows, numbers).map(r => r.name)).toEqual(['가', '나', '다'])
  })

  it('공사번호 없는 수동 등록 행은 뒤로 가고, 그들끼리는 sort_order 순을 지킨다', () => {
    const rows = [
      row('수동2', 20, null),
      row('연계', 999, 'bid-b'),
      row('수동1', 10, null),
    ]
    expect(sortOvertimeProjects(rows, numbers).map(r => r.name)).toEqual(['연계', '수동1', '수동2'])
  })

  it('연계 행이지만 프로젝트 List에서 사라진 경우도 수동 행처럼 뒤로 보낸다', () => {
    const rows = [
      row('사라진 연계', 5, 'bid-없음'),
      row('연계', 99, 'bid-a'),
    ]
    expect(sortOvertimeProjects(rows, numbers).map(r => r.name)).toEqual(['연계', '사라진 연계'])
  })

  it('원본 배열을 건드리지 않는다', () => {
    const rows = [row('나', 1, 'bid-c'), row('가', 2, 'bid-a')]
    sortOvertimeProjects(rows, numbers)
    expect(rows.map(r => r.name)).toEqual(['나', '가'])
  })
})
