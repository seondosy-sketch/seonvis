-- 연장근무 자동배정 — Migration C 직전 점검 (읽기 전용, SELECT 한 문장)
--
-- supabase/migration_overtime_planning_c_corrections.sql 실행 직전 SQL Editor에서 실행한다. 데이터·스키마를 바꾸지 않는다.
-- 결과: check_name / status(OK·STOP·INFO) / detail. STOP이 하나라도 있으면 C를 실행하지 않는다.
-- fp_* 행은 C 적용 후 postflight의 같은 이름 행과 비교한다(c 함수 4개는 바뀌고, 나머지는 같아야 한다).
-- 개인정보 값은 나오지 않는다(건수·UUID 없는 해시·역할명만).

with
fn(sig) as (
  values ('private.overtime_drafts_guard()'), ('public.overtime_save_assignment_run(jsonb,jsonb)'),
         ('public.overtime_confirm_run(uuid,uuid[])'), ('public.sync_team_employees()')
),
link as (
  select (select count(*) from public.overtime_employees e
           where e.is_active and not exists (select 1 from public.engineer_contacts c where c.employee_id = e.id)) as unlinked_employees,
         (select count(*) from public.engineer_contacts c where c.company = '미래사업팀' and c.employee_id is null) as unlinked_contacts
),
checks(check_name, status, detail) as (
  select 'c_pre01_A_applied',
         case when to_regclass('public.overtime_assignment_drafts') is not null and to_regclass('public.overtime_monthly_targets') is not null
                   and to_regclass('public.engineer_contacts_employee_id_key') is not null
                   and to_regprocedure('private.overtime_pay_period(text)') is not null then 'OK' else 'STOP' end,
         'A 테이블·인덱스·급여기간 함수'
  union all
  select 'c_pre02_B_applied',
         case when to_regprocedure('public.overtime_save_assignment_run(jsonb,jsonb)') is not null
                   and to_regprocedure('public.overtime_confirm_run(uuid,uuid[])') is not null
                   and to_regprocedure('public.overtime_unconfirm_drafts(uuid[])') is not null
                   and exists (select 1 from pg_catalog.pg_trigger t where t.tgname = 'overtime_assignment_drafts_guard') then 'OK' else 'STOP' end,
         'B RPC·초안 보호 트리거'
  union all
  -- 운영 순서상 C는 월 목표 강제조건·격리수준 방어(activation) 다음이다. C 자체는 둘에 의존하지 않는다.
  select 'c_pre03_monthly_guard',
         case when exists (select 1 from pg_catalog.pg_trigger t where t.tgname = 'overtime_work_records_ab_monthly_target') then 'OK' else 'INFO' end,
         case when exists (select 1 from pg_catalog.pg_trigger t where t.tgname = 'overtime_work_records_ab_monthly_target')
              then '월 목표 강제조건 적용됨' else '월 목표 강제조건 미적용 (C와 무관, 운영 순서 확인)' end
  union all
  select 'c_pre04_isolation_guard',
         case when coalesce(pg_catalog.pg_get_functiondef(to_regprocedure('private.overtime_assert_weekly_cap(uuid,date,numeric,uuid,numeric)'))
                            like '%OVERTIME_ISOLATION_UNSUPPORTED%', false) then 'OK' else 'INFO' end,
         '격리수준 방어 (C와 무관, 운영 순서 확인)'
  union all
  select 'c_pre05_C_state', 'INFO',
         case when coalesce(pg_catalog.pg_get_functiondef(to_regprocedure('public.overtime_confirm_run(uuid,uuid[])')) like '%확정 시 공휴일 변경 반영%', false)
              then 'C 수정본이 이미 있음 (다시 실행해도 같은 결과)' else 'C 미적용' end
  union all
  select 'c_pre06_employee_link',
         case when l.unlinked_employees > 0 and l.unlinked_contacts > 0 then 'STOP' else 'OK' end,
         '미연결 재직 직원 ' || l.unlinked_employees || '명 / 미연결 미래사업팀 주소록 ' || l.unlinked_contacts || '명'
         || case when l.unlinked_employees > 0 and l.unlinked_contacts > 0
                 then ' — C가 OVERTIME_EMPLOYEE_LINK_REQUIRED로 중단된다. overtime_employee_link_check.sql로 수동 연결 먼저' else '' end
  from link l
  union all
  -- 기존 버그로 이미 어긋난 확정 초안(기록 사유 ≠ 초안 사유). C는 데이터를 고치지 않으므로 이 초안은 C 뒤에도 확정취소가 막힌다.
  select 'c_pre07_confirmed_reason_mismatch',
         case when count(*) = 0 then 'OK' else 'INFO' end,
         count(*) || '건 (확정 초안과 최종기록의 주말·공휴일 사유가 다름 — 있으면 별도 보정 방안 검토)'
  from public.overtime_assignment_drafts d
  join public.overtime_work_records r on r.assignment_draft_id = d.id
  where d.status = 'confirmed' and r.assignment_exception_reason is distinct from d.exception_reason
  union all
  select 'c_pre08_table_owner',
         case when count(distinct pg_catalog.pg_get_userbyid(c.relowner)) = 1
                   and min(pg_catalog.pg_get_userbyid(c.relowner)) = current_user then 'OK' else 'STOP' end,
         string_agg(distinct pg_catalog.pg_get_userbyid(c.relowner), ',') || ' / 실행 역할 ' || current_user
  from pg_catalog.pg_class c
  where c.oid in (to_regclass('public.overtime_work_records'), to_regclass('public.overtime_assignment_drafts'),
                  to_regclass('public.overtime_assignment_runs'))
  union all
  select 'c_pre09_holidays', 'INFO',
         count(*) filter (where extract(year from holiday_date) = 2026) || '건(2026) / '
         || count(*) filter (where extract(year from holiday_date) = 2027) || '건(2027)'
  from public.holidays
  union all
  -- ── 지문: C가 바꾸는 함수 4개 (postflight에서는 달라져야 하고, rollback 뒤에는 이 값으로 돌아와야 한다) ──
  select 'fp_fn_' || f.sig, 'INFO',
         coalesce(md5(pg_catalog.pg_get_functiondef(to_regprocedure(f.sig))), '없음')
  from fn f
  union all
  -- C가 바꾸지 않는 연장근무 함수 전체 (postflight와 같아야 한다)
  select 'fp_other_functions', 'INFO',
         md5(coalesce(string_agg(p.oid::regprocedure::text || md5(pg_catalog.pg_get_functiondef(p.oid)), '|' order by p.oid::regprocedure::text), ''))
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and p.proname like 'overtime\_%' and p.prokind = 'f'
    and p.oid not in (select to_regprocedure(sig) from fn where to_regprocedure(sig) is not null)
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
