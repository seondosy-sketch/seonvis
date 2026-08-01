-- 숙박관리 (Hotel Stay Management) — DB 설계
-- 실제 운영은 "한 객실 = 대표 이용자 1명 등록, 동반자는 보조 기록"이므로 lodging_bookings/lodging_guests
-- 다대다로 쪼개지 않고 lodging_records 단일 테이블을 쓴다. 각 행 = "대표 이용자가 지정된 객실 예약 및
-- 정산 1건". 향후 실제 투숙자 전원의 개별 이력 관리가 필요해지면 그때 lodging_guests 자식 테이블을
-- 추가한다 — v1에서는 선제적으로 다대다 구조를 만들지 않는다.

create table if not exists lodging_hotels (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  default_price_per_night numeric(14,0) not null default 0,
  address text not null default '',
  phone text not null default '',
  memo text not null default '',
  is_active boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists lodging_records (
  id uuid primary key default gen_random_uuid(),

  -- 대표 이용자: 화면은 기술인/직원 통합 검색(구분 입력란 없음)이지만, DB는 원본 인력 테이블을
  -- 두 개의 nullable FK + CHECK로 명시 식별한다(폴리모픽 uuid 대신 — 이 코드베이스가 항상 FK
  -- 무결성을 명시적으로 강제하는 관례를 따름). 동일 이름을 자동 병합하지 않는다.
  guest_source text not null check (guest_source in ('engineer_contact', 'overtime_employee')),
  engineer_contact_id uuid references engineer_contacts(id) on delete restrict,
  overtime_employee_id uuid references overtime_employees(id) on delete restrict,
  guest_name_snapshot text not null,  -- 등록 당시 성명 (원본 인력 정보가 바뀌어도 과거 기록 유지)

  -- 동반자(보조 기록) — 인력 테이블과 연결하지 않는다.
  actual_guest_count integer not null default 1 check (actual_guest_count > 0),
  companion_names text not null default '',

  project_id uuid references projects(id) on delete set null,  -- 비프로젝트 숙박(직원 출장 등) 허용
  project_name_snapshot text not null default '',

  purpose text not null default '',  -- 면접 준비/기술제안서 작성/현장조사/교육/출장/회의/워크샵/기타(자유 입력)

  -- 원본 accommodation.xlsx 상세카드에 실제 존재(사용자 확인) — 면접일시/제안서작성일 등 숙박
  -- 사유와 별개로 발생하는 업무 일정을 선택적으로 기록. 체크인/체크아웃과는 별개 개념이라 독립
  -- 컬럼으로 둔다. 둘 다 nullable — 해당 없는 숙박(출장 등)은 비워둔다.
  work_date date,
  work_date_type text check (work_date_type in ('interview', 'proposal_submission', 'other')),

  -- 숙소: 마스터 연결 + 스냅샷. 마스터에 없는 숙소도 자유 입력 가능, 이 경우 hotel_id는 null.
  -- 이후 마스터 이름이 바뀌거나 비활성화돼도 과거 레코드의 hotel_name_snapshot은 유지된다.
  hotel_id uuid references lodging_hotels(id) on delete set null,
  hotel_name_snapshot text not null default '',
  room_type text not null default '',  -- Standard/Deluxe/Twin/Double/Suite/기타(자유 입력)

  check_in date not null,
  check_out date not null,
  room_count integer not null default 1 check (room_count > 0),
  price_per_night numeric(14,0) not null default 0 check (price_per_night >= 0),

  -- DB가 확정하는 금액 — 클라이언트가 보낸 값을 신뢰하지 않는다. generated column이므로
  -- INSERT/UPDATE 페이로드에 이 컬럼을 지정하면 Postgres가 에러를 낸다(항상 서버가 계산).
  -- date - date는 정수라 IMMUTABLE 제약을 만족한다.
  -- v1은 이 단순 계산식(단가×박수×객실수)으로 충분하다. 향후 할인/추가요금/부가서비스 등 정산
  -- 규칙이 늘어나면 generated column을 일반 컬럼 + 트리거(또는 애플리케이션 계산)로 전환할 수
  -- 있도록 설계를 열어둔다 — 지금 트리거를 미리 만들지는 않는다.
  total_price numeric(14,0) generated always as (
    price_per_night * (check_out - check_in) * room_count
  ) stored,

  memo text not null default '',

  created_by text not null default '',
  updated_by text not null default '',
  created_at timestamptz default now(),
  -- updated_at: DB 트리거 없음. 화면 코드가 매 update()/upsert() 호출 시 updated_at을 직접
  -- 페이로드에 세팅한다(app/(dashboard)/projects/page.tsx, trip/page.tsx와 동일 관례).
  updated_at timestamptz default now(),

  check (check_out > check_in),
  check (
    (guest_source = 'engineer_contact' and engineer_contact_id is not null and overtime_employee_id is null)
    or
    (guest_source = 'overtime_employee' and overtime_employee_id is not null and engineer_contact_id is null)
  ),
  check (
    (work_date is null and work_date_type is null)
    or
    (work_date is not null and work_date_type is not null)
  )
);

create index if not exists idx_lodging_records_dates on lodging_records (check_in, check_out);
create index if not exists idx_lodging_records_project on lodging_records (project_id);
create index if not exists idx_lodging_records_engineer on lodging_records (engineer_contact_id);
create index if not exists idx_lodging_records_employee on lodging_records (overtime_employee_id);
create index if not exists idx_lodging_records_hotel on lodging_records (hotel_id);

-- RLS: 숙박관리는 PII(투숙객 성명)와 금액 정보를 다루므로, 다른 테이블들과 달리
-- "인증 여부만 확인"하는 authenticated_full_access 대신 menu_permissions.lodging(none/read/write)을
-- DB 단에서 직접 강제한다 — private.menu_permission() 정의는 migration_menu_permission_function.sql
-- 참고. none이면 조회 자체가 안 되고, read면 조회만 가능하며 쓰기는 막힌다.
alter table lodging_hotels enable row level security;
alter table lodging_records enable row level security;

create policy "lodging_select" on lodging_hotels
  for select using (private.menu_permission('lodging') <> 'none');
create policy "lodging_insert" on lodging_hotels
  for insert with check (private.menu_permission('lodging') = 'write');
create policy "lodging_update" on lodging_hotels
  for update using (private.menu_permission('lodging') = 'write') with check (private.menu_permission('lodging') = 'write');
create policy "lodging_delete" on lodging_hotels
  for delete using (private.menu_permission('lodging') = 'write');

create policy "lodging_select" on lodging_records
  for select using (private.menu_permission('lodging') <> 'none');
create policy "lodging_insert" on lodging_records
  for insert with check (private.menu_permission('lodging') = 'write');
create policy "lodging_update" on lodging_records
  for update using (private.menu_permission('lodging') = 'write') with check (private.menu_permission('lodging') = 'write');
create policy "lodging_delete" on lodging_records
  for delete using (private.menu_permission('lodging') = 'write');
