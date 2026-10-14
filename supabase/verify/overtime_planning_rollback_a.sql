-- 연장근무 자동배정 — Migration A 복구 초안 (실행하지 않는다. 문제 시 별도 승인 후, B가 없을 때만)
--
-- 안전장치: B가 적용돼 있거나, 새 테이블에 데이터가 있거나, 동명이인이 생겼으면 중단한다.
-- 기존 overtime_work_records의 기존 컬럼 값과 hours는 건드리지 않는다. 새 컬럼만 지운다
-- (A 단독 상태에서는 새 컬럼에 값이 들어갈 경로가 없다 — postflight a04로 확인).
--
-- 되돌리기 순서: overtime_planning_c_rollback → overtime_cap_isolation_guard_rollback → overtime_monthly_target_rollback → overtime_planning_rollback_b → overtime_project_sync_rpc_rollback → overtime_planning_rollback_a
--   마지막 단계. sync_team_employees는 migration_team_roster_sync.sql 원래 정의(이름 매칭)로 돌아간다.

begin;

do $$
begin
  if to_regprocedure('public.overtime_confirm_run(uuid,uuid[])') is not null
     or exists (select 1 from pg_trigger where tgname = 'overtime_work_records_a_protect') then
    raise exception 'rollback A 중단: Migration B가 적용돼 있다 — rollback_b 먼저';
  end if;
  -- 월 목표 트리거는 A의 private.overtime_pay_period를 부른다(plpgsql은 의존성 추적이 없어 지워도 막히지 않고,
  -- 이후 수동 입력이 실행 시점에 깨진다) → overtime_monthly_target_rollback.sql을 먼저
  if exists (select 1 from pg_trigger where tgname = 'overtime_work_records_ab_monthly_target')
     or to_regprocedure('private.overtime_assert_monthly_target(uuid,date,numeric,uuid,numeric)') is not null then
    raise exception 'rollback A 중단: 월 목표 강제조건이 남아 있다 — overtime_cap_isolation_guard_rollback.sql → overtime_monthly_target_rollback.sql 먼저';
  end if;
  if exists (select 1 from public.overtime_assignment_runs) or exists (select 1 from public.overtime_assignment_drafts)
     or exists (select 1 from public.overtime_monthly_targets) or exists (select 1 from public.overtime_member_tasks) then
    raise exception 'rollback A 중단: 새 테이블에 데이터가 있다 — 보존 방안을 먼저 정한다';
  end if;
  if exists (select 1 from public.overtime_work_records
             where source = 'auto' or assignment_run_id is not null or assignment_exception_reason is not null
                or employee_name_snapshot is not null or project_name_snapshot is not null or task_name_snapshot is not null) then
    raise exception 'rollback A 중단: 새 컬럼에 값이 있다';
  end if;
  if exists (select 1 from public.overtime_employees group by name having count(*) > 1) then
    raise exception 'rollback A 중단: 같은 이름 직원이 둘 이상 — overtime_employees_name_key 복원 불가';
  end if;
end $$;

drop index if exists public.overtime_work_records_assignment_draft_key;
drop index if exists public.overtime_work_records_auto_one_per_day;
alter table public.overtime_work_records drop constraint if exists overtime_work_records_assignment_draft_fk;
alter table public.overtime_work_records drop constraint if exists overtime_work_records_assignment_run_fk;
alter table public.overtime_work_records drop constraint if exists overtime_work_records_exception_check;
alter table public.overtime_work_records drop constraint if exists overtime_work_records_auto_link_check;
alter table public.overtime_work_records drop constraint if exists overtime_work_records_source_check;
alter table public.overtime_work_records
  drop column if exists confirmed_at,
  drop column if exists assignment_exception_reason,
  drop column if exists task_name_snapshot,
  drop column if exists project_name_snapshot,
  drop column if exists employee_name_snapshot,
  drop column if exists assignment_draft_id,
  drop column if exists assignment_run_id,
  drop column if exists source;

drop table if exists public.overtime_assignment_drafts;
drop table if exists public.overtime_assignment_runs;
drop table if exists public.overtime_member_tasks;
drop trigger if exists overtime_monthly_targets_touch on public.overtime_monthly_targets;
drop table if exists public.overtime_monthly_targets;
alter table public.overtime_project_members drop constraint if exists overtime_project_members_id_employee_key;
alter table public.overtime_employee_tasks drop constraint if exists overtime_employee_tasks_id_employee_key;

drop function if exists private.overtime_monthly_targets_touch();
drop function if exists private.overtime_pay_period(text);
drop function if exists private.overtime_week_start(date);

drop policy if exists "overtime_select" on public.holidays;
drop index if exists public.engineer_contacts_employee_id_key;
alter table public.overtime_employees add constraint overtime_employees_name_key unique (name);

-- sync_team_employees 원래 정의 (supabase/migration_team_roster_sync.sql과 동일)
create or replace function public.sync_team_employees()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;  -- 아래 UPDATE 문의 테이블 별칭 c와 겹치지 않게 (겹치면 "ambiguous" 오류)
  eid uuid;
begin
  -- 연장근무/실무자 연장근무 중 하나라도 볼 수 있는 사용자만. 동기화 결과는 원본(주소록)에서
  -- 파생된 값뿐이라 읽기 권한 사용자가 실행해도 사용자가 고를 수 있는 값은 없다.
  if private.menu_permission('overtime') = 'none' and private.menu_permission('field_overtime') = 'none' then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  for rec in
    select * from engineer_contacts
    where company = '미래사업팀' and employee_id is null
    order by created_at, name
  loop
    select e.id into eid
    from overtime_employees e
    where e.name = rec.name
      and not exists (select 1 from engineer_contacts x where x.employee_id = e.id)
    limit 1;

    if eid is null then
      -- 같은 이름의 직원이 이미 다른 기술인과 연결돼 있으면(동명이인) 이름 UNIQUE 때문에 만들 수 없다 — 건너뛴다
      if exists (select 1 from overtime_employees where name = rec.name) then
        continue;
      end if;
      insert into overtime_employees (name, position, is_active, sort_order)
      values (rec.name, rec.rank, rec.employment_status = '재직',
              coalesce((select max(sort_order) from overtime_employees), 0) + 10)
      returning id into eid;
    end if;

    update engineer_contacts set employee_id = eid where id = rec.id;
  end loop;

  update overtime_employees e
  set position = c.rank,
      is_active = (c.company = '미래사업팀' and c.employment_status = '재직')
  from engineer_contacts c
  where c.employee_id = e.id
    and (e.position, e.is_active) is distinct from (c.rank, (c.company = '미래사업팀' and c.employment_status = '재직'));

  -- 이름은 따로 — 바꾸려는 이름이 다른 직원과 겹치면(UNIQUE) 그 행만 건너뛴다
  update overtime_employees e
  set name = c.name
  from engineer_contacts c
  where c.employee_id = e.id
    and e.name <> c.name
    and not exists (select 1 from overtime_employees o where o.name = c.name and o.id <> e.id);
end;
$$;

revoke all on function public.sync_team_employees() from public, anon, authenticated, service_role;
grant execute on function public.sync_team_employees() to authenticated, service_role;

commit;
