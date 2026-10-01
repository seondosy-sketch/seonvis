-- 연장근무 (실무자) — 제안서팀 연장근무(migration_overtime.sql)와 별개인 실무자용 기능.
-- 먼저 migration_team_roster_sync.sql을 적용한다(직원 명단 = 기술인 주소록 '미래사업팀').
--
-- 제안서팀 버전과 달리 프로젝트/업무내용 없이 "직원 + 날짜 + 종료시간"만 입력한다.
-- 시작시간(18:00)·휴게시간(1시간)은 규칙으로 고정이라 저장하지 않고, 인정시간(hours)만
-- 저장 시점에 계산해 넣는다(lib/field-overtime/calc.ts). 그래서 하루에 한 사람당 기록은 1건 —
-- (employee_id, work_date) UNIQUE로 같은 날 중복 입력을 DB 단에서 막는다.
--
-- 직원은 별도 명단을 두지 않고 overtime_employees(주소록 '미래사업팀'에서 동기화되는 공용 직원 테이블)를 쓴다.

create table if not exists field_overtime_records (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references overtime_employees(id) on delete restrict,
  work_date date not null,
  end_time text not null,       -- "HH:mm". 자정을 넘기면 "24:00" 이상으로 표기 (overtime_work_records와 같은 이유로 text)
  hours numeric(4,2) not null,  -- 인정시간 = 종료 - 18:00 - 휴게 1시간, 1시간 단위 절삭. 저장 시점에 계산
  note text not null default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (employee_id, work_date)
);

create index if not exists idx_field_overtime_records_date
  on field_overtime_records (work_date);

-- RLS: menu_permissions.field_overtime(none/read/write)를 DB 단에서 직접 강제한다
-- (private.menu_permission() 정의는 migration_menu_permission_function.sql 참고).
alter table field_overtime_records enable row level security;

create policy "menu_select" on field_overtime_records for select using (private.menu_permission('field_overtime') <> 'none');
create policy "menu_insert" on field_overtime_records for insert with check (private.menu_permission('field_overtime') = 'write');
create policy "menu_update" on field_overtime_records for update using (private.menu_permission('field_overtime') = 'write') with check (private.menu_permission('field_overtime') = 'write');
create policy "menu_delete" on field_overtime_records for delete using (private.menu_permission('field_overtime') = 'write');

-- 실무자 연장근무 사용자는 overtime 권한이 없어도 직원 이름을 읽을 수 있어야 한다 (정책은 OR로 합쳐진다).
-- 쓰기는 주지 않는다 — 명단 변경은 주소록 + sync_team_employees()(security definer)로만 일어난다.
create policy "field_overtime_select" on overtime_employees for select using (private.menu_permission('field_overtime') <> 'none');
