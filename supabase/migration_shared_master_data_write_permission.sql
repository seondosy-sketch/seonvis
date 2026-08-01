-- projects/project_notes/project_tooltips(키: projects)와 performing_projects/expected_projects/
-- weekly_meta(키: weekly) — 이 테이블들의 원래 create table/최초 RLS는 이 마이그레이션 문서
-- 관례가 생기기 전에 만들어져 별도 파일로 존재하지 않는다(schema.sql에 테이블 정의만 일부 있음).
-- 이 파일은 그 이후 적용한 RLS 변경만 기록한다.
--
-- lodging/attendance/leave/overtime/sites/engineers와 달리 이 테이블들은 홈 대시보드
-- (app/(dashboard)/page.tsx), 출장지원(trip), 숙박관리(lodging), 기술인 출근부(attendance) 등
-- 다른 화면이 그 화면 자신의 menu_permission과 무관하게 직접 참조하는 공유 마스터 데이터다
-- (사용자 확인 — projects/weekly 권한이 none/read인 사용자도 다른 화면의 미리보기 기능은 계속
-- 동작해야 함). 그래서 select는 기존 그대로(인증된 사용자 전체 허용) 두고, insert/update/delete만
-- 해당 메뉴의 write 권한으로 제한한다 — lodging 등과 달리 select까지 제한하지 않는다.
--
-- private.menu_permission() 정의는 migration_menu_permission_function.sql 참고.

-- projects: 기존 select 정책("authenticated users can read projects", qual=true)은 그대로 둔다.
drop policy if exists "authenticated users can insert projects" on projects;
drop policy if exists "authenticated users can update projects" on projects;
drop policy if exists "authenticated users can delete projects" on projects;
create policy "projects_write_insert" on projects
  for insert with check (private.menu_permission('projects') = 'write');
create policy "projects_write_update" on projects
  for update using (private.menu_permission('projects') = 'write') with check (private.menu_permission('projects') = 'write');
create policy "projects_write_delete" on projects
  for delete using (private.menu_permission('projects') = 'write');

-- project_notes, project_tooltips: 키 'projects'.
drop policy if exists "authenticated users can manage notes" on project_notes;
create policy "select_authenticated" on project_notes for select using (auth.role() = 'authenticated');
create policy "write_insert" on project_notes for insert with check (private.menu_permission('projects') = 'write');
create policy "write_update" on project_notes for update using (private.menu_permission('projects') = 'write') with check (private.menu_permission('projects') = 'write');
create policy "write_delete" on project_notes for delete using (private.menu_permission('projects') = 'write');

-- project_tooltips는 project_notes와 달리 projects(projects/page.tsx)뿐 아니라 trip(출장지원,
-- trip/page.tsx의 interview_location/location upsert)도 직접 쓴다 — insert/update는 두 권한 중
-- 하나라도 write면 허용한다(trip:write만 있고 projects:write는 없는 사용자도 출장지원 화면에서
-- 저장할 수 있어야 함, migration_trip_web_proposal_db_investigation.sql 참고). delete는 프로젝트
-- 삭제에 연쇄되는 동작이라 projects:write만 유지 — trip 화면은 삭제하지 않는다.
drop policy if exists "allow all for authenticated" on project_tooltips;
create policy "select_authenticated" on project_tooltips for select using (auth.role() = 'authenticated');
create policy "write_insert" on project_tooltips for insert
  with check (private.menu_permission('projects') = 'write' or private.menu_permission('trip') = 'write');
create policy "write_update" on project_tooltips for update
  using (private.menu_permission('projects') = 'write' or private.menu_permission('trip') = 'write')
  with check (private.menu_permission('projects') = 'write' or private.menu_permission('trip') = 'write');
create policy "write_delete" on project_tooltips for delete using (private.menu_permission('projects') = 'write');

-- performing_projects, expected_projects, weekly_meta (주간/월간보고, schema.sql): 키 'weekly'.
drop policy if exists "allow all for authenticated" on performing_projects;
create policy "select_authenticated" on performing_projects for select using (auth.role() = 'authenticated');
create policy "write_insert" on performing_projects for insert with check (private.menu_permission('weekly') = 'write');
create policy "write_update" on performing_projects for update using (private.menu_permission('weekly') = 'write') with check (private.menu_permission('weekly') = 'write');
create policy "write_delete" on performing_projects for delete using (private.menu_permission('weekly') = 'write');

drop policy if exists "allow all for authenticated" on expected_projects;
create policy "select_authenticated" on expected_projects for select using (auth.role() = 'authenticated');
create policy "write_insert" on expected_projects for insert with check (private.menu_permission('weekly') = 'write');
create policy "write_update" on expected_projects for update using (private.menu_permission('weekly') = 'write') with check (private.menu_permission('weekly') = 'write');
create policy "write_delete" on expected_projects for delete using (private.menu_permission('weekly') = 'write');

drop policy if exists "allow all for authenticated" on weekly_meta;
create policy "select_authenticated" on weekly_meta for select using (auth.role() = 'authenticated');
create policy "write_insert" on weekly_meta for insert with check (private.menu_permission('weekly') = 'write');
create policy "write_update" on weekly_meta for update using (private.menu_permission('weekly') = 'write') with check (private.menu_permission('weekly') = 'write');
create policy "write_delete" on weekly_meta for delete using (private.menu_permission('weekly') = 'write');

-- team_events(홈 화면 팀 일정)와 access_requests(가입 승인 전 요청 플로우)는 menu_permissions에
-- 대응하는 항목이 없어 이번 확장 대상에서 제외했다(의도적으로 인증된 사용자 전체 공개 유지).
