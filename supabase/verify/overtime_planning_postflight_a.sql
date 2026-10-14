-- 연장근무 자동배정 — Migration A 직후 확인 (읽기 전용, SELECT 한 문장)
--
-- migration_overtime_planning_a_base.sql 적용 직후 SQL Editor에서 실행한다. 데이터·스키마를 바꾸지 않는다.
-- verdict가 전부 OK여야 한다. fp_* 행의 detail은 직전 preflight의 같은 이름 행과 같아야 한다(기존 데이터·스키마 불변).
-- 결과는 Export → Copy as CSV로 전달한다. 개인정보 값은 나오지 않는다.
-- a16~a21: 직원 UUID 보존 확인 — 수동 연결 후·첫 동기화 후에도 다시 실행해 전부 OK인지 본다.

with
fn_expect(sig, want_definer, want_acl) as (
  -- want_acl: 소유자 외에 EXECUTE를 가진 역할(정렬된 목록, 없으면 빈 문자열)
  values
    ('public.sync_team_employees()', true, 'authenticated,service_role'),
    ('private.overtime_week_start(date)', false, ''),
    ('private.overtime_pay_period(text)', false, ''),
    ('private.overtime_monthly_targets_touch()', false, '')
),
fn_actual as (
  select f.sig, f.want_definer, f.want_acl, p.oid is not null as present, p.prosecdef, p.proconfig,
         coalesce((select string_agg(case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end, ','
                                     order by case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end)
                   from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                   where a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner), '') as acl
  from fn_expect f left join pg_proc p on p.oid = to_regprocedure(f.sig)
),
new_tables(name) as (
  values ('overtime_monthly_targets'), ('overtime_member_tasks'), ('overtime_assignment_runs'), ('overtime_assignment_drafts')
),
team as (
  select c.employee_id, c.name, c.rank, (c.company = '미래사업팀' and c.employment_status = '재직') as active
  from public.engineer_contacts c where c.employee_id is not null
),
checks(check_name, verdict, detail) as (
  select 'a01_new_tables',
         case when count(*) filter (where to_regclass('public.' || name) is not null) = 4 then 'OK' else 'FAIL' end,
         count(*) filter (where to_regclass('public.' || name) is not null) || ' / 4'
  from new_tables
  union all
  select 'a02_new_tables_rls',
         case when count(*) = 4 and bool_and(c.relrowsecurity) and not bool_or(c.relforcerowsecurity) then 'OK' else 'FAIL' end,
         count(*) filter (where c.relrowsecurity) || ' / 4 enabled'
  from new_tables t join pg_class c on c.oid = to_regclass('public.' || t.name)
  union all
  select 'a03_record_columns_nullable_no_default',
         case when count(*) = 8 and bool_and(is_nullable = 'YES') and count(column_default) = 0 then 'OK' else 'FAIL' end,
         count(*) || ' cols / nullable ' || count(*) filter (where is_nullable = 'YES') || ' / default ' || count(column_default)
  from information_schema.columns
  where table_schema = 'public' and table_name = 'overtime_work_records'
    and column_name in ('source', 'assignment_run_id', 'assignment_draft_id', 'employee_name_snapshot',
                        'project_name_snapshot', 'task_name_snapshot', 'assignment_exception_reason', 'confirmed_at')
  union all
  select 'a04_record_new_values_empty',
         case when count(*) = 0 then 'OK' else 'FAIL' end,
         count(*) || '건 (A 직후 0 — backfill 없음, A는 source를 채우는 트리거도 없다)'
  from public.overtime_work_records
  where source is not null or assignment_run_id is not null or employee_name_snapshot is not null
     or project_name_snapshot is not null or task_name_snapshot is not null or assignment_exception_reason is not null
  union all
  select 'a05_constraints',
         case when count(*) = 8 then 'OK' else 'FAIL' end,
         count(*) || ' / 8: ' || string_agg(conname, ',' order by conname)
  from pg_constraint
  where conname in ('overtime_work_records_source_check', 'overtime_work_records_auto_link_check',
                    'overtime_work_records_exception_check', 'overtime_work_records_assignment_run_fk',
                    'overtime_work_records_assignment_draft_fk', 'overtime_project_members_id_employee_key',
                    'overtime_employee_tasks_id_employee_key', 'overtime_member_tasks_member_fk')
  union all
  select 'a06_indexes',
         case when count(*) = 4 then 'OK' else 'FAIL' end,
         count(*) || ' / 4: ' || string_agg(indexname, ',' order by indexname)
  from pg_indexes
  where schemaname = 'public'
    and indexname in ('engineer_contacts_employee_id_key', 'overtime_assignment_drafts_one_per_day',
                      'overtime_work_records_assignment_draft_key', 'overtime_work_records_auto_one_per_day')
  union all
  select 'a07_name_unique_dropped',
         case when not exists (select 1 from pg_constraint where conname = 'overtime_employees_name_key') then 'OK' else 'FAIL' end,
         'overtime_employees_name_key'
  union all
  -- 신규 테이블 정책: 전부 TO authenticated, 개수 고정 (runs·drafts는 A에서 SELECT만)
  select 'a08_new_table_policies',
         case when count(*) = 10 and bool_and(roles = '{authenticated}')
                   and count(*) filter (where tablename = 'overtime_assignment_runs') = 1
                   and count(*) filter (where tablename = 'overtime_assignment_drafts') = 1 then 'OK' else 'FAIL' end,
         string_agg(tablename || '.' || policyname || '(' || cmd || ':' || array_to_string(roles, ',') || ')', ' ' order by tablename, policyname)
  from pg_policies
  where schemaname = 'public' and tablename in (select name from new_tables)
  union all
  select 'a09_holidays_policy',
         case when count(*) = 1 and bool_and(roles = '{authenticated}') and bool_and(cmd = 'SELECT')
                   and bool_and(qual like '%menu_permission(''overtime''%') then 'OK' else 'FAIL' end,
         coalesce(string_agg(cmd || ' ' || array_to_string(roles, ',') || ' ' || qual, ' '), '없음')
  from pg_policies where schemaname = 'public' and tablename = 'holidays' and policyname = 'overtime_select'
  union all
  -- A 상태 계약: 기존 수동입력에 영향을 주는 트리거가 없다
  select 'a10_no_record_triggers',
         case when count(*) = 0 then 'OK' else 'FAIL' end,
         count(*) || '개 (A에서는 0 — 주 12시간·자동확정 보호는 B)'
  from pg_trigger where tgrelid = to_regclass('public.overtime_work_records') and not tgisinternal
  union all
  select 'a11_function_' || f.sig,
         case when f.present and f.prosecdef = f.want_definer and f.proconfig is not null and f.acl = f.want_acl then 'OK' else 'FAIL' end,
         'definer=' || coalesce(f.prosecdef::text, '없음') || ' search_path=' || coalesce(array_to_string(f.proconfig, ';'), '없음')
         || ' acl=[' || f.acl || '] want=[' || f.want_acl || ']'
  from fn_actual f
  union all
  select 'a12_private_usage_unchanged',
         case when not has_schema_privilege('anon', 'private', 'USAGE') and not has_schema_privilege('authenticated', 'private', 'USAGE')
                   and not has_schema_privilege('service_role', 'private', 'USAGE') then 'OK' else 'FAIL' end,
         'anon/authenticated/service_role 모두 false여야 함'
  union all
  select 'a13_new_tables_empty',
         case when (select count(*) from public.overtime_monthly_targets) + (select count(*) from public.overtime_member_tasks)
                 + (select count(*) from public.overtime_assignment_runs) + (select count(*) from public.overtime_assignment_drafts) = 0
              then 'OK' else 'FAIL' end,
         'targets/member_tasks/runs/drafts 행 수 합계 0'
  union all
  select 'a14_sync_noop_linked',
         case when count(*) = 0 then 'OK' else 'FAIL' end,
         count(*) || '명 (연결 직원 이름·직급·재직이 주소록과 다른 수 — 0이면 sync가 UPDATE하지 않음)'
  from public.overtime_employees e join team t on t.employee_id = e.id
  where (e.name, e.position, e.is_active) is distinct from (t.name, t.rank, t.active)
  union all
  select 'a15_linked_employees', case when count(*) = 9 then 'OK' else 'INFO' end, count(*) || '명 연결' from team
  union all
  -- ── 직원 UUID 보존: 과거 기록·월 목표·업무·참여가 모두 존재하는 직원 UUID를 가리켜야 한다(고아·새 UUID 분리 없음) ──
  -- 첫 동기화(화면 진입 시 sync_team_employees) 뒤에도 한 번 더 실행한다.
  select 'a16_records_employee_exists',
         case when count(*) = 0 then 'OK' else 'FAIL' end,
         count(*) || '건 (없는 직원 UUID를 가리키는 overtime_work_records)'
  from public.overtime_work_records r where not exists (select 1 from public.overtime_employees e where e.id = r.employee_id)
  union all
  select 'a17_targets_employee_exists',
         case when count(*) = 0 then 'OK' else 'FAIL' end,
         count(*) || '건 (없는 직원 UUID를 가리키는 overtime_monthly_targets)'
  from public.overtime_monthly_targets t where not exists (select 1 from public.overtime_employees e where e.id = t.employee_id)
  union all
  select 'a18_tasks_employee_exists',
         case when count(*) = 0 then 'OK' else 'FAIL' end,
         count(*) || '건 (없는 직원 UUID를 가리키는 overtime_employee_tasks)'
  from public.overtime_employee_tasks t where not exists (select 1 from public.overtime_employees e where e.id = t.employee_id)
  union all
  select 'a19_members_employee_exists',
         case when count(*) = 0 then 'OK' else 'FAIL' end,
         count(*) || '건 (없는 직원 UUID를 가리키는 overtime_project_members)'
  from public.overtime_project_members m where not exists (select 1 from public.overtime_employees e where e.id = m.employee_id)
  union all
  -- 분리 의심: 과거 데이터(기록·업무·참여·목표)가 있는 직원이 주소록 연결 없이 비활성인데, 주소록에 연결된 다른 직원에게는
  -- 과거 데이터가 하나도 없는 경우(새 UUID로 갈라진 모양). 건수만 낸다 — 자동 연결하지 않는다.
  select 'a20_split_suspects',
         case when count(*) = 0 then 'OK' else 'FAIL' end,
         count(*) || '명 (주소록 미연결·비활성인데 과거 데이터가 있는 직원 — overtime_employee_link_check.sql로 확인)'
  from public.overtime_employees e
  where not e.is_active
    and not exists (select 1 from public.engineer_contacts c where c.employee_id = e.id)
    and (exists (select 1 from public.overtime_work_records r where r.employee_id = e.id)
         or exists (select 1 from public.overtime_employee_tasks t where t.employee_id = e.id)
         or exists (select 1 from public.overtime_project_members m where m.employee_id = e.id)
         or exists (select 1 from public.overtime_monthly_targets t where t.employee_id = e.id))
    and exists (select 1 from public.overtime_employees n
                join public.engineer_contacts c on c.employee_id = n.id
                where n.id <> e.id
                  and not exists (select 1 from public.overtime_work_records r where r.employee_id = n.id)
                  and not exists (select 1 from public.overtime_employee_tasks t where t.employee_id = n.id)
                  and not exists (select 1 from public.overtime_project_members m where m.employee_id = n.id))
  union all
  select 'a21_employee_link_required',
         case when (select count(*) from public.overtime_employees e
                     where e.is_active and not exists (select 1 from public.engineer_contacts c where c.employee_id = e.id)) > 0
               and (select count(*) from public.engineer_contacts c where c.company = '미래사업팀' and c.employee_id is null) > 0
              then 'FAIL' else 'OK' end,
         '미연결 재직 직원과 미연결 미래사업팀 주소록이 동시에 있으면 FAIL (sync가 OVERTIME_EMPLOYEE_LINK_REQUIRED로 멈춤)'
  union all
  -- ── 지문 (preflight와 같아야 함) ──
  select 'fp_records', 'INFO',
         count(*) || '건 / ' || coalesce(sum(hours), 0) || 'h / '
         || md5(coalesce(string_agg(id::text || employee_id::text || project_id::text || work_date::text || hours::text
                                    || start_time || end_time || coalesce(break_hours::text, '') || task_description || note, '|' order by id), ''))
  from public.overtime_work_records
  union all
  select 'fp_linked_employees', 'INFO',
         md5(coalesce(string_agg(e.id::text || e.name || e.position || e.is_active::text, '|' order by e.id), ''))
  from public.overtime_employees e
  union all
  select 'fp_config_rows', 'INFO',
         (select count(*) from public.overtime_projects) || ' projects / '
         || (select count(*) from public.overtime_project_members) || ' members / '
         || (select count(*) from public.overtime_employee_tasks) || ' tasks / '
         || (select count(*) from public.field_overtime_records) || ' field_records'
  union all
  select 'fp_existing_columns', 'INFO',
         md5(string_agg(table_name || '.' || column_name || ':' || data_type || coalesce(numeric_precision::text, '')
                        || coalesce(numeric_scale::text, '') || is_nullable || coalesce(column_default, ''), '|'
                        order by table_name, column_name))
  from information_schema.columns
  where table_schema = 'public'
    and table_name in ('overtime_employees', 'overtime_employee_tasks', 'overtime_projects', 'overtime_project_members',
                       'overtime_work_records', 'holidays', 'engineer_contacts')
    and not (table_name = 'overtime_work_records' and column_name in ('source', 'assignment_run_id', 'assignment_draft_id',
             'employee_name_snapshot', 'project_name_snapshot', 'task_name_snapshot', 'assignment_exception_reason', 'confirmed_at'))
  union all
  select 'fp_existing_policies', 'INFO',
         md5(string_agg(tablename || '.' || policyname || cmd || array_to_string(roles, ',') || coalesce(qual, '') || coalesce(with_check, ''), '|'
                        order by tablename, policyname))
  from pg_policies
  where schemaname = 'public'
    and tablename in ('overtime_employees', 'overtime_employee_tasks', 'overtime_projects', 'overtime_project_members',
                      'overtime_work_records', 'holidays', 'engineer_contacts')
    and not (tablename = 'holidays' and policyname = 'overtime_select')
)
select check_name, verdict, detail from checks order by check_name;
