-- 공용 표 읽기 정책 — 권한 조합별 시험 (개발용 Supabase 전용). migration 적용 전·후 모두 실행할 수 있다.
--
-- 임시 데이터(끝나면 모두 지운다)
--   allowed_users 13행: rls-scn-*@example.invalid (시나리오별 메뉴 권한)
--   표마다 시험 행 1개(projects는 기존 seed 5건 사용): project_number 'RLS-SCN', week '2099-W01', code 'rls_scn'
--   삭제 범위: 위 고정 이메일·고정 키만.
-- 시나리오: A 전부 none · B overtime write · C attendance read/write · D lodging/trip read · E interview_db read ·
--   F projects read · G projects write · W weekly read · X 무관 메뉴만 · K 키 없음(기본 write) · H 관리자 · I 비로그인
-- 기대(적용 후): 전부 OK. 적용 전에는 "차단돼야 할" 칸이 FAIL(전체 읽기)로 나오는 것이 정상.
-- 쓰기 정책은 이 시험으로 바꾸지 않는다(쓰기 시도 없음).

drop table if exists pg_temp.shared_rls_check;
create temp table shared_rls_check (seq int generated always as identity, scenario text, label text, table_name text,
                                    expected text, actual text, verdict text);

do $$
declare
  e record;
  v_n int;
  v_err text;
