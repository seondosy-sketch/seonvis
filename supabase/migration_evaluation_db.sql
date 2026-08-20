-- 평가 DB (사용자 화면 명칭: "면접 DB") — DB 설계
--
-- 사용자 화면은 "면접 DB / 면접후기 / 질의"라는 업무 용어를 쓰지만(실제 HWP 양식이 "면접후기"다),
-- 저장되는 데이터는 면접만이 아니다. 실제 업무에서 SOQ·TP·종심제 등도 사업에 따라 PT 발표와
-- 기술인 질의응답 평가를 진행하고 그때 실제 질의가 발생한다. 그래서 내부 모델은 면접보다 넓은
-- "평가 수행기록"으로 두고 evaluation_* 로 이름을 붙였다.
--
-- ⚠ 이름 충돌 주의: 기존 `projects.evaluation` 컬럼은 "평가"가 아니라 **낙찰사**를 담는다
-- (app/(dashboard)/projects/page.tsx의 computeStatus에서 evaluation === '선' → 수주 판정).
-- 이 migration이 만드는 evaluation_* 테이블들과는 아무 관계가 없다. 혼동을 막기 위해 여기서는
-- `evaluation`이라는 이름의 단독 컬럼/테이블을 만들지 않는다 — 항상 evaluation_ + 명사 형태다.
--
-- 구성:
--   evaluation_types                 평가유형 마스터(면접/SOQ/TP/종심제/...) — 평가 자체의 분류축
--   evaluation_roles                 질의그룹 마스터(책임/건축/안전/토목/기계/전기 + legacy)
--   evaluation_question_categories   질의분류 마스터(품질/안전/공정/사업관리/...) — 질문 주제 축
--   evaluation_reviews               프로젝트 평가 수행기록 1건 (프로젝트 1 : 기록 N)
--   evaluation_review_attendees      참석자(기술인 주소록 연결 + 스냅샷)
--   evaluation_questions             실제 질의 — 질문 1개 = 1행
--
-- 질문에 걸리는 두 축을 혼동하지 말 것:
--   질의그룹(role_id)     = 누구에게 나온 질문인가 (책임/건축/안전/…)
--   질의분류(category_id) = 질문의 주제가 무엇인가 (품질/공정/사업관리/…)
-- 예) 책임기술인에게 나온 공정 질문 → 질의그룹 '책임' + 질의분류 '공정'
--
-- 참석자는 Project List의 참여기술인(project_participants → engineer_contacts)에서 가져오는 것이
-- 기본 흐름이다. 기술인 master를 새로 만들지 않는다.
--
-- 전문분야는 신규 마스터를 만들지 않고 기존 engineer_specialties(기술인 주소록의 분야 마스터)를
-- 그대로 참조한다 — 같은 개념의 마스터가 두 개면 화면마다 다른 분야 목록을 보여주게 된다.
-- 단 질문의 specialty_id는 legacy 이관 전용이고 신규 입력 화면은 쓰지 않는다(질의그룹이 대체).
--
-- 시설용도(시설구분)는 Project List에 대응 컬럼이 없다(projects.type은 면접/SOQ/PQ 같은 평가유형
-- 성격이고, project_tooltips.area/scale은 대지면적·층수다). 이번 작업에서 Project List 스키마를
-- 개편하지 않기로 했으므로 evaluation_reviews.facility_type에 자체 보관한다.

-- ── 1. 평가유형 마스터 ────────────────────────────────────────────────────────
-- 자유문자열이 아니라 마스터로 둔다. 향후 통계(평가유형별 질문 수, 발주처 × 평가유형,
-- 연도 × 평가유형 등)에서 독립 차원으로 쓰이므로 query 가능한 정식 데이터여야 한다.
create table if not exists evaluation_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,   -- 코드는 화면 표기와 무관한 안정 식별자(통계/이관 규칙에서 참조)
  name text not null unique,   -- 화면에 보이는 이름
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz default now()
);

