-- 연장근무(제안서팀) 자동배정 — Migration A: 기반 스키마
--
-- ⚠ 초안. 어떤 DB에도 실행하지 않았다. 적용 절차·의존성: docs/overtime-planning-db.md
--   적용 전 supabase/verify/overtime_planning_preflight.sql, 적용 후 overtime_planning_postflight_a.sql.
--
-- 이 파일만 적용된 상태에서도 기존 연장근무 수동입력·출력은 그대로 동작해야 한다. 그래서:
--   - overtime_work_records에 트리거를 걸지 않는다(주 12시간·자동확정 보호는 Migration B).
--   - 자동배정 RPC는 만들지 않는다(Migration B). 실행 기록·초안 테이블은 읽기 정책만 둔다 —
--     클라이언트는 이 상태에서 실행·초안·자동확정 기록을 만들 수 없다.
--   - 기존 overtime_* RLS 정책은 건드리지 않는다.
--
-- 카탈로그 확인(2026-10-03, PostgreSQL 17.6)을 전제로 한다:
--   overtime_work_records.hours numeric(4,2) NOT NULL, break_hours numeric(3,1), 기록 0건,
--   overtime_employees.name UNIQUE = overtime_employees_name_key, engineer_contacts.employee_id UNIQUE 없음,
--   private 스키마 USAGE는 anon·authenticated·service_role 모두 없음,
--   public 스키마 신규 함수에는 기본 ACL로 anon·authenticated·service_role EXECUTE가 붙는다
--   → 모든 신규·교체 함수는 만든 직후 권한을 전부 회수하고 필요한 역할에만 다시 준다.
--
-- 원칙: 기존 행 UPDATE/DELETE 없음, hours 재계산 없음, 이름 backfill 없음, 새 컬럼은 nullable·기본값 없음.
-- 직원 분리 방지(2026-10-07 추가): 미연결 '미래사업팀' 주소록과 주소록 미연결 재직 직원이 둘 다 있으면 0단계에서
--   OVERTIME_EMPLOYEE_LINK_REQUIRED로 중단한다(preflight p10·p11 = STOP). 확인: supabase/verify/overtime_employee_link_check.sql.
--   이미 A가 적용된 DB는 같은 sync_team_employees 본문을 supabase/migration_overtime_planning_c_corrections.sql로 받는다.
-- 한 트랜잭션 — 하나라도 실패하면 전부 롤백된다. 재실행해도 같은 결과(if not exists / drop if exists).

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- 0. 가드 — 전제가 틀리면 아무것도 만들지 않는다
-- ════════════════════════════════════════════════════════════════════════════
do $$
begin
  if to_regprocedure('private.menu_permission(text)') is null then
    raise exception 'preflight: private.menu_permission(text) 없음';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'overtime_work_records'
                   and column_name = 'hours' and numeric_precision = 4 and numeric_scale = 2) then
    raise exception 'preflight: overtime_work_records.hours가 numeric(4,2)가 아님';
  end if;
  if exists (select 1 from public.engineer_contacts where employee_id is not null
             group by employee_id having count(*) > 1) then
    raise exception 'preflight: engineer_contacts.employee_id 중복 연결이 있음';
  end if;
  -- 직원 분리 방지 (sync_team_employees 0단계와 같은 조건): 미연결 '미래사업팀' 주소록과 주소록 미연결 재직 직원이
  -- 동시에 있으면, 첫 동기화가 같은 사람을 새 직원 행(새 UUID)으로 만들고 기존 행은 비활성으로 돌려 기록이 둘로 갈라질 수 있다.
  -- 이름으로 자동 연결하지 않는다 — supabase/verify/overtime_employee_link_check.sql로 확인 후 사람이 연결한다.
  if exists (select 1 from public.engineer_contacts c where c.company = '미래사업팀' and c.employee_id is null)
     and exists (select 1 from public.overtime_employees e
                 where e.is_active and not exists (select 1 from public.engineer_contacts c where c.employee_id = e.id)) then
    raise exception 'OVERTIME_EMPLOYEE_LINK_REQUIRED: 연결 안 된 주소록 %명 / 직원 %명',
      (select count(*) from public.engineer_contacts c where c.company = '미래사업팀' and c.employee_id is null),
      (select count(*) from public.overtime_employees e
        where e.is_active and not exists (select 1 from public.engineer_contacts c where c.employee_id = e.id))
      using errcode = '55000';
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. 순수 계산 헬퍼 (private, INVOKER, IMMUTABLE) — Migration B의 RPC가 소유자 권한으로 부른다
--    (2h/3h 프리셋 값은 초안 CHECK와 Migration B의 초안 트리거가 고정한다)
-- ════════════════════════════════════════════════════════════════════════════

