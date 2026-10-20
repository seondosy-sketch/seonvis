import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * 기술인 주소록(소속 '미래사업팀') → overtime_employees 단방향 동기화.
 * 실제 로직은 DB 함수 sync_team_employees()(supabase/migration_team_roster_sync.sql)에 있다 —
 * security definer라 사용자에게 기술인 주소록 권한이 없어도 동기화된다.
 * 직원 목록을 읽기 직전에 호출한다(syncBidProjects와 같은 "열 때마다 맞추기" 방식).
 * 실패해도(마이그레이션 미적용 등) 기존 명단으로 화면은 그대로 뜨게 예외를 던지지 않는다.
 * 다만 연결 확인이 필요한 중단(OVERTIME_EMPLOYEE_LINK_REQUIRED — 미연결 주소록과 미연결 재직 직원이 함께 있음)은
 * 화면이 안내할 수 있게 결과로 돌려준다. DB 오류 원문은 돌려주지 않는다.
 */
export type TeamSyncResult = { ok: true } | { ok: false; linkRequired: boolean }

export async function syncTeamEmployees(supabase: SupabaseClient): Promise<TeamSyncResult> {
  const { error } = await supabase.rpc('sync_team_employees')
  if (!error) return { ok: true }
  console.warn('[sync_team_employees]', error.message)
  return { ok: false, linkRequired: (error.message ?? '').includes('OVERTIME_EMPLOYEE_LINK_REQUIRED') }
}