-- 초기값 선정 기준(업무정책 확정 결과):
-- 이 마스터에는 "실제로 분석할 가치가 있는 평가유형"만 둔다. 기존 '참여용역 질의답변 DB.xlsx'의
-- `평가자료` 컬럼에는 평가제도(면접/SOQ/TP/종심제/적격심사)와 제출자료명(과업수행계획서/
-- 자기소개서/수행계획서/기술자평가서/기술제안서)이 섞여 있는데, 후자는 "어떤 평가였는지"가 아니라
-- "어떤 서류였는지"라서 평가유형 축으로 쓰면 통계가 뒤섞인다. 그래서 마스터에 넣지 않고
-- 표준 유형은 '미지정'으로, 원문은 evaluation_type_source에 보존한다.
--
-- 실측 분포(544행 전수, 행수/질문수):
--   면접 184/903 · SOQ 85/277 · 종심제 55/228 · TP 11/42(+ 'T P' 표기변형 2/17) · 적격심사 10/27
--   면접평가서 9/35 · (마스터 제외) 과업수행계획서 20/94 · 자기소개서 19/63 · 수행계획서 12/40
--   기술자평가서 10/36 · 기술제안서 1/2 · 복합값 6/21 · 빈값 120/308
--
-- '면접평가서'는 명칭상 '면접'과 같을 가능성이 있으나 실제 9행의 내용을 검토하기 전에는 추측으로
-- 통합하지 않는다 — 별도 유형으로 남겨두고 legacy 이관 검수 때 결정한다.
--
-- '미지정'을 정식 행으로 두는 이유: 평가유형을 사실에 근거해 정할 수 없는 자료(빈값, 제출자료명,
-- 복합값)를 임의로 SOQ/TP/면접에 밀어넣지 않고 그대로 저장하기 위함이다. 질문 데이터를 버리지
-- 않으면서도 통계에서 "모르는 것"을 정직하게 분리할 수 있다.
insert into evaluation_types (code, name, sort_order) values
  ('interview',           '면접',        10),
  ('soq',                 'SOQ',         20),
  ('tp',                  'TP',          30),
  ('jongsimje',           '종심제',      40),
  ('qualification',       '적격심사',    50),
  ('interview_eval_sheet','면접평가서',  60),   -- legacy 내용 검토 전까지 별도 유지
  ('other',               '기타',       900),
  ('unspecified',         '미지정',     999)   -- 사실 확인이 안 되는 자료의 안전한 착지점
on conflict (code) do nothing;

-- ── 2. 질의그룹(평가역할) 마스터 ──────────────────────────────────────────────
-- 화면에서는 "질의그룹"이라고 부른다 — 실제질의를 누구에게 나온 질문인지로 묶는 축이다.
-- 테이블 이름을 evaluation_roles로 유지하는 이유: 값 자체가 면접에서 그 사람이 맡은 역할
-- (책임/건축/안전/…)이고, 이미 검증된 구조를 이름만 바꾸려고 건드리지 않는다.
--
-- ⚠ 이 축은 "질문의 주제"가 아니다. 주제는 evaluation_question_categories(질의분류)다.
--    예) 책임기술인에게 나온 공정 질문 → 질의그룹 '책임' + 질의분류 '공정'
--
-- is_primary: 신규 입력 UI의 기본 선택지(사용자 업무용 6종)인지. legacy 수용 전용 값은 false로
-- 두어 신규 작성 화면에는 나타나지 않게 하고, 검색 필터에서는 전부 보인다 —
-- "legacy 수용성"과 "신규 UX"를 한 마스터 안에서 구분하기 위한 플래그다.
create table if not exists evaluation_roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order integer not null default 0,
  is_primary boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz default now()
);
-- 이미 만들어진 환경에서도 컬럼이 생기도록(이 migration은 재실행 가능해야 한다).
alter table evaluation_roles add column if not exists is_primary boolean not null default false;

-- 신규 입력 6종은 사용자가 실제 면접후기를 쓸 때 쓰는 그룹이다(업무 확정).
-- legacy 4종은 기존 Excel 이관 수용 전용:
--   '공통'  — '▷공통질의' 처럼 특정 대상이 없는 질문
--   '타사'  — 역할 머리말이 경쟁사 이름(토펙/신한/이가 등)으로 적힌 질의 그룹 실측 65건.
--             개별 업체명을 마스터로 만들지 않고(업체는 역할이 아니다) 하나로 모은다.
--   '기타'  — 6종에 안 들어가는 명시적 역할
--   '미지정' — 머리말이 없거나 해석이 불가능한 질문(실측 46행). 추측으로 6종에 밀어넣지 않는다.
insert into evaluation_roles (name, sort_order, is_primary) values
  ('책임',   10, true),
  ('건축',   20, true),
  ('안전',   30, true),
  ('토목',   40, true),
  ('기계',   50, true),
  ('전기',   60, true),
  ('공통',  900, false),
  ('타사',  910, false),
  ('기타',  920, false),
  ('미지정', 999, false)
on conflict (name) do nothing;

