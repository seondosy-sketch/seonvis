-- 연장근무 자동배정 — migration 직전 점검 (읽기 전용, SELECT 한 문장)
--
-- Migration A 직전과 Migration B 직전에 각각 SQL Editor에서 실행한다. 데이터·스키마를 바꾸지 않는다.
-- 결과: check_name / verdict(OK·STOP·INFO) / detail. STOP이 하나라도 있으면 migration을 실행하지 않는다.
-- 개인정보 값은 나오지 않는다(건수·해시·역할명만). fp_* 행의 detail은 postflight의 같은 이름 행과 같아야 한다.
-- 결과는 Export → Copy as CSV로 전달한다.
-- p10(미연결 재직 직원)과 p11(미연결 '미래사업팀' 주소록)이 둘 다 0보다 크면 둘 다 STOP — 이름으로 자동 연결하지 않는다.
--   supabase/verify/overtime_employee_link_check.sql로 대상 UUID를 보고 주소록에서 사람이 연결한 뒤 이 파일을 다시 실행한다.

with
a_objects(kind, name, present) as (
  values
    ('table', 'overtime_monthly_targets', to_regclass('public.overtime_monthly_targets') is not null),
    ('table', 'overtime_member_tasks', to_regclass('public.overtime_member_tasks') is not null),
    ('table', 'overtime_assignment_runs', to_regclass('public.overtime_assignment_runs') is not null),
    ('table', 'overtime_assignment_drafts', to_regclass('public.overtime_assignment_drafts') is not null),
    ('index', 'engineer_contacts_employee_id_key', to_regclass('public.engineer_contacts_employee_id_key') is not null),
    ('func', 'private.overtime_pay_period', to_regprocedure('private.overtime_pay_period(text)') is not null),
    ('policy', 'holidays.overtime_select', exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'holidays' and policyname = 'overtime_select')),
    ('column', 'overtime_work_records.source', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'overtime_work_records' and column_name = 'source'))
),
b_objects(kind, name, present) as (
  values
    ('rpc', 'overtime_save_assignment_run', to_regprocedure('public.overtime_save_assignment_run(jsonb,jsonb)') is not null),
    ('rpc', 'overtime_confirm_run', to_regprocedure('public.overtime_confirm_run(uuid,uuid[])') is not null),
    ('rpc', 'overtime_unconfirm_drafts', to_regprocedure('public.overtime_unconfirm_drafts(uuid[])') is not null),
    ('rpc', 'overtime_discard_run', to_regprocedure('public.overtime_discard_run(uuid)') is not null),
    ('trigger', 'overtime_work_records_a_protect', exists (select 1 from pg_trigger where tgname = 'overtime_work_records_a_protect')),
    ('trigger', 'overtime_work_records_b_weekly_cap', exists (select 1 from pg_trigger where tgname = 'overtime_work_records_b_weekly_cap'))
),
team as (
  select c.employee_id, c.name, c.rank, (c.company = '미래사업팀' and c.employment_status = '재직') as active
  from public.engineer_contacts c where c.employee_id is not null
),
-- 직원 분리 위험: 미연결 재직 직원(p10)과 미연결 '미래사업팀' 주소록(p11)이 둘 다 있으면 첫 동기화가 같은 사람을
-- 새 UUID로 만들고 기존 행을 비활성으로 돌릴 수 있다 → 둘 다 STOP. migration A·C와 sync_team_employees도 같은 조건에서 중단한다.
link as (
  select (select count(*) from public.overtime_employees e
           where e.is_active and not exists (select 1 from public.engineer_contacts c where c.employee_id = e.id)) as unlinked_employees,
         (select count(*) from public.engineer_contacts c where c.company = '미래사업팀' and c.employee_id is null) as unlinked_contacts
),
checks(check_name, verdict, detail) as (
  -- 적용 상태: A·B 객체가 전부 없거나 전부 있어야 한다(일부만 있으면 이전 적용이 중간에 끊긴 것)
  select 'p01_state_A',
         case when bool_and(present) or not bool_or(present) then 'OK' else 'STOP' end,
         case when bool_and(present) then 'A 적용됨' when not bool_or(present) then 'A 미적용' else 'A 일부만 존재: ' || string_agg(name, ',') filter (where present) end
  from a_objects
  union all
  select 'p02_state_B',
         case when bool_and(present) or not bool_or(present) then 'OK' else 'STOP' end,
         case when bool_and(present) then 'B 적용됨' when not bool_or(present) then 'B 미적용' else 'B 일부만 존재: ' || string_agg(name, ',') filter (where present) end
  from b_objects
  union all
  select 'p03_name_key',
         'INFO',
         case when exists (select 1 from pg_constraint where conname = 'overtime_employees_name_key')
              then 'overtime_employees_name_key 있음 (A가 제거 예정)' else '없음 (A 적용 후 정상)' end
  union all
  select 'p04_hours_precision',
         case when max(numeric_precision) = 4 and max(numeric_scale) = 2 then 'OK' else 'STOP' end,
         'numeric(' || max(numeric_precision) || ',' || max(numeric_scale) || ')'
  from information_schema.columns
  where table_schema = 'public' and table_name = 'overtime_work_records' and column_name = 'hours'
  union all
  select 'p05_records_count', 'INFO', count(*)::text || '건 (카탈로그 확인 시 0)' from public.overtime_work_records
  union all
  select 'p06_weeks_over_12h',
         case when count(*) = 0 then 'OK' else 'INFO' end,
         count(*)::text || '개 직원×주 (있으면 B 적용 전 보고 — 삭제·수정하지 않음)'
  from (select 1 from public.overtime_work_records
        group by employee_id, date_trunc('week', work_date::timestamp) having sum(hours) > 12) w
  union all
  select 'p07_employee_id_duplicate',
         case when count(*) = 0 then 'OK' else 'STOP' end,
         count(*)::text
  from (select 1 from public.engineer_contacts where employee_id is not null group by employee_id having count(*) > 1) d
  union all
  select 'p08_linked_employees',
         case when count(*) = 9 then 'OK' else 'INFO' end,
         count(*)::text || '명 연결 (카탈로그 확인 시 9)'
  from team
  union all
  -- 새 sync를 돌려도 바뀌지 않아야 할 행: 연결된 직원 중 이름·직급·재직이 주소록과 다른 수
  select 'p09_sync_noop_linked',
         case when count(*) = 0 then 'OK' else 'INFO' end,
         count(*)::text || '명 (0이면 다음 sync에서 연결 직원 UPDATE 없음)'
  from public.overtime_employees e join team t on t.employee_id = e.id
  where (e.name, e.position, e.is_active) is distinct from (t.name, t.rank, t.active)
  union all
  select 'p10_unlinked_active_employees',
         case when l.unlinked_employees = 0 then 'OK' when l.unlinked_contacts > 0 then 'STOP' else 'INFO' end,
         l.unlinked_employees::text || '명 (새 sync가 비활성 처리할 대상'
         || case when l.unlinked_contacts > 0 then ' — p11과 동시: 직원 분리 위험, overtime_employee_link_check.sql로 수동 연결 후 다시 preflight)' else ')' end
  from link l
  union all
  select 'p11_unlinked_team_contacts',
         case when l.unlinked_contacts = 0 then 'OK' when l.unlinked_employees > 0 then 'STOP' else 'INFO' end,
         l.unlinked_contacts::text || '명 (새 sync가 새 직원 행을 만들 대상'
         || case when l.unlinked_employees > 0 then ' — p10과 동시: 직원 분리 위험, overtime_employee_link_check.sql로 수동 연결 후 다시 preflight)' else ')' end
  from link l
  union all
  select 'p12_sync_team_employees_acl',
         'INFO',
         coalesce((select string_agg(case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end, ',' order by a.grantee)
                   from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                   where p.oid = to_regprocedure('public.sync_team_employees()') and a.privilege_type = 'EXECUTE'), '-')
         || ' (카탈로그: postgres,authenticated,service_role)'
  union all
  select 'p13_private_usage',
         case when not has_schema_privilege('anon', 'private', 'USAGE') and not has_schema_privilege('authenticated', 'private', 'USAGE')
                   and not has_schema_privilege('service_role', 'private', 'USAGE') then 'OK' else 'STOP' end,
         'anon=' || has_schema_privilege('anon', 'private', 'USAGE') || ' authenticated=' || has_schema_privilege('authenticated', 'private', 'USAGE')
         || ' service_role=' || has_schema_privilege('service_role', 'private', 'USAGE')
  union all
  select 'p14_holidays',
         case when count(*) filter (where extract(year from holiday_date) = 2026) = 16 then 'OK' else 'INFO' end,
         '2026=' || count(*) filter (where extract(year from holiday_date) = 2026)
         || ' 2027=' || count(*) filter (where extract(year from holiday_date) = 2027) || ' (2027은 12/21 전에 별도 등록)'
  from public.holidays
  union all
  -- B의 "소유자 맥락" 판정 전제: 연장근무 테이블 소유자가 한 역할이고, migration 실행 역할과 같아야 한다
  select 'p15_table_owner',
         case when count(distinct pg_get_userbyid(c.relowner)) = 1 and min(pg_get_userbyid(c.relowner)) = current_user then 'OK' else 'STOP' end,
         string_agg(distinct pg_get_userbyid(c.relowner), ',') || ' / 실행 역할 ' || current_user
  from pg_class c
  where c.oid in (to_regclass('public.overtime_work_records'), to_regclass('public.overtime_employees'),
                  to_regclass('public.overtime_projects'), to_regclass('public.overtime_project_members'),
                  to_regclass('public.overtime_employee_tasks'))
  union all
  -- 동기화 RPC(migration_overtime_project_sync_rpc.sql)의 on conflict가 쓰는 부분 UNIQUE 인덱스 — 없거나 모양이 다르면 STOP
  select 'p16_sync_source_index',
         case when x.on_table and x.is_unique and x.on_column and x.partial_ok and x.valid_ready then 'OK' else 'STOP' end,
         case when x.on_table is null then 'overtime_projects_source_project_id_key 없음 (migration_overtime_source_project.sql 필요)'
              else '대상 표=' || x.on_table::text || ' unique=' || x.is_unique::text || ' 열=' || x.on_column::text
                   || ' 부분조건=' || x.partial_ok::text || ' valid·ready=' || x.valid_ready::text end
  -- 속성마다 coalesce(…, false) — migration 가드와 같은 fail-closed 판정(인덱스가 없으면 x 전체가 NULL → '없음')
  from (select 1) one left join (select coalesce(i.indrelid = to_regclass('public.overtime_projects'), false) as on_table,
                 coalesce(i.indisunique, false) as is_unique,
                 coalesce(i.indnatts = 1 and i.indexprs is null and a.attname = 'source_project_id', false) as on_column,
                 coalesce(pg_catalog.pg_get_expr(i.indpred, i.indrelid) = '(source_project_id IS NOT NULL)', false) as partial_ok,
                 coalesce(i.indisvalid and i.indisready, false) as valid_ready
          from pg_catalog.pg_index i
          left join pg_catalog.pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
          where i.indexrelid = to_regclass('public.overtime_projects_source_project_id_key')) x on true
  union all
  -- ── 지문: postflight의 같은 이름 행과 같아야 한다 ──
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
  -- 기존 스키마 지문: 기존 테이블의 기존 컬럼·기존 정책 (migration이 의도적으로 추가·제거하는 것은 제외)
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