-- 주 시작일(월요일). ISO 주(월~일), timestamp(타임존 없음)로 계산해 세션 타임존과 무관.
create or replace function private.overtime_week_start(p_date date)
returns date
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$ select pg_catalog.date_trunc('week', p_date::timestamp)::date $$;

-- 급여기간 라벨 'YYYY-MM' → [전월 21일, 당월 20일]. lib/overtime/summary.ts payPeriodRange와 같은 규칙
-- (lib/overtime/planningTypes.test.ts가 4년치 일치를 검사한다).
create or replace function private.overtime_pay_period(p_label text, out period_start date, out period_end date)
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $$
declare
  m date;
begin
  if p_label is null or p_label !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'OVERTIME_INVALID_PERIOD' using errcode = '22023';
  end if;
  m := pg_catalog.make_date(pg_catalog.split_part(p_label, '-', 1)::int, pg_catalog.split_part(p_label, '-', 2)::int, 1);
  period_start := (m - interval '1 month')::date + 20;
  period_end := m + 19;
end $$;

-- 클라이언트가 부를 이유가 없다 — 모든 역할에서 회수(소유자만 실행). private USAGE도 새로 주지 않는다.
revoke all on function private.overtime_week_start(date) from public, anon, authenticated, service_role;
revoke all on function private.overtime_pay_period(text) from public, anon, authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. 공휴일 읽기 정책 — overtime 권한 사용자 (기존 menu_* 4개·field_overtime_select는 그대로)
-- ════════════════════════════════════════════════════════════════════════════
drop policy if exists "overtime_select" on public.holidays;
create policy "overtime_select" on public.holidays
  for select to authenticated
  using (private.menu_permission('overtime') <> 'none');

-- ════════════════════════════════════════════════════════════════════════════
-- 3. 직원 식별자 — engineer_contacts.employee_id가 유일한 연결키, 동명이인 허용
-- ════════════════════════════════════════════════════════════════════════════
create unique index if not exists engineer_contacts_employee_id_key
  on public.engineer_contacts (employee_id) where employee_id is not null;

alter table public.overtime_employees drop constraint if exists overtime_employees_name_key;

-- 이름으로 기존 직원을 찾는 단계를 없앤 버전. 주소록(engineer_contacts)이 원본이다.
--   0) 미연결 '미래사업팀' 기술인(p11)과 주소록 미연결 재직 직원(p10)이 둘 다 있으면 아무것도 바꾸지 않고
--      OVERTIME_EMPLOYEE_LINK_REQUIRED(errcode 55000) — 같은 사람이 새 UUID로 갈라지는 것을 막는다. 자동 이름 매칭은 하지 않는다.
--      한쪽만 있으면 아래 규칙 그대로(미연결 기술인만 → 1) 생성 / 미연결 재직 직원만 → 3) 비활성).
--   1) 미연결 '미래사업팀' 기술인 → 새 직원 행을 만들어 연결 (동명이인이어도 별개 직원)
--   2) 연결된 직원 → 이름·직급·재직(= 소속 미래사업팀 AND 재직상태 '재직')을 주소록 값으로
--   3) 주소록 연결이 완전히 끊긴 직원 → 비활성 (행·기록·참여·업무는 그대로)
--      단, 주소록에 '미래사업팀' 재직자가 한 명도 없으면 데이터 사고로 보고 3)을 건너뛴다.
--   다시 연결(engineer_contacts.employee_id에 기존 직원 id 지정)되면 2)가 재활성화한다.
-- 이 함수는 DB 안에서 주소록 전체를 소유자 권한으로 읽는다 — RLS·네트워크 때문에 일부만 읽히는 일이 없고,
-- 조회가 실패하면 예외로 전체가 롤백되므로 "조회 실패를 퇴직으로 오판"하는 경로가 없다.
create or replace function public.sync_team_employees()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  rec record;
  eid uuid;
  v_unlinked_contacts int;
  v_unlinked_employees int;
