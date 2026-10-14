-- 연장근무 자동배정 — 현재 상태 사후확인 (읽기 전용, SELECT 한 문장)
--
-- 대상: A → 동기화 RPC → B → 월 목표 → 격리수준 → C가 모두 적용된 DB(지금의 개발 DB, 운영 적용 완료 후의 운영 DB).
-- A 직후 전용 확인은 overtime_planning_postflight_a.sql(결과 열 verdict)을 그대로 쓴다 — 이 파일은 그것을 대신한다.
-- 결과: check_name / status / detail.
--   status: OK(정상) · INFO(정보만, 조치 불필요) · FAIL(조치 필요). 정상 DB에서는 OK·INFO만 나와야 하며 "예상 FAIL"은 없다.
-- 데이터·스키마를 바꾸지 않는다. 개인정보(이름·이메일) 값은 출력하지 않는다(건수·id 접두어만).
--
-- 함수 확인은 스키마.이름 + 인자 타입(identity arguments, 타입의 public.·pg_catalog. 수식 제거) 단위다. 같은 이름의 다른 인자
-- 함수는 cur_fn_overload로 따로 FAIL.
--   cur_fn_attr:*  언어·변동성·SECURITY DEFINER·search_path를 catalog에서 직접 비교
--   cur_fn_body:*  본문 지문 비교. MD5는 보안 인증이 아니라 "본문이 저장소 최종 정의와 같은가"를 보는 일치 확인용 지문이다.
--                  prosrc($태그$ 사이 본문)를 쓰므로 태그 이름 차이는 영향이 없고, 작은따옴표 밖의 공백·줄바꿈·CR 차이만 무시한다
--                  (문자열 리터럴 안 공백은 그대로 비교). 값은 lib/overtime/sql/migrationFunctions.ts가 만들고
--                  lib/overtime/sql/overtimeSql.test.ts가 저장소와 같은지 고정한다.
--   C가 바꾼 함수 4개는 지문과 별도로 핵심 구문(cur_c01~c03, cur_e01)과 catalog 속성(cur_fn_attr·cur_fn_security)을 확인한다.

