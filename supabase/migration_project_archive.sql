-- 프로젝트 List 과거 연도 보관 — "○○년 참여프로젝트 관리" 엑셀(2021~2025)을 옮겨 담는 표 2개
--
-- ⚠ 개발용 Supabase에서 먼저 검증한다. 운영 적용은 별도 승인.
--
-- 왜 projects에 합치지 않고 따로 두나:
--   projects는 출근부·숙소·연장근무 동기화·면접 DB·대시보드·구글 캘린더·출장·미래봇이 함께 읽는다.
--   과거 약 400건이 섞이면 그 화면들의 선택 목록에 2021년 공고가 뜨고, 결과가 빈 과거 건이
--   대시보드에서 '진행중'으로 잡히며, 캘린더 동기화 대상이 된다. 보관 표는 프로젝트 List만 읽는다.
--
-- 표 2개:
--   project_archive        — 1시트(프로젝트 관리 대장) 한 줄 = 1행. 열 이름은 projects와 같게 맞춰
--                             화면·엑셀 출력(lib/projects/export/ledgerRows.ts LedgerProject)이 그대로 쓴다.
--   project_archive_staff  — 2시트(참여기술자) 셀 안의 줄 하나 = 1행. 원본 셀은 "기술인 1명 = 1칸"에
--                             참여 프로젝트를 줄바꿈으로 이어 적었다. 2021~2024년은 1시트에 분야 인력 칸이
--                             없어서 이 시트가 유일한 기록이다 → 원문(project_text)을 그대로 보존하고,
--                             1시트 프로젝트와 맞춰지면 archive_project_id로 잇는다(못 맞추면 null — 원문은 남는다).
--
-- 같은 공고가 두 해 대장에 다 있을 수 있다(12월 제출 → 1월 평가). 엑셀처럼 해마다 1행씩 둔다
-- → 유니크는 (ledger_year, project_number).
--
-- 데이터는 이 파일이 넣지 않는다 — scripts/import_project_archive.py가 넣는다(재실행 시 연도 단위 교체).
-- 되돌리기: drop table public.project_archive_staff; drop table public.project_archive;

begin;

create table if not exists public.project_archive (
  id uuid primary key default gen_random_uuid(),
  ledger_year integer not null check (ledger_year between 2000 and 2100),
  seq integer,                                   -- 원본 '연번'
  project_number text not null default '',
  type text not null default '',                 -- 원본 '발주방식' ('T P'는 'TP'로 맞춤, '민간' 등은 원문 유지)
  order_basis text not null default '',          -- 원본 '발주기준'(국토부·지자체) — 2021~2023년 서식에만 있다
  client text not null default '',
  name text not null,
  fee numeric,                                   -- 억 단위 숫자. 2021~2023년 원본은 '70.4억' 글자 → 숫자로 바꿈
  fee_raw text not null default '',              -- 숫자로 못 바꾼 원문(비어 있으면 fee가 원문과 같다)
  tp_score text not null default '',
  duration_days text not null default '',        -- 원본 '배점'(projects와 같은 이름 — reimport_projects.py 참고)
  submit_date date,
  interview_date date,
  interview_written boolean not null default false,
  interview_raw text not null default '',        -- 평가일이 날짜가 아닐 때 원문('추후'·'미정'·'1/14~2/6' 등)
  result_score text not null default '',
  evaluation text not null default '',
  participants text not null default '',
  note text not null default '',
  director text not null default '',
  staff_arch text not null default '',
  staff_civil text not null default '',
  staff_mech text not null default '',
  staff_safety text not null default '',
  status_override text check (status_override in ('진행중', '수주', '탈락', '취소')),
  source_file text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ledger_year, project_number)
);

create index if not exists idx_project_archive_year on public.project_archive (ledger_year);

create table if not exists public.project_archive_staff (
  id uuid primary key default gen_random_uuid(),
  ledger_year integer not null check (ledger_year between 2000 and 2100),
  section text not null check (section in ('director', 'specialist')), -- 2시트 왼쪽(책임기술인) / 오른쪽(분야별)
  person_seq integer not null,                   -- 시트에 적힌 순서(원본 '번호'는 2023년에 중복이 있어 쓰지 않는다)
  name text not null,
  field text not null default '',                -- 원본 '직책'/'분야' (단장·건축·토목·기계·안전)
  line_no integer not null,                      -- 셀 안에서 몇 번째 줄인지(1부터)
  project_text text not null,                    -- 줄 원문 그대로 (예: 'LH천안신부', '충북도청 후생복지관 - 수주')
  archive_project_id uuid references public.project_archive(id) on delete set null,
  match_method text check (match_method in ('auto', 'manual')), -- null = 못 맞춤
  created_at timestamptz not null default now(),
  unique (ledger_year, section, person_seq, line_no)
);

create index if not exists idx_project_archive_staff_year on public.project_archive_staff (ledger_year);
create index if not exists idx_project_archive_staff_project on public.project_archive_staff (archive_project_id);

-- RLS — 프로젝트 List 메뉴 권한을 그대로 따른다(읽기 = read 이상, 쓰기 = write).
alter table public.project_archive enable row level security;
alter table public.project_archive_staff enable row level security;

drop policy if exists "menu_select" on public.project_archive;
drop policy if exists "menu_insert" on public.project_archive;
drop policy if exists "menu_update" on public.project_archive;
drop policy if exists "menu_delete" on public.project_archive;
create policy "menu_select" on public.project_archive for select to authenticated using (private.menu_permission('projects') <> 'none');
create policy "menu_insert" on public.project_archive for insert to authenticated with check (private.menu_permission('projects') = 'write');
create policy "menu_update" on public.project_archive for update to authenticated using (private.menu_permission('projects') = 'write') with check (private.menu_permission('projects') = 'write');
create policy "menu_delete" on public.project_archive for delete to authenticated using (private.menu_permission('projects') = 'write');

drop policy if exists "menu_select" on public.project_archive_staff;
drop policy if exists "menu_insert" on public.project_archive_staff;
drop policy if exists "menu_update" on public.project_archive_staff;
drop policy if exists "menu_delete" on public.project_archive_staff;
create policy "menu_select" on public.project_archive_staff for select to authenticated using (private.menu_permission('projects') <> 'none');
create policy "menu_insert" on public.project_archive_staff for insert to authenticated with check (private.menu_permission('projects') = 'write');
create policy "menu_update" on public.project_archive_staff for update to authenticated using (private.menu_permission('projects') = 'write') with check (private.menu_permission('projects') = 'write');
create policy "menu_delete" on public.project_archive_staff for delete to authenticated using (private.menu_permission('projects') = 'write');

commit;
