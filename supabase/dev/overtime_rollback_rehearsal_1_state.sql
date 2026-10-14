-- 연장근무 되돌리기 리허설 1단계 — 시작 상태 저장 (스키마는 바꾸지 않는다, 리허설용 private 표·뷰만 만든다)
--
-- ████████████████████████████████████████████████████████████████████████████
-- ⚠ 경고 — 개발용 Supabase 전용 "전체 되돌리기 리허설". 운영에서 실행 금지.
--   이 리허설은 개발 DB의 연장근무 자동배정 데이터(실행·초안·자동확정 기록·월 목표·참여업무)를 지운다(5단계).
--   A 되돌리기(8단계)는 overtime_work_records의 자동배정 칸(source 등)과 새 표 4개를 지운다. 지운 데이터는 되살리지 않는다
--   (리허설 뒤 화면 시험 데이터가 필요하면 supabase/dev/overtime_ui_seed.sql을 다시 실행한다).
--   리허설 동안 개발 서버(next dev)를 멈춘다 — 화면이 되돌려진 sync_team_employees(이름 매칭)를 부르지 않게.
--   위 내용을 읽었으면 아래 "set local overtime.rehearsal_ack" 줄 맨 앞의 "-- "를 지우고 실행한다.
--   지우지 않으면 안전장치가 아무것도 바꾸지 않고 멈춘다(파일마다 매번).
-- 순서: _1_state → _2_c → _3_isolation → _4_monthly → _5_purge → _6_b → _7_sync_rpc → _8_a → (정방향 재적용: _9_forward 목록)
--       → _10_compare. 각 단계 뒤 overtime_rollback_rehearsal_check.sql(상태 확인).
-- 되돌리기 순서: overtime_planning_c_rollback → overtime_cap_isolation_guard_rollback → overtime_monthly_target_rollback → overtime_planning_rollback_b → overtime_project_sync_rpc_rollback → overtime_planning_rollback_a
-- ████████████████████████████████████████████████████████████████████████████
--
-- 전제: 개발 DB에 A·동기화 RPC·B·월 목표·격리수준·C가 모두 적용돼 있다(C 적용 후 overtime_planning_c_postflight.sql 전부 OK).
-- 하는 일: private.overtime_rehearsal_catalog(카탈로그 뷰)와 private.overtime_rehearsal_snapshot(시작 상태)을 만든다.
--   연장근무 함수(정의 md5·권한·소유자)·트리거·표(컬럼·RLS·권한)·제약·인덱스·정책 지문과 자동배정 데이터 건수를 저장한다.
--   두 객체는 10단계(_10_compare.sql) 끝에서 지운다. 이미 있으면(이전 리허설이 끝나지 않음) 중단한다.
-- 직원 연결 확인: 미연결 재직 직원과 미연결 미래사업팀 주소록이 둘 다 있으면 중단한다 — 그 상태면 정방향 재적용에서
--   A가 OVERTIME_EMPLOYEE_LINK_REQUIRED로 멈춰 개발 DB가 되돌려진 상태로 남는다.
-- 결과: check_name / status / detail

begin;
-- set local overtime.rehearsal_ack = 'yes';   -- ← 맨 위 경고를 읽었으면 이 줄 맨 앞의 "-- "를 지운다

do $$
begin
  if coalesce(current_setting('overtime.rehearsal_ack', true), '') <> 'yes' then
    raise exception '중단: 맨 위 경고를 읽고 set local overtime.rehearsal_ack 줄의 주석을 푼 뒤 실행한다';
  end if;
  -- 개발 DB 확인 (overtime_behavior_test.sql과 같은 기준)
  if (select count(*) from public.projects) > 10 then
    raise exception '중단: projects가 10건을 넘습니다 — 개발용 DB가 아닌 것 같습니다';
  end if;
  if exists (select 1 from public.overtime_employees e
             where e.id::text not like 'e1000000-0000-4000-8000-00000000000_' and e.id::text not like 'f1000000-0000-4000-8000-00000000000_') then
    raise exception '중단: 시험용이 아닌 연장근무 직원이 있습니다 — 개발용 DB가 아닌 것 같습니다';
  end if;
  if exists (select 1 from public.overtime_work_records r
             where r.employee_id::text not like 'e1000000-0000-4000-8000-00000000000_' and r.employee_id::text not like 'f1000000-0000-4000-8000-00000000000_') then
    raise exception '중단: 시험용이 아닌 연장근무 기록이 있습니다 — 개발용 DB가 아닌 것 같습니다';
  end if;
end $$;

