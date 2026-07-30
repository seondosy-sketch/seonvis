-- 미래사업팀 Hub → Google Calendar 단방향 연동 (docs/google-calendar/README.md)
--
-- Hub가 원본이고 Google Calendar는 사본이다. Google에서 직접 수정한 내용은 가져오지 않으며,
-- Hub에서 다시 저장하면 Hub 값으로 덮어쓴다. 양방향 동기화·webhook은 구현하지 않는다.
--
-- ── 인증 방식: 서비스 계정 (refresh token을 DB에 저장하지 않는다) ──
-- GCP 서비스 계정(seonvis-calendar@seonvis-hub.iam.gserviceaccount.com)에 `미래사업팀` 캘린더를
-- 공유해 두고, 서버가 개인키(Vercel 환경변수 GOOGLE_SA_PRIVATE_KEY)로 JWT를 서명해 액세스 토큰을
-- 받아 쓴다. 그래서 이 스키마에는 **토큰을 저장하는 컬럼이 없다** — 유출 대상 자체를 만들지 않는
-- 것이 목적이다. (관리자 개인 계정 OAuth 방식으로 바꿀 경우를 대비해 auth_mode만 남겨둔다.)
--
-- 두 테이블 모두 RLS를 켜고 정책을 만들지 않는다 = anon/authenticated 전부 거부.
-- 읽기·쓰기는 service role(lib/supabase-admin.ts)로만 하고, 관리자 화면도 서버 API를 경유한다.
-- widget_tokens와 같은 관례다. (Supabase 보안 어드바이저의 rls_enabled_no_policy INFO는 의도된 상태)

-- ────────────────────────────────────────────────────────────────────────────
-- 1) 연결 정보 — 팀 전체가 하나의 캘린더를 쓰므로 행이 하나만 존재하게 강제한다.
--    id를 boolean + check(id)로 두면 true 한 행만 들어갈 수 있다.
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists google_calendar_connection (
  id boolean primary key default true check (id),

  auth_mode text not null default 'service_account'
    check (auth_mode in ('service_account', 'oauth')),

  -- service_account 모드: 서비스 계정 이메일. oauth 모드: 연결한 Google 계정.
  google_account_email text,

  -- 대상 캘린더 — 새로 만들지 않고, 관리자가 목록에서 고른 기존 캘린더의 정확한 ID를 저장한다.
  calendar_id text,
  -- 선택 시점의 캘린더 이름 스냅샷(표시용). Google에서 이름이 바뀌어도 여기 값은 그대로 남는다.
  calendar_summary text,
  calendar_time_zone text,

  -- colors.get 응답에서 해석한 {행위: colorId} 매핑. 색상 ID를 하드코딩하지 않고 연결 시점에
  -- 조회·매칭한 결과를 남겨 무엇이 어떤 ID로 잡혔는지 화면에서 확인할 수 있게 한다.
  color_map jsonb not null default '{}'::jsonb,

  status text not null default 'disconnected'
    check (status in ('connected', 'disconnected', 'error')),
  last_ok_at timestamptz,          -- 마지막으로 Google 호출이 성공한 시각
  last_synced_at timestamptz,      -- 마지막 동기화 실행 시각
  last_error text,

  connected_by_email text,         -- 연결을 수행한 관리자
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table google_calendar_connection enable row level security;

-- ────────────────────────────────────────────────────────────────────────────
-- 2) 일정 연결 — Hub 일정 1건 ↔ Google 이벤트 1건
--
-- Hub는 일정 테이블이 따로 없고 프로젝트 행에 날짜 컬럼이 여러 개 있는 구조다
-- (projects.announce_date/submit_date/interview_date/bid_date +
--  project_tooltips.pq_date/soq_date/notify_date). 그래서 안정적인 키를
-- **(projects.id, 행위)** 조합으로 만든다. project_number는 사용자가 편집할 수 있어 키로 쓰지 않는다.
--
-- projects.id에 FK를 걸지 않는다 — 프로젝트가 삭제돼도 "지워야 할 Google 이벤트 ID"를 알아야
-- 하므로 이 행이 살아남아야 한다. 남은 고아 행은 동기화가 감지해 이벤트를 삭제한 뒤 정리한다.
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists project_calendar_events (
  project_id uuid not null,
  action text not null check (action in ('announce', 'pq', 'soq', 'submit', 'interview', 'bid', 'notify')),

  calendar_id text not null,
  google_event_id text,

  event_date date,                 -- 동기화된 날짜 (종일 일정)
  title text,                      -- 동기화된 제목 '[정제된 프로젝트명] 행위명'
  -- Hub 데이터 지문 — 날짜·제목·색이 바뀌었는지 판단해 불필요한 Google 호출을 막는다.
  fingerprint text,

  sync_state text not null default 'synced' check (sync_state in ('synced', 'failed')),
  retry_count integer not null default 0,
  last_synced_at timestamptz,
  last_error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (project_id, action)
);

alter table project_calendar_events enable row level security;

-- 실패 건만 골라 재시도할 때 쓴다.
create index if not exists project_calendar_events_state_idx
  on project_calendar_events (sync_state);

-- 같은 Google 이벤트를 두 행이 물지 못하게 막는다(중복 생성 방지의 마지막 안전장치).
create unique index if not exists project_calendar_events_event_uniq
  on project_calendar_events (calendar_id, google_event_id)
  where google_event_id is not null;
