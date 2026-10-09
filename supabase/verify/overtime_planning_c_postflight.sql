-- 연장근무 자동배정 — Migration C 직후 확인 (읽기 전용, SELECT 한 문장)
--
-- supabase/migration_overtime_planning_c_corrections.sql 적용 직후 SQL Editor에서 실행한다. 데이터·스키마를 바꾸지 않는다.
-- 결과: check_name / status(OK·FAIL·INFO) / detail. OK·INFO만 있어야 한다.
-- fp_other_functions·fp_triggers·fp_planning_rows는 직전 overtime_planning_c_preflight.sql의 같은 이름 행과 같아야 한다
-- (C는 함수 4개만 바꾸고 다른 함수·트리거·데이터는 바꾸지 않는다). fp_fn_*은 preflight와 달라야 한다(첫 적용일 때).
-- 개인정보 값은 나오지 않는다.

with
fn_expect(sig, want_definer, want_acl, marker) as (
  values
    ('private.overtime_drafts_guard()', false, '', '%상태 전이 또는 draft가 아닌 행%'),
    ('public.overtime_save_assignment_run(jsonb,jsonb)', true, 'authenticated', '%OVERTIME_HOLIDAY_CHANGED%'),
    ('public.overtime_confirm_run(uuid,uuid[])', true, 'authenticated', '%확정 시 공휴일 변경 반영%'),
    ('public.sync_team_employees()', true, 'authenticated,service_role', '%OVERTIME_EMPLOYEE_LINK_REQUIRED%')
),
fn_actual as (
  select f.sig, f.want_definer, f.want_acl, f.marker, p.oid is not null as present, p.prosecdef, p.proconfig,
         pg_catalog.pg_get_functiondef(p.oid) as def,
         coalesce((select string_agg(case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end, ','
                                     order by case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end)
                   from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                   where a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner), '') as acl
  from fn_expect f left join pg_catalog.pg_proc p on p.oid = to_regprocedure(f.sig)
),
link as (
  select (select count(*) from public.overtime_employees e
           where e.is_active and not exists (select 1 from public.engineer_contacts c where c.employee_id = e.id)) as unlinked_employees,
         (select count(*) from public.engineer_contacts c where c.company = '미래사업팀' and c.employee_id is null) as unlinked_contacts
),
checks(check_name, status, detail) as (
  select 'c01_fn_' || f.sig,
         case when f.present and f.prosecdef = f.want_definer and f.proconfig is not null and f.acl = f.want_acl then 'OK' else 'FAIL' end,
         'definer=' || coalesce(f.prosecdef::text, '없음') || ' search_path=' || coalesce(array_to_string(f.proconfig, ';'), '없음')
         || ' acl=[' || f.acl || '] want=[' || f.want_acl || ']'
  from fn_actual f
  union all
  select 'c02_fix_' || f.sig,
         case when coalesce(f.def like f.marker, false) then 'OK' else 'FAIL' end,
         'C 수정 표지 ' || f.marker
  from fn_actual f
  union all
  -- 초안 트리거: 상태 전이 분기가 달력 재계산보다 먼저
  select 'c03_guard_skip_before_recompute',
         case when position('상태 전이 또는 draft가 아닌 행' in f.def) > 0
                   and position('상태 전이 또는 draft가 아닌 행' in f.def) < position('new.is_holiday := exists' in f.def) then 'OK' else 'FAIL' end,
         '상태 전이 return이 is_holiday 재계산보다 앞'
  from fn_actual f where f.sig = 'private.overtime_drafts_guard()'
  union all
  -- 확정 RPC: 재계산 UPDATE → 다시 읽기 → 최종기록 INSERT 순서
  select 'c04_confirm_refresh_before_insert',
         case when position(('select * in' || 'to v_fresh') in f.def) > 0
                   and position(('select * in' || 'to v_fresh') in f.def) < position(('insert in' || 'to public.overtime_work_records') in f.def) then 'OK' else 'FAIL' end,
         '확정 직전 재계산·재조회 후 기록 생성'
  from fn_actual f where f.sig = 'public.overtime_confirm_run(uuid,uuid[])'
  union all
  select 'c05_triggers',
         case when count(*) = 4 and bool_and(t.tgenabled = 'O') then 'OK' else 'FAIL' end,
         count(*) || ' / 4: ' || string_agg(t.tgname::text, ',' order by t.tgname)
  from pg_catalog.pg_trigger t
  where not t.tgisinternal
    and t.tgname in ('overtime_work_records_a_protect', 'overtime_work_records_b_weekly_cap',
                     'overtime_assignment_drafts_guard', 'overtime_assignment_runs_guard')
  union all
  select 'c06_unchanged_rpcs',
         case when to_regprocedure('public.overtime_unconfirm_drafts(uuid[])') is not null
                   and to_regprocedure('public.overtime_discard_run(uuid)') is not null then 'OK' else 'FAIL' end,
         '확정취소·폐기 RPC는 C가 바꾸지 않는다'
  union all
  select 'c07_anon_public_execute',
         case when count(*) = 0 then 'OK' else 'FAIL' end,
         count(*) || '개 함수 (anon 또는 PUBLIC 실행 가능 — 0이어야 함)'
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private')
    and (p.proname like 'overtime\_%' or p.proname = 'sync_team_employees')
    and exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                where a.privilege_type = 'EXECUTE' and (a.grantee = 0 or a.grantee = 'anon'::regrole))
  union all
  select 'c08_private_usage_unchanged',
         case when not has_schema_privilege('anon', 'private', 'USAGE') and not has_schema_privilege('authenticated', 'private', 'USAGE')
                   and not has_schema_privilege('service_role', 'private', 'USAGE') then 'OK' else 'FAIL' end,
         'anon/authenticated/service_role 모두 false여야 함'
  union all
  -- ── 직원 UUID 보존 (MAJOR 8): 과거 기록·월 목표·업무·참여가 존재하는 직원을 가리킨다 ──
  select 'c09_employee_refs_exist',
         case when (select count(*) from public.overtime_work_records r where not exists (select 1 from public.overtime_employees e where e.id = r.employee_id))
                 + (select count(*) from public.overtime_monthly_targets t where not exists (select 1 from public.overtime_employees e where e.id = t.employee_id))
                 + (select count(*) from public.overtime_employee_tasks t where not exists (select 1 from public.overtime_employees e where e.id = t.employee_id))
                 + (select count(*) from public.overtime_project_members m where not exists (select 1 from public.overtime_employees e where e.id = m.employee_id))
                 + (select count(*) from public.overtime_member_tasks mt where not exists (select 1 from public.overtime_employees e where e.id = mt.employee_id)) = 0
              then 'OK' else 'FAIL' end,
         '기록·월 목표·업무·참여·참여업무의 직원 UUID가 모두 존재'
  union all
  select 'c10_split_suspects',
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
  union all
  select 'c11_employee_link',
         case when l.unlinked_employees > 0 and l.unlinked_contacts > 0 then 'FAIL' else 'OK' end,
         '미연결 재직 직원 ' || l.unlinked_employees || '명 / 미연결 미래사업팀 주소록 ' || l.unlinked_contacts || '명'
  from link l
  union all
  select 'c12_confirmed_reason_mismatch',
         case when count(*) = 0 then 'OK' else 'INFO' end,
         count(*) || '건 (C 이전 버그로 어긋난 확정 초안 — C는 데이터를 고치지 않는다, preflight c_pre07과 같아야 함)'
  from public.overtime_assignment_drafts d
  join public.overtime_work_records r on r.assignment_draft_id = d.id
  where d.status = 'confirmed' and r.assignment_exception_reason is distinct from d.exception_reason
  union all
  -- ── 지문 (preflight와 비교) ──
  select 'fp_fn_' || f.sig, 'INFO', coalesce(md5(f.def), '없음')
  from fn_actual f
  union all
  select 'fp_other_functions', 'INFO',
         md5(coalesce(string_agg(p.oid::regprocedure::text || md5(pg_catalog.pg_get_functiondef(p.oid)), '|' order by p.oid::regprocedure::text), ''))
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and p.proname like 'overtime\_%' and p.prokind = 'f'
    and p.oid not in (select to_regprocedure(sig) from fn_expect where to_regprocedure(sig) is not null)
  union all
  select 'fp_triggers', 'INFO',
         md5(coalesce(string_agg(t.tgname || pg_catalog.pg_get_triggerdef(t.oid) || t.tgenabled::text, '|' order by t.tgname), ''))
  from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid = t.tgrelid
  where not t.tgisinternal and c.relname like 'overtime\_%'
  union all
  select 'fp_planning_rows', 'INFO',
         (select count(*) from public.overtime_assignment_runs) || ' runs / '
         || (select count(*) from public.overtime_assignment_drafts) || ' drafts / '
         || (select count(*) from public.overtime_work_records where source = 'auto') || ' auto / '
         || md5(coalesce((select string_agg(d.id::text || d.status || d.is_holiday::text || coalesce(d.exception_reason, ''), '|' order by d.id)
                          from public.overtime_assignment_drafts d), ''))
)
select check_name, status, detail from checks order by check_name;
