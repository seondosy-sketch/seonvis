import type { SupabaseClient } from '@supabase/supabase-js'
import { compareProjectNumber } from '@/lib/projectOrder'
import type { Project } from './types'

/**
 * 연장근무 프로젝트 목록을 프로젝트 List가 정한 공사번호 순으로 세운다.
 *
 * `overtime_projects`에는 공사번호 열이 없다. 입찰 연계 행은 `source_project_id`로
 * `projects.project_number`를 찾아 그 순서를 따르고, 입찰 List에 없는 수동 등록 행
 * (내부 업무 등)은 공사번호가 없으므로 뒤쪽에 모아 사용자가 지정한 `sort_order`
 * 순서를 그대로 유지한다 — 연장근무는 프로젝트 관리 모달에서 정렬순서를 직접
 * 입력하는 화면이라, 그 입력이 의미를 갖는 유일한 자리를 남겨두는 것이다.
 */
export function sortOvertimeProjects<T extends Pick<Project, 'name' | 'sort_order' | 'source_project_id'>>(
  rows: readonly T[],
  numberBySourceId: ReadonlyMap<string, string>
): T[] {
  const numberOf = (r: T) => (r.source_project_id ? numberBySourceId.get(r.source_project_id) ?? '' : '')
  return [...rows].sort((a, b) => {
    // compareProjectNumber가 번호 없는 행(수동 등록)을 알아서 뒤로 보낸다.
    const byNumber = compareProjectNumber(numberOf(a), numberOf(b))
    if (byNumber !== 0) return byNumber
    return a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'ko')
  })
}

/**
 * `overtime_projects.source_project_id` → `projects.project_number` 맵.
 * PostgREST 임베드 대신 작은 조회를 따로 하는 쪽을 택했다 — projects는 수십 행 규모라
 * 비용이 사실상 없고, 관계 임베드 문법이 깨졌을 때 목록 전체가 빈 화면이 되는 위험이 없다.
 */
export async function loadProjectNumbers(supabase: SupabaseClient): Promise<Map<string, string>> {
  const { data } = await supabase.from('projects').select('id,project_number')
  return new Map(((data ?? []) as { id: string; project_number: string }[]).map(p => [p.id, p.project_number]))
}