-- ── 2-1. 질의분류 마스터 ──────────────────────────────────────────────────────
-- 질문의 "주제" 축. 질의그룹(누구에게 나왔나)과 완전히 다른 개념이므로 별도 마스터다.
--
-- 이전 단계에서 free-text `topic` 컬럼을 제거한 이유가 여기서 해소된다 — taxonomy가 업무적으로
-- 확정됐으므로 자유문자열이 아니라 마스터 + FK로 만든다.
--
-- 기존 코드/DB에 같은 개념의 마스터가 있는지 먼저 확인했고 없었다. engineer_specialties에
-- '품질/공정/사업관리' 같은 이름이 있지만 그것은 **기술인의 전문분야**(사람의 축)이고, 여기는
-- **질문의 주제**(질문의 축)라서 재사용하면 두 축이 뒤섞인다. 그래서 신규 마스터를 만든다.
--
-- AI 자동분류는 이번 범위가 아니다 — 값은 사용자가 고르거나 '미지정'으로 남는다.
create table if not exists evaluation_question_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null unique,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz default now()
);

insert into evaluation_question_categories (code, name, sort_order) values
  ('quality',          '품질',        10),
  ('safety',           '안전',        20),
  ('schedule',         '공정',        30),
  ('project_mgmt',     '사업관리',    40),
  ('construction',     '시공',        50),
  ('design',           '설계',        60),
  ('cost',             '원가',        70),
  ('contract_claim',   '계약/클레임', 80),
  ('complaint',        '민원',        90),
  ('law_standard',     '법규/기준',  100),
  ('site_mgmt',        '현장관리',   110),
  ('general_tech',     '기술일반',   120),
  ('other',            '기타',       900),
  ('unspecified',      '미지정',     999)
on conflict (code) do nothing;

