-- 기술인 출퇴근부 — 1단계 DB 설계 (docs/attendance/03-data-model.md, 사용자 승인/재검토사항 반영)
--
-- 핵심 원칙 (연장근무 overtime_work_records와 동일):
--   attendance_records는 "기술인 1명 + 날짜 1개 + 프로젝트 1개 = 행 1개" 단위를 절대 어기지 않는다.
--   미출근 날짜는 행을 만들지 않는다 — "레코드 존재 = 출근"이며, 체크 해제는 UPDATE가 아니라 DELETE.
--
-- 과거 기록 보존 방식(사용자 승인, docs/attendance/03-data-model.md §0):
--   "유효기간이 있는 project_participants(운영 데이터)" + "월 마감 시 attendance_closure_snapshot_rows(고정 데이터)"
--   하이브리드. project_participants는 절대 값을 덮어쓰지 않고(교체 시 기존 행 종료 + 새 행 추가),
--   마감 시점에만 attendance_closure_snapshot_rows로 통째로 얼린다.
--
-- 재공고/변경공고/공고취소(사용자 확정): projects에 boolean 컬럼을 추가하지 않는다.
--   project_change_history가 공식 원본이며, projects 쪽 캐시성 컬럼은 필요해지면 별도 마이그레이션으로 추가한다.
--
-- ⚠ 재검토 후 반영된 변경사항 (사용자 지시로 Phase 1 안에서 수정, docs/attendance/03-data-model.md §0 참고):
--   1) project_participants 유니크 제약은 실측 검증 후 그대로 유지(변경 없음 — 아래 해당 섹션 주석 참고).
--   2) attendance_records.closure_id 컬럼을 제거했다(재마감 반복 시 덮어쓰기 위험 때문).
--   3) attendance_month_closures를 "기간당 1행"에서 "마감 시도(버전)당 1행"으로 바꿨다(재마감마다 새 버전).
--   4) attendance_closure_snapshot_rows에 present_count=배열길이 CHECK와 중복날짜 방지 트리거를 추가했다.