begin
  if exists (select 1 from public.overtime_employees x
             where x.id::text not like 'e1000000-0000-4000-8000-00000000000_' and x.id::text not like 'f1000000-0000-4000-8000-00000000000_') then
    raise exception '중단: 시험용이 아닌 연장근무 직원이 있습니다 — 개발용 DB가 아닌 것 같습니다';
  end if;
  if (select count(*) from public.allowed_users where email not like 'rls-%@example.invalid') > 3 then
    raise exception '중단: 승인 사용자가 3명을 넘습니다 — 개발용 DB가 아닌 것 같습니다';
  end if;
  if (select count(*) from public.projects) = 0 then
    raise exception '중단: projects에 행이 없다(화면 seed 필요)';
  end if;

  -- 임시 데이터
  delete from public.allowed_users where email like 'rls-scn-%@example.invalid';
  insert into public.allowed_users (email, is_admin, menu_permissions) values
    ('rls-scn-a@example.invalid', false, '{"projects": "none", "weekly": "none", "overtime": "none", "field_overtime": "none", "leave": "none", "engineers": "none", "sites": "none", "attendance": "none", "lodging": "none", "trip": "none", "web": "none", "proposal_db": "none", "interview_db": "none"}'::jsonb),
    ('rls-scn-b@example.invalid', false, '{"projects": "none", "weekly": "none", "overtime": "write", "field_overtime": "none", "leave": "none", "engineers": "none", "sites": "none", "attendance": "none", "lodging": "none", "trip": "none", "web": "none", "proposal_db": "none", "interview_db": "none"}'::jsonb),
    ('rls-scn-c1@example.invalid', false, '{"projects": "none", "weekly": "none", "overtime": "none", "field_overtime": "none", "leave": "none", "engineers": "none", "sites": "none", "attendance": "read", "lodging": "none", "trip": "none", "web": "none", "proposal_db": "none", "interview_db": "none"}'::jsonb),
    ('rls-scn-c2@example.invalid', false, '{"projects": "none", "weekly": "none", "overtime": "none", "field_overtime": "none", "leave": "none", "engineers": "none", "sites": "none", "attendance": "write", "lodging": "none", "trip": "none", "web": "none", "proposal_db": "none", "interview_db": "none"}'::jsonb),
    ('rls-scn-d1@example.invalid', false, '{"projects": "none", "weekly": "none", "overtime": "none", "field_overtime": "none", "leave": "none", "engineers": "none", "sites": "none", "attendance": "none", "lodging": "read", "trip": "none", "web": "none", "proposal_db": "none", "interview_db": "none"}'::jsonb),
    ('rls-scn-d2@example.invalid', false, '{"projects": "none", "weekly": "none", "overtime": "none", "field_overtime": "none", "leave": "none", "engineers": "none", "sites": "none", "attendance": "none", "lodging": "none", "trip": "read", "web": "none", "proposal_db": "none", "interview_db": "none"}'::jsonb),
    ('rls-scn-e@example.invalid', false, '{"projects": "none", "weekly": "none", "overtime": "none", "field_overtime": "none", "leave": "none", "engineers": "none", "sites": "none", "attendance": "none", "lodging": "none", "trip": "none", "web": "none", "proposal_db": "none", "interview_db": "read"}'::jsonb),
    ('rls-scn-f@example.invalid', false, '{"projects": "read", "weekly": "none", "overtime": "none", "field_overtime": "none", "leave": "none", "engineers": "none", "sites": "none", "attendance": "none", "lodging": "none", "trip": "none", "web": "none", "proposal_db": "none", "interview_db": "none"}'::jsonb),
    ('rls-scn-g@example.invalid', false, '{"projects": "write", "weekly": "none", "overtime": "none", "field_overtime": "none", "leave": "none", "engineers": "none", "sites": "none", "attendance": "none", "lodging": "none", "trip": "none", "web": "none", "proposal_db": "none", "interview_db": "none"}'::jsonb),
    ('rls-scn-w@example.invalid', false, '{"projects": "none", "weekly": "read", "overtime": "none", "field_overtime": "none", "leave": "none", "engineers": "none", "sites": "none", "attendance": "none", "lodging": "none", "trip": "none", "web": "none", "proposal_db": "none", "interview_db": "none"}'::jsonb),
    ('rls-scn-x@example.invalid', false, '{"projects": "none", "weekly": "none", "overtime": "none", "field_overtime": "none", "leave": "write", "engineers": "none", "sites": "write", "attendance": "none", "lodging": "none", "trip": "none", "web": "write", "proposal_db": "none", "interview_db": "none"}'::jsonb),
    ('rls-scn-k@example.invalid', false, '{}'::jsonb),
    ('rls-scn-h@example.invalid', true, '{"projects": "none", "weekly": "none", "overtime": "none", "field_overtime": "none", "leave": "none", "engineers": "none", "sites": "none", "attendance": "none", "lodging": "none", "trip": "none", "web": "none", "proposal_db": "none", "interview_db": "none"}'::jsonb);
  delete from public.project_notes where project_number = 'RLS-SCN';
  delete from public.project_tooltips where project_number = 'RLS-SCN';
  delete from public.performing_projects where week = '2099-W01' and name = 'RLS-SCN';
  delete from public.expected_projects where week = '2099-W01' and name = 'RLS-SCN';
  delete from public.weekly_meta where week = '2099-W01';
  delete from public.evaluation_types where code = 'rls_scn';
  delete from public.evaluation_roles where name = 'RLS-SCN';
  delete from public.evaluation_question_categories where code = 'rls_scn';
  insert into public.project_notes (project_number, field, note) values ('RLS-SCN', 'note', 'rls');
  insert into public.project_tooltips (project_number, location) values ('RLS-SCN', 'rls');
  insert into public.performing_projects (week, status, name) values ('2099-W01', '진행중', 'RLS-SCN');
  insert into public.expected_projects (week, name) values ('2099-W01', 'RLS-SCN');
  insert into public.weekly_meta (week) values ('2099-W01');
  insert into public.evaluation_types (code, name) values ('rls_scn', 'RLS-SCN');
  insert into public.evaluation_roles (name) values ('RLS-SCN');
  insert into public.evaluation_question_categories (code, name) values ('rls_scn', 'RLS-SCN');

  for e in select * from (values
    ('A', '관련 메뉴 전부 none', 'rls-scn-a@example.invalid', 'projects', false),
    ('A', '관련 메뉴 전부 none', 'rls-scn-a@example.invalid', 'project_notes', false),
    ('A', '관련 메뉴 전부 none', 'rls-scn-a@example.invalid', 'project_tooltips', false),
    ('A', '관련 메뉴 전부 none', 'rls-scn-a@example.invalid', 'performing_projects', false),
    ('A', '관련 메뉴 전부 none', 'rls-scn-a@example.invalid', 'expected_projects', false),
    ('A', '관련 메뉴 전부 none', 'rls-scn-a@example.invalid', 'weekly_meta', false),
    ('A', '관련 메뉴 전부 none', 'rls-scn-a@example.invalid', 'evaluation_types', false),
    ('A', '관련 메뉴 전부 none', 'rls-scn-a@example.invalid', 'evaluation_roles', false),
    ('A', '관련 메뉴 전부 none', 'rls-scn-a@example.invalid', 'evaluation_question_categories', false),
    ('B', 'overtime만 write', 'rls-scn-b@example.invalid', 'projects', true),
    ('B', 'overtime만 write', 'rls-scn-b@example.invalid', 'project_notes', false),
    ('B', 'overtime만 write', 'rls-scn-b@example.invalid', 'project_tooltips', false),
    ('B', 'overtime만 write', 'rls-scn-b@example.invalid', 'performing_projects', false),
    ('B', 'overtime만 write', 'rls-scn-b@example.invalid', 'expected_projects', false),
    ('B', 'overtime만 write', 'rls-scn-b@example.invalid', 'weekly_meta', false),
    ('B', 'overtime만 write', 'rls-scn-b@example.invalid', 'evaluation_types', false),
    ('B', 'overtime만 write', 'rls-scn-b@example.invalid', 'evaluation_roles', false),
    ('B', 'overtime만 write', 'rls-scn-b@example.invalid', 'evaluation_question_categories', false),
    ('C1', 'attendance만 read', 'rls-scn-c1@example.invalid', 'projects', true),
    ('C1', 'attendance만 read', 'rls-scn-c1@example.invalid', 'project_notes', false),
    ('C1', 'attendance만 read', 'rls-scn-c1@example.invalid', 'project_tooltips', false),
    ('C1', 'attendance만 read', 'rls-scn-c1@example.invalid', 'performing_projects', false),
    ('C1', 'attendance만 read', 'rls-scn-c1@example.invalid', 'expected_projects', false),
    ('C1', 'attendance만 read', 'rls-scn-c1@example.invalid', 'weekly_meta', false),
    ('C1', 'attendance만 read', 'rls-scn-c1@example.invalid', 'evaluation_types', false),
    ('C1', 'attendance만 read', 'rls-scn-c1@example.invalid', 'evaluation_roles', false),
    ('C1', 'attendance만 read', 'rls-scn-c1@example.invalid', 'evaluation_question_categories', false),
    ('C2', 'attendance만 write', 'rls-scn-c2@example.invalid', 'projects', true),
    ('C2', 'attendance만 write', 'rls-scn-c2@example.invalid', 'project_notes', false),
    ('C2', 'attendance만 write', 'rls-scn-c2@example.invalid', 'project_tooltips', false),
    ('C2', 'attendance만 write', 'rls-scn-c2@example.invalid', 'performing_projects', false),
    ('C2', 'attendance만 write', 'rls-scn-c2@example.invalid', 'expected_projects', false),
    ('C2', 'attendance만 write', 'rls-scn-c2@example.invalid', 'weekly_meta', false),
    ('C2', 'attendance만 write', 'rls-scn-c2@example.invalid', 'evaluation_types', false),
    ('C2', 'attendance만 write', 'rls-scn-c2@example.invalid', 'evaluation_roles', false),
    ('C2', 'attendance만 write', 'rls-scn-c2@example.invalid', 'evaluation_question_categories', false),
    ('D1', 'lodging만 read', 'rls-scn-d1@example.invalid', 'projects', true),
    ('D1', 'lodging만 read', 'rls-scn-d1@example.invalid', 'project_notes', false),
    ('D1', 'lodging만 read', 'rls-scn-d1@example.invalid', 'project_tooltips', false),
    ('D1', 'lodging만 read', 'rls-scn-d1@example.invalid', 'performing_projects', false),
    ('D1', 'lodging만 read', 'rls-scn-d1@example.invalid', 'expected_projects', false),
    ('D1', 'lodging만 read', 'rls-scn-d1@example.invalid', 'weekly_meta', false),
    ('D1', 'lodging만 read', 'rls-scn-d1@example.invalid', 'evaluation_types', false),
    ('D1', 'lodging만 read', 'rls-scn-d1@example.invalid', 'evaluation_roles', false),
    ('D1', 'lodging만 read', 'rls-scn-d1@example.invalid', 'evaluation_question_categories', false),
    ('D2', 'trip만 read', 'rls-scn-d2@example.invalid', 'projects', true),
    ('D2', 'trip만 read', 'rls-scn-d2@example.invalid', 'project_notes', false),
    ('D2', 'trip만 read', 'rls-scn-d2@example.invalid', 'project_tooltips', true),
    ('D2', 'trip만 read', 'rls-scn-d2@example.invalid', 'performing_projects', false),
    ('D2', 'trip만 read', 'rls-scn-d2@example.invalid', 'expected_projects', false),
    ('D2', 'trip만 read', 'rls-scn-d2@example.invalid', 'weekly_meta', false),
    ('D2', 'trip만 read', 'rls-scn-d2@example.invalid', 'evaluation_types', false),
    ('D2', 'trip만 read', 'rls-scn-d2@example.invalid', 'evaluation_roles', false),
    ('D2', 'trip만 read', 'rls-scn-d2@example.invalid', 'evaluation_question_categories', false),
    ('E', 'interview_db만 read', 'rls-scn-e@example.invalid', 'projects', true),
    ('E', 'interview_db만 read', 'rls-scn-e@example.invalid', 'project_notes', false),
    ('E', 'interview_db만 read', 'rls-scn-e@example.invalid', 'project_tooltips', false),
    ('E', 'interview_db만 read', 'rls-scn-e@example.invalid', 'performing_projects', false),
    ('E', 'interview_db만 read', 'rls-scn-e@example.invalid', 'expected_projects', false),
    ('E', 'interview_db만 read', 'rls-scn-e@example.invalid', 'weekly_meta', false),
    ('E', 'interview_db만 read', 'rls-scn-e@example.invalid', 'evaluation_types', true),
    ('E', 'interview_db만 read', 'rls-scn-e@example.invalid', 'evaluation_roles', true),
    ('E', 'interview_db만 read', 'rls-scn-e@example.invalid', 'evaluation_question_categories', true),
    ('F', 'projects만 read', 'rls-scn-f@example.invalid', 'projects', true),
    ('F', 'projects만 read', 'rls-scn-f@example.invalid', 'project_notes', true),
    ('F', 'projects만 read', 'rls-scn-f@example.invalid', 'project_tooltips', true),
    ('F', 'projects만 read', 'rls-scn-f@example.invalid', 'performing_projects', false),
    ('F', 'projects만 read', 'rls-scn-f@example.invalid', 'expected_projects', false),
    ('F', 'projects만 read', 'rls-scn-f@example.invalid', 'weekly_meta', false),
    ('F', 'projects만 read', 'rls-scn-f@example.invalid', 'evaluation_types', false),
    ('F', 'projects만 read', 'rls-scn-f@example.invalid', 'evaluation_roles', false),
    ('F', 'projects만 read', 'rls-scn-f@example.invalid', 'evaluation_question_categories', false),
    ('G', 'projects만 write', 'rls-scn-g@example.invalid', 'projects', true),
    ('G', 'projects만 write', 'rls-scn-g@example.invalid', 'project_notes', true),
    ('G', 'projects만 write', 'rls-scn-g@example.invalid', 'project_tooltips', true),
    ('G', 'projects만 write', 'rls-scn-g@example.invalid', 'performing_projects', false),
    ('G', 'projects만 write', 'rls-scn-g@example.invalid', 'expected_projects', false),
    ('G', 'projects만 write', 'rls-scn-g@example.invalid', 'weekly_meta', false),
    ('G', 'projects만 write', 'rls-scn-g@example.invalid', 'evaluation_types', false),
    ('G', 'projects만 write', 'rls-scn-g@example.invalid', 'evaluation_roles', false),
    ('G', 'projects만 write', 'rls-scn-g@example.invalid', 'evaluation_question_categories', false),
    ('W', 'weekly만 read', 'rls-scn-w@example.invalid', 'projects', true),
    ('W', 'weekly만 read', 'rls-scn-w@example.invalid', 'project_notes', true),
    ('W', 'weekly만 read', 'rls-scn-w@example.invalid', 'project_tooltips', true),
    ('W', 'weekly만 read', 'rls-scn-w@example.invalid', 'performing_projects', true),
    ('W', 'weekly만 read', 'rls-scn-w@example.invalid', 'expected_projects', true),
    ('W', 'weekly만 read', 'rls-scn-w@example.invalid', 'weekly_meta', true),
    ('W', 'weekly만 read', 'rls-scn-w@example.invalid', 'evaluation_types', false),
    ('W', 'weekly만 read', 'rls-scn-w@example.invalid', 'evaluation_roles', false),
    ('W', 'weekly만 read', 'rls-scn-w@example.invalid', 'evaluation_question_categories', false),
    ('X', '연장근무와 무관한 메뉴만 write(leave·sites·web)', 'rls-scn-x@example.invalid', 'projects', false),
    ('X', '연장근무와 무관한 메뉴만 write(leave·sites·web)', 'rls-scn-x@example.invalid', 'project_notes', false),
    ('X', '연장근무와 무관한 메뉴만 write(leave·sites·web)', 'rls-scn-x@example.invalid', 'project_tooltips', false),
    ('X', '연장근무와 무관한 메뉴만 write(leave·sites·web)', 'rls-scn-x@example.invalid', 'performing_projects', false),
    ('X', '연장근무와 무관한 메뉴만 write(leave·sites·web)', 'rls-scn-x@example.invalid', 'expected_projects', false),
    ('X', '연장근무와 무관한 메뉴만 write(leave·sites·web)', 'rls-scn-x@example.invalid', 'weekly_meta', false),
    ('X', '연장근무와 무관한 메뉴만 write(leave·sites·web)', 'rls-scn-x@example.invalid', 'evaluation_types', false),
    ('X', '연장근무와 무관한 메뉴만 write(leave·sites·web)', 'rls-scn-x@example.invalid', 'evaluation_roles', false),
    ('X', '연장근무와 무관한 메뉴만 write(leave·sites·web)', 'rls-scn-x@example.invalid', 'evaluation_question_categories', false),
    ('K', '메뉴 키 없음(기본 write) — 전부 허용', 'rls-scn-k@example.invalid', 'projects', true),
    ('K', '메뉴 키 없음(기본 write) — 전부 허용', 'rls-scn-k@example.invalid', 'project_notes', true),
    ('K', '메뉴 키 없음(기본 write) — 전부 허용', 'rls-scn-k@example.invalid', 'project_tooltips', true),
    ('K', '메뉴 키 없음(기본 write) — 전부 허용', 'rls-scn-k@example.invalid', 'performing_projects', true),
    ('K', '메뉴 키 없음(기본 write) — 전부 허용', 'rls-scn-k@example.invalid', 'expected_projects', true),
    ('K', '메뉴 키 없음(기본 write) — 전부 허용', 'rls-scn-k@example.invalid', 'weekly_meta', true),
    ('K', '메뉴 키 없음(기본 write) — 전부 허용', 'rls-scn-k@example.invalid', 'evaluation_types', true),
    ('K', '메뉴 키 없음(기본 write) — 전부 허용', 'rls-scn-k@example.invalid', 'evaluation_roles', true),
    ('K', '메뉴 키 없음(기본 write) — 전부 허용', 'rls-scn-k@example.invalid', 'evaluation_question_categories', true),
    ('H', '관리자(is_admin)', 'rls-scn-h@example.invalid', 'projects', true),
    ('H', '관리자(is_admin)', 'rls-scn-h@example.invalid', 'project_notes', true),
    ('H', '관리자(is_admin)', 'rls-scn-h@example.invalid', 'project_tooltips', true),
    ('H', '관리자(is_admin)', 'rls-scn-h@example.invalid', 'performing_projects', true),
    ('H', '관리자(is_admin)', 'rls-scn-h@example.invalid', 'expected_projects', true),
    ('H', '관리자(is_admin)', 'rls-scn-h@example.invalid', 'weekly_meta', true),
    ('H', '관리자(is_admin)', 'rls-scn-h@example.invalid', 'evaluation_types', true),
    ('H', '관리자(is_admin)', 'rls-scn-h@example.invalid', 'evaluation_roles', true),
    ('H', '관리자(is_admin)', 'rls-scn-h@example.invalid', 'evaluation_question_categories', true),
    ('I', '비로그인(anon)', null, 'projects', false),
    ('I', '비로그인(anon)', null, 'project_notes', false),
    ('I', '비로그인(anon)', null, 'project_tooltips', false),
    ('I', '비로그인(anon)', null, 'performing_projects', false),
    ('I', '비로그인(anon)', null, 'expected_projects', false),
    ('I', '비로그인(anon)', null, 'weekly_meta', false),
    ('I', '비로그인(anon)', null, 'evaluation_types', false),
    ('I', '비로그인(anon)', null, 'evaluation_roles', false),
    ('I', '비로그인(anon)', null, 'evaluation_question_categories', false)
  ) as x(scenario, label, email, table_name, allowed) loop
    v_n := null; v_err := null;
    if e.email is null then
      perform set_config('request.jwt.claims', '', true);
      execute 'set local role anon';
    else
      perform set_config('request.jwt.claims', pg_catalog.json_build_object('email', e.email, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
    end if;
    begin
      case e.table_name
      when 'projects' then select count(*) into v_n from public.projects;
      when 'project_notes' then select count(*) into v_n from public.project_notes;
      when 'project_tooltips' then select count(*) into v_n from public.project_tooltips;
      when 'performing_projects' then select count(*) into v_n from public.performing_projects;
      when 'expected_projects' then select count(*) into v_n from public.expected_projects;
      when 'weekly_meta' then select count(*) into v_n from public.weekly_meta;
      when 'evaluation_types' then select count(*) into v_n from public.evaluation_types;
      when 'evaluation_roles' then select count(*) into v_n from public.evaluation_roles;
      when 'evaluation_question_categories' then select count(*) into v_n from public.evaluation_question_categories;
      end case;
    exception when others then v_err := sqlstate || ' ' || left(sqlerrm, 60);
    end;
    execute 'reset role';
    insert into shared_rls_check (scenario, label, table_name, expected, actual, verdict)
    values (e.scenario, e.label, e.table_name, case when e.allowed then '읽기 허용(>0)' else '0건' end,
            coalesce(v_n::text || '건', v_err),
            case when v_err is not null and (e.allowed or v_err not like '42501%') then 'FAIL'
                 when e.allowed and coalesce(v_n, 0) > 0 then 'OK'
                 when not e.allowed and coalesce(v_n, 0) = 0 then 'OK'
                 else 'FAIL' end);
  end loop;

  -- 정리 (고정 이메일·고정 키만)
  delete from public.allowed_users where email like 'rls-scn-%@example.invalid';
  delete from public.project_notes where project_number = 'RLS-SCN';
  delete from public.project_tooltips where project_number = 'RLS-SCN';
  delete from public.performing_projects where week = '2099-W01' and name = 'RLS-SCN';
  delete from public.expected_projects where week = '2099-W01' and name = 'RLS-SCN';
  delete from public.weekly_meta where week = '2099-W01';
  delete from public.evaluation_types where code = 'rls_scn';
  delete from public.evaluation_roles where name = 'RLS-SCN';
  delete from public.evaluation_question_categories where code = 'rls_scn';
  insert into shared_rls_check (scenario, label, table_name, expected, actual, verdict)
  values ('Z', '시험 데이터 정리', '-', '0건',
          ((select count(*) from public.allowed_users where email like 'rls-scn-%@example.invalid')
           + (select count(*) from public.project_notes where project_number = 'RLS-SCN')
           + (select count(*) from public.evaluation_types where code = 'rls_scn'))::text || '건',
          case when exists (select 1 from public.allowed_users where email like 'rls-scn-%@example.invalid') then 'FAIL' else 'OK' end);
end $$;

select seq, scenario, label, table_name, expected, actual, verdict from shared_rls_check order by seq;