begin
  if private.menu_permission('overtime') = 'none' and private.menu_permission('field_overtime') = 'none' then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  -- 0) 직원 분리 방지 — 데이터를 바꾸기 전에 확인한다
  select count(*) into v_unlinked_contacts
  from public.engineer_contacts c where c.company = '미래사업팀' and c.employee_id is null;
  select count(*) into v_unlinked_employees
  from public.overtime_employees e
  where e.is_active and not exists (select 1 from public.engineer_contacts c where c.employee_id = e.id);
  if v_unlinked_contacts > 0 and v_unlinked_employees > 0 then
    raise exception 'OVERTIME_EMPLOYEE_LINK_REQUIRED: 연결 안 된 주소록 %명 / 직원 %명', v_unlinked_contacts, v_unlinked_employees
      using errcode = '55000', hint = 'supabase/verify/overtime_employee_link_check.sql로 확인 후 주소록에서 직원을 연결한다';
  end if;

  -- 1) for update: 동시 실행 시 두 번째 호출은 이미 연결된 행을 다시 평가해 건너뛴다
  --    (engineer_contacts_employee_id_key도 같은 직원 이중 연결을 막는다)
  for rec in
    select c.id, c.name, c.rank, c.employment_status
    from public.engineer_contacts c
    where c.company = '미래사업팀' and c.employee_id is null
    order by c.created_at, c.id
    for update
  loop
    insert into public.overtime_employees (name, position, is_active, sort_order)
    values (rec.name, rec.rank, rec.employment_status = '재직',
            coalesce((select max(e.sort_order) from public.overtime_employees e), 0) + 10)
    returning id into eid;
    update public.engineer_contacts set employee_id = eid where id = rec.id;
  end loop;

  -- 2) 바뀐 행만 쓴다(같은 값이면 UPDATE 없음)
  update public.overtime_employees e
  set name = c.name,
      position = c.rank,
      is_active = (c.company = '미래사업팀' and c.employment_status = '재직')
  from public.engineer_contacts c
  where c.employee_id = e.id
    and (e.name, e.position, e.is_active)
        is distinct from (c.name, c.rank, (c.company = '미래사업팀' and c.employment_status = '재직'));

  -- 3) 연결이 끊긴 직원 비활성
  if exists (select 1 from public.engineer_contacts c where c.company = '미래사업팀' and c.employment_status = '재직') then
    update public.overtime_employees e
    set is_active = false
    where e.is_active
      and not exists (select 1 from public.engineer_contacts c where c.employee_id = e.id);
  end if;
end $$;

