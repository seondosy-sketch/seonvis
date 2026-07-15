-- 기술인 주소록 — DB 설계 (docs/engineer-address-book/03-data-model.md)
-- 외부 기술인력 풀(667명 규모)이라 팀 내부용 overtime_employees와 별도 테이블.
-- 향후 엑셀 동기화를 위해 engineer_no(고유번호)와 sync 이력 테이블을 미리 둔다.

create table if not exists engineer_contacts (
  id uuid primary key default gen_random_uuid(),
  -- 사람 친화적 고유번호 — 추후 Excel 내보내기/재가져오기의 1순위 동일인 매칭 키
  engineer_no integer generated always as identity unique,
  -- 내부 직원 연결 (MVP 미사용, 확장 예약). 직원이 삭제돼도 주소록은 남는다
  employee_id uuid references overtime_employees(id) on delete set null,
  name text not null,
  rank text not null default '',      -- 직위 (상무·이사 등)
  position text not null default '',  -- 직책 (팀장·본부장 등, 선택)
  company text not null default '',   -- 소속 회사/부서
  mobile_phone text not null default '',  -- 하이픈 포함 표시 형식 그대로 저장
  office_phone text not null default '',
  email text not null default '',
  region text not null default '',    -- 시·도 — 주소에서 자동 추출, 수정 가능 (필터용)
  address text not null default '',   -- 단일 텍스트 (안 1). 우편번호/상세 분리는 확장
  employment_status text not null default '재직' check (employment_status in ('재직', '퇴직', '비활성')),
  joined_date date,
  retired_date date,
  memo text not null default '',
  is_favorite boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_engineer_contacts_name on engineer_contacts (name);
create index if not exists idx_engineer_contacts_phone on engineer_contacts (mobile_phone);
create index if not exists idx_engineer_contacts_region on engineer_contacts (region);
create index if not exists idx_engineer_contacts_status on engineer_contacts (employment_status);

-- 전문분야 마스터 (다중 지정 — 문자열 하나로 저장하지 않는다: 필터·집계·이름변경 때문)
create table if not exists engineer_specialties (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz default now()
);

create table if not exists engineer_contact_specialties (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references engineer_contacts(id) on delete cascade,
  specialty_id uuid not null references engineer_specialties(id) on delete restrict,
  unique (contact_id, specialty_id)
);

-- 향후 엑셀 동기화 실행 이력 (MVP 미사용 — 구조 예약)
create table if not exists engineer_sync_logs (
  id uuid primary key default gen_random_uuid(),
  executed_at timestamptz default now(),
  file_name text not null default '',
  added_count integer not null default 0,
  updated_count integer not null default 0,
  deactivated_count integer not null default 0,
  error_count integer not null default 0,
  note text not null default ''
);

-- RLS: 다른 테이블들과 동일 — 실제 접근 제어는 layout + 항목별 권한(menu_permissions)
alter table engineer_contacts enable row level security;
alter table engineer_specialties enable row level security;
alter table engineer_contact_specialties enable row level security;
alter table engineer_sync_logs enable row level security;

create policy "authenticated_full_access" on engineer_contacts
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated_full_access" on engineer_specialties
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated_full_access" on engineer_contact_specialties
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated_full_access" on engineer_sync_logs
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- 시드: 전문분야 12종
insert into engineer_specialties (name, sort_order)
select * from (values
  ('건축', 10), ('토목', 20), ('기계', 30), ('전기', 40), ('통신', 50), ('소방', 60),
  ('안전', 70), ('품질', 80), ('공정', 90), ('사업관리', 100), ('조경', 110), ('기타', 120)
) as seed(name, ord)
where not exists (select 1 from engineer_specialties);

-- 기술인 667명 초기 데이터는 supabase/seed_engineers.sql (address book.xls 1회 이관)
