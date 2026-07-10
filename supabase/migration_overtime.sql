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

-- RLS: 로그인 여부·허용 사용자 여부는 app/(dashboard)/layout.tsx에서 이미 확인하므로,
-- 테이블 단에서는 다른 테이블들과 동일하게 "인증된 사용자는 전체 접근 가능" 정도만 방어적으로 건다.
alter table overtime_employees enable row level security;
alter table overtime_projects enable row level security;
alter table overtime_work_records enable row level security;

create policy "authenticated_full_access" on overtime_employees
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "authenticated_full_access" on overtime_projects
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "authenticated_full_access" on overtime_work_records
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