-- 기존 권한(postgres·authenticated·service_role)과 같게. anon에는 주지 않는다.
revoke all on function public.sync_team_employees() from public, anon, authenticated, service_role;
grant execute on function public.sync_team_employees() to authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. 월 목표시간 — 행 없음(미입력)과 0시간(유효, 배정 0건)을 구분한다
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.overtime_monthly_targets (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.overtime_employees(id) on delete restrict,
  period_label text not null check (period_label ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  -- 2·3시간 조합으로 못 만드는 값도 저장 허용 — 엔진이 가능한 만큼만 배정하고 미배정 사유를 낸다
  target_hours numeric(5,2) not null check (target_hours >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text not null default coalesce(auth.jwt() ->> 'email', ''),
  updated_by text not null default coalesce(auth.jwt() ->> 'email', ''),
  constraint overtime_monthly_targets_employee_period_key unique (employee_id, period_label)
);

-- updated_at/updated_by — 강제조건이 아닌 기록용 트리거라 A에 둔다.
-- INVOKER: 본문이 private 객체를 부르지 않는다(authenticated에는 private USAGE가 없음).
create or replace function private.overtime_monthly_targets_touch()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  new.updated_at := pg_catalog.now();
  new.updated_by := coalesce(auth.jwt() ->> 'email', '');
  return new;
end $$;
revoke all on function private.overtime_monthly_targets_touch() from public, anon, authenticated, service_role;

drop trigger if exists overtime_monthly_targets_touch on public.overtime_monthly_targets;
create trigger overtime_monthly_targets_touch
  before update on public.overtime_monthly_targets
  for each row execute function private.overtime_monthly_targets_touch();

-- ════════════════════════════════════════════════════════════════════════════
-- 5. 직원×프로젝트 담당업무 — 복합 FK로 "같은 직원"을 선언적으로 보장
-- ════════════════════════════════════════════════════════════════════════════
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'overtime_project_members_id_employee_key') then
    alter table public.overtime_project_members
      add constraint overtime_project_members_id_employee_key unique (id, employee_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'overtime_employee_tasks_id_employee_key') then
    alter table public.overtime_employee_tasks
      add constraint overtime_employee_tasks_id_employee_key unique (id, employee_id);
  end if;
end $$;

-- 참여관계에 행이 0건이면 그 직원의 기본업무 전체를 쓴다(애플리케이션 계약).
-- 설정 데이터라 CASCADE — 최종기록은 이 테이블을 참조하지 않고 업무명을 텍스트로 가진다.
create table if not exists public.overtime_member_tasks (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null,
  task_id uuid not null,
  employee_id uuid not null,
  created_at timestamptz not null default now(),
  created_by text not null default coalesce(auth.jwt() ->> 'email', ''),
  constraint overtime_member_tasks_member_fk foreign key (member_id, employee_id)
    references public.overtime_project_members (id, employee_id) on delete cascade,
  constraint overtime_member_tasks_task_fk foreign key (task_id, employee_id)
    references public.overtime_employee_tasks (id, employee_id) on delete cascade,
  constraint overtime_member_tasks_member_task_key unique (member_id, task_id)
);
create index if not exists idx_overtime_member_tasks_task on public.overtime_member_tasks (task_id);
create index if not exists idx_overtime_member_tasks_employee on public.overtime_member_tasks (employee_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 6. 자동배정 실행 기록 (생성·변경은 Migration B의 RPC만)
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.overtime_assignment_runs (
  id uuid primary key default gen_random_uuid(),
  period_label text not null check (period_label ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  seed bigint not null,
  scope text not null check (scope in ('all', 'employee', 'project')),
  scope_employee_id uuid references public.overtime_employees(id) on delete restrict,
  scope_project_id uuid references public.overtime_projects(id) on delete restrict,
  rule_version text not null default '',
  input_snapshot jsonb not null default '{}'::jsonb,   -- 내부 ID·기간·목표·프로젝트 날짜·업무 관계만 (개인정보 없음)
  result_summary jsonb not null default '{}'::jsonb,
  status text not null default 'draft'
    check (status in ('draft', 'partially_confirmed', 'confirmed', 'superseded', 'discarded')),
  created_by text not null default coalesce(auth.jwt() ->> 'email', ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  discarded_at timestamptz,
  constraint overtime_assignment_runs_scope_target_check check (
    (scope = 'all' and scope_employee_id is null and scope_project_id is null) or
    (scope = 'employee' and scope_employee_id is not null and scope_project_id is null) or
    (scope = 'project' and scope_project_id is not null and scope_employee_id is null)
  )
);
create index if not exists idx_overtime_assignment_runs_period on public.overtime_assignment_runs (period_label, created_at desc);

-- ════════════════════════════════════════════════════════════════════════════
-- 7. 자동배정 초안 — 최종기록과 분리. 기존 집계(SUM(overtime_work_records.hours))에 들어가지 않는다.
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.overtime_assignment_drafts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.overtime_assignment_runs(id) on delete restrict,
  employee_id uuid not null references public.overtime_employees(id) on delete restrict,
  project_id uuid not null references public.overtime_projects(id) on delete restrict,
  work_date date not null,
  task_id uuid references public.overtime_employee_tasks(id) on delete set null,  -- 허용업무 검증·재배정용
  task_name text not null,                                                         -- 확정 기록에 옮길 스냅샷
  time_type text not null check (time_type in ('2h', '3h')),
  start_time text not null,
  end_time text not null,
  break_hours numeric(3,1) not null,   -- overtime_work_records.break_hours와 같은 정밀도
  hours numeric(4,2) not null,         -- overtime_work_records.hours와 같은 정밀도
  is_weekend boolean not null default false,
  is_holiday boolean not null default false,
  exception_reason text,               -- 주말·공휴일 배정 사유 (평일 일반 배정은 NULL)
  manually_edited boolean not null default false,
  locked boolean not null default false,
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'superseded', 'discarded')),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint overtime_assignment_drafts_preset_check check (
    (time_type = '2h' and start_time = '18:00' and end_time = '21:00' and break_hours = 1 and hours = 2) or
    (time_type = '3h' and start_time = '18:00' and end_time = '22:00' and break_hours = 1 and hours = 3)
  ),
  constraint overtime_assignment_drafts_weekend_check check (is_weekend = (extract(isodow from work_date) in (6, 7))),
  -- 주말·공휴일이면 사유 필수, 평일이면 NULL
  constraint overtime_assignment_drafts_exception_check check (
    case when is_weekend or is_holiday then exception_reason is not null else exception_reason is null end
  ),
  constraint overtime_assignment_drafts_confirmed_check check ((status = 'confirmed') = (confirmed_at is not null))
);
-- 하루 한 프로젝트: 직원·근무일당 살아 있는(draft/confirmed) 초안 1건 — 실행과 무관
create unique index if not exists overtime_assignment_drafts_one_per_day
  on public.overtime_assignment_drafts (employee_id, work_date) where status in ('draft', 'confirmed');
create index if not exists idx_overtime_assignment_drafts_run on public.overtime_assignment_drafts (run_id, status);
create index if not exists idx_overtime_assignment_drafts_project_date on public.overtime_assignment_drafts (project_id, work_date);

-- ════════════════════════════════════════════════════════════════════════════
-- 8. 최종기록 컬럼 — 전부 nullable, 기본값 없음. source NULL = 기존(수동)기록
-- ════════════════════════════════════════════════════════════════════════════
alter table public.overtime_work_records
  add column if not exists source text,
  add column if not exists assignment_run_id uuid,
  add column if not exists assignment_draft_id uuid,
  add column if not exists employee_name_snapshot text,
  add column if not exists project_name_snapshot text,
  add column if not exists task_name_snapshot text,
  add column if not exists assignment_exception_reason text,   -- 자동배정 주말·공휴일 사유 (note와 분리)
  add column if not exists confirmed_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'overtime_work_records_source_check') then
    alter table public.overtime_work_records add constraint overtime_work_records_source_check
      check (source is null or source in ('manual', 'auto'));
  end if;
  -- auto ⇔ 실행·초안·확정시각 모두 있음. 그 외(NULL·manual)는 셋 다 없음.
  if not exists (select 1 from pg_constraint where conname = 'overtime_work_records_auto_link_check') then
    alter table public.overtime_work_records add constraint overtime_work_records_auto_link_check
      check (case when source = 'auto'
                  then assignment_run_id is not null and assignment_draft_id is not null and confirmed_at is not null
                  else assignment_run_id is null and assignment_draft_id is null and confirmed_at is null end);
  end if;
  -- 예외사유는 자동배정 기록에만, 주말 자동배정이면 필수(공휴일은 확정 RPC가 초안에서 옮기며 보장)
  if not exists (select 1 from pg_constraint where conname = 'overtime_work_records_exception_check') then
    alter table public.overtime_work_records add constraint overtime_work_records_exception_check
      check (case when source = 'auto'
                  then extract(isodow from work_date) not in (6, 7) or assignment_exception_reason is not null
                  else assignment_exception_reason is null end);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'overtime_work_records_assignment_run_fk') then
    alter table public.overtime_work_records add constraint overtime_work_records_assignment_run_fk
      foreign key (assignment_run_id) references public.overtime_assignment_runs(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'overtime_work_records_assignment_draft_fk') then
    alter table public.overtime_work_records add constraint overtime_work_records_assignment_draft_fk
      foreign key (assignment_draft_id) references public.overtime_assignment_drafts(id) on delete restrict;
  end if;
