-- 개발 DB 전용 — 운영에는 있지만 개발 DB에 없는 공용 표 8개를 저장소 정의와 "보정 전" 정책 그대로 만든다.
-- 목적: migration_shared_project_tables_rls.sql을 운영과 같은 시작 상태에서 검증하기 위해서다.
--   구조: supabase/schema.sql(주간보고 3개), migration_evaluation_db.sql(면접 기준표 3개), 화면 코드에서 쓰는 열(노트·툴팁)
--   정책: migration_shared_master_data_write_permission.sql·migration_evaluation_db.sql의 정의(읽기 = 로그인 전체, 쓰기 = 메뉴 write)
-- 안전장치: 시험용이 아닌 연장근무 직원이 있거나 승인 사용자가 3명을 넘거나(운영 흔적) 8개 중 하나라도 이미 있으면 아무것도 하지 않는다.
--   (운영에는 8개 표가 모두 있으므로 여기서 멈춘다.) 데이터 행은 넣지 않는다 — 시험 행은 shared_project_tables_rls_check.sql이 넣고 지운다.
-- 지우기(개발 DB에서 필요할 때만): drop table public.<표> — 8개, 이 파일이 만든 표만

begin;

do $$
begin
  if exists (select 1 from public.overtime_employees e
             where e.id::text not like 'e1000000-0000-4000-8000-00000000000_' and e.id::text not like 'f1000000-0000-4000-8000-00000000000_') then
    raise exception '중단: 시험용이 아닌 연장근무 직원이 있습니다 — 개발용 DB가 아닌 것 같습니다';
  end if;
  if (select count(*) from public.allowed_users where email not like 'rls-%@example.invalid') > 3 then
    raise exception '중단: 승인 사용자가 3명을 넘습니다 — 개발용 DB가 아닌 것 같습니다';
  end if;
  if to_regclass('public.project_notes') is not null or to_regclass('public.project_tooltips') is not null
     or to_regclass('public.performing_projects') is not null or to_regclass('public.expected_projects') is not null
     or to_regclass('public.weekly_meta') is not null or to_regclass('public.evaluation_types') is not null
     or to_regclass('public.evaluation_roles') is not null or to_regclass('public.evaluation_question_categories') is not null then
    raise exception '중단: 공용 표 중 이미 있는 표가 있다 — 이 파일은 표가 하나도 없을 때만 실행한다';
  end if;
  if not exists (select 1 from pg_catalog.pg_policy where polrelid = 'public.projects'::regclass and polname = 'authenticated users can read projects') then
    raise exception '중단: projects의 기존 읽기 정책이 개발 기준과 다르다';
  end if;
end $$;

create table public.project_notes (
  id uuid primary key default gen_random_uuid(),
  project_number text not null,
  field text not null,
  note text not null default '',
  updated_at timestamptz default now(),
  unique (project_number, field)
);
alter table public.project_notes enable row level security;
create policy "select_authenticated" on public.project_notes for select using (auth.role() = 'authenticated');
create policy "write_insert" on public.project_notes for insert with check (private.menu_permission('projects') = 'write');
create policy "write_update" on public.project_notes for update using (private.menu_permission('projects') = 'write') with check (private.menu_permission('projects') = 'write');
create policy "write_delete" on public.project_notes for delete using (private.menu_permission('projects') = 'write');

create table public.project_tooltips (
  id uuid primary key default gen_random_uuid(),
  project_number text not null unique,
  location text, interview_location text,
  proposal_p text, self_intro_p text, ppt_p text, score_dist text, interview_time text,
  pq_date date, soq_date date, notify_date date,
  updated_at timestamptz default now()
);
alter table public.project_tooltips enable row level security;
create policy "select_authenticated" on public.project_tooltips for select using (auth.role() = 'authenticated');
create policy "write_insert" on public.project_tooltips for insert with check (private.menu_permission('projects') = 'write' or private.menu_permission('trip') = 'write');
create policy "write_update" on public.project_tooltips for update using (private.menu_permission('projects') = 'write' or private.menu_permission('trip') = 'write') with check (private.menu_permission('projects') = 'write' or private.menu_permission('trip') = 'write');
create policy "write_delete" on public.project_tooltips for delete using (private.menu_permission('projects') = 'write');

