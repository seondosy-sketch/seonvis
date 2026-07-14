import type { SupabaseClient } from '@supabase/supabase-js'
import { Project } from './types'

/**
 * 입찰 현황 "프로젝트 List"(projects) → 연장근무 프로젝트(overtime_projects) 단방향 동기화.
 *
 * 연장근무에서 프로젝트의 기간은 "공고일(announce_date) ~ 발표/면접일(interview_date)"이다.
 * 이 기간이 조회 중인 급여기간 [start, end]와 겹치는 입찰 프로젝트를 overtime_projects에
 * 자동으로 만들어 넣는다(작성자가 일일이 수동 등록하던 것을 대체).
 *
 * 원칙:
 * - 원본은 항상 projects — 연계된 행(source_project_id 있음)의 이름·기간·상태는
 *   페이지를 열 때마다 여기서 덮어쓴다. 공고일/발표일이 나중에 바뀌어도 자동 반영된다.
 * - 추가/갱신만 하고 삭제는 절대 하지 않는다. 수동 프로젝트(source_project_id null)는
 *   건드리지 않고, 기간이 지난 연계 프로젝트는 그리드 행 필터에서 빠질 뿐 데이터는 남는다.
 * - 발표일이 없는 프로젝트는 end_date를 null로 둔다 → 종료일 없이 계속 표기 (사용자 결정).
 * - 입찰 상태가 '진행중'일 때만 연장근무에서도 '진행중'이다. 수주/탈락(개찰 완료)/취소는
 *   전부 '종료' → 그리드는 근무기록이 있을 때만 보여주므로 "포함하되, 기록 없으면 숨김"이
 *   된다 (사용자 결정 + 개찰 끝난 프로젝트가 진행중으로 떠 보이던 문제 수정).
 */
export async function syncBidProjects(supabase: SupabaseClient, start: string, end: string): Promise<void> {
  // 기간 겹침: 공고일 <= 기간끝 AND (발표일 없음 OR 발표일 >= 기간시작)
  const { data: bids } = await supabase
    .from('projects')
    .select('id, name, announce_date, interview_date, status')
    .not('announce_date', 'is', null)
    .lte('announce_date', end)
    .or(`interview_date.is.null,interview_date.gte.${start}`)
  if (!bids || bids.length === 0) return

  const { data: existing } = await supabase.from('overtime_projects').select('*')
  if (!existing) return
  const overtimeProjects = existing as Project[]
  const bySourceId = new Map(
    overtimeProjects.filter(p => p.source_project_id).map(p => [p.source_project_id as string, p])
  )
  // 아직 연계되지 않은 수동 행을 이름으로 찾기 위한 맵 — 사용자가 같은 프로젝트를 먼저
  // 수동 등록해둔 경우, 새 행을 만들어 중복시키는 대신 그 행을 연계 행으로 전환한다.
  const manualByName = new Map(
    overtimeProjects.filter(p => !p.source_project_id).map(p => [p.name, p])
  )
  let maxSort = overtimeProjects.reduce((m, p) => Math.max(m, p.sort_order), 0)

  const inserts: Array<Omit<Project, 'id'>> = []
  for (const bid of bids) {
    const desired = {
      name: bid.name as string,
      start_date: bid.announce_date as string,
      end_date: (bid.interview_date ?? null) as string | null,
      status: (bid.status === '진행중' ? '진행중' : '종료') as Project['status'],
    }
    const cur = bySourceId.get(bid.id)
    if (!cur) {
      const manual = manualByName.get(desired.name)
      if (manual) {
        await supabase.from('overtime_projects').update({ ...desired, source_project_id: bid.id }).eq('id', manual.id)
        manualByName.delete(desired.name)
        continue
      }
      maxSort += 10
      inserts.push({ ...desired, source_project_id: bid.id, sort_order: maxSort })
    } else if (
      cur.name !== desired.name ||
      cur.start_date !== desired.start_date ||
      cur.end_date !== desired.end_date ||
      cur.status !== desired.status
    ) {
      await supabase.from('overtime_projects').update(desired).eq('id', cur.id)
    }
  }
  if (inserts.length > 0) await supabase.from('overtime_projects').insert(inserts)
}