end $$;

-- 초안 1건 → 최종기록 1건 (재확정 방지)
create unique index if not exists overtime_work_records_assignment_draft_key
  on public.overtime_work_records (assignment_draft_id) where assignment_draft_id is not null;
-- 자동배정 확정 기록은 직원·근무일당 1건 (수동 기록은 제한하지 않음)
create unique index if not exists overtime_work_records_auto_one_per_day
  on public.overtime_work_records (employee_id, work_date) where source = 'auto';

-- ════════════════════════════════════════════════════════════════════════════
-- 9. RLS — 신규 테이블은 TO authenticated만. anon·PUBLIC 정책 없음.
-- ════════════════════════════════════════════════════════════════════════════
alter table public.overtime_monthly_targets enable row level security;
alter table public.overtime_member_tasks enable row level security;
alter table public.overtime_assignment_runs enable row level security;
alter table public.overtime_assignment_drafts enable row level security;

-- 설정 데이터: 읽기 = overtime ≠ none, 쓰기 = write
drop policy if exists "menu_select" on public.overtime_monthly_targets;
drop policy if exists "menu_insert" on public.overtime_monthly_targets;
drop policy if exists "menu_update" on public.overtime_monthly_targets;
drop policy if exists "menu_delete" on public.overtime_monthly_targets;
create policy "menu_select" on public.overtime_monthly_targets for select to authenticated using (private.menu_permission('overtime') <> 'none');
create policy "menu_insert" on public.overtime_monthly_targets for insert to authenticated with check (private.menu_permission('overtime') = 'write');
create policy "menu_update" on public.overtime_monthly_targets for update to authenticated using (private.menu_permission('overtime') = 'write') with check (private.menu_permission('overtime') = 'write');
create policy "menu_delete" on public.overtime_monthly_targets for delete to authenticated using (private.menu_permission('overtime') = 'write');