create table public.performing_projects (
  id uuid primary key default gen_random_uuid(),
  week text not null default to_char(now(), 'IYYY-"W"IW'),
  status text not null check (status in ('개찰', '진행중')),
  name text not null default '',
  director text not null default '',
  submit_date date, interview_date date, result_date date,
  fee numeric(10,2),
  note text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.performing_projects enable row level security;
create policy "select_authenticated" on public.performing_projects for select using (auth.role() = 'authenticated');
create policy "write_insert" on public.performing_projects for insert with check (private.menu_permission('weekly') = 'write');
create policy "write_update" on public.performing_projects for update using (private.menu_permission('weekly') = 'write') with check (private.menu_permission('weekly') = 'write');
create policy "write_delete" on public.performing_projects for delete using (private.menu_permission('weekly') = 'write');

create table public.expected_projects (
  id uuid primary key default gen_random_uuid(),
  week text not null default to_char(now(), 'IYYY-"W"IW'),
  name text not null default '', client text not null default '', director text not null default '',
  project_cost numeric(10,2), order_month text not null default '', fee numeric(10,2),
  note text not null default '', sort_order integer not null default 0,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
alter table public.expected_projects enable row level security;
create policy "select_authenticated" on public.expected_projects for select using (auth.role() = 'authenticated');
create policy "write_insert" on public.expected_projects for insert with check (private.menu_permission('weekly') = 'write');
create policy "write_update" on public.expected_projects for update using (private.menu_permission('weekly') = 'write') with check (private.menu_permission('weekly') = 'write');
create policy "write_delete" on public.expected_projects for delete using (private.menu_permission('weekly') = 'write');

create table public.weekly_meta (
  id uuid primary key default gen_random_uuid(),
  week text not null unique,
  education_note text not null default '', other_note text not null default '',
  created_at timestamptz default now(), updated_at timestamptz default now()
);
alter table public.weekly_meta enable row level security;
create policy "select_authenticated" on public.weekly_meta for select using (auth.role() = 'authenticated');
create policy "write_insert" on public.weekly_meta for insert with check (private.menu_permission('weekly') = 'write');
create policy "write_update" on public.weekly_meta for update using (private.menu_permission('weekly') = 'write') with check (private.menu_permission('weekly') = 'write');
create policy "write_delete" on public.weekly_meta for delete using (private.menu_permission('weekly') = 'write');

create table public.evaluation_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique, name text not null unique,
  sort_order integer not null default 0, is_active boolean not null default true,
  created_at timestamptz default now()
);
alter table public.evaluation_types enable row level security;
create policy "eval_types_select" on public.evaluation_types for select using (auth.role() = 'authenticated');
create policy "eval_types_insert" on public.evaluation_types for insert with check (private.menu_permission('interview_db') = 'write');
create policy "eval_types_update" on public.evaluation_types for update using (private.menu_permission('interview_db') = 'write') with check (private.menu_permission('interview_db') = 'write');
create policy "eval_types_delete" on public.evaluation_types for delete using (private.menu_permission('interview_db') = 'write');

create table public.evaluation_roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique, sort_order integer not null default 0,
  is_primary boolean not null default false, is_active boolean not null default true,
  created_at timestamptz default now()
);
alter table public.evaluation_roles enable row level security;
create policy "eval_roles_select" on public.evaluation_roles for select using (auth.role() = 'authenticated');
create policy "eval_roles_insert" on public.evaluation_roles for insert with check (private.menu_permission('interview_db') = 'write');
create policy "eval_roles_update" on public.evaluation_roles for update using (private.menu_permission('interview_db') = 'write') with check (private.menu_permission('interview_db') = 'write');
create policy "eval_roles_delete" on public.evaluation_roles for delete using (private.menu_permission('interview_db') = 'write');

create table public.evaluation_question_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique, name text not null unique,
  sort_order integer not null default 0, is_active boolean not null default true,
  created_at timestamptz default now()
);
alter table public.evaluation_question_categories enable row level security;
create policy "eval_categories_select" on public.evaluation_question_categories for select using (auth.role() = 'authenticated');
create policy "eval_categories_insert" on public.evaluation_question_categories for insert with check (private.menu_permission('interview_db') = 'write');
create policy "eval_categories_update" on public.evaluation_question_categories for update using (private.menu_permission('interview_db') = 'write') with check (private.menu_permission('interview_db') = 'write');
create policy "eval_categories_delete" on public.evaluation_question_categories for delete using (private.menu_permission('interview_db') = 'write');

commit;

select c.relname::text as table_name, count(p.*) as policies
from pg_catalog.pg_class c left join pg_catalog.pg_policy p on p.polrelid = c.oid
where c.relnamespace = 'public'::regnamespace and c.relname in ('projects', 'project_notes', 'project_tooltips', 'performing_projects', 'expected_projects', 'weekly_meta', 'evaluation_types', 'evaluation_roles', 'evaluation_question_categories')
group by 1 order by 1;
