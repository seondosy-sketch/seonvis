-- 팀 직원 명단 = 기술인 주소록의 소속 '미래사업팀' — 단방향 동기화 (engineer_contacts → overtime_employees)
--
-- overtime_employees는 연장근무(제안서팀)·연장근무(실무자)·휴가관리·숙박관리가 같이 쓰는 직원 테이블이고,
-- 근무기록·휴가 등 FK가 전부 여기를 가리킨다. 그래서 테이블을 바꾸지 않고, 주소록을 원본으로 삼아
-- 이 테이블을 맞춰 넣는다. 둘의 연결은 migration_engineers.sql에서 예약만 해두었던
-- engineer_contacts.employee_id를 쓴다.
--
-- 원칙:
-- - 이름·직급(rank)·재직여부는 주소록이 원본 — 연결된 직원 행은 sync 때마다 덮어쓴다.
--   재직여부 = (소속이 '미래사업팀' AND 재직상태 '재직'). 다른 소속으로 옮기거나 퇴직하면 비활성.
-- - 정렬순서·기본업무내용·입사일 등 연장근무/휴가 전용 정보는 overtime_employees에만 있으므로 건드리지 않는다.
-- - 삭제는 하지 않는다(근무기록 FK RESTRICT, 과거 기록 보존).
-- - 아직 연결 안 된 '미래사업팀' 기술인은 같은 이름의 미연결 직원이 있으면 그 행에 연결하고,
--   없으면 직원 행을 새로 만든다.

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

revoke all on function public.sync_team_employees() from public, anon;
grant execute on function public.sync_team_employees() to authenticated;

-- ── 1회성: 기존 연장근무 직원을 주소록 '미래사업팀' 인원으로 반영 ─────────────────
-- 주소록에 '미래사업팀' 소속으로 없는 기존 직원(예: 소속이 비어 있던 서영빈)을 주소록 쪽에 맞춘다.
--   1) 같은 이름·같은 직급의 기술인이 소속 빈칸으로 정확히 1명 있으면 → 그 사람의 소속을 '미래사업팀'으로
--      (같은 이름이라도 직급이 다르면 동명이인일 수 있어 건드리지 않는다 — 예: 김영준 부장 vs 김영준 상무)
--   2) 그것도 없으면 → 주소록에 '미래사업팀' 기술인을 새로 만든다
update engineer_contacts c
set company = '미래사업팀'
from overtime_employees e
where c.name = e.name
  and c.rank = e.position
  and c.company = ''
  and c.employee_id is null
  and not exists (select 1 from engineer_contacts t where t.name = e.name and t.company = '미래사업팀')
  and (select count(*) from engineer_contacts d where d.name = e.name and d.rank = e.position and d.company = '') = 1;

insert into engineer_contacts (name, rank, company, employment_status, employee_id)
select e.name, e.position, '미래사업팀', case when e.is_active then '재직' else '퇴직' end, e.id
from overtime_employees e
where not exists (select 1 from engineer_contacts t where t.name = e.name and t.company = '미래사업팀')
  and not exists (select 1 from engineer_contacts x where x.employee_id = e.id);

-- 위 정리 후 이름으로 연결 (SQL 에디터는 auth.jwt()가 없어 함수의 권한 검사를 통과하지 못하므로
-- 함수 본문과 같은 연결 로직을 여기서 한 번 직접 실행한다)
update engineer_contacts c
set employee_id = e.id
from overtime_employees e
where c.company = '미래사업팀'
  and c.employee_id is null
  and c.name = e.name
  and not exists (select 1 from engineer_contacts x where x.employee_id = e.id)
  and (select count(*) from engineer_contacts d where d.company = '미래사업팀' and d.name = c.name) = 1;