drop policy if exists "menu_select" on public.overtime_member_tasks;
drop policy if exists "menu_insert" on public.overtime_member_tasks;
drop policy if exists "menu_update" on public.overtime_member_tasks;
drop policy if exists "menu_delete" on public.overtime_member_tasks;
create policy "menu_select" on public.overtime_member_tasks for select to authenticated using (private.menu_permission('overtime') <> 'none');
create policy "menu_insert" on public.overtime_member_tasks for insert to authenticated with check (private.menu_permission('overtime') = 'write');
create policy "menu_update" on public.overtime_member_tasks for update to authenticated using (private.menu_permission('overtime') = 'write') with check (private.menu_permission('overtime') = 'write');
create policy "menu_delete" on public.overtime_member_tasks for delete to authenticated using (private.menu_permission('overtime') = 'write');

-- 실행·초안: A에서는 읽기만. insert/update/delete 정책이 없어 클라이언트는 만들 수도 고칠 수도 없다.
-- (초안 수동 수정 정책은 Migration B에서 초안 보호 트리거와 함께 추가)
drop policy if exists "menu_select" on public.overtime_assignment_runs;
create policy "menu_select" on public.overtime_assignment_runs for select to authenticated using (private.menu_permission('overtime') <> 'none');
drop policy if exists "menu_select" on public.overtime_assignment_drafts;
create policy "menu_select" on public.overtime_assignment_drafts for select to authenticated using (private.menu_permission('overtime') <> 'none');

commit;
