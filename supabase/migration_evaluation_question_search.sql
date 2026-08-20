-- 평가 DB(면접 DB) — 질의 탭 서버측 검색/페이지네이션용 읽기 전용 view
--
-- 왜 view가 필요한가
--   질의 탭은 질문 1,119건을 전부 브라우저로 내려받아 JavaScript로 걸렀다. PostgREST는 요청한
--   limit과 무관하게 한 응답에 최대 1,000행만 돌려주므로(실측: Content-Range 0-999/1119) 119건이
--   화면에서 아예 조회되지 않았다. 필터·정렬·페이지네이션을 DB로 내리는 것이 근본 해결이다.
--
--   대부분의 조건은 view 없이도 된다 — evaluation_questions에 evaluation_reviews를 !inner로
--   임베드하면 임베드 컬럼 필터(발주처/시설용도/연도/평가유형), 임베드 컬럼 정렬, exact count가
--   모두 정상 동작함을 실측했다. 안 되는 것은 딱 하나, "전체검색"이다:
--     or=(question_text.ilike.*민원*,review.client_snapshot.ilike.*민원*)
--     → PGRST100 "failed to parse logic tree"
--   PostgREST의 or=(...)는 부모 테이블 컬럼과 임베드 리소스 컬럼을 한 논리식에 섞을 수 없다.
--   전체검색은 질문 본문 OR 용역명 OR 발주처(OR 시설용도)를 한 번에 훑어야 하므로, 질문과 기록을
--   미리 조인해 컬럼을 평평하게 노출하는 view가 가장 단순한 해법이다.
--   (PostgREST 집계 기능도 이 프로젝트에서는 비활성 — PGRST123. 그래서 필터 후보 목록도 view로 뽑는다.)
--
-- 왜 security definer 함수가 아닌가
--   security_invoker = true view는 조회하는 사용자의 권한으로 base table을 읽는다. 즉
--   evaluation_questions / evaluation_reviews의 기존 RLS(private.menu_permission('interview_db'))가
--   그대로 적용된다. RLS를 우회하는 읽기 경로를 새로 만들지 않는다.
--
-- 이 migration은 데이터를 만들거나 바꾸지 않는다. view 2개 생성 + SELECT 권한 부여뿐이다.
-- PostgreSQL 15+ 필요(security_invoker). 운영 확인: 17.6.

-- ── 1. 질의 검색 view ─────────────────────────────────────────────────────────
-- 질문 1행 + 그 질문이 나온 기록의 조회용 필드. 질문을 복제 저장하는 테이블이 아니라
-- evaluation_questions를 그대로 조인한 뷰다(질문 1개 = evaluation_questions 1행 원칙 유지).
-- review_id는 not null이고 FK가 걸려 있어 inner join으로 행이 사라질 일은 없다.
drop view if exists evaluation_question_search;
create view evaluation_question_search
  with (security_invoker = true) as
select
  q.id,
  q.review_id,
  q.question_text,
  q.role_id,
  q.category_id,
  q.specialty_id,
  q.group_order,
  q.question_order,
  q.created_at,
  q.updated_at,
  -- 아래는 evaluation_reviews의 값(질문에 복제 저장하지 않는다 — 조인해서 읽는다)
  r.evaluation_type_id,
  r.client_snapshot,
  r.project_name_snapshot,
  r.facility_type,
  r.evaluation_date,
  r.evaluation_year_effective
from evaluation_questions q
join evaluation_reviews r on r.id = q.review_id;

comment on view evaluation_question_search is
  '면접 DB 질의 탭 서버측 검색용 읽기 전용 view. evaluation_questions + evaluation_reviews 조인. security_invoker=true라 base table RLS가 그대로 적용된다.';

-- ── 2. 필터 후보 목록 view ────────────────────────────────────────────────────
-- 발주처·시설용도·연도는 마스터 테이블이 없는 자유 입력 값이라 실제 데이터에서 후보를 뽑아야 한다.
-- 현재 페이지 100건에서 뽑으면 안 되므로(그러면 후보가 페이지마다 달라진다) 전체 데이터 기준으로
-- 집계한다. 정렬은 화면이 정하고, 여기서는 질문 건수만 함께 준다(기존 UI의 "빈도 내림차순" 유지).
drop view if exists evaluation_question_facets;
create view evaluation_question_facets
  with (security_invoker = true) as
-- 값은 btrim으로 정규화한다 — 실제 데이터에 앞뒤 공백이 섞인 값이 있어서(실측: 시설용도
-- ' 교육연구시설(초,중,고등학교)') 그대로 뽑으면 같은 용도가 후보에 두 번 나온다. 원본 데이터는
-- 건드리지 않고 조회 계층에서만 정규화한다.
select 'client'::text as facet, btrim(r.client_snapshot) as value, count(*)::bigint as question_count
  from evaluation_questions q
  join evaluation_reviews r on r.id = q.review_id
 where btrim(r.client_snapshot) <> ''
 group by 1, 2
union all
select 'facility'::text, btrim(r.facility_type), count(*)::bigint
  from evaluation_questions q
  join evaluation_reviews r on r.id = q.review_id
 where btrim(r.facility_type) <> ''
 group by 1, 2
union all
select 'year'::text, r.evaluation_year_effective::text, count(*)::bigint
  from evaluation_questions q
  join evaluation_reviews r on r.id = q.review_id
 where r.evaluation_year_effective is not null
 group by 1, 2;

comment on view evaluation_question_facets is
  '면접 DB 질의 탭 필터 후보(발주처/시설용도/연도) — 전체 데이터 기준 집계. security_invoker=true.';

-- ── 3. 권한 ───────────────────────────────────────────────────────────────────
-- 조회 전용이다. 로그인 사용자(authenticated)에게만 SELECT를 주고, 미로그인(anon)에서는 회수한다.
-- ALTER DEFAULT PRIVILEGES 때문에 새 객체에 anon 권한이 자동으로 붙을 수 있어 명시적으로 revoke한다
-- (supabase/migration_evaluation_db.sql의 함수 권한 처리와 같은 이유).
-- 실제 행 노출은 base table RLS가 결정한다 — 권한 키는 interview_db.
revoke all on evaluation_question_search from anon;
revoke all on evaluation_question_facets from anon;
-- authenticated에도 SELECT만 남긴다. 조인/집계 view라 Postgres 규칙상 애초에 갱신이 불가능하지만,
-- 권한 자체를 조회로 못박아 "읽기 전용"이 문서가 아니라 권한으로 보장되게 한다.
revoke insert, update, delete, truncate, references, trigger on evaluation_question_search from authenticated;
revoke insert, update, delete, truncate, references, trigger on evaluation_question_facets from authenticated;
grant select on evaluation_question_search to authenticated;
grant select on evaluation_question_facets to authenticated;

-- ── 4. 인덱스 ─────────────────────────────────────────────────────────────────
-- 새 인덱스를 만들지 않는다. migration_evaluation_db.sql이 이미 조회 경로에 필요한 인덱스를 갖고 있다:
--   evaluation_questions (review_id, group_order, question_order) / role_id / category_id
--   evaluation_reviews   evaluation_year_effective DESC / evaluation_date DESC /
--                        client_snapshot / facility_type / evaluation_type_id
-- 전체검색(ilike 부분일치)은 인덱스를 쓸 수 없지만, 이를 위해 pg_trgm 같은 extension을 새로
-- 도입하지 않는다 — 현재 1,119행에서 실측 수십 ms이고, 필요성이 실측으로 확인될 때 별도로 판단한다.