-- ── 3. 평가 수행기록 ──────────────────────────────────────────────────────────
-- 프로젝트 1 : 평가 수행기록 N. 한 프로젝트에 SOQ 평가와 TP 평가가 따로 있을 수 있고, 같은
-- 평가유형의 재평가도 있을 수 있으므로 (project_id, evaluation_type_id)에 UNIQUE를 걸지 않는다.
create table if not exists evaluation_reviews (
  id uuid primary key default gen_random_uuid(),

  -- Project List 연계. on delete set null인 이유: 이 테이블은 "과거 평가에서 실제로 나온 질문"을
  -- 모으는 지식자산이라, 프로젝트 행이 지워졌다고 질문까지 사라지면 안 된다. 아래 스냅샷 컬럼들이
  -- 있어서 프로젝트 연결이 끊겨도 기록 자체는 온전히 읽힌다.
  -- (attendance 계열이 쓰는 on delete restrict를 따르지 않은 것은 의도적이다 — 프로젝트 삭제를
  --  막는 참조를 더 늘리지 않기 위함. 정보 손실은 스냅샷으로 막는다.)
  project_id uuid references projects(id) on delete set null,

  -- ── 평가유형: 정규화된 분류축(evaluation_type_id)과 legacy 원문(evaluation_type_source)은
  --    의미가 다르다. 절대 혼동하면 안 되므로 여기 명시한다.
  --
  -- evaluation_type_id  = 미래Hub가 쓰는 **정규화된 평가유형**.
  --                       검색·필터·통계·향후 AI 예상질문 분석의 유일한 공식 분류축이다.
  --                       신규 입력에서는 사용자가 고른 값이 authoritative value다.
  -- evaluation_type_source = 기존 자료에 **실제로 적혀 있던 원문**.
  --                       추적성과 원본 보존 목적이며, **통계의 분류축으로 쓰지 않는다**.
  --
  -- on delete restrict: 핵심 분류축이라 실수로 마스터 행을 지워 기존 기록의 분류가 사라지는 일을
  -- 막는다. 더 이상 쓰지 않는 유형은 삭제가 아니라 is_active = false로 내린다(신규 입력 목록에서만
  -- 빠지고 과거 기록은 그대로 유지된다).
  --
  -- nullable로 남겨두지만 실제 운영에서는 비우지 않는다 — 사실 확인이 안 되는 자료는 null이 아니라
  -- '미지정' 유형 행을 가리키게 한다("모름"의 표현을 한 가지로 유지). 신규 입력 화면은 선택을
  -- 필수로 받고, legacy 이관도 미지정을 쓴다. nullable인 것은 이관 도중의 안전장치일 뿐이다.
  evaluation_type_id uuid references evaluation_types(id) on delete restrict,
  --
  -- 원문 보존 예시(업무정책 확정 내용):
  --   'T P'              → 표준 TP        / source 'T P'        (표기변형만 정규화)
  --   'SOQ'              → 표준 SOQ       / source 'SOQ'
  --   '과업수행계획서'   → 표준 미지정    / source '과업수행계획서'
  --   '기술자평가서/PPT' → 표준 미지정    / source '기술자평가서/PPT'
  --   빈값               → 표준 미지정    / source ''
  -- 신규 입력 화면에는 이 칸을 노출하지 않는다 — 사용자가 추측해 채워야 하는 값을 요구하지 않는다.
  evaluation_type_source text not null default '',

  -- 면접 당시 정보 보존용 스냅샷(lodging_records.project_name_snapshot과 동일 관례).
  -- 프로젝트 정보가 나중에 수정되어도 "그때 그 평가"의 기록은 바뀌지 않아야 한다.
  -- 향후 legacy 이관에서 Project List에 없는 과거 용역도 이 컬럼만으로 등록할 수 있다.
  client_snapshot text not null default '',        -- 발주처
  project_name_snapshot text not null default '',  -- 용역명

  facility_type text not null default '',          -- 시설용도(위 헤더 주석 참고)

  -- ── 평가 시점 ──
  -- evaluation_date: 실제 평가일. 신규 기록은 이 값을 쓴다.
  -- evaluation_year: 연도만 아는 legacy 자료용. 기존 Excel에는 `사업수행 년도`만 있고 월/일이
  --   아예 없다(면접 행 193건 전수 확인). 없는 월/일을 2020-01-01처럼 만들어 넣는 것은 사실을
  --   조작하는 것이라 하지 않는다.
  -- evaluation_year_effective: 둘 중 있는 쪽에서 연도를 뽑는 generated column. 연도 필터·통계는
  --   항상 이 컬럼만 본다 — 조회부가 coalesce를 반복하지 않고, DB가 계산하므로 두 값이 어긋날
  --   여지도 없다(lodging_records.total_price가 이미 같은 방식의 generated column이다).
  evaluation_date date,
  evaluation_year integer,
  evaluation_year_effective integer generated always as (
    coalesce(date_part('year', evaluation_date)::integer, evaluation_year)
  ) stored,

  -- 평가 시각은 date로 담기지 않는 표기가 실제로 쓰인다(HWP 원본: "13:30~"). 기존
  -- project_tooltips.interview_time도 같은 이유로 text다('추후', '5분', '10분/10분') — 그 관례를 따른다.
  evaluation_time text not null default '',
  location text not null default '',

  -- 평가위원(면접관) 수 / 참가업체 수 / 발표·면접 순서.
  evaluator_count integer check (evaluator_count is null or evaluator_count >= 0),
  participant_company_count integer check (participant_company_count is null or participant_company_count >= 0),
  presentation_order integer check (presentation_order is null or presentation_order >= 0),
  -- HWP 원본 "7개 중 1번째 (업체 나열)"의 업체 목록. 개수/순서는 위 두 컬럼에 숫자로 넣고,
  -- 업체명 나열은 자유 텍스트로 둔다(업체 마스터를 새로 만들지 않는다).
  participant_companies text not null default '',

  -- 진행방법: 평가유형(제도)과 다른 개념이다. 유형은 evaluation_type_id, 진행방법은 여기.
  -- 예) 유형 'TP' + 진행방법 'PT 발표 후 책임기술인 및 분야별 기술인 질의응답'.
  -- PT/면접/질의응답을 별도 마스터로 세분화하지 않는다 — 필요해지면 그때 확장한다.
  evaluation_method text not null default '',
  special_notes text not null default '',     -- 특이사항(분위기, 좌석배치 등)

  created_by text not null default '',
  updated_by text not null default '',
  created_at timestamptz not null default now(),
  -- updated_at: DB 트리거 없음. 저장 RPC(save_evaluation_review)가 매번 명시적으로 세팅한다
  -- (projects/trip/lodging과 동일 관례).
  updated_at timestamptz not null default now(),

  -- legacy 연도의 상식적 범위
  check (evaluation_year is null or evaluation_year between 1900 and 2200),
  -- 실제 날짜와 legacy 연도를 둘 다 넣었다면 연도가 일치해야 한다(모순 저장 차단)
  check (
    evaluation_date is null or evaluation_year is null
    or date_part('year', evaluation_date)::integer = evaluation_year
  )
);

create index if not exists idx_eval_reviews_project on evaluation_reviews (project_id);
create index if not exists idx_eval_reviews_type on evaluation_reviews (evaluation_type_id);
create index if not exists idx_eval_reviews_date on evaluation_reviews (evaluation_date desc);
create index if not exists idx_eval_reviews_year on evaluation_reviews (evaluation_year_effective desc);
create index if not exists idx_eval_reviews_client on evaluation_reviews (client_snapshot);
create index if not exists idx_eval_reviews_facility on evaluation_reviews (facility_type);

