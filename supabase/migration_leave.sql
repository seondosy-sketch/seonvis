-- 휴가관리 — DB 설계 (docs/leave-management/03-data-model.md)
--
-- 핵심 원칙 (연장근무와 동일):
--   월별/연간 사용일수·잔여 연차는 컬럼으로 저장하지 않고 항상
--   leave_record_dates(휴가의 날짜별 전개)에서 계산한다.
--   집계·중복 검증·월 셀 상세보기가 전부 이 테이블만 본다.

-- 0. 직원 테이블 공용 사용 — 입사일/퇴사일 컬럼 추가 (nullable, 연장근무 무영향)
alter table overtime_employees
  add column if not exists hire_date date,
  add column if not exists resign_date date;

-- 1. 휴가 유형
create table if not exists leave_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  deducts_annual_leave boolean not null default true, -- 연차 차감 여부
  default_deduction_unit numeric(2,1) not null default 1, -- 기본 차감 단위 (1 / 0.5 / 0)
  is_active boolean not null default true, -- 비활성 유형은 신규 등록 드롭다운에서 제외 (소프트 삭제)
  sort_order integer not null default 0,
  created_at timestamptz default now()
);

-- 2. 연도별 연차 부여 (직원·연도당 1행)
create table if not exists annual_leave_balances (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references overtime_employees(id) on delete restrict,
  year integer not null,
  granted_days numeric(4,1) not null default 0,    -- 기본 부여 연차 (0.5 단위 허용)
  adjustment_days numeric(4,1) not null default 0, -- 조정일수 (이월/추가부여/보정/차감, ± 허용)
  adjustment_reason text not null default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (employee_id, year)
);
-- 최종 사용 가능 연차 = granted_days + adjustment_days (저장하지 않고 항상 계산)

-- 3. 연차 부여/수정 이력 — 연차 설정 화면에서 insert/update 할 때마다 앱 코드가 1행씩 남긴다
create table if not exists annual_leave_balance_history (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references overtime_employees(id) on delete restrict,
  year integer not null,
  previous_granted_days numeric(4,1),      -- 최초 부여면 null
  new_granted_days numeric(4,1) not null,
  previous_adjustment_days numeric(4,1),
  new_adjustment_days numeric(4,1) not null,
  reason text not null default '',
  changed_at timestamptz default now()
);

-- 4. 휴가 1건 (원본)
create table if not exists leave_records (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references overtime_employees(id) on delete restrict,
  leave_type_id uuid not null references leave_types(id) on delete restrict,
  start_date date not null,
  end_date date not null,
  start_day_unit text not null default 'full' check (start_day_unit in ('full', 'am', 'pm')),
  end_day_unit text not null default 'full' check (end_day_unit in ('full', 'am', 'pm')),
  total_calendar_days integer not null,  -- 전체 기간 = 종료-시작+1. "몇 박"은 -1로 파생 (별도 저장 안 함)
  deducted_days numeric(4,1) not null,   -- 실제 차감 합 — leave_record_dates 재생성 때마다 함께 다시 계산해 넣는다
  memo text not null default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_leave_records_employee on leave_records (employee_id);
create index if not exists idx_leave_records_range on leave_records (start_date, end_date);

-- 5. 날짜별 전개 — 집계/중복검증/월 셀 상세의 기준.
--    기간 내 모든 달력 날짜를 행으로 저장한다(주말·공휴일 포함, 차감 0으로):
--    차감 없는 유형(경조 등)도 날짜는 점유하므로 중복 검증이 단순해지고,
--    월 셀 상세에서 제외된 날을 설명할 수 있다.
--    휴가 수정 시 해당 record의 행을 전부 지우고 재생성한다.
create table if not exists leave_record_dates (
  id uuid primary key default gen_random_uuid(),
  leave_record_id uuid not null references leave_records(id) on delete cascade,
  leave_date date not null,
  day_unit text not null default 'full' check (day_unit in ('full', 'am', 'pm')),
  deducted_days numeric(2,1) not null default 0,
  is_weekend boolean not null default false,
  is_holiday boolean not null default false,
  holiday_name text -- 저장 시점 스냅샷 — 이후 공휴일 편집과 무관하게 당시 기준 보존
);

create index if not exists idx_leave_record_dates_record on leave_record_dates (leave_record_id);
create index if not exists idx_leave_record_dates_date on leave_record_dates (leave_date);

-- 6. 공휴일/회사휴무 — 차감 계산은 이 테이블만 본다 (인터넷 없이 동작)
create table if not exists holidays (
  id uuid primary key default gen_random_uuid(),
  holiday_date date not null unique,
  name text not null,
  holiday_type text not null default '법정공휴일' check (holiday_type in ('법정공휴일', '회사휴무')),
  created_at timestamptz default now()
);

-- RLS: 다른 테이블들과 동일 — 실제 접근 제어는 app/(dashboard)/layout.tsx가 담당
alter table leave_types enable row level security;
alter table annual_leave_balances enable row level security;
alter table annual_leave_balance_history enable row level security;
alter table leave_records enable row level security;
alter table leave_record_dates enable row level security;
alter table holidays enable row level security;

create policy "authenticated_full_access" on leave_types
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated_full_access" on annual_leave_balances
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated_full_access" on annual_leave_balance_history
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated_full_access" on leave_records
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated_full_access" on leave_record_dates
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated_full_access" on holidays
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- 시드: 휴가 유형 기본 8종
insert into leave_types (name, deducts_annual_leave, default_deduction_unit, sort_order)
select * from (values
  ('연차',      true,  1.0, 10),
  ('오전 반차', true,  0.5, 20),
  ('오후 반차', true,  0.5, 30),
  ('경조휴가',  false, 0.0, 40),
  ('병가',      false, 0.0, 50),
  ('공가',      false, 0.0, 60),
  ('대체휴무',  false, 0.0, 70),
  ('기타',      false, 0.0, 80)
) as seed(name, deducts, unit, ord)
where not exists (select 1 from leave_types);

-- 시드: 2026년 대한민국 법정공휴일 (기존 /api/holidays와 같은 소스 기준.
-- 주말과 겹치는 공휴일은 주말 규칙으로 이미 차감 제외라 목록에 없어도 계산에 영향 없음.
-- 단, 소스가 제헌절을 공휴일로 잘못 표기해 제외했다 — 2008년부터 법정공휴일 아님.
-- 인터넷 불러오기로 들어와도 관리 모달에서 삭제하면 된다)
insert into holidays (holiday_date, name, holiday_type)
values
  ('2026-01-01', '새해', '법정공휴일'),
  ('2026-02-16', '설날', '법정공휴일'),
  ('2026-02-17', '설날', '법정공휴일'),
  ('2026-02-18', '설날', '법정공휴일'),
  ('2026-03-02', '3·1절 대체공휴일', '법정공휴일'),
  ('2026-05-01', '노동절', '법정공휴일'),
  ('2026-05-05', '어린이날', '법정공휴일'),
  ('2026-05-25', '부처님 오신 날 대체공휴일', '법정공휴일'),
  ('2026-06-03', '지방 선거일', '법정공휴일'),
  ('2026-08-17', '광복절 대체공휴일', '법정공휴일'),
  ('2026-09-24', '추석', '법정공휴일'),
  ('2026-09-25', '추석', '법정공휴일'),
  ('2026-09-26', '추석', '법정공휴일'),
  ('2026-10-05', '개천절 대체공휴일', '법정공휴일'),
  ('2026-10-09', '한글날', '법정공휴일'),
  ('2026-12-25', '크리스마스', '법정공휴일')
on conflict (holiday_date) do nothing;
