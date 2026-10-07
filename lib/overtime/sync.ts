import { Project } from './types'
import { BidProjectSource, EligibilityKind, evaluateProjectEligibility, isStrictIsoDate } from './eligibility'

/**
 * 입찰 현황 "프로젝트 List"(projects) → 연장근무 프로젝트(overtime_projects) 단방향 동기화.
 *
 * 대상 여부와 기간은 lib/overtime/eligibility.ts가 정한다(서면평가는 제출일까지, 면접일 미정은
 * 개찰일까지 등 — 규칙은 그 파일 참고). 이 파일은 그 판정을 overtime_projects 행에 옮겨 적기만 한다.
 *
 * 원칙:
 * - 원본은 항상 projects — 연계된 행(source_project_id 있음)의 이름·기간·상태는 동기화 때마다
 *   덮어쓴다. 조회 중인 급여기간과 상관없이 **연계된 행 전부**를 최신 원본에 맞춘다
 *   (예전에는 기간이 겹치는 사업만 갱신해서, 지난 사업은 탈락·수주 뒤에도 '진행중'으로 남았다).
 * - 새 행은 신규 자동배정 대상(eligible)이면서 대상기간이 조회 기간과 겹치는 사업만 만든다.
 * - 추가/갱신만 하고 삭제는 절대 하지 않는다. 대상에서 빠진 사업은 status만 '종료'가 되고
 *   담당직원(overtime_project_members)·근무기록(overtime_work_records)은 그대로 남는다.
 *   다시 대상이 되면 같은 행이 '진행중'으로 돌아온다(source_project_id로 찾으므로 새로 만들지 않음).
 * - overtime_projects.status는 '진행중'/'종료'만 허용(CHECK)하므로 '확인 필요'·'차단'은 DB에
 *   적지 않는다 — 그런 사업은 '종료'로 두고, 판정 결과를 반환값(attention)으로 돌려준다.
 * - 수동 프로젝트(source_project_id null)는 건드리지 않는다. 단, 새로 만들 사업과 이름이 같은
 *   수동 행이 있으면 새 행 대신 그 행을 연계 행으로 전환한다(기존 동작 유지).
 */

type SyncedFields = Pick<Project, 'name' | 'start_date' | 'end_date' | 'status'>

export interface BidSyncPlan {
  inserts: Array<Omit<Project, 'id'>>
  updates: Array<{ id: string; patch: Partial<Omit<Project, 'id'>> }>
  /** 진행중이지만 확인 필요·차단으로 신규 배정에서 빠진 사업 — 호출부가 안내에 쓴다 */
  attention: Array<{ sourceProjectId: string; overtimeProjectId: string | null; kind: EligibilityKind; reason: string | null }>
}

/**
 * 동기화 계획을 세운다(순수 함수 — DB를 읽거나 쓰지 않는다). 반환하는 작업은 insert/update뿐이고
 * 삭제는 만들 수 없다. 계획대로 반영한 뒤 같은 입력으로 다시 부르면 빈 계획이 나온다(멱등).
 */
export function planBidProjectSync(
  sources: readonly BidProjectSource[],
  overtimeProjects: readonly Project[],
  period: { start: string; end: string },
  asOf: string,
): BidSyncPlan {
  const plan: BidSyncPlan = { inserts: [], updates: [], attention: [] }
  const bySourceId = new Map(
    overtimeProjects.filter(p => p.source_project_id).map(p => [p.source_project_id as string, p])
  )
  // 아직 연계되지 않은 수동 행을 이름으로 찾기 위한 맵 — 사용자가 같은 프로젝트를 먼저
  // 수동 등록해둔 경우, 새 행을 만들어 중복시키는 대신 그 행을 연계 행으로 전환한다.
  const manualByName = new Map(
    overtimeProjects.filter(p => !p.source_project_id).map(p => [p.name, p])
  )
  let maxSort = overtimeProjects.reduce((m, p) => Math.max(m, p.sort_order), 0)

  for (const source of sources) {
    const e = evaluateProjectEligibility(source, asOf)
    const desired: SyncedFields = {
      name: source.name,
      // 시작일은 공고일 그대로 — 종료일을 정할 수 없어 대상에서 빠져도 사실인 공고일은 지우지 않는다
      start_date: isStrictIsoDate(source.announce_date) ? source.announce_date : null,
      end_date: e.end,
      status: e.kind === 'eligible' ? '진행중' : '종료',
    }
    const cur = bySourceId.get(source.id)

    if (source.status === '진행중' && (e.kind === 'needs_review' || e.kind === 'blocked')) {
      plan.attention.push({ sourceProjectId: source.id, overtimeProjectId: cur?.id ?? null, kind: e.kind, reason: e.reason })
    }

    if (cur) {
      const patch = diff(cur, desired)
      if (patch) plan.updates.push({ id: cur.id, patch })
      continue
    }

    // 새 행: 신규 배정 대상이고 대상기간이 조회 기간과 겹칠 때만 (경계 당일 포함)
    const overlaps = e.start !== null && e.end !== null && e.start <= period.end && e.end >= period.start
    if (e.kind !== 'eligible' || !overlaps) continue

    const manual = manualByName.get(source.name)
    if (manual) {
      plan.updates.push({ id: manual.id, patch: { ...desired, source_project_id: source.id } })
      manualByName.delete(source.name)
      continue
    }
    maxSort += 10
    plan.inserts.push({ ...desired, source_project_id: source.id, sort_order: maxSort })
  }
  return plan
}

/** 바뀐 필드만 담은 patch. 바뀐 게 없으면 null — 같은 값으로 UPDATE를 반복하지 않기 위해. */
function diff(cur: Project, desired: SyncedFields): Partial<SyncedFields> | null {
  const patch: Partial<SyncedFields> = {}
  if (cur.name !== desired.name) patch.name = desired.name
  if ((cur.start_date ?? null) !== desired.start_date) patch.start_date = desired.start_date
  if ((cur.end_date ?? null) !== desired.end_date) patch.end_date = desired.end_date
  if (cur.status !== desired.status) patch.status = desired.status
  return Object.keys(patch).length > 0 ? patch : null
}

export type SyncAttention = BidSyncPlan['attention']

/**
 * 동기화 요청(브라우저용). 실제 계획·반영은 서버(app/api/overtime/sync-projects)가 service role RPC로
 * 한 트랜잭션에 한다 — 읽기 권한 사용자가 열어도 갱신되고, 동시에 열어도 충돌하지 않는다.
 * 실패해도(네트워크·권한·migration 미적용) 화면은 기존 목록으로 계속 뜨도록 빈 결과를 돌려준다.
 * `start`/`end`는 조회 중인 급여기간 — 새 행을 만들 범위로만 쓰인다.
 */
export async function requestProjectSync(start: string, end: string): Promise<{ ok: boolean; attention: SyncAttention }> {
  try {
    const res = await fetch('/api/overtime/sync-projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start, end }),
    })
    if (!res.ok) return { ok: false, attention: [] }
    const body = (await res.json()) as { ok: boolean; attention?: SyncAttention }
    return { ok: body.ok, attention: body.attention ?? [] }
  } catch {
    return { ok: false, attention: [] }
  }
}
