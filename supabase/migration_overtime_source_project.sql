-- 연장근무 프로젝트를 입찰 현황(projects)과 연계.
-- source_project_id가 null이면 기존처럼 수동 등록된 프로젝트다.
-- 입찰 프로젝트가 삭제되면 연계만 끊고(SET NULL) 연장근무 행과 근무기록은 보존한다.
alter table overtime_projects
  add column if not exists source_project_id uuid references projects(id) on delete set null;

-- 입찰 프로젝트 1건당 연장근무 행 1개만 허용 (동기화 중복 생성 방지)
create unique index if not exists overtime_projects_source_project_id_key
  on overtime_projects (source_project_id) where source_project_id is not null;

-- 초기 1회 연결: 이름이 정확히 1건 일치하는 기존 수동 행을 연계 처리해
-- 첫 동기화 때 중복 행이 생기지 않게 한다.
update overtime_projects op
set source_project_id = p.id
from projects p
where op.source_project_id is null
  and p.name = op.name
  and (select count(*) from projects p2 where p2.name = op.name) = 1;

-- 이름은 이제 projects에서 동기화로 미러링되는 값이라 고유성을 보장할 수 없다
-- (projects.name에는 UNIQUE가 없음). 식별자는 id/source_project_id로 충분하다.
alter table overtime_projects drop constraint if exists overtime_projects_name_key;