-- ── 4. 참석자 ─────────────────────────────────────────────────────────────────
-- 참석자를 textarea 한 칸에 몰아넣지 않고 행으로 쪼갠다. 다만 별도의 참석자 관리 시스템을 만들지는
-- 않는다 — 기술인 주소록에 있으면 FK로 연결하고, 없으면(내부 수행직원 등) 이름만 남긴다.
-- 그래서 engineer_contact_id는 nullable이고 이름 스냅샷은 not null이다.
create table if not exists evaluation_review_attendees (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references evaluation_reviews(id) on delete cascade,
  engineer_contact_id uuid references engineer_contacts(id) on delete set null,
  attendee_name_snapshot text not null,
  attendee_role text not null default '',  -- 단장/안전/수행 등 후기에 적힌 그대로
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  check (length(btrim(attendee_name_snapshot)) > 0)
);

create index if not exists idx_eval_attendees_review on evaluation_review_attendees (review_id);
create index if not exists idx_eval_attendees_engineer on evaluation_review_attendees (engineer_contact_id);

-- ── 5. 실제 질의 ──────────────────────────────────────────────────────────────
-- 질문 1개 = 1행. 발주처/용역명/시설용도/평가일/평가유형은 여기 복제하지 않고 review를 조인해서
-- 읽는다(정규화 우선). project_id도 두지 않는다 — review_id로 항상 도출되므로 중복 저장하면
-- 두 값이 어긋날 경로만 생긴다.
create table if not exists evaluation_questions (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references evaluation_reviews(id) on delete cascade,

  question_text text not null,

  -- 질의그룹(누구에게 나온 질문인가) — 신규 입력에서 사용자가 고르는 축. nullable이지만 실제로는
  -- 비우지 않고 '미지정' 행을 가리킨다(모름의 표현을 하나로 유지 — evaluation_type_id와 같은 정책).
  role_id uuid references evaluation_roles(id) on delete set null,

  -- 질의분류(질문의 주제) — 위 role_id와 완전히 다른 축이다. 혼동 금지.
  -- on delete restrict: 분류축을 실수로 지워 기존 질문의 분류가 사라지는 것을 막는다.
  -- 정리는 삭제가 아니라 is_active = false로 한다(evaluation_types와 동일 정책).
  category_id uuid references evaluation_question_categories(id) on delete restrict,

  -- 전문분야 — **legacy 수용 전용**. 신규 입력 화면은 이 값을 쓰지 않는다(질의그룹이 분야 의미를
  -- 이미 담고 있어 사용자에게 중복 선택을 요구하지 않는다). 기존 Excel에 역할 머리말은 없고
  -- 분야만 있는 질문이 실제로 있어(실측 46행) 이관 때 쓸 자리로 남겨둔다.
  specialty_id uuid references engineer_specialties(id) on delete set null,

  -- 입력 화면의 질의그룹 순서와 그룹 내 질문 순서. 화면에 보이는 순서를 그대로 되살리기 위해
  -- 둘을 나눠 저장한다.
  group_order integer not null default 0,
  question_order integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- 빈 질문 방지 — 공백만 있는 질문은 저장 자체가 안 된다.
  check (length(btrim(question_text)) > 0)
);

create index if not exists idx_eval_questions_review on evaluation_questions (review_id, group_order, question_order);
create index if not exists idx_eval_questions_specialty on evaluation_questions (specialty_id);
create index if not exists idx_eval_questions_role on evaluation_questions (role_id);
create index if not exists idx_eval_questions_category on evaluation_questions (category_id);

-- 질문주제는 free-text `topic` 컬럼이 아니라 위 category_id(evaluation_question_categories FK)로
-- 관리한다 — taxonomy가 업무적으로 확정됐기 때문이다. 자유문자열 topic 컬럼은 두지 않는다.

-- ── 6. RLS ────────────────────────────────────────────────────────────────────
-- lodging과 같은 방식으로 menu_permissions.interview_db(none/read/write)를 DB 단에서 강제한다
-- (private.menu_permission 정의: supabase/migration_menu_permission_function.sql).
-- 권한 키는 사용자 화면 메뉴(면접 DB)를 따라 'interview_db'를 그대로 쓴다 — 내부 테이블 이름이
-- evaluation_* 로 바뀌어도 사용자가 관리자 화면에서 보는 항목은 "면접 DB" 하나다.
-- 마스터는 다른 마스터들과 마찬가지로 인증 사용자면 조회 가능하되, 쓰기는 쓰기 권한자로 제한한다.
alter table evaluation_types enable row level security;
alter table evaluation_roles enable row level security;
alter table evaluation_question_categories enable row level security;
alter table evaluation_reviews enable row level security;
alter table evaluation_review_attendees enable row level security;
alter table evaluation_questions enable row level security;

