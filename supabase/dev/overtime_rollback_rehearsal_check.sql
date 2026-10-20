-- 연장근무 되돌리기 리허설 — 단계별 상태 확인 (읽기 전용, SELECT 한 문장, 매 단계 뒤 실행)
--
-- ⚠ 개발용 Supabase 전용 리허설의 확인 파일. 데이터·스키마를 바꾸지 않는다(읽기만 — 확인 표지 set local은 필요 없다).
--   맨 앞 DO 블록은 개발 DB 확인만 한다(운영으로 보이면 중단).
-- [설정] step: 비워 두면(null) private.overtime_rehearsal_snapshot에 기록된 마지막 되돌리기 단계로 판정한다.
--   정방향 재적용은 원본 migration 파일을 그대로 실행하므로 기록이 남지 않는다 → 그때는 step을 직접 적는다:
--   start, c, isolation, monthly, purge, b, sync_rpc, a, fwd_a, fwd_sync_rpc, fwd_b, fwd_monthly, fwd_isolation, fwd_c
-- 결과: check_name / status(OK·FAIL·INFO) / detail — 그 단계에서 있어야 할 것·없어야 할 것이 맞으면 OK.
-- 참고: 정방향 B(fwd_b)부터 초안 트리거·저장·확정 RPC에 C 수정 표지가 있다(B 파일 자체가 수정본 — 신규 설치에 C 내용 포함).
--       정방향 A(fwd_a)부터 sync_team_employees에 직원 분리 방지 표지가 있다.

do $$
begin
  if (select count(*) from public.projects) > 10 then
    raise exception '중단: projects가 10건을 넘습니다 — 개발용 DB가 아닌 것 같습니다';
  end if;
  if exists (select 1 from public.overtime_employees e
             where e.id::text not like 'e1000000-0000-4000-8000-00000000000_' and e.id::text not like 'f1000000-0000-4000-8000-00000000000_') then
    raise exception '중단: 시험용이 아닌 연장근무 직원이 있습니다 — 개발용 DB가 아닌 것 같습니다';
  end if;
  if to_regclass('private.overtime_rehearsal_snapshot') is null then
    raise exception '중단: 리허설 기록(private.overtime_rehearsal_snapshot)이 없다 — 1단계부터';
  end if;
end $$;

