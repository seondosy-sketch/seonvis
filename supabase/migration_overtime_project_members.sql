-- 연장근무 관리 — 프로젝트별 담당직원
--
-- 프로젝트 관리 화면에서 각 프로젝트를 담당하는 직원들을 체크로 지정한다.
-- 향후 "프로젝트별 인원을 나열하여 근무일을 표기"하는 화면의 기초자료가 된다.
-- overtime_work_records(실제 근무 이력)와 달리 "배정" 정보일 뿐이므로,
-- 프로젝트/직원 행이 지워지면 같이 정리되어도 무방하다 (ON DELETE CASCADE).

create table if not exists overtime_project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references overtime_projects(id) on delete cascade,
  employee_id uuid not null references overtime_employees(id) on delete cascade,
  created_at timestamptz default now(),
  unique (project_id, employee_id) -- 같은 프로젝트에 같은 직원 중복 배정 방지
);

create index if not exists idx_overtime_project_members_project
  on overtime_project_members (project_id);

alter table overtime_project_members enable row level security;

-- menu_permissions.overtime(none/read/write) — migration_overtime.sql, migration_menu_permission_function.sql 참고.
create policy "menu_select" on overtime_project_members for select using (private.menu_permission('overtime') <> 'none');
create policy "menu_insert" on overtime_project_members for insert with check (private.menu_permission('overtime') = 'write');
create policy "menu_update" on overtime_project_members for update using (private.menu_permission('overtime') = 'write') with check (private.menu_permission('overtime') = 'write');
create policy "menu_delete" on overtime_project_members for delete using (private.menu_permission('overtime') = 'write');
