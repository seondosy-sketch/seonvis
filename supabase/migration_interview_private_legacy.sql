-- 면접 DB — 2020년 이하 자료를 "개인 비공개 자료"로 보호한다.
--
-- 왜 있는가
--   면접 DB에 이관한 과거 자료 중 2020년 이하 136건(질의 576건, 참석자 136건)은 특정 개인이
--   개인적으로 모아 둔 자료다. 회사 공용 자료가 아니므로 일반 사용자에게는 보이지 않아야 한다.
--
--   단순 UI 숨김이 아니다. 권한 없는 사용자가 PostgREST를 직접 호출하거나 view/조인으로 우회해도
--   행 자체가 돌아오지 않아야 하므로 base table RLS에서 막는다. 화면 필터는 편의(토글)일 뿐이고
--   보안 경계가 아니다.
--
-- 열람 권한을 코드가 아니라 데이터로 둔다
--   allowed_users.can_view_private_legacy(boolean, 기본 false)에 저장한다. 이메일을 코드 곳곳에
--   하드코딩하면 사람이 바뀔 때마다 배포가 필요하고, 어디에 흩어져 있는지 추적이 안 된다.
--   is_admin과는 **별개**다 — 관리자라는 이유만으로 남의 개인자료를 볼 수는 없다.
--
-- 연도 경계와 NULL
--   기준은 evaluation_year_effective(generated: 평가일의 연도, 없으면 evaluation_year)다.
--   NULL은 공개 취급한다. 이유: 신규 등록 화면(ReviewFormModal)은 평가일을 필수로 받지 않고
--   legacy 연도 칸은 이관 전용이라 아예 입력받지 않는다. 즉 평가일을 비운 채 저장한 **신규** 후기가
--   NULL이 된다. NULL을 비공개로 두면 사용자가 방금 쓴 자기 후기를 못 보게 된다.
--   과거 자료가 NULL로 새는 경로는 없다 — 이관 자료는 전부 연도가 있고(현재 NULL 0건), 수정 화면도
--   evaluation_year를 그대로 실어 보내므로 legacy 후기를 편집해도 연도가 지워지지 않는다.
--
-- 되돌리는 방법 (rollback)
--   이 파일 맨 아래 주석의 SQL을 실행하면 정책이 이전 상태(연도 조건 없음)로 돌아간다.
--   데이터는 건드리지 않는다 — 이 migration은 행을 지우거나 연도를 바꾸지 않는다.

-- ── 1. 열람 권한 플래그 ───────────────────────────────────────────────────────
alter table allowed_users
  add column if not exists can_view_private_legacy boolean not null default false;

comment on column allowed_users.can_view_private_legacy is
  '면접 DB의 2020년 이하 개인 비공개 자료를 열람/수정/삭제할 수 있는지. is_admin과 별개다.';

-- 자료 소유자 2명에게만 부여한다. 나머지는 기본값 false.
update allowed_users
   set can_view_private_legacy = true
 where email in ('seon.dosy@gmail.com', 'kiiiiyoung@gmail.com');

-- ── 2. RLS 헬퍼 ───────────────────────────────────────────────────────────────
-- private.menu_permission과 같은 형태(STABLE SECURITY DEFINER, search_path 고정, JWT email 기준).
-- 행이 없으면 false다 — 모르는 계정에게 열어주지 않는다.
create or replace function private.can_view_private_legacy()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select coalesce(
    (
      select u.can_view_private_legacy
      from allowed_users u
      where u.email = (auth.jwt() ->> 'email')
    ),
    false
  )
$fn$;

revoke all on function private.can_view_private_legacy() from public;
grant execute on function private.can_view_private_legacy() to authenticated;

-- 연도 경계를 한 곳에만 둔다 — 정책 9개에 2020을 흩뿌리면 한 곳만 고쳐지는 사고가 난다.
--
-- SECURITY DEFINER 여야 한다. INVOKER로 두면 본문이 호출자(authenticated) 권한으로 돌고,
-- authenticated 에게는 schema private 의 USAGE 가 없어서 안쪽 private.can_view_private_legacy()
-- 호출이 "permission denied for schema private"로 실패한다 — 면접 DB 조회 전체가 에러가 된다.
create or replace function private.evaluation_review_visible(p_year integer)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select p_year is null
      or p_year > 2020
      or private.can_view_private_legacy()
$fn$;

revoke all on function private.evaluation_review_visible(integer) from public;
grant execute on function private.evaluation_review_visible(integer) to authenticated;

-- 화면이 "이 사람에게 토글을 보여줄지" 묻는 용도. 보안 판단은 하지 않는다(RLS가 한다).
-- 위와 같은 이유로 SECURITY DEFINER 다(authenticated 는 schema private 에 접근할 수 없다).
create or replace function public.can_view_private_legacy()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select private.can_view_private_legacy()
$fn$;

revoke all on function public.can_view_private_legacy() from public;
-- anon 도 명시적으로 회수한다. Supabase 는 public 스키마 함수에 ALTER DEFAULT PRIVILEGES 로
-- anon/authenticated/service_role 에 EXECUTE 를 자동 부여하므로, `from public` 만으로는
-- 미인증 역할에서 떨어지지 않는다(불러도 false 만 오지만 남겨 둘 이유가 없다).
revoke execute on function public.can_view_private_legacy() from anon;
grant execute on function public.can_view_private_legacy() to authenticated;

