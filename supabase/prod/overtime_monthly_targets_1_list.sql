-- 월 목표 선입력 1단계 — 대상 직원 목록 (읽기 전용, 운영 SQL Editor)
--
-- ⚠ 이 결과에는 직원 이름이 나온다 — SQL Editor 화면에서 본인 확인용으로만 본다.
--   결과를 내보내거나(Export·CSV) 대화창·문서·로그에 붙여 넣지 않는다. 2단계 적용은 이름이 아니라 UUID로만 한다.
-- 대상 = 재직 미래사업팀 직원: overtime_employees.is_active AND 주소록(engineer_contacts.employee_id 연결)이
--        company = '미래사업팀' AND employment_status = '재직'. 동명이인은 UUID로 구분한다.
-- "대상" 열이 false인 재직 행(주소록 미연결·주소록상 비재직)은 목표를 넣기 전에 원인을 확인한다.
-- 전제: Migration A 적용 후. [설정]의 급여기간을 2단계와 같게 둔다.

with opts as (select '2026-10'::text as period_label),   -- [설정] 급여기간
emp as (
  select e.id as overtime_employee_id,
         c.id as contact_id,
         e.name,
         e.is_active,
         c.id is not null as linked,
         coalesce(c.company = '미래사업팀' and c.employment_status = '재직', false) as contact_active_team,
         e.sort_order, e.created_at
  from public.overtime_employees e
  left join public.engineer_contacts c on c.employee_id = e.id
  where e.is_active
)
select
  row_number() over (order by emp.sort_order, emp.created_at, emp.overtime_employee_id) as 화면순번,
  emp.overtime_employee_id,
  emp.contact_id as 주소록_uuid,
  emp.name as 이름_화면확인용,
  emp.is_active as 재직,
  emp.linked as 주소록_연결,
  emp.contact_active_team as 대상,
  (select t.target_hours from public.overtime_monthly_targets t, opts
    where t.employee_id = emp.overtime_employee_id and t.period_label = opts.period_label) as 기존_목표시간,
  null::numeric as 입력할_목표시간
from emp
order by 1;