with
opts as (select null::text as step),   -- [설정] null = 자동
steps(step, idx) as (
  values ('start', 0), ('c', 1), ('isolation', 2), ('monthly', 3), ('purge', 4), ('b', 5), ('sync_rpc', 6), ('a', 7),
         ('fwd_a', 8), ('fwd_sync_rpc', 9), ('fwd_b', 10), ('fwd_monthly', 11), ('fwd_isolation', 12), ('fwd_c', 13)
),
cur as (
  select s.step, s.idx
  from steps s
  where s.step = coalesce((select step from opts),
                          (select x.name from private.overtime_rehearsal_snapshot x where x.kind = 'step'
                           order by x.captured_at desc limit 1))
),
fdef as (
  select pg_catalog.pg_get_functiondef(to_regprocedure('private.overtime_drafts_guard()')) as guard_def,
         pg_catalog.pg_get_functiondef(to_regprocedure('public.overtime_confirm_run(uuid,uuid[])')) as confirm_def,
         pg_catalog.pg_get_functiondef(to_regprocedure('public.overtime_save_assignment_run(jsonb,jsonb)')) as save_def,
         pg_catalog.pg_get_functiondef(to_regprocedure('public.sync_team_employees()')) as sync_def,
         pg_catalog.pg_get_functiondef(to_regprocedure('private.overtime_assert_weekly_cap(uuid,date,numeric,uuid,numeric)')) as weekly_def,
         pg_catalog.pg_get_functiondef(to_regprocedure('private.overtime_assert_monthly_target(uuid,date,numeric,uuid,numeric)')) as monthly_def
),
obj(name, actual, expected_at) as (
  select 'c_fix_drafts_guard', coalesce(guard_def like '%상태 전이 또는 draft가 아닌 행%', false), array[0, 10, 11, 12, 13] from fdef
  union all select 'c_fix_confirm_run', coalesce(confirm_def like '%확정 시 공휴일 변경 반영%', false), array[0, 10, 11, 12, 13] from fdef
  union all select 'c_fix_save_run', coalesce(save_def like '%OVERTIME_HOLIDAY_CHANGED%', false), array[0, 10, 11, 12, 13] from fdef
  union all select 'c_fix_sync_team_employees', coalesce(sync_def like '%OVERTIME_EMPLOYEE_LINK_REQUIRED%', false), array[0, 8, 9, 10, 11, 12, 13] from fdef
  union all select 'isolation_weekly_cap', coalesce(weekly_def like '%OVERTIME_ISOLATION_UNSUPPORTED%', false), array[0, 1, 12, 13] from fdef
  union all select 'isolation_monthly_target', coalesce(monthly_def like '%OVERTIME_ISOLATION_UNSUPPORTED%', false), array[0, 1, 12, 13] from fdef
  union all select 'fn_assert_monthly_target', to_regprocedure('private.overtime_assert_monthly_target(uuid,date,numeric,uuid,numeric)') is not null, array[0, 1, 2, 11, 12, 13]
  union all select 'fn_pay_period_label', to_regprocedure('private.overtime_pay_period_label(date)') is not null, array[0, 1, 2, 11, 12, 13]
  union all select 'trg_ab_monthly_target', exists (select 1 from pg_catalog.pg_trigger where tgname = 'overtime_work_records_ab_monthly_target'), array[0, 1, 2, 11, 12, 13]
  union all select 'fn_assert_weekly_cap', to_regprocedure('private.overtime_assert_weekly_cap(uuid,date,numeric,uuid,numeric)') is not null, array[0, 1, 2, 3, 4, 10, 11, 12, 13]
  union all select 'rpc_confirm_run', to_regprocedure('public.overtime_confirm_run(uuid,uuid[])') is not null, array[0, 1, 2, 3, 4, 10, 11, 12, 13]
  union all select 'rpc_unconfirm_drafts', to_regprocedure('public.overtime_unconfirm_drafts(uuid[])') is not null, array[0, 1, 2, 3, 4, 10, 11, 12, 13]
  union all select 'trg_a_protect', exists (select 1 from pg_catalog.pg_trigger where tgname = 'overtime_work_records_a_protect'), array[0, 1, 2, 3, 4, 10, 11, 12, 13]
  union all select 'trg_drafts_guard', exists (select 1 from pg_catalog.pg_trigger where tgname = 'overtime_assignment_drafts_guard'), array[0, 1, 2, 3, 4, 10, 11, 12, 13]
  union all select 'policy_drafts_menu_update', exists (select 1 from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'overtime_assignment_drafts' and policyname = 'menu_update'), array[0, 1, 2, 3, 4, 10, 11, 12, 13]
  union all select 'rpc_apply_project_sync', to_regprocedure('public.overtime_apply_project_sync(jsonb,jsonb)') is not null, array[0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13]
  union all select 'table_assignment_drafts', to_regclass('public.overtime_assignment_drafts') is not null, array[0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13]
  union all select 'table_monthly_targets', to_regclass('public.overtime_monthly_targets') is not null, array[0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13]
  union all select 'column_records_source', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'overtime_work_records' and column_name = 'source'), array[0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13]
  union all select 'index_contacts_employee_id_key', to_regclass('public.engineer_contacts_employee_id_key') is not null, array[0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13]
  union all select 'policy_holidays_overtime_select', exists (select 1 from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'holidays' and policyname = 'overtime_select'), array[0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13]
  union all select 'fn_pay_period', to_regprocedure('private.overtime_pay_period(text)') is not null, array[0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13]
  union all select 'constraint_employees_name_key', exists (select 1 from pg_catalog.pg_constraint where conname = 'overtime_employees_name_key'), array[7]
),
checks(sort_key, check_name, status, detail) as (
  select 0, 'r00_step',
         case when c.step is null then 'FAIL' else 'INFO' end,
         coalesce(c.step || ' (#' || c.idx || ')', '단계를 알 수 없다 — step을 직접 적거나 1단계부터')
  from (select 1) one left join cur c on true
  union all
  select 1, 'r_' || o.name,
         case when c.idx is null then 'FAIL' when o.actual = (c.idx = any (o.expected_at)) then 'OK' else 'FAIL' end,
         '기대=' || case when c.idx = any (o.expected_at) then '있음' else '없음' end || ' / 실제=' || case when o.actual then '있음' else '없음' end
  from obj o left join cur c on true
  union all
  -- purge·b·sync_rpc 단계(#4~#6): 새 표 4개 행이 0이어야 B·A 되돌리기가 진행된다.
  -- 표가 없는 단계(a 이후)에도 이 SELECT가 깨지지 않도록 건수는 그 단계에서만 query_to_xml로 센다(동적 조회, 읽기만).
  select 2, 'r_planning_rows_zero',
         case when c.idx between 4 and 6 then
                case when (xpath('/row/n/text()', query_to_xml(
                             'select (select count(*) from public.overtime_assignment_drafts) + (select count(*) from public.overtime_assignment_runs)'
                             || ' + (select count(*) from public.overtime_monthly_targets) + (select count(*) from public.overtime_member_tasks) as n',
                             false, true, '')))[1]::text = '0'
                     then 'OK' else 'FAIL' end
              else 'INFO' end,
         case when c.idx between 4 and 6 then 'purge 뒤 새 표 4개 행 0이어야 함' else '이 단계에서는 확인하지 않음' end
  from cur c
)
select check_name, status, detail from checks order by sort_key, check_name;