do $$
begin
  if to_regclass('private.overtime_rehearsal_snapshot') is not null or to_regclass('private.overtime_rehearsal_catalog') is not null then
    raise exception '중단: 이전 리허설의 private.overtime_rehearsal_* 객체가 남아 있다 — 이전 리허설 상태를 확인한 뒤 직접 지운다';
  end if;
  if to_regprocedure('public.overtime_confirm_run(uuid,uuid[])') is null
     or coalesce(pg_catalog.pg_get_functiondef(to_regprocedure('public.overtime_confirm_run(uuid,uuid[])')) like '%확정 시 공휴일 변경 반영%', false) = false
     or not exists (select 1 from pg_catalog.pg_trigger where tgname = 'overtime_work_records_ab_monthly_target')
     or to_regprocedure('public.overtime_apply_project_sync(jsonb,jsonb)') is null then
    raise exception '중단: A·동기화 RPC·B·월 목표·격리수준·C가 모두 적용된 상태에서 시작한다';
  end if;
  if exists (select 1 from public.engineer_contacts c where c.company = '미래사업팀' and c.employee_id is null)
     and exists (select 1 from public.overtime_employees e
                 where e.is_active and not exists (select 1 from public.engineer_contacts c where c.employee_id = e.id)) then
    raise exception '중단: 미연결 재직 직원과 미연결 미래사업팀 주소록이 함께 있다 — 정방향 재적용(A)이 멈춘다. overtime_employee_link_check.sql 먼저';
  end if;
end $$;

create view private.overtime_rehearsal_catalog as
-- 함수: 정의 해시 + 실행 권한 + 소유자
select 'function'::text as kind, p.oid::regprocedure::text as name,
       md5(pg_catalog.pg_get_functiondef(p.oid)) || ' acl=' || coalesce(array_to_string(p.proacl, ','), 'default')
       || ' owner=' || pg_catalog.pg_get_userbyid(p.proowner) as fp
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'private') and p.prokind = 'f'
  and (p.proname like 'overtime\_%' or p.proname = 'sync_team_employees')
union all
-- 트리거: 정의 해시 + 활성 상태
select 'trigger', c.relname || '.' || t.tgname, md5(pg_catalog.pg_get_triggerdef(t.oid)) || ' enabled=' || t.tgenabled::text
from pg_catalog.pg_trigger t
join pg_catalog.pg_class c on c.oid = t.tgrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where not t.tgisinternal and n.nspname = 'public' and c.relname like 'overtime\_%'
union all
-- 표: 컬럼(이름·형식·NOT NULL·기본값, 순서대로) 해시 + RLS + 표 권한
select 'table', c.relname,
       md5(string_agg(a.attname || ':' || pg_catalog.format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':'
                      || coalesce(pg_catalog.pg_get_expr(d.adbin, d.adrelid), ''), ',' order by a.attnum))
       || ' rls=' || c.relrowsecurity::text || ' acl=' || max(coalesce(array_to_string(c.relacl, ','), 'default'))
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
left join pg_catalog.pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'overtime\_%'
group by c.oid, c.relname, c.relrowsecurity
union all
-- 제약조건
select 'constraint', c.relname || '.' || con.conname, md5(pg_catalog.pg_get_constraintdef(con.oid))
from pg_catalog.pg_constraint con
join pg_catalog.pg_class c on c.oid = con.conrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname like 'overtime\_%'
union all
-- 인덱스 (A가 만드는 engineer_contacts_employee_id_key 포함)
select 'index', i.tablename || '.' || i.indexname, md5(i.indexdef)
from pg_catalog.pg_indexes i
where i.schemaname = 'public' and (i.tablename like 'overtime\_%' or i.indexname = 'engineer_contacts_employee_id_key')
union all
-- 정책 (A가 만드는 holidays.overtime_select 포함)
select 'policy', p.tablename || '.' || p.policyname,
       md5(p.cmd || array_to_string(p.roles, ',') || coalesce(p.qual, '') || coalesce(p.with_check, ''))
from pg_catalog.pg_policies p
where p.schemaname = 'public' and (p.tablename like 'overtime\_%' or (p.tablename = 'holidays' and p.policyname = 'overtime_select'));

create table private.overtime_rehearsal_snapshot (
  kind text not null,      -- function·trigger·table·constraint·index·policy = 시작 지문 / data = 시작 건수 / step = 진행 기록
  name text not null,
  fp text not null,
  captured_at timestamptz not null default pg_catalog.now()
);
revoke all on private.overtime_rehearsal_snapshot from public, anon, authenticated, service_role;
revoke all on private.overtime_rehearsal_catalog from public, anon, authenticated, service_role;

insert into private.overtime_rehearsal_snapshot (kind, name, fp)
select kind, name, fp from private.overtime_rehearsal_catalog;

insert into private.overtime_rehearsal_snapshot (kind, name, fp) values
  ('data', 'overtime_assignment_runs', (select count(*) from public.overtime_assignment_runs)::text),
  ('data', 'overtime_assignment_drafts', (select count(*) from public.overtime_assignment_drafts)::text),
  ('data', 'overtime_work_records(auto)', (select count(*) from public.overtime_work_records where source = 'auto')::text),
  ('data', 'overtime_work_records(전체)', (select count(*) from public.overtime_work_records)::text),
  ('data', 'overtime_monthly_targets', (select count(*) from public.overtime_monthly_targets)::text),
  ('data', 'overtime_member_tasks', (select count(*) from public.overtime_member_tasks)::text),
  ('step', 'start', pg_catalog.now()::text);

commit;

select 's1_' || kind as check_name, 'INFO' as status, count(*)::text || '개 저장' as detail
from private.overtime_rehearsal_snapshot
group by kind
order by 1;