drop policy if exists "eval_types_select" on evaluation_types;
drop policy if exists "eval_types_insert" on evaluation_types;
drop policy if exists "eval_types_update" on evaluation_types;
drop policy if exists "eval_types_delete" on evaluation_types;
create policy "eval_types_select" on evaluation_types
  for select using (auth.role() = 'authenticated');
create policy "eval_types_insert" on evaluation_types
  for insert with check (private.menu_permission('interview_db') = 'write');
create policy "eval_types_update" on evaluation_types
  for update using (private.menu_permission('interview_db') = 'write') with check (private.menu_permission('interview_db') = 'write');
create policy "eval_types_delete" on evaluation_types
  for delete using (private.menu_permission('interview_db') = 'write');

drop policy if exists "eval_roles_select" on evaluation_roles;
drop policy if exists "eval_roles_insert" on evaluation_roles;
drop policy if exists "eval_roles_update" on evaluation_roles;
drop policy if exists "eval_roles_delete" on evaluation_roles;
create policy "eval_roles_select" on evaluation_roles
  for select using (auth.role() = 'authenticated');
create policy "eval_roles_insert" on evaluation_roles
  for insert with check (private.menu_permission('interview_db') = 'write');
create policy "eval_roles_update" on evaluation_roles
  for update using (private.menu_permission('interview_db') = 'write') with check (private.menu_permission('interview_db') = 'write');
create policy "eval_roles_delete" on evaluation_roles
  for delete using (private.menu_permission('interview_db') = 'write');

drop policy if exists "eval_categories_select" on evaluation_question_categories;
drop policy if exists "eval_categories_insert" on evaluation_question_categories;
drop policy if exists "eval_categories_update" on evaluation_question_categories;
drop policy if exists "eval_categories_delete" on evaluation_question_categories;
create policy "eval_categories_select" on evaluation_question_categories
  for select using (auth.role() = 'authenticated');
create policy "eval_categories_insert" on evaluation_question_categories
  for insert with check (private.menu_permission('interview_db') = 'write');
create policy "eval_categories_update" on evaluation_question_categories
  for update using (private.menu_permission('interview_db') = 'write') with check (private.menu_permission('interview_db') = 'write');
create policy "eval_categories_delete" on evaluation_question_categories
  for delete using (private.menu_permission('interview_db') = 'write');

drop policy if exists "eval_reviews_select" on evaluation_reviews;
drop policy if exists "eval_reviews_insert" on evaluation_reviews;
drop policy if exists "eval_reviews_update" on evaluation_reviews;
drop policy if exists "eval_reviews_delete" on evaluation_reviews;
create policy "eval_reviews_select" on evaluation_reviews
  for select using (private.menu_permission('interview_db') <> 'none');
create policy "eval_reviews_insert" on evaluation_reviews
  for insert with check (private.menu_permission('interview_db') = 'write');
create policy "eval_reviews_update" on evaluation_reviews
  for update using (private.menu_permission('interview_db') = 'write') with check (private.menu_permission('interview_db') = 'write');
create policy "eval_reviews_delete" on evaluation_reviews
  for delete using (private.menu_permission('interview_db') = 'write');

drop policy if exists "eval_attendees_select" on evaluation_review_attendees;
drop policy if exists "eval_attendees_insert" on evaluation_review_attendees;
drop policy if exists "eval_attendees_update" on evaluation_review_attendees;
drop policy if exists "eval_attendees_delete" on evaluation_review_attendees;
create policy "eval_attendees_select" on evaluation_review_attendees
  for select using (private.menu_permission('interview_db') <> 'none');
create policy "eval_attendees_insert" on evaluation_review_attendees
  for insert with check (private.menu_permission('interview_db') = 'write');
create policy "eval_attendees_update" on evaluation_review_attendees
  for update using (private.menu_permission('interview_db') = 'write') with check (private.menu_permission('interview_db') = 'write');
create policy "eval_attendees_delete" on evaluation_review_attendees
  for delete using (private.menu_permission('interview_db') = 'write');

drop policy if exists "eval_questions_select" on evaluation_questions;
drop policy if exists "eval_questions_insert" on evaluation_questions;
drop policy if exists "eval_questions_update" on evaluation_questions;
drop policy if exists "eval_questions_delete" on evaluation_questions;
create policy "eval_questions_select" on evaluation_questions
  for select using (private.menu_permission('interview_db') <> 'none');
create policy "eval_questions_insert" on evaluation_questions
  for insert with check (private.menu_permission('interview_db') = 'write');
create policy "eval_questions_update" on evaluation_questions
  for update using (private.menu_permission('interview_db') = 'write') with check (private.menu_permission('interview_db') = 'write');
