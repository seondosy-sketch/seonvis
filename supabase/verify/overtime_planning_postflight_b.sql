-- 연장근무 자동배정 — Migration B 직후 확인 (읽기 전용, SELECT 한 문장)
--
-- migration_overtime_planning_b_activate.sql 적용 직후(Phase 4 배포와 같이) SQL Editor에서 실행한다.
-- 프로젝트 동기화 RPC(migration_overtime_project_sync_rpc.sql)를 같이 적용했다면 b11 행도 OK여야 한다.
-- verdict가 전부 OK여야 한다. fp_* 행은 B 직전 preflight와 같아야 한다. 개인정보 값은 나오지 않는다.

with
fn_expect(sig, want_definer, want_acl) as (
  values
    -- 사용자 RPC: DEFINER, authenticated만 (함수 안에서 overtime write / is_admin을 다시 확인)
    ('public.overtime_save_assignment_run(jsonb,jsonb)', true, 'authenticated'),
    ('public.overtime_confirm_run(uuid,uuid[])', true, 'authenticated'),
    ('public.overtime_unconfirm_drafts(uuid[])', true, 'authenticated'),
    ('public.overtime_discard_run(uuid)', true, 'authenticated'),
    ('public.sync_team_employees()', true, 'authenticated,service_role'),
    -- private 헬퍼: 소유자만
    ('private.overtime_require_write()', true, ''),
    ('private.overtime_is_admin()', true, ''),
    ('private.overtime_week_total(uuid,date,uuid)', true, ''),
    ('private.overtime_assert_weekly_cap(uuid,date,numeric,uuid,numeric)', true, ''),
    ('private.overtime_refresh_run_status(uuid)', true, ''),
    ('private.overtime_week_start(date)', false, ''),
    ('private.overtime_pay_period(text)', false, ''),
    -- 트리거 함수: 보호 트리거는 호출자(current_user)를 봐야 하므로 INVOKER, 주간 합산은 DEFINER
    ('private.overtime_work_records_protect()', false, ''),
    ('private.overtime_work_records_weekly_cap()', true, ''),
    ('private.overtime_drafts_guard()', false, ''),
    ('private.overtime_runs_guard()', false, ''),
    ('private.overtime_monthly_targets_touch()', false, '')
),
fn_actual as (
  select f.sig, f.want_definer, f.want_acl, p.oid is not null as present, p.prosecdef, p.proconfig,
         pg_get_userbyid(p.proowner) as owner,
         coalesce((select string_agg(case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end, ','
                                     order by case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end)
                   from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                   where a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner), '') as acl
  from fn_expect f left join pg_proc p on p.oid = to_regprocedure(f.sig)
),
table_owner as (
  select pg_get_userbyid(c.relowner) as owner from pg_class c where c.oid = to_regclass('public.overtime_work_records')
),
checks(check_name, verdict, detail) as (
  select 'b01_fn_' || f.sig,
         case when f.present and f.prosecdef = f.want_definer and f.proconfig is not null and f.acl = f.want_acl then 'OK' else 'FAIL' end,
         'definer=' || coalesce(f.prosecdef::text, '없음') || ' search_path=' || coalesce(array_to_string(f.proconfig, ';'), '없음')
         || ' acl=[' || f.acl || '] want=[' || f.want_acl || ']'
  from fn_actual f
  union all
  -- 소유자 맥락 판정의 전제: DEFINER RPC 소유자 = 테이블 소유자
  select 'b02_rpc_owner_equals_table_owner',
         case when bool_and(f.owner = t.owner) then 'OK' else 'FAIL' end,
         'table=' || min(t.owner) || ' rpc=' || string_agg(distinct f.owner, ',')
  from fn_actual f cross join table_owner t
  where f.sig like 'public.overtime\_%' or f.sig like 'private.overtime\_%'
  union all
  select 'b03_triggers',
         case when count(*) = 5 and bool_and(tgenabled = 'O') then 'OK' else 'FAIL' end,
         count(*) || ' / 5: ' || string_agg(tgname::text || '(' || tgenabled::text || ')', ',' order by tgname)
  from pg_trigger
  where not tgisinternal
    and tgname in ('overtime_work_records_a_protect', 'overtime_work_records_b_weekly_cap', 'overtime_assignment_drafts_guard',
                   'overtime_assignment_runs_guard', 'overtime_monthly_targets_touch')
  union all
  -- 보호 트리거가 주간 검사보다 먼저(이름순) — BEFORE 트리거는 이름순으로 실행된다
  select 'b04_record_trigger_order',
         case when string_agg(tgname, ',' order by tgname) = 'overtime_work_records_a_protect,overtime_work_records_b_weekly_cap' then 'OK' else 'FAIL' end,
         string_agg(tgname, ',' order by tgname)
  from pg_trigger where tgrelid = to_regclass('public.overtime_work_records') and not tgisinternal
  union all
  select 'b05_drafts_policies',
         case when count(*) = 2 and bool_and(roles = '{authenticated}')
                   and count(*) filter (where cmd = 'SELECT') = 1 and count(*) filter (where cmd = 'UPDATE') = 1 then 'OK' else 'FAIL' end,
         string_agg(policyname || '(' || cmd || ':' || array_to_string(roles, ',') || ')', ' ' order by policyname)
  from pg_policies where schemaname = 'public' and tablename = 'overtime_assignment_drafts'
  union all
  -- 실행 기록·초안에는 INSERT/DELETE 정책이 없어야 한다(RPC 전용)
  select 'b06_no_direct_insert_delete_policies',
         case when count(*) = 0 then 'OK' else 'FAIL' end,
         count(*) || '개'
  from pg_policies
  where schemaname = 'public' and tablename in ('overtime_assignment_runs', 'overtime_assignment_drafts')
    and cmd in ('INSERT', 'DELETE', 'ALL')
  union all
  select 'b07_anon_public_execute',
         case when count(*) = 0 then 'OK' else 'FAIL' end,
         count(*) || '개 함수 (anon 또는 PUBLIC 실행 가능 — 0이어야 함)'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private')
    and (p.proname like 'overtime\_%' or p.proname = 'sync_team_employees')
    and exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                where a.privilege_type = 'EXECUTE' and (a.grantee = 0 or a.grantee = 'anon'::regrole))
  union all
  select 'b08_private_usage_unchanged',
         case when not has_schema_privilege('anon', 'private', 'USAGE') and not has_schema_privilege('authenticated', 'private', 'USAGE')
                   and not has_schema_privilege('service_role', 'private', 'USAGE') then 'OK' else 'FAIL' end,
         'anon/authenticated/service_role 모두 false여야 함'
  union all
  select 'b09_new_tables_empty',
         case when (select count(*) from public.overtime_assignment_runs) + (select count(*) from public.overtime_assignment_drafts) = 0
              then 'OK' else 'INFO' end,
         'runs/drafts 행 수 합계 (B 직후 0)'
  union all
  select 'b10_no_auto_records',
         case when count(*) = 0 then 'OK' else 'INFO' end,
         count(*) || '건 source=auto (B 직후 0)'
  from public.overtime_work_records where source = 'auto'
  union all
  -- 선택안: 프로젝트 동기화 RPC (적용했을 때만 OK, 미적용이면 INFO)
  select 'b11_project_sync_rpc',
         case when p.oid is null then 'INFO'
              when not p.prosecdef and p.proconfig is not null
                   and coalesce((select string_agg(case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end, ',')
                                 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                 where a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner), '') = 'service_role' then 'OK'
              else 'FAIL' end,
         case when p.oid is null then '미적용' else 'invoker, service_role만 실행' end
  from (select to_regprocedure('public.overtime_apply_project_sync(jsonb,jsonb)') as fn) x
  left join pg_proc p on p.oid = x.fn
  union all
  -- ── 지문 (B 직전 preflight와 같아야 함) ──
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
