-- 연장근무 관리 (제안서팀) — 2단계 DB 설계
--
-- 핵심 원칙: overtime_work_records는
--   "직원 1명 + 날짜 1개 + 프로젝트 1개 + 업무 1개 = 행 1개" 단위를 절대 어기지 않는다.
-- 총 연장시간·건수 컬럼은 별도로 두지 않는다. 화면(월간 그리드 셀의 "6h (3)")은
-- 항상 이 테이블을 employee_id + work_date로 SUM(hours)/COUNT(*) 해서 구한다.

create table if not exists overtime_employees (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  position text not null default '',       -- 직급
  is_active boolean not null default true, -- 재직여부. 퇴사 시 false로만 바꾸고 행은 삭제하지 않음 (과거 기록 보존)
  sort_order integer not null default 0,   -- 좌측 직원 목록 정렬순서
  created_at timestamptz default now()
);

create table if not exists overtime_projects (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  status text not null default '진행중' check (status in ('진행중', '종료')),
  sort_order integer not null default 0,
  created_at timestamptz default now()
);

-- 핵심 테이블 — 업무 1건 = 행 1개
create table if not exists overtime_work_records (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references overtime_employees(id) on delete restrict,
  project_id uuid not null references overtime_projects(id) on delete restrict,
  work_date date not null,
  task_description text not null default '', -- 업무내용
  start_time text not null,                   -- "HH:mm" (예: "18:00")
  end_time text not null,                      -- "HH:mm". 자정을 넘기면 "24:00" 이상으로 표기 (예: 21:00~24:00)
  hours numeric(4,2) not null,                 -- 저장 시점에 (end_time - start_time)으로 계산해 넣는다. 컬럼으로 남기는 이유는
                                                -- "HH:mm" 텍스트를 매 조회마다 다시 계산하지 않고 SUM()으로 바로 집계하기 위함
  note text not null default '',               -- 비고
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 월간 그리드(직원×날짜 범위 조회)와 대시보드 집계(날짜별/프로젝트별)에서 바로 쓰는 인덱스
create index if not exists idx_overtime_work_records_employee_date
  on overtime_work_records (employee_id, work_date);

create index if not exists idx_overtime_work_records_date
  on overtime_work_records (work_date);

create index if not exists idx_overtime_work_records_project
  on overtime_work_records (project_id);

-- RLS: menu_permissions.overtime(none/read/write)를 DB 단에서 직접 강제한다(lodging 파일럿과
-- 동일 패턴 — private.menu_permission() 정의는 migration_menu_permission_function.sql 참고).
alter table overtime_employees enable row level security;
alter table overtime_projects enable row level security;
alter table overtime_work_records enable row level security;

create policy "menu_select" on overtime_employees for select using (private.menu_permission('overtime') <> 'none');
create policy "menu_insert" on overtime_employees for insert with check (private.menu_permission('overtime') = 'write');
create policy "menu_update" on overtime_employees for update using (private.menu_permission('overtime') = 'write') with check (private.menu_permission('overtime') = 'write');
create policy "menu_delete" on overtime_employees for delete using (private.menu_permission('overtime') = 'write');

create policy "menu_select" on overtime_projects for select using (private.menu_permission('overtime') <> 'none');
create policy "menu_insert" on overtime_projects for insert with check (private.menu_permission('overtime') = 'write');
create policy "menu_update" on overtime_projects for update using (private.menu_permission('overtime') = 'write') with check (private.menu_permission('overtime') = 'write');
create policy "menu_delete" on overtime_projects for delete using (private.menu_permission('overtime') = 'write');

create policy "menu_select" on overtime_work_records for select using (private.menu_permission('overtime') <> 'none');
create policy "menu_insert" on overtime_work_records for insert with check (private.menu_permission('overtime') = 'write');
create policy "menu_update" on overtime_work_records for update using (private.menu_permission('overtime') = 'write') with check (private.menu_permission('overtime') = 'write');
create policy "menu_delete" on overtime_work_records for delete using (private.menu_permission('overtime') = 'write');