create policy "eval_questions_delete" on evaluation_questions
  for delete using (private.menu_permission('interview_db') = 'write');

-- ── 7. 저장 RPC ───────────────────────────────────────────────────────────────
-- 평가 수행기록 + 참석자 + 질문을 한 트랜잭션으로 저장한다. supabase-js는 여러 문장을 한
-- 트랜잭션으로 묶을 수 없어서, "기록은 저장됐는데 질문 일부만 들어간" 반쪼가리 상태를 막으려면
-- RPC가 필요하다(attendance_confirm_participant_link와 같은 이유·같은 패턴).
--
-- 자식(참석자/질문)은 지우고 다시 넣는 replace 방식이다. 질문은 화면에서 자유롭게 추가·삭제·순서
-- 변경되므로 행 단위 diff보다 단순하고, 한 트랜잭션 안이라 중간 상태가 외부에 보이지 않는다.
-- (질문 id를 외부에서 영구 참조하는 기능은 아직 없다 — 생기면 그때 diff 방식으로 바꾼다.)
--
-- security invoker: 함수 본문이 호출자 권한으로 실행되므로 위 RLS 정책이 그대로 적용된다
-- (읽기 권한자가 RPC를 우회해 쓰기를 하는 경로를 만들지 않는다).
--
-- set search_path = public: 호출자가 search_path를 바꿔 다른 스키마의 동명 테이블을 가리키게
-- 하는 경로를 없앤다. 저장소의 기존 RPC(attendance_*)와 Supabase security advisor
-- (function_search_path_mutable)의 요구를 함께 만족시킨다.
create or replace function save_evaluation_review(
  p_review_id uuid,        -- null이면 신규 등록
  p_review jsonb,          -- evaluation_reviews 컬럼들
  p_attendees jsonb,       -- [{engineer_contact_id, attendee_name_snapshot, attendee_role}]
  p_questions jsonb,       -- [{question_text, role_id, category_id, group_order, question_order}]
  p_actor text
)
returns evaluation_reviews
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_review evaluation_reviews;
  v_now timestamptz := now();
