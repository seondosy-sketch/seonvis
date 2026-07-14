-- 연장근무 관리 — 프로젝트 시작일/종료일 추가
--
-- 프로젝트 관리 화면에서 프로젝트별 기간(시작일~종료일)을 설정할 수 있게 한다.
-- 기존 데이터가 있으므로 nullable로 추가한다 — 날짜를 아직 정하지 않은 프로젝트도 허용.

alter table overtime_projects
  add column if not exists start_date date,
  add column if not exists end_date date;
