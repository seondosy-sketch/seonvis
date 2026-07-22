-- 기술인 출근부 — Project List 자동연계 링크 테이블 (Phase 3)
--
-- 배경: Project List(projects)의 director/staff_arch/staff_civil/staff_mech/staff_safety
-- 5개 텍스트 슬롯을 기술인 주소록(engineer_contacts)과 연결해 참여기술인(project_participants)을
-- 자동 구성하려 한다. 다만 project_participants.engineer_id는 NOT NULL이라 "아직 확정되지 않은
-- 연결 후보"를 그 테이블에 둘 수 없다(사용자 지시: project_participants는 확정된 참여기술인만
-- 저장하는 테이블로 유지). 그래서 이 별도 테이블이 "Project List 슬롯 ↔ 확정된 참여행"의
-- 연결 상태만 추적한다 — project_participants·attendance_records의 기존 컬럼·FK·유니크
-- 인덱스·RPC는 전혀 건드리지 않는다.
--
-- 확정 전(아직 이 테이블에 행이 없는) 슬롯의 상태(동명이인/주소록미등록/신규연결예정)는 이 테이블에
-- 저장하지 않는다 — projects의 현재 텍스트 + engineer_contacts를 매번 다시 비교해 순수 계산한다
-- (lib/attendance/engineerLink.ts). 화면 조회만으로 DB 쓰기가 발생하지 않게 하기 위함(사용자 지시 #10).
-- 그래서 이 테이블에는 "한 번이라도 확정(자동연결 반영 또는 사용자 수동 선택)된 슬롯"만 행으로 존재한다.
--
-- 이름 변경 감지(사용자 지시 #1): source_name_snapshot은 "마지막으로 사용자가 이 연결을 확정(또는
-- 재확인)했을 때의 Project List 슬롯 텍스트"로 정의한다. 조회·동기화 미리보기 과정에서는 절대
-- 덮어쓰지 않는다 — 오직 확정 액션(attendance_confirm_participant_link, attendance_reassign_engineer,
-- 또는 향후 추가될 "유지 확인" 액션)에서만 갱신한다. 현재 Project List 텍스트는 매번 실시간으로
-- 읽어 이 snapshot과 비교하고, 다르면 "원본변경" 상태를 화면에 표시한다(자동 재매핑은 절대 하지 않음).
--
-- link_status는 "확정된 연결이 자동 매칭이었는지 사용자가 직접 선택했는지"만 기록한다(사용자 지시 #2
-- "자동 연결했다는 상태가 사용자에게 구분되어야" 반영). 원본변경/제거됨/확인필요/동명이인/주소록미등록은
-- 이 컬럼에 저장하지 않고 화면에서 순수 계산으로만 표시한다(participant_id가 있는데 현재 이름이
-- snapshot과 다르면 원본변경, 현재 슬롯 텍스트가 비어있으면 제거됨 — lib/attendance/engineerLink.ts 참고).
create table if not exists project_participant_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  source_slot text not null check (source_slot in
    ('director', 'staff_arch', 'staff_civil', 'staff_mech', 'staff_safety')),
  source_name_snapshot text not null default '',
  engineer_id uuid not null references engineer_contacts(id) on delete restrict,
  participant_id uuid references project_participants(id) on delete set null,
  -- 확정 방식만 기록(자동 1명일치 vs 사용자 직접 선택) — 나머지 표시 상태는 위 주석 참고, 순수 계산.
  link_status text not null default '자동연결' check (link_status in ('자동연결', '연결완료')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 프로젝트 안에서 같은 슬롯(예: staff_arch)은 한 번에 하나의 연결만 가진다.
  unique (project_id, source_slot)
);

-- 사용자 지시 #3: 한 참여행(participant_id)은 동시에 하나의 슬롯에만 연결된다(중복 연결 차단).
-- 현재 요구사항상 한 슬롯=한 참여행, 한 참여행=한 슬롯이 맞다는 사용자 확인에 따름.
-- participant_id가 null인 행(연결이 해제된 뒤 아직 재확정 전)은 이 제약 대상에서 제외한다.
create unique index if not exists project_participant_links_participant_unique
  on project_participant_links (participant_id) where participant_id is not null;

create index if not exists idx_project_participant_links_project on project_participant_links (project_id);
create index if not exists idx_project_participant_links_engineer on project_participant_links (engineer_id);

-- RLS: 기존 attendance 테이블들과 동일한 원칙 — 실제 접근 제어는 layout + menu_permissions('attendance').
alter table project_participant_links enable row level security;

create policy "authenticated_full_access" on project_participant_links
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