begin
  if p_review_id is null then
    insert into evaluation_reviews (
      project_id, evaluation_type_id, evaluation_type_source,
      client_snapshot, project_name_snapshot, facility_type,
      evaluation_date, evaluation_year, evaluation_time, location,
      evaluator_count, participant_company_count, presentation_order, participant_companies,
      evaluation_method, special_notes,
      created_by, updated_by, created_at, updated_at
    ) values (
      nullif(p_review->>'project_id', '')::uuid,
      nullif(p_review->>'evaluation_type_id', '')::uuid,
      coalesce(p_review->>'evaluation_type_source', ''),
      coalesce(p_review->>'client_snapshot', ''),
      coalesce(p_review->>'project_name_snapshot', ''),
      coalesce(p_review->>'facility_type', ''),
      nullif(p_review->>'evaluation_date', '')::date,
      nullif(p_review->>'evaluation_year', '')::integer,
      coalesce(p_review->>'evaluation_time', ''),
      coalesce(p_review->>'location', ''),
      nullif(p_review->>'evaluator_count', '')::integer,
      nullif(p_review->>'participant_company_count', '')::integer,
      nullif(p_review->>'presentation_order', '')::integer,
      coalesce(p_review->>'participant_companies', ''),
      coalesce(p_review->>'evaluation_method', ''),
      coalesce(p_review->>'special_notes', ''),
      coalesce(p_actor, ''), coalesce(p_actor, ''), v_now, v_now
    )
    returning * into v_review;
  else
    update evaluation_reviews set
      project_id = nullif(p_review->>'project_id', '')::uuid,
      evaluation_type_id = nullif(p_review->>'evaluation_type_id', '')::uuid,
      evaluation_type_source = coalesce(p_review->>'evaluation_type_source', ''),
      client_snapshot = coalesce(p_review->>'client_snapshot', ''),
      project_name_snapshot = coalesce(p_review->>'project_name_snapshot', ''),
      facility_type = coalesce(p_review->>'facility_type', ''),
      evaluation_date = nullif(p_review->>'evaluation_date', '')::date,
      evaluation_year = nullif(p_review->>'evaluation_year', '')::integer,
      evaluation_time = coalesce(p_review->>'evaluation_time', ''),
      location = coalesce(p_review->>'location', ''),
      evaluator_count = nullif(p_review->>'evaluator_count', '')::integer,
      participant_company_count = nullif(p_review->>'participant_company_count', '')::integer,
      presentation_order = nullif(p_review->>'presentation_order', '')::integer,
      participant_companies = coalesce(p_review->>'participant_companies', ''),
      evaluation_method = coalesce(p_review->>'evaluation_method', ''),
      special_notes = coalesce(p_review->>'special_notes', ''),
      updated_by = coalesce(p_actor, ''),
      updated_at = v_now
    where id = p_review_id
    returning * into v_review;

    -- RLS(update 권한 없음)나 이미 삭제된 기록 때문에 한 행도 안 바뀐 경우 — 자식만 지워지는 것을
    -- 막기 위해 자식을 건드리기 전에 여기서 중단한다.
    if v_review.id is null then
      raise exception 'evaluation review not found or not writable: %', p_review_id using errcode = 'P0001';
    end if;
  end if;

  delete from evaluation_review_attendees where review_id = v_review.id;
  insert into evaluation_review_attendees (
    review_id, engineer_contact_id, attendee_name_snapshot, attendee_role, sort_order
  )
  select
    v_review.id,
    nullif(a->>'engineer_contact_id', '')::uuid,
    btrim(coalesce(a->>'attendee_name_snapshot', '')),
    coalesce(a->>'attendee_role', ''),
    (a_idx - 1) * 10
  from jsonb_array_elements(coalesce(p_attendees, '[]'::jsonb)) with ordinality as t(a, a_idx)
  -- 이름이 빈 참석자 줄은 화면에서 지우지 않고 남겨둔 빈 입력란일 뿐이라 저장하지 않는다.
  where length(btrim(coalesce(a->>'attendee_name_snapshot', ''))) > 0;

  delete from evaluation_questions where review_id = v_review.id;
  insert into evaluation_questions (
    review_id, question_text, role_id, category_id, specialty_id,
    group_order, question_order, created_at, updated_at
  )
  select
    v_review.id,
    btrim(q->>'question_text'),
    nullif(q->>'role_id', '')::uuid,
    nullif(q->>'category_id', '')::uuid,
    -- specialty_id는 legacy 이관 전용이라 신규 화면은 보내지 않는다(없으면 null).
    nullif(q->>'specialty_id', '')::uuid,
    coalesce((q->>'group_order')::integer, 0),
    coalesce((q->>'question_order')::integer, 0),
    v_now, v_now
  from jsonb_array_elements(coalesce(p_questions, '[]'::jsonb)) as q
  -- 빈 질문 방지: 공백만 입력된 줄은 조용히 버린다(CHECK로 트랜잭션 전체를 실패시키는 대신,
  -- 화면에서 질문칸을 추가만 하고 안 채운 흔한 경우를 자연스럽게 처리).
  where length(btrim(coalesce(q->>'question_text', ''))) > 0;

  return v_review;
end $$;

-- 최소 권한 원칙: 이 함수는 쓰기 작업이라 security invoker + RLS로 실제 변경이 막히더라도
-- 미인증(anon) 역할에게 실행 권한 자체를 남겨둘 이유가 없다.
--
-- 주의: Supabase 프로젝트는 새 함수 생성 시 기본 권한(ALTER DEFAULT PRIVILEGES)으로 PUBLIC뿐
-- 아니라 anon/authenticated/service_role에게도 각각 개별 EXECUTE grant를 자동 부여한다.
-- `REVOKE ... FROM PUBLIC`만으로는 anon에게 직접 부여된 권한이 남으므로 anon도 명시적으로
-- revoke해야 한다(supabase/migration_attendance_director_rpc.sql에서 실측 확인된 동작).
-- service_role은 서버 전용 관리 클라이언트(lib/supabase-admin.ts)가 쓰는 신뢰된 역할이라 건드리지 않는다.
revoke all on function save_evaluation_review(uuid, jsonb, jsonb, jsonb, text) from public;
revoke all on function save_evaluation_review(uuid, jsonb, jsonb, jsonb, text) from anon;
grant execute on function save_evaluation_review(uuid, jsonb, jsonb, jsonb, text) to authenticated;

-- ── rollback (필요할 때 수동 실행) ────────────────────────────────────────────
--   drop function if exists save_evaluation_review(uuid, jsonb, jsonb, jsonb, text);
--   drop table if exists evaluation_questions;
--   drop table if exists evaluation_review_attendees;
--   drop table if exists evaluation_reviews;
--   drop table if exists evaluation_question_categories;
--   drop table if exists evaluation_roles;
--   drop table if exists evaluation_types;
--
-- 기존 테이블(projects, engineer_contacts, engineer_specialties)에는 컬럼을 추가하거나 제약을
-- 바꾸지 않았으므로, 위 5개 테이블과 함수만 지우면 이 migration 이전 상태로 완전히 돌아간다.