with
-- ── 함수 기대값: 저장소 최종 정의 지문 + DEFINER 여부 + 소유자 외 EXECUTE 역할 ──
fn_body(schema_name, fn_name, identity_args, body_md5, lang, volatility, secdef, search_path, source_file) as (
  values
    -- BEGIN fn_body (자동 생성 값 — lib/overtime/sql/migrationFunctions.ts. 손으로 고치지 않는다)
    ('private', 'overtime_assert_monthly_target', 'p_employee uuid, p_date date, p_new_hours numeric, p_exclude_id uuid, p_previous_same_period numeric', 'a640249579b34ba7d07897adf645220a', 'plpgsql', 'v', true, 'search_path=public, pg_temp', 'migration_overtime_cap_isolation_guard.sql'),
    ('private', 'overtime_assert_weekly_cap', 'p_employee uuid, p_date date, p_new_hours numeric, p_exclude_id uuid, p_previous_same_week numeric', 'a505ff5dc8021adb640927d096115420', 'plpgsql', 'v', true, 'search_path=public, pg_temp', 'migration_overtime_cap_isolation_guard.sql'),
    ('private', 'overtime_drafts_guard', '', 'e78cecc55c11b33485b041bfcbf16d8d', 'plpgsql', 'v', false, 'search_path=pg_catalog, pg_temp', 'migration_overtime_planning_c_corrections.sql'),
    ('private', 'overtime_is_admin', '', '3733c94a197669e5088558b741f9c2be', 'sql', 's', true, 'search_path=public, pg_temp', 'migration_overtime_planning_b_activate.sql'),
    ('private', 'overtime_monthly_targets_touch', '', '439530bfc28dac34b9e9ca5c1b6ad54d', 'plpgsql', 'v', false, 'search_path=pg_catalog, pg_temp', 'migration_overtime_planning_a_base.sql'),
    ('private', 'overtime_pay_period', 'p_label text, out period_start date, out period_end date', '8d56197c9b1f89c107f0203590887627', 'plpgsql', 'i', false, 'search_path=pg_catalog, pg_temp', 'migration_overtime_planning_a_base.sql'),
    ('private', 'overtime_pay_period_label', 'p_date date', 'aa42ea296bcf45f9c82ad0772f906687', 'sql', 'i', false, 'search_path=pg_catalog, pg_temp', 'migration_overtime_monthly_target_guard.sql'),
    ('private', 'overtime_refresh_run_status', 'p_run_id uuid', '8990d3b7e3bdc18185435455f8044616', 'plpgsql', 'v', true, 'search_path=public, pg_temp', 'migration_overtime_planning_b_activate.sql'),
    ('private', 'overtime_require_write', '', '16c65d529ad4c90c99a74a79f9d4c8a5', 'plpgsql', 's', true, 'search_path=public, pg_temp', 'migration_overtime_planning_b_activate.sql'),
    ('private', 'overtime_runs_guard', '', '9f0849cd644947036184d8da15bf60a8', 'plpgsql', 'v', false, 'search_path=pg_catalog, pg_temp', 'migration_overtime_planning_b_activate.sql'),
    ('private', 'overtime_week_start', 'p_date date', '656679e8879a1d88cb863dee54a2d924', 'sql', 'i', false, 'search_path=pg_catalog, pg_temp', 'migration_overtime_planning_a_base.sql'),
    ('private', 'overtime_week_total', 'p_employee uuid, p_date date, p_exclude_id uuid', '102749dd3ca376479f47cce8b035c5c1', 'sql', 's', true, 'search_path=public, pg_temp', 'migration_overtime_planning_b_activate.sql'),
    ('private', 'overtime_work_records_monthly_target', '', '169c0c130494f050fb62ef2766ba6716', 'plpgsql', 'v', true, 'search_path=public, pg_temp', 'migration_overtime_monthly_target_guard.sql'),
    ('private', 'overtime_work_records_protect', '', '6714bd8ef6e2e4ad3a8d89af7056872a', 'plpgsql', 'v', false, 'search_path=pg_catalog, pg_temp', 'migration_overtime_planning_b_activate.sql'),
    ('private', 'overtime_work_records_weekly_cap', '', '726d9e885d2ba63d5ff87609742fa897', 'plpgsql', 'v', true, 'search_path=public, pg_temp', 'migration_overtime_planning_b_activate.sql'),
    ('public', 'overtime_apply_project_sync', 'p_inserts jsonb, p_updates jsonb', 'bb59a8bbfa126f6fa1d726200cebbe28', 'plpgsql', 'v', false, 'search_path=public, pg_temp', 'migration_overtime_project_sync_rpc.sql'),
    ('public', 'overtime_confirm_run', 'p_run_id uuid, p_employee_ids uuid[]', '0566c2cd6ac012bfeaeeb21d1a920deb', 'plpgsql', 'v', true, 'search_path=public, pg_temp', 'migration_overtime_planning_c_corrections.sql'),
    ('public', 'overtime_discard_run', 'p_run_id uuid', '9baacba673a6cd09064fca5326cad6c6', 'plpgsql', 'v', true, 'search_path=public, pg_temp', 'migration_overtime_planning_b_activate.sql'),
    ('public', 'overtime_save_assignment_run', 'p_run jsonb, p_drafts jsonb', '599d2c518ba5ffe25df527d9923737f9', 'plpgsql', 'v', true, 'search_path=public, pg_temp', 'migration_overtime_planning_c_corrections.sql'),
    ('public', 'overtime_unconfirm_drafts', 'p_draft_ids uuid[]', 'c422fa65dad3e7505b8a5310919dfd9a', 'plpgsql', 'v', true, 'search_path=public, pg_temp', 'migration_overtime_planning_b_activate.sql'),
    ('public', 'sync_team_employees', '', '4da85c203769503aecfc551539a349dc', 'plpgsql', 'v', true, 'search_path=public, pg_temp', 'migration_overtime_planning_c_corrections.sql')
    -- END fn_body
),
fn_sec(schema_name, fn_name, want_definer, want_acl) as (
  values
    -- 사용자 RPC: DEFINER, authenticated만(함수 첫 줄에서 overtime write / is_admin을 다시 확인)
    ('public', 'overtime_save_assignment_run', true, 'authenticated'),
    ('public', 'overtime_confirm_run', true, 'authenticated'),
    ('public', 'overtime_unconfirm_drafts', true, 'authenticated'),
    ('public', 'overtime_discard_run', true, 'authenticated'),
    ('public', 'sync_team_employees', true, 'authenticated,service_role'),
    -- 프로젝트 동기화: INVOKER, service_role만(서버 API)
    ('public', 'overtime_apply_project_sync', false, 'service_role'),
    -- private 헬퍼·검사 함수: 소유자만 실행
    ('private', 'overtime_require_write', true, ''),
    ('private', 'overtime_is_admin', true, ''),
    ('private', 'overtime_week_total', true, ''),
    ('private', 'overtime_assert_weekly_cap', true, ''),
    ('private', 'overtime_assert_monthly_target', true, ''),
    ('private', 'overtime_refresh_run_status', true, ''),
    ('private', 'overtime_week_start', false, ''),
    ('private', 'overtime_pay_period', false, ''),
    ('private', 'overtime_pay_period_label', false, ''),
    -- 트리거 함수: 보호 트리거는 호출자(current_user)를 봐야 하므로 INVOKER, 합산 트리거는 DEFINER
    ('private', 'overtime_work_records_protect', false, ''),
    ('private', 'overtime_work_records_weekly_cap', true, ''),
    ('private', 'overtime_work_records_monthly_target', true, ''),
    ('private', 'overtime_drafts_guard', false, ''),
    ('private', 'overtime_runs_guard', false, ''),
    ('private', 'overtime_monthly_targets_touch', false, '')
),
fn_db as (
  select n.nspname::text as schema_name, p.proname::text as fn_name, p.oid, p.prosecdef, p.proconfig, p.provolatile::text as volatility,
         l.lanname::text as lang,
         -- 인자 타입의 스키마 수식(public.·pg_catalog.) 차이를 없앤 identity arguments — 오버로드 구분 기준
         regexp_replace(lower(pg_catalog.pg_get_function_identity_arguments(p.oid)), '\m(public|pg_catalog)\.', '', 'g') as identity_args,
         pg_catalog.pg_get_userbyid(p.proowner)::text as owner,
         -- 본문 지문(보안 용도 아님, 일치 확인용): prosrc는 $태그$ 사이 본문만 담으므로 태그 이름 차이는 영향이 없다.
         -- 작은따옴표 밖 조각만 공백을 한 칸으로 줄이고, 리터럴 안 조각은 CRLF→LF만(리터럴 안 공백은 보존).
         (select md5(btrim(string_agg(case when x.n % 2 = 1 then regexp_replace(x.s, E'[ \t\n\r\f\013]+', ' ', 'g')
                                           else replace(x.s, E'\r\n', E'\n') end, '''' order by x.n)))
            from regexp_split_to_table(p.prosrc, '''') with ordinality as x(s, n)) as body_md5,
         pg_catalog.pg_get_functiondef(p.oid) as def,
         coalesce((select string_agg(case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end, ','
                                     order by case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end)
                   from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                   where a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner), '') as acl
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  join pg_catalog.pg_language l on l.oid = p.prolang
  where n.nspname in ('public', 'private') and (p.proname like 'overtime\_%' or p.proname = 'sync_team_employees')
),
-- ── 트리거 기대값(연장근무 표 전체 — 이 밖의 사용자 트리거는 예상하지 않은 것) ──
trg_expect(table_name, trigger_name) as (
  values
    ('overtime_work_records', 'overtime_work_records_a_protect'),
    ('overtime_work_records', 'overtime_work_records_ab_monthly_target'),
    ('overtime_work_records', 'overtime_work_records_b_weekly_cap'),
    ('overtime_assignment_drafts', 'overtime_assignment_drafts_guard'),
    ('overtime_assignment_runs', 'overtime_assignment_runs_guard'),
    ('overtime_monthly_targets', 'overtime_monthly_targets_touch')
),
trg_db as (
  select c.relname::text as table_name, t.tgname::text as trigger_name, t.tgenabled::text as enabled,
         pg_catalog.pg_get_triggerdef(t.oid) as def
  from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid = t.tgrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where not t.tgisinternal and n.nspname = 'public' and c.relname like 'overtime\_%'
),
-- ── 정책 기대값(자동배정 표 4개 + holidays 연장근무 읽기) — 이 표들의 다른 정책은 예상하지 않은 것 ──
pol_expect(table_name, policy_name, cmd) as (
  values
    ('overtime_monthly_targets', 'menu_select', 'SELECT'), ('overtime_monthly_targets', 'menu_insert', 'INSERT'),
    ('overtime_monthly_targets', 'menu_update', 'UPDATE'), ('overtime_monthly_targets', 'menu_delete', 'DELETE'),
    ('overtime_member_tasks', 'menu_select', 'SELECT'), ('overtime_member_tasks', 'menu_insert', 'INSERT'),
    ('overtime_member_tasks', 'menu_update', 'UPDATE'), ('overtime_member_tasks', 'menu_delete', 'DELETE'),
    ('overtime_assignment_runs', 'menu_select', 'SELECT'),
    ('overtime_assignment_drafts', 'menu_select', 'SELECT'), ('overtime_assignment_drafts', 'menu_update', 'UPDATE')
),
pol_db as (
  select tablename::text as table_name, policyname::text as policy_name, cmd::text as cmd, roles, permissive
  from pg_catalog.pg_policies
  where schemaname = 'public'
    and tablename in ('overtime_monthly_targets', 'overtime_member_tasks', 'overtime_assignment_runs', 'overtime_assignment_drafts')
),
team as (
  select c.employee_id, c.name, c.rank, (c.company = '미래사업팀' and c.employment_status = '재직') as active
  from public.engineer_contacts c where c.employee_id is not null
),
link as (
  select (select count(*) from public.overtime_employees e
           where e.is_active and not exists (select 1 from public.engineer_contacts c where c.employee_id = e.id)) as p10_unlinked_employees,
         (select count(*) from public.engineer_contacts c where c.company = '미래사업팀' and c.employee_id is null) as p11_unlinked_contacts
),
-- 주(월~일)별 합계: 최종기록 / 살아 있는 초안
week_rec as (
  select r.employee_id, private.overtime_week_start(r.work_date) as week_start, sum(r.hours) as hours
  from public.overtime_work_records r group by 1, 2
),
week_draft as (
  select d.employee_id, private.overtime_week_start(d.work_date) as week_start, sum(d.hours) as hours
  from public.overtime_assignment_drafts d where d.status = 'draft' group by 1, 2
),
checks(check_name, status, detail) as (
  -- ════════ A: 표·열·제약·인덱스·RLS·정책 ════════
  select 'cur_a01_tables',
         case when count(*) filter (where to_regclass('public.' || t) is not null) = 4 then 'OK' else 'FAIL' end,
         count(*) filter (where to_regclass('public.' || t) is not null) || ' / 4 (월 목표·참여업무·실행·초안)'
  from unnest(array['overtime_monthly_targets', 'overtime_member_tasks', 'overtime_assignment_runs', 'overtime_assignment_drafts']) as x(t)
  union all
  select 'cur_a02_rls',
         case when count(*) = 4 and bool_and(c.relrowsecurity) and not bool_or(c.relforcerowsecurity) then 'OK' else 'FAIL' end,
         count(*) filter (where c.relrowsecurity) || ' / 4 RLS 켜짐(FORCE 아님)'
  from pg_catalog.pg_class c
  where c.oid in (to_regclass('public.overtime_monthly_targets'), to_regclass('public.overtime_member_tasks'),
                  to_regclass('public.overtime_assignment_runs'), to_regclass('public.overtime_assignment_drafts'))
  union all
  select 'cur_a03_record_columns',
         case when count(*) = 8 and bool_and(is_nullable = 'YES') and count(column_default) = 0 then 'OK' else 'FAIL' end,
         count(*) || ' / 8 열, nullable ' || count(*) filter (where is_nullable = 'YES') || ', 기본값 ' || count(column_default)
  from information_schema.columns
  where table_schema = 'public' and table_name = 'overtime_work_records'
    and column_name in ('source', 'assignment_run_id', 'assignment_draft_id', 'employee_name_snapshot',
                        'project_name_snapshot', 'task_name_snapshot', 'assignment_exception_reason', 'confirmed_at')
  union all
  select 'cur_a04_constraints',
         case when count(*) = 8 then 'OK' else 'FAIL' end,
         count(*) || ' / 8'
  from pg_catalog.pg_constraint
  where conname in ('overtime_work_records_source_check', 'overtime_work_records_auto_link_check',
                    'overtime_work_records_exception_check', 'overtime_work_records_assignment_run_fk',
                    'overtime_work_records_assignment_draft_fk', 'overtime_project_members_id_employee_key',
                    'overtime_employee_tasks_id_employee_key', 'overtime_member_tasks_member_fk')
  union all
  select 'cur_a05_indexes',
         case when count(*) = 4 then 'OK' else 'FAIL' end,
         count(*) || ' / 4 (주소록 연결 유일·초안 하루 1건·기록↔초안 유일·자동기록 하루 1건)'
  from pg_catalog.pg_indexes
  where schemaname = 'public'
    and indexname in ('engineer_contacts_employee_id_key', 'overtime_assignment_drafts_one_per_day',
                      'overtime_work_records_assignment_draft_key', 'overtime_work_records_auto_one_per_day')
  union all
  select 'cur_a06_name_unique_dropped',
         case when not exists (select 1 from pg_catalog.pg_constraint where conname = 'overtime_employees_name_key') then 'OK' else 'FAIL' end,
         '직원 이름 UNIQUE 없음(동명이인 허용)'
  union all
  select 'cur_a07_policies_expected',
         case when (select count(*) from pol_expect e
                    where not exists (select 1 from pol_db d where d.table_name = e.table_name and d.policy_name = e.policy_name
                                        and d.cmd = e.cmd and d.roles = '{authenticated}' and d.permissive = 'PERMISSIVE')) = 0
              then 'OK' else 'FAIL' end,
         (select count(*) from pol_expect) || '개 정책(전부 TO authenticated, PERMISSIVE)'
  union all
  select 'cur_a08_policies_unexpected',
         case when count(*) = 0 then 'OK' else 'FAIL' end,
         count(*) || '개' || coalesce(': ' || string_agg(d.table_name || '.' || d.policy_name || '(' || d.cmd || ')', ', ' order by d.table_name, d.policy_name), '')
  from pol_db d
  where not exists (select 1 from pol_expect e where e.table_name = d.table_name and e.policy_name = d.policy_name)
  union all
  select 'cur_a09_holidays_policy',
         case when count(*) = 1 and bool_and(roles = '{authenticated}') and bool_and(cmd = 'SELECT')
                   and bool_and(qual like '%menu_permission(''overtime''%') then 'OK' else 'FAIL' end,
         count(*) || '개 (holidays.overtime_select, SELECT, authenticated)'
  from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'holidays' and policyname = 'overtime_select'
  union all
  -- 실행·초안에는 INSERT/DELETE 정책이 없다(RPC 전용)
  select 'cur_a10_no_direct_insert_delete',
         case when count(*) = 0 then 'OK' else 'FAIL' end,
         count(*) || '개 (실행·초안 INSERT·DELETE·ALL 정책)'
  from pol_db where table_name in ('overtime_assignment_runs', 'overtime_assignment_drafts') and cmd in ('INSERT', 'DELETE', 'ALL')

  -- ════════ 함수: 존재·본문(저장소 최종 정의)·DEFINER·search_path·EXECUTE·소유자 ════════
  union all
  -- 본문 지문(보조 지표 겸 일치 확인) — 같은 스키마·이름·인자 타입의 함수 1개와 비교
  select 'cur_fn_body:' || b.schema_name || '.' || b.fn_name || '(' || b.identity_args || ')',
         case when d.oid is not null and d.body_md5 = b.body_md5 then 'OK' else 'FAIL' end,
         case when d.oid is null then '없음(같은 인자 타입의 함수가 없음)'
              when d.body_md5 = b.body_md5 then b.source_file || ' 최종 정의와 본문 같음'
              else '본문이 ' || b.source_file || ' 최종 정의와 다름' end
  from fn_body b left join fn_db d on d.schema_name = b.schema_name and d.fn_name = b.fn_name and d.identity_args = b.identity_args
  union all
  -- catalog 속성(언어·변동성·SECURITY DEFINER·search_path) — 지문과 별개로 직접 비교
  select 'cur_fn_attr:' || b.schema_name || '.' || b.fn_name,
         case when d.oid is not null and d.lang = b.lang and d.volatility = b.volatility and d.prosecdef = b.secdef
                   and coalesce(array_to_string(d.proconfig, ';'), '') = coalesce(b.search_path, '') then 'OK' else 'FAIL' end,
         'lang=' || coalesce(d.lang, '없음') || '/' || b.lang || ' volatility=' || coalesce(d.volatility, '없음') || '/' || b.volatility
         || ' definer=' || coalesce(d.prosecdef::text, '없음') || '/' || b.secdef::text
         || ' config=' || coalesce(array_to_string(d.proconfig, ';'), '없음') || '/' || coalesce(b.search_path, '없음')
  from fn_body b left join fn_db d on d.schema_name = b.schema_name and d.fn_name = b.fn_name and d.identity_args = b.identity_args
  union all
  -- 같은 이름의 예상하지 않은 오버로드(인자 타입이 다른 함수)
  select 'cur_fn_overload',
         case when count(*) = 0 then 'OK' else 'FAIL' end,
         count(*) || '개' || coalesce(': ' || string_agg(d.schema_name || '.' || d.fn_name || '(' || d.identity_args || ')', ', '), '')
  from fn_db d
  where exists (select 1 from fn_body b where b.schema_name = d.schema_name and b.fn_name = d.fn_name)
    and not exists (select 1 from fn_body b where b.schema_name = d.schema_name and b.fn_name = d.fn_name and b.identity_args = d.identity_args)
  union all
  select 'cur_fn_security:' || s.schema_name || '.' || s.fn_name,
         case when d.oid is not null and d.prosecdef = s.want_definer and d.proconfig is not null and d.acl = s.want_acl then 'OK' else 'FAIL' end,
         'definer=' || coalesce(d.prosecdef::text, '없음') || ' search_path=' || coalesce(array_to_string(d.proconfig, ';'), '없음')
         || ' execute=[' || coalesce(d.acl, '') || '] 기대=[' || s.want_acl || ']'
  from fn_sec s left join fn_db d on d.schema_name = s.schema_name and d.fn_name = s.fn_name
  union all
  select 'cur_fn_unexpected',
         case when count(*) = 0 then 'OK' else 'FAIL' end,
         count(*) || '개' || coalesce(': ' || string_agg(d.schema_name || '.' || d.fn_name, ', ' order by d.schema_name, d.fn_name), '')
  from fn_db d where not exists (select 1 from fn_body b where b.schema_name = d.schema_name and b.fn_name = d.fn_name)
  union all
  -- 소유자 맥락 판정의 전제: DEFINER 함수·트리거 함수 소유자 = 테이블 소유자
  select 'cur_fn_owner_equals_table_owner',
         case when bool_and(d.owner = pg_catalog.pg_get_userbyid(c.relowner)::text) then 'OK' else 'FAIL' end,
         count(*) || '개 함수 소유자 = overtime_work_records 소유자'
  from fn_db d cross join pg_catalog.pg_class c
  where c.oid = to_regclass('public.overtime_work_records') and d.fn_name <> 'overtime_apply_project_sync'
  union all
  select 'cur_fn_anon_public_execute',
         case when count(*) = 0 then 'OK' else 'FAIL' end,
         count(*) || '개 (anon·PUBLIC 실행 가능 — 0이어야 함)'
  from fn_db d join pg_catalog.pg_proc p on p.oid = d.oid
  where exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                where a.privilege_type = 'EXECUTE' and (a.grantee = 0 or a.grantee = 'anon'::regrole))
  union all
  select 'cur_fn_private_usage',
         case when not has_schema_privilege('anon', 'private', 'USAGE') and not has_schema_privilege('authenticated', 'private', 'USAGE')
                   and not has_schema_privilege('service_role', 'private', 'USAGE') then 'OK' else 'FAIL' end,
         'private 스키마 USAGE — anon·authenticated·service_role 모두 없음'

  -- ════════ 트리거: 개수·순서·활성 ════════
  union all
  select 'cur_trg_expected',
         case when (select count(*) from trg_expect e
                    where not exists (select 1 from trg_db t where t.table_name = e.table_name and t.trigger_name = e.trigger_name
                                        and t.enabled = 'O' and t.def like '%BEFORE%' and t.def like '%FOR EACH ROW%')) = 0
              then 'OK' else 'FAIL' end,
         (select count(*) from trg_expect) || '개 (BEFORE ROW, 활성)'
  union all
  select 'cur_trg_unexpected',
         case when count(*) = 0 then 'OK' else 'FAIL' end,
         count(*) || '개' || coalesce(': ' || string_agg(t.table_name || '.' || t.trigger_name, ', ' order by t.trigger_name), '')
  from trg_db t where not exists (select 1 from trg_expect e where e.table_name = t.table_name and e.trigger_name = t.trigger_name)
  union all
  -- 같은 이벤트 BEFORE ROW 트리거는 이름 바이트 순으로 실행된다: 잠금 → 월 목표 → 주 12시간
  select 'cur_trg_record_order',
         case when string_agg(trigger_name, ' → ' order by trigger_name collate "C")
                   = 'overtime_work_records_a_protect → overtime_work_records_ab_monthly_target → overtime_work_records_b_weekly_cap'
              then 'OK' else 'FAIL' end,
         string_agg(trigger_name, ' → ' order by trigger_name collate "C")
  from trg_db where table_name = 'overtime_work_records'

  -- ════════ 월 목표·격리수준·C 수정 표지 ════════
  union all
  select 'cur_m01_label_boundaries',
         case when private.overtime_pay_period_label('2026-10-20') = '2026-10'
               and private.overtime_pay_period_label('2026-10-21') = '2026-11'
               and private.overtime_pay_period_label('2026-12-21') = '2027-01'
               and private.overtime_pay_period_label('2027-01-20') = '2027-01' then 'OK' else 'FAIL' end,
         '10/20→2026-10, 10/21→2026-11, 12/21→2027-01, 1/20→2027-01'
  union all
  select 'cur_m02_monthly_lock',
         case when coalesce((select def from fn_db where fn_name = 'overtime_assert_monthly_target') like '%pg_advisory_xact_lock%overtime_month:%', false)
              then 'OK' else 'FAIL' end,
         '월 목표 검사 — 직원×급여기간 advisory lock'
  union all
  select 'cur_m03_isolation_guard:' || fn_name,
         case when def like '%OVERTIME_ISOLATION_UNSUPPORTED%' then 'OK' else 'FAIL' end,
         'REPEATABLE READ 이상 거부'
  from fn_db where fn_name in ('overtime_assert_weekly_cap', 'overtime_assert_monthly_target')
  union all
  select 'cur_c01_guard_snapshot',
         case when position('상태 전이 또는 draft가 아닌 행' in def) > 0
                   and position('상태 전이 또는 draft가 아닌 행' in def) < position('new.is_holiday := exists' in def) then 'OK' else 'FAIL' end,
         '초안 트리거: 상태 전이는 달력 재계산 전에 끝남(스냅샷 유지)'
  from fn_db where fn_name = 'overtime_drafts_guard'
  union all
  select 'cur_c02_confirm_refresh',
         case when position(('select * in' || 'to v_fresh') in def) > 0
                   and position(('select * in' || 'to v_fresh') in def) < position(('insert in' || 'to public.overtime_work_records') in def) then 'OK' else 'FAIL' end,
         '확정: 확정 직전 재계산·재조회 후 기록 생성'
  from fn_db where fn_name = 'overtime_confirm_run'
  union all
  select 'cur_c03_save_holiday_check',
         case when def like '%OVERTIME_HOLIDAY_CHANGED%' then 'OK' else 'FAIL' end,
         '저장: is_holiday가 공휴일 표와 다르면 거부'
  from fn_db where fn_name = 'overtime_save_assignment_run'

  -- ════════ 직원 연결 안전장치 (p10 = 미연결 재직 직원, p11 = 미연결 미래사업팀 주소록) ════════
  union all
  select 'cur_e01_sync_stops_before_change',
         case when position('OVERTIME_EMPLOYEE_LINK_REQUIRED' in def) > 0
                   and position('OVERTIME_EMPLOYEE_LINK_REQUIRED' in def) < position(('insert in' || 'to public.overtime_employees') in def)
                   and position('v_unlinked_contacts > 0 and v_unlinked_employees > 0' in def) > 0 then 'OK' else 'FAIL' end,
         'sync_team_employees: p10·p11 동시 발생이면 데이터 변경 전에 OVERTIME_EMPLOYEE_LINK_REQUIRED'
  from fn_db where fn_name = 'sync_team_employees'
  union all
  select 'cur_e02_link_state',
         case when l.p10_unlinked_employees > 0 and l.p11_unlinked_contacts > 0 then 'FAIL' else 'OK' end,
         'p10(미연결 재직 직원) ' || l.p10_unlinked_employees || '명 / p11(미연결 미래사업팀 주소록) ' || l.p11_unlinked_contacts
         || '명 — 둘 다 있으면 수동 연결 필요(overtime_employee_link_check.sql)'
  from link l
  union all
  select 'cur_e03_linked_employees', 'INFO', count(*) || '명 주소록 연결' from team
  union all
  select 'cur_e04_sync_pending', 'INFO',
         count(*) || '명 (연결 직원 이름·직급·재직이 주소록과 다름 — 다음 sync에서 맞춰짐)'
  from public.overtime_employees e join team t on t.employee_id = e.id
  where (e.name, e.position, e.is_active) is distinct from (t.name, t.rank, t.active)

  -- ════════ 데이터: 직원 UUID 보존 ════════
  union all
  select 'cur_d01_employee_refs',
         case when x.n = 0 then 'OK' else 'FAIL' end,
         x.n || '건 (기록·월 목표·업무·참여·참여업무 중 없는 직원 UUID를 가리키는 행)'
  from (select (select count(*) from public.overtime_work_records r where not exists (select 1 from public.overtime_employees e where e.id = r.employee_id))
             + (select count(*) from public.overtime_monthly_targets t where not exists (select 1 from public.overtime_employees e where e.id = t.employee_id))
             + (select count(*) from public.overtime_employee_tasks t where not exists (select 1 from public.overtime_employees e where e.id = t.employee_id))
             + (select count(*) from public.overtime_project_members m where not exists (select 1 from public.overtime_employees e where e.id = m.employee_id))
             + (select count(*) from public.overtime_member_tasks mt where not exists (select 1 from public.overtime_employees e where e.id = mt.employee_id)) as n) x
  union all
  select 'cur_d02_split_suspects',
         case when count(*) = 0 then 'OK' else 'FAIL' end,
         count(*) || '명 (주소록 미연결·비활성인데 과거 데이터가 있고, 과거 데이터 없는 연결 직원이 따로 있음)'
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

  -- ════════ 데이터: 확정 스냅샷·자동기록 연결 ════════
  union all
  -- 확정취소가 비교하는 값 그대로 — 하나라도 다르면 그 초안은 확정취소가 막힌다
  select 'cur_d03_confirmed_snapshot_mismatch',
         case when count(*) = 0 then 'OK' else 'FAIL' end,
         count(*) || '건 (확정 초안 ↔ 자동기록 값 불일치)'
  from public.overtime_assignment_drafts d
  join public.overtime_work_records r on r.assignment_draft_id = d.id
  where d.status = 'confirmed'
    and (r.source, r.assignment_run_id, r.employee_id, r.project_id, r.work_date, r.hours, r.start_time, r.end_time,
         r.break_hours, r.task_description, r.task_name_snapshot, r.assignment_exception_reason, r.confirmed_at)
        is distinct from
        ('auto'::text, d.run_id, d.employee_id, d.project_id, d.work_date, d.hours, d.start_time, d.end_time,
         d.break_hours, d.task_name, d.task_name, d.exception_reason, d.confirmed_at)
  union all
  select 'cur_d04_confirmed_without_record',
         case when count(*) = 0 then 'OK' else 'FAIL' end,
         count(*) || '건 (확정 초안인데 연결된 자동기록 없음)'
  from public.overtime_assignment_drafts d
  where d.status = 'confirmed' and not exists (select 1 from public.overtime_work_records r where r.assignment_draft_id = d.id)
  union all
  select 'cur_d05_auto_record_draft_state',
         case when count(*) = 0 then 'OK' else 'FAIL' end,
         count(*) || '건 (자동기록인데 연결 초안이 없거나 confirmed가 아님)'
  from public.overtime_work_records r
  where r.source = 'auto'
    and not exists (select 1 from public.overtime_assignment_drafts d where d.id = r.assignment_draft_id and d.status = 'confirmed')

  -- ════════ 데이터: 월 목표·주 12시간 ════════
  union all
  -- 기존 기록은 목표 없이도 남아 있을 수 있다(guard 적용 전 입력). 새 입력·수정은 목표가 있어야 한다 → 정보만
  select 'cur_d06_records_without_target', 'INFO',
         count(*) || '건 / ' || count(distinct r.employee_id::text || '|' || private.overtime_pay_period_label(r.work_date)) || '개 직원×급여기간 (월 목표 행 없는 기존 기록)'
  from public.overtime_work_records r
  where not exists (select 1 from public.overtime_monthly_targets t
                    where t.employee_id = r.employee_id and t.period_label = private.overtime_pay_period_label(r.work_date))
  union all
  -- 최종기록만으로 12시간 초과인 주: 규칙상 과거 초과 주는 줄이거나 그대로 두는 수정만 허용 → 정보만
  select 'cur_d07_weeks_over_cap_records', 'INFO',
         count(*) || '개 직원×주 (최종기록만 12시간 초과 — 기존 허용 상태)'
  from week_rec where hours > 12
  union all
  -- 살아 있는 초안까지 더해 12시간을 넘는 주: 저장 RPC가 막아야 하므로 생기면 조치 필요
  select 'cur_d08_weeks_over_cap_with_drafts',
         case when count(*) = 0 then 'OK' else 'FAIL' end,
         count(*) || '개 직원×주 (최종기록 + 살아 있는 초안 > 12, 초안 포함 주만)'
  from week_draft d left join week_rec r on r.employee_id = d.employee_id and r.week_start = d.week_start
  where coalesce(r.hours, 0) + d.hours > 12 and coalesce(r.hours, 0) <= 12

  -- ════════ 동기화 RPC 의존 인덱스 ════════
  union all
  -- overtime_apply_project_sync의 on conflict (source_project_id) where source_project_id is not null 이 쓰는 부분 UNIQUE 인덱스
  select 'cur_s01_sync_source_index',
         case when x.on_table and x.is_unique and x.on_column and x.partial_ok and x.valid_ready then 'OK' else 'FAIL' end,
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

  -- ════════ 시험 잔여 데이터 ════════
  union all
  -- 스스로 되돌리는 시험(공휴일 확정·직원 연결·권한·공용 표)의 고정 데이터 — 남아 있으면 조치 필요
  select 'cur_r01_self_cleaning_tests',
         case when x.n = 0 then 'OK' else 'FAIL' end,
         x.n || '건 (overtime_confirm_holiday_test·overtime_employee_link_test·menu_permission_strict_check·shared_project_tables_rls_check)'
  from (select (select count(*) from public.overtime_employees e
                 where e.id::text like 'e2000000-0000-4000-8000-%' or e.id::text like 'e3000000-0000-4000-8000-%' or e.id::text like 'e3100000-0000-4000-8000-%')
             + (select count(*) from public.overtime_projects p where p.id::text like 'a2000000-0000-4000-8000-%')
             + (select count(*) from public.overtime_employee_tasks t where t.id::text like 'b2000000-0000-4000-8000-%')
             + (select count(*) from public.overtime_assignment_runs r where r.rule_version = 'ot-holiday-test')
             + (select count(*) from public.holidays h where h.name like 'ZZ시험%')
             + (select count(*) from public.engineer_contacts c where c.name like 'ZZ연결시험%')
             + (select count(*) from public.allowed_users u
                 where u.email like 'menu-strict-%@example.com' or u.email like 'rls-%@example.invalid'
                    or u.email like 'ot-holiday-%@example.invalid' or u.email like 'ot-link-%@example.invalid') as n) x
  union all
  -- 동작 시험(별도 정리 파일 overtime_behavior_test_cleanup.sql)·화면 seed(f1…)는 의도적으로 남겨 두는 개발 데이터 → 정보만
  select 'cur_r02_behavior_test_data', 'INFO',
         (select count(*) from public.overtime_employees e where e.id::text like 'e1000000-0000-4000-8000-%') || '명 직원 / '
         || (select count(*) from public.overtime_assignment_runs r where r.rule_version = 'ot-behavior-test') || '개 실행 (정리: dev/overtime_behavior_test_cleanup.sql)'
  union all
  select 'cur_r03_ui_seed_data', 'INFO',
         (select count(*) from public.overtime_employees e where e.id::text like 'f1000000-0000-4000-8000-%') || '명 직원 (화면 시험 seed — 정리: dev/overtime_ui_seed_cleanup.sql)'
)
select check_name, status, detail from checks order by check_name;
