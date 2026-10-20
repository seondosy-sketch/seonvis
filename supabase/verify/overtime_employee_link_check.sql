-- 연장근무 직원 ↔ 기술인 주소록 연결 확인 (읽기 전용, SELECT 한 문장)
--
-- 언제: overtime_planning_preflight.sql의 p10(미연결 재직 직원)·p11(미연결 '미래사업팀' 주소록)이 둘 다 STOP일 때,
--   또는 sync_team_employees / migration A·C가 OVERTIME_EMPLOYEE_LINK_REQUIRED로 멈췄을 때.
-- 왜: 둘 다 있으면 첫 동기화가 같은 사람을 새 직원 행(새 UUID)으로 만들고 기존 직원 행은 비활성으로 돌려
--   과거 기록·월 목표·업무·참여가 옛 UUID에 남는다(직원 분리). DB는 이름으로 자동 연결하지 않는다.
-- 하는 일: 양쪽 미연결 행을 UUID와 최소 식별정보로 나열한다. 데이터·스키마를 바꾸지 않는다. 자동 연결 SQL은 없다.
--   연결은 사람이 이 목록을 보고 주소록 행의 employee_id에 기존 직원 UUID를 한 행씩 지정한다(별도 승인, 이 파일 밖).
--   연결 후 overtime_planning_preflight.sql을 다시 실행해 p10·p11이 STOP이 아닌지 확인한다.
-- 결과: check_name / status(STOP·INFO·OK) / detail
--
-- 나오는 정보(최소한):
--   주소록: contact_id(UUID), 이름, 재직상태, 등록일 / 직원: employee_id(UUID), 이름, 재직 여부, 기록 건수·마지막 근무일, 등록일
--   이름은 꼭 필요하다 — UUID만으로는 어느 주소록 행이 어느 직원과 같은 사람인지 사람이 판단할 수 없다.
--   동명이인은 기록 건수·마지막 근무일·등록일로 구분한다. 전화번호·이메일·주소·직위는 내지 않는다.
-- ⚠ 결과에 이름이 나온다 — SQL Editor 화면 확인용으로만 본다. 내보내거나(Export·CSV) 대화창·문서·로그에 붙여 넣지 않는다.

with
unlinked_employees as (
  select e.id, e.name, e.is_active, e.created_at,
         (select count(*) from public.overtime_work_records r where r.employee_id = e.id) as record_count,
         (select max(r.work_date) from public.overtime_work_records r where r.employee_id = e.id) as last_work_date
  from public.overtime_employees e
  where not exists (select 1 from public.engineer_contacts c where c.employee_id = e.id)
),
unlinked_contacts as (
  select c.id, c.name, c.employment_status, c.created_at
  from public.engineer_contacts c
  where c.company = '미래사업팀' and c.employee_id is null
),
counts as (
  select (select count(*) from unlinked_employees where is_active) as active_employees,
         (select count(*) from unlinked_contacts) as contacts
),
checks(sort_key, check_name, status, detail) as (
  select 0, 'l00_link_required',
         case when n.active_employees > 0 and n.contacts > 0 then 'STOP' else 'OK' end,
         '미연결 재직 직원 ' || n.active_employees || '명 / 미연결 미래사업팀 주소록 ' || n.contacts || '명'
         || case when n.active_employees > 0 and n.contacts > 0 then ' — 수동 연결 전에는 동기화·migration A·C가 중단된다' else '' end
  from counts n
  union all
  select 1, 'l01_unlinked_contact',
         case when n.active_employees > 0 then 'STOP' else 'INFO' end,
         'contact_id=' || c.id || ' 이름=' || c.name || ' 재직상태=' || c.employment_status
         || ' 등록일=' || coalesce(to_char(c.created_at at time zone 'Asia/Seoul', 'YYYY-MM-DD'), '-')
  from unlinked_contacts c cross join counts n
  union all
  -- 재직 직원만 동기화가 비활성 처리하지만, 이미 비활성인 미연결 직원도 같은 사람일 수 있어 INFO로 함께 보인다
  select 2, 'l02_unlinked_employee',
         case when e.is_active and n.contacts > 0 then 'STOP' else 'INFO' end,
         'employee_id=' || e.id || ' 이름=' || e.name || ' 재직=' || e.is_active
         || ' 기록=' || e.record_count || '건 마지막근무일=' || coalesce(e.last_work_date::text, '-')
         || ' 등록일=' || coalesce(to_char(e.created_at at time zone 'Asia/Seoul', 'YYYY-MM-DD'), '-')
  from unlinked_employees e cross join counts n
)
select check_name, status, detail from checks order by sort_key, detail;
