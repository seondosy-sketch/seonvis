-- 연장근무 되돌리기 리허설 — 기준 상태 기록 (읽기 전용, SELECT 한 문장). 결과: check_name / detail, 정확히 58행.
--
-- 대상 DB: 개발용 Supabase(zaot…iyas)의 전체 되돌리기 리허설 전용. 운영(lkvb…odrt)에서는 실행하지 않는다
--   (읽기만 해서 바꾸는 것은 없지만, b 항목이 개발 seed 고정 ID를 세고 결과는 리허설 비교에만 쓴다).
--   운영·개발 구분은 이 파일이 아니라 SQL Editor 화면의 project ref로 사람이 확인한다 — 리허설 단계 파일(_1_state 등)은
--   따로 개발 DB 안전장치를 갖는다.
-- 실행 시점: 리허설 시작 전(_1_state 직전)과 overtime_ui_seed.sql 복원 뒤, 같은 파일을 그대로 두 번 실행해 비교한다.
-- 출력: 건수·참/거짓·MD5 지문만. 이름·이메일·UUID·업무내용 원문은 출력하지 않는다(이메일도 md5로만 지문에 넣는다).
--   MD5는 보안 인증이 아니다 — "리허설 전후 값이 같은가"를 짧게 비교하기 위한 지문일 뿐이다(지문 원문도 대화창에 붙이지 않는다).
-- 항목: a 행 수(16) · b seed·직원 연결(10) · c 객체 수·리허설 객체 잔여(6) · d 스키마·함수·정책 지문(10) · e 데이터 지문(16)
--   d03 메뉴 권한 함수 2개, d07 공용 표 9개 정책은 리허설이 건드리지 않는다 — 전후가 다르면 리허설 실패.
--   e01(승인 사용자)은 seed가 다시 만드는 시험 계정 3개를, e04(입찰 프로젝트)는 seed 고정 ID(f2… 5개·d1…01)를 빼고 지문을 만든다
--   → 둘 다 seed 복원 뒤에도 같아야 한다. seed 복원으로 달라질 수 있는 것: a·b의 시험 행 수와 e13~e16(시험 직원·업무·
--   연장근무 프로젝트·참여 — 개발 DB에는 시험 행만 있다). 그 밖의 e 지문(주소록·공휴일·공용 표)과 d 지문은 같아야 한다.
with
cnt(check_name, detail) as (values
  ('a01 rows overtime_employees', (select count(*) from public.overtime_employees)::text),
  ('a02 rows overtime_employee_tasks', (select count(*) from public.overtime_employee_tasks)::text),
  ('a03 rows overtime_projects', (select count(*) from public.overtime_projects)::text),
  ('a04 rows overtime_project_members', (select count(*) from public.overtime_project_members)::text),
  ('a05 rows overtime_work_records(전체)', (select count(*) from public.overtime_work_records)::text),
  ('a06 rows overtime_work_records(auto)', (select count(*) from public.overtime_work_records where source = 'auto')::text),
  ('a07 rows overtime_assignment_runs', (select count(*) from public.overtime_assignment_runs)::text),
  ('a08 rows overtime_assignment_drafts', (select count(*) from public.overtime_assignment_drafts)::text),
  ('a09 rows overtime_monthly_targets', (select count(*) from public.overtime_monthly_targets)::text),
  ('a10 rows overtime_member_tasks', (select count(*) from public.overtime_member_tasks)::text),
  ('a11 rows holidays', (select count(*) from public.holidays)::text),
  ('a12 rows engineer_contacts', (select count(*) from public.engineer_contacts)::text),
  ('a13 rows projects', (select count(*) from public.projects)::text),
  ('a14 rows allowed_users', (select count(*) from public.allowed_users)::text),
  ('a15 allowed_users is_admin=true 수', (select count(*) from public.allowed_users where is_admin)::text),
  ('a16 시험 계정(ot-ui-test) is_admin', coalesce((select is_admin::text from public.allowed_users where email = 'ot-ui-test@example.com'), '행 없음')),
  ('b01 seed 직원(f1) 수', (select count(*) from public.overtime_employees where id::text like 'f1000000-0000-4000-8000-00000000000_')::text),
  ('b02 동작시험 직원(e1) 수', (select count(*) from public.overtime_employees where id::text like 'e1000000-0000-4000-8000-00000000000_')::text),
  ('b03 seed 업무(f1 직원) 수', (select count(*) from public.overtime_employee_tasks where employee_id::text like 'f1000000-0000-4000-8000-00000000000_')::text),
  ('b04 seed 입찰 프로젝트(f2) 수', (select count(*) from public.projects where id::text like 'f2000000-0000-4000-8000-00000000000_')::text),
  ('b05 seed 수동 프로젝트(f3) 수', (select count(*) from public.overtime_projects where id = 'f3000000-0000-4000-8000-000000000001')::text),
  ('b06 seed 직원 기록 수', (select count(*) from public.overtime_work_records where employee_id::text like 'f1000000-0000-4000-8000-00000000000_')::text),
  ('b07 seed 직원 목표 수', (select count(*) from public.overtime_monthly_targets where employee_id::text like 'f1000000-0000-4000-8000-00000000000_')::text),
  ('b08 seed 직원 참여 수', (select count(*) from public.overtime_project_members where employee_id::text like 'f1000000-0000-4000-8000-00000000000_')::text),
  ('b09 미연결 재직 직원(p10)', (select count(*) from public.overtime_employees e where e.is_active
                                   and not exists (select 1 from public.engineer_contacts c where c.employee_id = e.id))::text),
  ('b10 미연결 미래사업팀 주소록(p11)', (select count(*) from public.engineer_contacts c where c.company = '미래사업팀' and c.employee_id is null)::text),
  ('c01 overtime 함수 수', (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                             where n.nspname in ('public', 'private') and (p.proname like 'overtime\_%' or p.proname = 'sync_team_employees'))::text),
  ('c02 overtime 트리거 수', (select count(*) from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid = t.tgrelid
                               where not t.tgisinternal and c.relname like 'overtime\_%')::text),
  ('c03 overtime 표 정책 수', (select count(*) from pg_catalog.pg_policies where schemaname = 'public' and tablename like 'overtime\_%')::text),
  ('c04 holidays 정책 수', (select count(*) from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'holidays')::text),
  ('c05 공용 표 9개 menu_read 수', (select count(*) from pg_catalog.pg_policies where schemaname = 'public' and policyname = 'menu_read'
                                    and tablename in ('projects', 'project_notes', 'project_tooltips', 'performing_projects', 'expected_projects',
                                                      'weekly_meta', 'evaluation_types', 'evaluation_roles', 'evaluation_question_categories'))::text),
  ('c06 리허설 객체 존재', ((to_regclass('private.overtime_rehearsal_snapshot') is not null) or (to_regclass('private.overtime_rehearsal_catalog') is not null))::text)
),
fp(check_name, detail) as (
  -- 스키마·함수 지문
  select 'd01 fp overtime 함수(정의·권한)',
         md5(coalesce(string_agg(p.oid::regprocedure::text || md5(pg_catalog.pg_get_functiondef(p.oid)) || coalesce(array_to_string(p.proacl, ','), ''),
                                 '|' order by p.oid::regprocedure::text), ''))
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and p.prokind = 'f' and (p.proname like 'overtime\_%' or p.proname = 'sync_team_employees')
  union all
  select 'd02 fp 그 밖의 public·private 함수',
         md5(coalesce(string_agg(p.oid::regprocedure::text || md5(pg_catalog.pg_get_functiondef(p.oid)) || coalesce(array_to_string(p.proacl, ','), ''),
                                 '|' order by p.oid::regprocedure::text), ''))
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and p.prokind = 'f' and not (p.proname like 'overtime\_%' or p.proname = 'sync_team_employees')
  union all
  select 'd03 fp 메뉴 권한 함수 2개(본문·설정·권한)',
         md5(coalesce(string_agg(p.oid::regprocedure::text || md5(p.prosrc) || coalesce(array_to_string(p.proconfig, ';'), '')
                                 || coalesce(array_to_string(p.proacl, ','), ''), '|' order by p.oid::regprocedure::text), ''))
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname in ('menu_permission', 'menu_any_readable')
  union all
  select 'd04 fp overtime 트리거',
         md5(coalesce(string_agg(t.tgname::text || pg_catalog.pg_get_triggerdef(t.oid) || t.tgenabled::text, '|' order by t.tgname), ''))
  from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid = t.tgrelid
  where not t.tgisinternal and c.relname like 'overtime\_%'
  union all
  select 'd05 fp overtime 표 컬럼',
         md5(coalesce(string_agg(c.table_name || '.' || c.column_name || ':' || c.data_type || ':' || c.is_nullable || ':' || coalesce(c.column_default, ''),
                                 '|' order by c.table_name, c.ordinal_position), ''))
  from information_schema.columns c where c.table_schema = 'public' and c.table_name like 'overtime\_%'
  union all
  select 'd06 fp overtime 표·holidays 정책',
         md5(coalesce(string_agg(p.tablename || '.' || p.policyname || p.cmd || array_to_string(p.roles, ',') || coalesce(p.qual, '') || coalesce(p.with_check, ''),
                                 '|' order by p.tablename, p.policyname), ''))
  from pg_catalog.pg_policies p where p.schemaname = 'public' and (p.tablename like 'overtime\_%' or p.tablename = 'holidays')
  union all
  select 'd07 fp 공용 표 9개 정책',
         md5(coalesce(string_agg(p.tablename || '.' || p.policyname || p.cmd || array_to_string(p.roles, ',') || coalesce(p.qual, '') || coalesce(p.with_check, ''),
                                 '|' order by p.tablename, p.policyname), ''))
  from pg_catalog.pg_policies p where p.schemaname = 'public'
    and p.tablename in ('projects', 'project_notes', 'project_tooltips', 'performing_projects', 'expected_projects',
                        'weekly_meta', 'evaluation_types', 'evaluation_roles', 'evaluation_question_categories')
  union all
  select 'd08 fp 그 밖의 표 정책(overtime·holidays·공용 표 9개 제외)',
         md5(coalesce(string_agg(p.tablename || '.' || p.policyname || p.cmd || array_to_string(p.roles, ',') || coalesce(p.qual, '') || coalesce(p.with_check, ''),
                                 '|' order by p.tablename, p.policyname), ''))
  from pg_catalog.pg_policies p where p.schemaname = 'public' and p.tablename not like 'overtime\_%' and p.tablename <> 'holidays'
    and p.tablename not in ('projects', 'project_notes', 'project_tooltips', 'performing_projects', 'expected_projects',
                            'weekly_meta', 'evaluation_types', 'evaluation_roles', 'evaluation_question_categories')
  union all
  select 'd09 fp overtime 외 표 컬럼',
         md5(coalesce(string_agg(c.table_name || '.' || c.column_name || ':' || c.data_type || ':' || c.is_nullable || ':' || coalesce(c.column_default, ''),
                                 '|' order by c.table_name, c.ordinal_position), ''))
  from information_schema.columns c where c.table_schema = 'public' and c.table_name not like 'overtime\_%'
  union all
  select 'd10 fp overtime 외 인덱스',
         md5(coalesce(string_agg(i.tablename || '.' || i.indexname || i.indexdef, '|' order by i.tablename, i.indexname), ''))
  from pg_catalog.pg_indexes i where i.schemaname = 'public' and i.tablename not like 'overtime\_%'
  -- 데이터 지문 (값은 출력하지 않는다)
  union all select 'e01 data allowed_users(seed 시험 계정 3개 제외)',
         md5(coalesce(string_agg(md5(u.email) || u.is_admin::text || coalesce(u.menu_permissions::text, '-'), '|' order by u.email), '')) from public.allowed_users u
         where u.email <> all (array['ot-ui-test@example.com', 'ot-test-writer@example.invalid', 'ot-test-admin@example.invalid'])
  union all select 'e02 data engineer_contacts', md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from public.engineer_contacts x
  union all select 'e03 data holidays', md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from public.holidays x
  union all select 'e04 data projects(seed 고정 ID 제외)', md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from public.projects x
         where x.id::text not like 'f2000000-0000-4000-8000-00000000000_' and x.id::text <> 'd1000000-0000-4000-8000-000000000001'
  union all select 'e05 data project_notes', md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from public.project_notes x
  union all select 'e06 data project_tooltips', md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from public.project_tooltips x
  union all select 'e07 data performing_projects', md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from public.performing_projects x
  union all select 'e08 data expected_projects', md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from public.expected_projects x
  union all select 'e09 data weekly_meta', md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from public.weekly_meta x
  union all select 'e10 data evaluation_types', md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from public.evaluation_types x
  union all select 'e11 data evaluation_roles', md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from public.evaluation_roles x
  union all select 'e12 data evaluation_question_categories', md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from public.evaluation_question_categories x
  union all select 'e13 data overtime_employees', md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from public.overtime_employees x
  union all select 'e14 data overtime_employee_tasks', md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from public.overtime_employee_tasks x
  union all select 'e15 data overtime_projects', md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from public.overtime_projects x
  union all select 'e16 data overtime_project_members', md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from public.overtime_project_members x
)
select check_name, detail from (select * from cnt union all select * from fp) z
order by check_name;
