-- 현장 현황 — 스키마 (docs/site-status/04-data-model.md). 개인정보 없음 — 시드는 별도 로컬 처리.
-- 월별 배치/스냅샷 테이블은 만들지 않는다 — 현재 현장 기본정보 단일 대장.

create table if not exists sites (
  id uuid primary key default gen_random_uuid(),
  -- 사람 친화적 고유번호 — 향후 Excel 내보내기/재가져오기의 1순위 동일 현장 매칭 키
  site_code integer generated always as identity unique,
  original_site_name text not null default '', -- 엑셀 원본 (줄바꿈 포함) — 동기화 매칭용 보존
  site_name text not null,                       -- 정규화 표시명 (줄바꿈→공백)
  source_category text not null check (source_category in ('건진법','주택법','건축법','전통소')),
  legal_category text not null check (legal_category in ('건설기술진흥법','주택법','건축법','분리발주(전기·통신·소방)')),
  manager_name text not null default '',
  contractor text not null default '',
  site_phone_raw text not null default '',   -- 원본 연락처 텍스트 그대로 (정보 손실 없음)
  site_landline text not null default '',    -- 추출된 유선전화 (여러 개면 "; " 연결)
  manager_mobile text not null default '',   -- 추출된 책임자 핸드폰 (원본 괄호 안 첫 010 — 추정치)
  phone_uncertain boolean not null default false, -- 번호가 여럿/모호해 자동추출 확신 불가
  site_address text not null default '',
  office_address text not null default '',
  region text not null default '',
  start_date date,
  planned_completion_date date,
  manual_status text check (manual_status in ('착수 전','진행 중','준공 임박','준공 완료','중지')), -- null = 자동 계산
  memo text not null default '',
  is_favorite boolean not null default false,
  active boolean not null default true, -- false = 비활성(소프트 삭제). deleted_at 컬럼 없음 (완전 삭제 MVP 미제공)
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_sites_name on sites (site_name);
create index if not exists idx_sites_source_category on sites (source_category);
create index if not exists idx_sites_region on sites (region);
create index if not exists idx_sites_active on sites (active);

-- 향후 엑셀 동기화 실행 이력 (MVP 미사용 — 구조 예약, engineer_sync_logs와 동일 패턴)
create table if not exists site_sync_logs (
  id uuid primary key default gen_random_uuid(),
  executed_at timestamptz default now(),
  file_name text not null default '',
  added_count integer not null default 0,
  updated_count integer not null default 0,
  deactivated_count integer not null default 0,
  error_count integer not null default 0,
  note text not null default ''
);

alter table sites enable row level security;
alter table site_sync_logs enable row level security;

create policy "authenticated_full_access" on sites
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated_full_access" on site_sync_logs
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- 89건 초기 데이터는 구현 시점 1회성 로컬 스크립트가 Project Portfolio.xlsx를 직접 읽어
-- Supabase REST로 삽입한다 (개인정보라 SQL로 커밋하지 않음 — docs/site-status/05-import-and-sync.md)