-- ── 1. 프로젝트 참여기술인 ──────────────────────────────────────────────
-- Project List(projects)와 기술인 주소록(engineer_contacts)을 잇는 관계 테이블.
-- 이 테이블이 생기기 전에는 "참여기술인 정보 연계" 자체가 불가능했다(projects에는
-- director/staff_* 텍스트 5개 필드뿐 — docs/attendance/01-current-analysis.md §2.3).
create table if not exists project_participants (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete restrict,
  engineer_id uuid not null references engineer_contacts(id) on delete restrict,
  role text not null default '',       -- 참여직책 (엑셀 실측: '단장'만 존재하나 자유 텍스트로 둔다)
  specialty_id uuid references engineer_specialties(id) on delete restrict, -- 분야 (기존 마스터 재사용)
  is_director boolean not null default false, -- 단장 여부 — 교체 시 같은 프로젝트에 여러 명 true 가능(이력 보존)
  participation_start date, -- 참여 시작일. 기본값은 화면에서 공고일 제안, 수정 가능
  participation_end date,   -- 참여 종료일. null = 계속 참여 중 (면접일 미정 프로젝트 등 — 서면/추후 같은
                             -- 비날짜 텍스트를 이 컬럼에 저장하지 않는다: 사용자 확정사항 #3)
  status text not null default '진행중' check (status in ('진행중', '종료')),
  sort_order integer not null default 0, -- 프로젝트 내 표시 순서(단장이 먼저 오도록)
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 유니크 제약 재검토(사용자 검토 지시 #1) — 추측하지 않고 실제 데이터로 확인했다:
--   (a) 첨부 엑셀(commute_sample.xlsx) 84개 프로젝트 전수 조사 — 같은 프로젝트 블록 안에
--       동일 성명이 두 번 이상 등장하는 사례 0건.
--   (b) 실제 운영 Supabase(seonvis)의 projects 60건 전수 — director가 staff_arch/civil/mech/safety
--       중 어느 것과도 동일한(=같은 사람이 두 역할을 겸함) 사례 0건
--       (`select ... where director <> '' and (director = staff_arch or ...)` → 결과 0행).
-- 두 독립된 실데이터 모두 "한 기술인 = 한 프로젝트에서 한 역할"만 보여준다 — 따라서
-- role/specialty를 키에 포함하지 않고 (project_id, engineer_id) 단위 활성 참여 유니크를 그대로 유지한다.
-- 같은 프로젝트에 같은 기술인의 "활성" 참여는 1건만(중복 참여 방지).
-- 과거(종료된) 참여까지 막지는 않는다 — 동일 기술인의 재투입을 허용해야 하므로.
create unique index if not exists project_participants_active_unique
  on project_participants (project_id, engineer_id) where status = '진행중';

create index if not exists idx_project_participants_project on project_participants (project_id);
create index if not exists idx_project_participants_engineer on project_participants (engineer_id);

-- ── 2. 월 마감 (버전 관리) ────────────────────────────────────────────────
-- 재검토 반영(사용자 검토 지시 #3): 마감→마감취소→재마감이 반복될 수 있으므로, 이 테이블은
-- "기간(period_year, period_month)당 1행"이 아니라 "마감 시도(episode) 1건 = 1행"인
-- append-only 버전 이력이다. 최초 마감 시 새 행(version=1, status='closed')을 만들고, 그
-- 마감이 나중에 취소되면 **같은 행**의 reopened_by/at/reason만 채운다(status→'reopened').
-- 재마감하면 새 버전(version=2, status='closed') 행을 새로 만든다 — 이래야 버전마다 독립된
-- attendance_closure_snapshot_rows(closure_id로 그 버전의 id를 참조)가 전부 보존되고,
-- "이전 스냅샷을 단순 삭제"하는 일이 생기지 않는다.
--
-- 특정 기간의 "현재" 마감 상태는 (period_year, period_month) 중 version이 가장 큰 행의
-- status로 판단한다(그 기간에 행이 하나도 없으면 = 한 번도 마감한 적 없음 = open).
-- 순수 판단 로직은 lib/attendance/closureLifecycle.ts의 currentClosureStatus()/nextClosureVersion() 참고.
--
-- period_year/period_month은 lib/overtime/summary.ts의 payPeriodDays 규약과 다르게
-- "사람이 읽는 1~12월 라벨"로 저장한다(그 함수의 month 매개변수는 0-indexed라 DB 컬럼으로
-- 그대로 쓰면 헷갈린다 — 변환은 lib/attendance/period.ts에서만 담당).
-- 예: period_year=2026, period_month=8 → 2026-07-21~2026-08-20("8월분").
create table if not exists attendance_month_closures (
  id uuid primary key default gen_random_uuid(),
  period_year integer not null,
  period_month integer not null check (period_month between 1 and 12),
  version integer not null default 1, -- 같은 기간의 몇 번째 마감 시도인지(1부터, 재마감마다 +1)
  status text not null default 'closed' check (status in ('closed', 'reopened')),
  closed_by text not null,
  closed_at timestamptz not null default now(),
  reopened_by text,
  reopened_at timestamptz,
  reopen_reason text, -- 마감취소 사유 — 애플리케이션에서 필수 입력 강제
  created_at timestamptz default now(),
  unique (period_year, period_month, version)
);

-- "이 기간의 최신 버전"을 빠르게 찾기 위한 인덱스(version desc로 정렬해 LIMIT 1 조회에 최적)
create index if not exists idx_attendance_month_closures_period
  on attendance_month_closures (period_year, period_month, version desc);

-- ── 3. 출근기록 (핵심 테이블, 운영 원본) ──────────────────────────────────
create table if not exists attendance_records (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete restrict,
  engineer_id uuid not null references engineer_contacts(id) on delete restrict,
  participant_id uuid not null references project_participants(id) on delete restrict,
  work_date date not null,
  -- 이번 1차 구현은 출근 여부만 필요(사용자 확정 #7) — 'present'만 허용하는 체크 제약으로 시작하고,
  -- 향후 absent/leave/business_trip/excluded 등이 필요해지면 이 CHECK만 넓히는 마이그레이션을 추가한다.
  -- (레코드 존재 자체가 "출근"을 의미하므로 미출근 날짜는 행을 만들지 않는다 — 체크 해제 = DELETE)
  status text not null default 'present' check (status in ('present')),
  created_by text not null default '', -- 입력자 이메일 (allowed_users.email과 동일 개념)
  updated_by text not null default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  note text not null default ''        -- 수정사유 (마감 후 예외 수정 시 필수 입력은 애플리케이션에서 강제)
  -- 재검토 반영(사용자 검토 지시 #2): closure_id 컬럼을 두지 않는다. 이유 —
  --   이 컬럼을 두면 마감취소→재마감이 반복될 때마다 그 기간에 속한 모든 attendance_records의
  --   closure_id를 새 버전의 id로 다시 써야 하고, 그 갱신을 누락하면 "이 기록이 잠겨 있는지"
  --   판정이 옛 버전을 가리킨 채로 틀어질 위험이 있다(사용자가 지적한 "덮어쓰기·이력손실" 위험).
  --   대신 work_date만으로 항상 정확히 판단할 수 있다: work_date → 회계기간 라벨 역산
  --   (lib/attendance/closureLifecycle.ts의 periodLabelForDate) → attendance_month_closures에서
  --   그 라벨의 최신 버전 상태 조회. attendance_records는 attendance_month_closures를 전혀
  --   몰라도 되므로, 이 테이블은 순수하게 "운영 원본"으로만 남는다.
);

-- 동일 프로젝트·기술인·날짜 중복 방지
create unique index if not exists attendance_records_unique
  on attendance_records (project_id, engineer_id, work_date);

create index if not exists idx_attendance_records_engineer_date
  on attendance_records (engineer_id, work_date);
create index if not exists idx_attendance_records_project_date
  on attendance_records (project_id, work_date);
create index if not exists idx_attendance_records_date
  on attendance_records (work_date);

-- ── 4. 마감 스냅샷 (마감 버전별 고정본) ────────────────────────────────────
-- 마감 버튼을 누르는 순간 그리드 한 줄 한 줄을 통째로 얼려서 저장한다. closure_id가
-- attendance_month_closures의 "버전별" id를 가리키므로, 재마감으로 새 버전이 생겨도
-- 이전 버전의 스냅샷 행은 그대로 남는다(위 2번 섹션 참고 — 절대 덮어쓰거나 지우지 않음).
-- 연간 통합 명부는 각 기간의 "현재 유효 버전" 스냅샷들을 이어붙이기만 하면 되므로,
-- Project List가 나중에 바뀌어도 이미 마감된 과거 출력물은 절대 흔들리지 않는다.
create table if not exists attendance_closure_snapshot_rows (
  id uuid primary key default gen_random_uuid(),
  closure_id uuid not null references attendance_month_closures(id) on delete cascade,
  project_id uuid not null references projects(id) on delete restrict,
  project_name_snapshot text not null,
  participant_id uuid not null references project_participants(id) on delete restrict,
  engineer_id uuid not null references engineer_contacts(id) on delete restrict,
  name_snapshot text not null,
  role_snapshot text not null default '',
  specialty_snapshot text not null default '',
  is_director_snapshot boolean not null default false,
  sort_order integer not null default 0,
  attendance_dates date[] not null default '{}', -- 그 기간 중 출근 처리된 날짜 배열(마감 시점 복사본)
  present_count integer not null default 0,      -- 출근일수 캐시 — 반드시 attendance_dates 길이와 일치(아래 CHECK)
  note_snapshot text not null default '',
  -- 재검토 반영(사용자 검토 지시 #5): present_count는 항상 attendance_dates 배열 길이와 같아야 한다.
  -- "attendance_dates가 그 마감기간 범위 안의 날짜인지"는 검증하지 않는다 — 회계기간(21일~20일)
  -- 규칙이 JS(lib/overtime/summary.ts, lib/attendance/period.ts)에만 있는 단일 진실 소스이고,
  -- Postgres CHECK 제약은 subquery를 쓸 수 없어 그 규칙을 SQL에 재구현해야 하는데 그러면 로직이
  -- 두 곳에 존재하게 된다(마스터 프롬프트가 경고하는 중복). 대신 생성 함수
  -- lib/attendance/snapshotBuilder.ts의 buildAttendanceDatesForSnapshot()가 "기간 밖 날짜가 있으면
  -- 예외를 던진다"로 애플리케이션 레이어에서 강제하고, 테스트로 검증한다.
  check (present_count = cardinality(attendance_dates))
);

create index if not exists idx_attendance_closure_snapshot_rows_closure
  on attendance_closure_snapshot_rows (closure_id);
-- 같은 마감 버전에 같은 참여자(participant_id)의 스냅샷 행이 중복 생성되지 않도록.
-- 단장 교체처럼 같은 프로젝트에 참여자가 여러 명(각각 다른 participant_id)이면 이 제약과
-- 무관하게 여러 행이 정상 생성된다 — docs/attendance/03-data-model.md §4 검증 참고.
create unique index if not exists attendance_closure_snapshot_rows_unique
  on attendance_closure_snapshot_rows (closure_id, participant_id);

-- 재검토 반영(사용자 검토 지시 #5): attendance_dates 배열에 중복 날짜가 없는지 DB 레벨로도 강제.
-- "기간 내 날짜인지"와 달리 이 검사는 회계기간 규칙에 의존하지 않는 순수 배열 무결성이라
-- (subquery 없이) 트리거로 안전하게 강제할 수 있다.
create or replace function attendance_closure_snapshot_rows_no_dup_dates()
returns trigger as $$
begin
  if (select count(*) from unnest(new.attendance_dates) d) <>
     (select count(distinct d) from unnest(new.attendance_dates) d) then
    raise exception 'attendance_dates에 중복된 날짜가 있습니다: %', new.attendance_dates;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_attendance_closure_snapshot_rows_no_dup_dates on attendance_closure_snapshot_rows;
create trigger trg_attendance_closure_snapshot_rows_no_dup_dates
  before insert or update on attendance_closure_snapshot_rows
  for each row execute function attendance_closure_snapshot_rows_no_dup_dates();

-- ── 5. 프로젝트 변경이력 ─────────────────────────────────────────────────
-- Project List에는 이런 이력 테이블이 없다(01-current-analysis.md §6) — 신규 생성.
-- 재공고/변경공고/공고취소 여부는 이 테이블이 공식 원본이다(사용자 확정 #2).
-- 출퇴근부는 이 테이블을 연계해서 읽기만 한다(중복 관리하지 않음).
create table if not exists project_change_history (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete restrict,
  change_type text not null check (change_type in (
    'director_change', 'participant_change', 'cancelled', 'reannounced', 'amended',
    'announce_date_change', 'interview_date_change', 'field_change', 'other'
  )),
  change_date date not null, -- 발생일자 — 출력 시 날짜순 정렬·기간 필터링 기준
  before_value text,
  after_value text,
  memo text not null default '',
  created_by text not null default '',
  created_at timestamptz default now()
);

create index if not exists idx_project_change_history_project_date
  on project_change_history (project_id, change_date);

-- ── 6. 감사이력 ────────────────────────────────────────────────────────
-- 마감취소·과거기록수정·기간외 출근입력에 대한 범용 감사 로그.
-- 특정 테이블에 종속시키지 않는 이유: 감사 대상 액션이 여러 테이블에 걸쳐 있고
-- "누가·무엇을·왜"를 남기는 목적이 테이블마다 갈라질 필요가 없기 때문.
create table if not exists attendance_audit_log (
  id uuid primary key default gen_random_uuid(),
  action_type text not null check (action_type in (
    'closure_reopen', 'past_record_edit', 'out_of_period_check', 'other'
  )),
  table_name text not null,
  record_id uuid,
  actor text not null default '',
  reason text not null default '',
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_attendance_audit_log_actiontype on attendance_audit_log (action_type);

-- ── 7. 월 마감 권한 (사용자 확정 #6) ───────────────────────────────────
-- 기존 menu_permissions(none/read/write 3단계)에는 "마감"처럼 쓰기 권한과 분리된
-- 개별 액션 권한 개념이 없다(01-current-analysis.md §6). 이 기능 전용 권한 컬럼을 신설한다.
-- 마감 취소도 이 권한으로 통제한다(사용자 지시: "마감취소는 can_close_attendance 권한이
-- 있는 사용자만 가능"). ADMIN_EMAILS 관리자는 기존 관례대로 이 컬럼과 무관하게 항상 가능.
alter table allowed_users
  add column if not exists can_close_attendance boolean not null default false;

-- ── RLS: 다른 테이블들과 동일 — 실제 접근 제어는 layout + 항목별 권한(menu_permissions) ──
alter table project_participants enable row level security;
alter table attendance_month_closures enable row level security;
alter table attendance_records enable row level security;
alter table attendance_closure_snapshot_rows enable row level security;
alter table project_change_history enable row level security;
alter table attendance_audit_log enable row level security;

create policy "authenticated_full_access" on project_participants
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated_full_access" on attendance_month_closures
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated_full_access" on attendance_records
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated_full_access" on attendance_closure_snapshot_rows
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated_full_access" on project_change_history
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated_full_access" on attendance_audit_log
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