-- ── 3. 정책 교체 ──────────────────────────────────────────────────────────────
-- 기존 menu_permission 조건은 그대로 두고 연도 조건을 AND로 더한다.
-- INSERT는 건드리지 않는다 — 신규 등록은 개인자료 정책과 무관하고, 막으면 정상 업무가 깨진다.

drop policy if exists "eval_reviews_select" on evaluation_reviews;
create policy "eval_reviews_select" on evaluation_reviews
  for select using (
    private.menu_permission('interview_db') <> 'none'
    and private.evaluation_review_visible(evaluation_year_effective)
  );
drop policy if exists "eval_reviews_update" on evaluation_reviews;
create policy "eval_reviews_update" on evaluation_reviews
  for update using (
    private.menu_permission('interview_db') = 'write'
    and private.evaluation_review_visible(evaluation_year_effective)
  ) with check (
    private.menu_permission('interview_db') = 'write'
    and private.evaluation_review_visible(evaluation_year_effective)
  );
drop policy if exists "eval_reviews_delete" on evaluation_reviews;
create policy "eval_reviews_delete" on evaluation_reviews
  for delete using (
    private.menu_permission('interview_db') = 'write'
    and private.evaluation_review_visible(evaluation_year_effective)
  );

-- 자식 테이블은 부모 기록의 연도로 판단한다. 질의 탭이 보는 evaluation_question_search view는
-- security_invoker = true라 이 정책을 그대로 상속하므로 view 쪽에 따로 조건을 걸지 않는다.
drop policy if exists "eval_questions_select" on evaluation_questions;
create policy "eval_questions_select" on evaluation_questions
  for select using (
    private.menu_permission('interview_db') <> 'none'
    and exists (
      select 1 from evaluation_reviews r
      where r.id = evaluation_questions.review_id
        and private.evaluation_review_visible(r.evaluation_year_effective)
    )
  );
drop policy if exists "eval_questions_update" on evaluation_questions;
create policy "eval_questions_update" on evaluation_questions
  for update using (
    private.menu_permission('interview_db') = 'write'
    and exists (
      select 1 from evaluation_reviews r
      where r.id = evaluation_questions.review_id
        and private.evaluation_review_visible(r.evaluation_year_effective)
    )
  ) with check (
    private.menu_permission('interview_db') = 'write'
    and exists (
      select 1 from evaluation_reviews r
      where r.id = evaluation_questions.review_id
        and private.evaluation_review_visible(r.evaluation_year_effective)
    )
  );
drop policy if exists "eval_questions_delete" on evaluation_questions;
create policy "eval_questions_delete" on evaluation_questions
  for delete using (
    private.menu_permission('interview_db') = 'write'
    and exists (
      select 1 from evaluation_reviews r
      where r.id = evaluation_questions.review_id
        and private.evaluation_review_visible(r.evaluation_year_effective)
    )
  );

drop policy if exists "eval_attendees_select" on evaluation_review_attendees;
create policy "eval_attendees_select" on evaluation_review_attendees
  for select using (
    private.menu_permission('interview_db') <> 'none'
    and exists (
      select 1 from evaluation_reviews r
      where r.id = evaluation_review_attendees.review_id
        and private.evaluation_review_visible(r.evaluation_year_effective)
    )
  );
drop policy if exists "eval_attendees_update" on evaluation_review_attendees;
create policy "eval_attendees_update" on evaluation_review_attendees
  for update using (
    private.menu_permission('interview_db') = 'write'
    and exists (
      select 1 from evaluation_reviews r
      where r.id = evaluation_review_attendees.review_id
        and private.evaluation_review_visible(r.evaluation_year_effective)
    )
  ) with check (
    private.menu_permission('interview_db') = 'write'
    and exists (
      select 1 from evaluation_reviews r
      where r.id = evaluation_review_attendees.review_id
        and private.evaluation_review_visible(r.evaluation_year_effective)
    )
  );
drop policy if exists "eval_attendees_delete" on evaluation_review_attendees;
create policy "eval_attendees_delete" on evaluation_review_attendees
  for delete using (
    private.menu_permission('interview_db') = 'write'
    and exists (
      select 1 from evaluation_reviews r
      where r.id = evaluation_review_attendees.review_id
        and private.evaluation_review_visible(r.evaluation_year_effective)
    )
  );

-- 자식 정책이 부모를 매번 조회하므로 review_id 인덱스가 있어야 한다(질의는 이미 있다).
create index if not exists idx_eval_attendees_review on evaluation_review_attendees (review_id);

-- ── rollback ──────────────────────────────────────────────────────────────────
-- 정책을 연도 조건 없는 이전 상태로 되돌린다(플래그 컬럼과 헬퍼는 남겨 둬도 무해하다).
-- supabase/migration_evaluation_db.sql 의 원래 정의를 그대로 다시 만든다:
--
--   create policy "eval_reviews_select" on evaluation_reviews
--     for select using (private.menu_permission('interview_db') <> 'none');
--   create policy "eval_reviews_update" on evaluation_reviews
--     for update using (private.menu_permission('interview_db') = 'write')
--            with check (private.menu_permission('interview_db') = 'write');
--   create policy "eval_reviews_delete" on evaluation_reviews
--     for delete using (private.menu_permission('interview_db') = 'write');
--   -- evaluation_questions · evaluation_review_attendees 의 select/update/delete 도 동일한 모양
--
-- 플래그와 헬퍼까지 완전히 지우려면:
--   drop function if exists public.can_view_private_legacy();
--   drop function if exists private.evaluation_review_visible(integer);
--   drop function if exists private.can_view_private_legacy();
--   alter table allowed_users drop column if exists can_view_private_legacy;
