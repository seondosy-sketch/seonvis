-- 월 목표 선입력 2단계 — 미리보기 / 적용 (운영 SQL Editor, 한 번에 전체 실행)
--
-- 사용법
--   ① 아래 [설정]의 period_label·expected_count를 확인하고, apply = false 로 둔 채 [입력표]를 채워 실행 → 미리보기 표 확인
--   ② 미리보기의 verdict가 전부 OK면 apply = true 로 바꿔 다시 실행 → 적용 결과 표 확인
--   - 이름으로 고르지 않는다: overtime_employee_id(1단계 목록의 UUID)만 쓴다. 동명이인도 UUID로 구분된다.
--   - 대상 = 재직 미래사업팀 직원(overtime_employees.is_active AND 주소록 연결 + company '미래사업팀' + '재직').
--     대상 인원이 expected_count(9)와 다르면 적용하지 않는다.
--   ⚠ 결과표 아래쪽 "입력값" 행에는 이름이 나온다 — SQL Editor 화면 확인용. 내보내거나 대화창·문서에 붙이지 않는다.
--   - 목표시간은 0 이상(0 = 그 기간 연장근무 0시간, 양수 입력 전부 차단). 빈칸(null)은 허용하지 않는다.
--   - 이미 목표가 있는 직원이 있으면 overwrite = true일 때만 덮어쓴다(기본은 중단).
-- 안전: 전체가 한 트랜잭션. 검사 하나라도 실패하면 아무것도 바뀌지 않는다(apply = true여도 미적용).
--       누락 직원·중복·없는 ID·비재직 ID·개수 불일치·범위 밖 값은 모두 FAIL.
-- 되돌리기(월 목표 강제조건 적용 전에만): overtime_monthly_targets_3_rollback.sql

begin;

create temp table ot_target_opts (period_label text, expected_count int, apply boolean, overwrite boolean) on commit drop;
create temp table ot_target_input (employee_id uuid, target_hours numeric) on commit drop;

-- ── [설정] ─────────────────────────────────────────────────────────────────
insert into ot_target_opts values ('2026-10', 9, false, false);
--                                  급여기간   재직인원 적용여부 덮어쓰기

-- ── [입력표] 1단계 목록의 employee_id와 목표시간을 적는다 (9줄) ───────────────────
insert into ot_target_input (employee_id, target_hours) values
  ('00000000-0000-0000-0000-000000000000', null),
  ('00000000-0000-0000-0000-000000000000', null),
  ('00000000-0000-0000-0000-000000000000', null),
  ('00000000-0000-0000-0000-000000000000', null),
  ('00000000-0000-0000-0000-000000000000', null),
  ('00000000-0000-0000-0000-000000000000', null),
  ('00000000-0000-0000-0000-000000000000', null),
  ('00000000-0000-0000-0000-000000000000', null),
  ('00000000-0000-0000-0000-000000000000', null);
-- ───────────────────────────────────────────────────────────────────────────

create temp table ot_target_result (seq int generated always as identity, check_name text, verdict text, detail text) on commit drop;

-- 대상 직원(재직 미래사업팀) — 검사·적용·미리보기가 모두 이 목록을 기준으로 한다
create or replace temp view ot_target_scope as
  select e.id as employee_id, c.id as contact_id, e.name, e.sort_order, e.created_at
  from public.overtime_employees e
  join public.engineer_contacts c on c.employee_id = e.id
  where e.is_active and c.company = '미래사업팀' and c.employment_status = '재직';

do $$
declare
  o record;
  v_errors int;
  v_written int := 0;
begin
  select * into o from ot_target_opts;
  if to_regclass('public.overtime_monthly_targets') is null then
    raise exception '중단: Migration A가 적용되지 않았다(overtime_monthly_targets 없음)';
  end if;

  insert into ot_target_result (check_name, verdict, detail)
  select '급여기간 형식', case when o.period_label ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then 'OK' else 'FAIL' end, o.period_label
  union all
  select '입력 줄 수 = 재직인원(' || o.expected_count || ')',
         case when (select count(*) from ot_target_input) = o.expected_count then 'OK' else 'FAIL' end,
         (select count(*) from ot_target_input)::text || '줄'
  union all
  select '대상(재직 미래사업팀) 인원 = ' || o.expected_count,
         case when (select count(*) from ot_target_scope) = o.expected_count then 'OK' else 'FAIL' end,
         (select count(*) from ot_target_scope)::text || '명'
  union all
  select '재직이지만 대상 아님(주소록 미연결·비재직)', case when exists (select 1 from public.overtime_employees e where e.is_active
                                    and not exists (select 1 from ot_target_scope s where s.employee_id = e.id)) then 'FAIL' else 'OK' end,
         (select count(*) from public.overtime_employees e where e.is_active
           and not exists (select 1 from ot_target_scope s where s.employee_id = e.id))::text || '명'
  union all
  select '자리표시 ID(000…) 남아 있음', case when exists (select 1 from ot_target_input where employee_id = '00000000-0000-0000-0000-000000000000') then 'FAIL' else 'OK' end, ''
  union all
  select '목표시간 빈칸', case when exists (select 1 from ot_target_input where target_hours is null) then 'FAIL' else 'OK' end,
         (select count(*) from ot_target_input where target_hours is null)::text || '줄'
  union all
  select '목표시간 범위(0~300)', case when exists (select 1 from ot_target_input where target_hours < 0 or target_hours > 300) then 'FAIL' else 'OK' end, ''
  union all
  select '중복 employee_id', case when exists (select 1 from ot_target_input group by employee_id having count(*) > 1) then 'FAIL' else 'OK' end,
         coalesce((select string_agg(employee_id::text, ', ') from (select employee_id from ot_target_input group by employee_id having count(*) > 1) d), '')
  union all
  select '대상이 아닌 ID(없음·비재직·다른 팀)', case when exists (select 1 from ot_target_input i where not exists
                                    (select 1 from ot_target_scope s where s.employee_id = i.employee_id)) then 'FAIL' else 'OK' end,
         coalesce((select string_agg(i.employee_id::text, ', ') from ot_target_input i where not exists
                   (select 1 from ot_target_scope s where s.employee_id = i.employee_id)), '')
  union all
  select '누락된 대상 직원', case when exists (select 1 from ot_target_scope s
                                    where not exists (select 1 from ot_target_input i where i.employee_id = s.employee_id)) then 'FAIL' else 'OK' end,
         coalesce((select string_agg(s.employee_id::text, ', ') from ot_target_scope s
                   where not exists (select 1 from ot_target_input i where i.employee_id = s.employee_id)), '')
  union all
  select '이미 목표가 있는 직원', case when not exists (select 1 from public.overtime_monthly_targets t join ot_target_input i on i.employee_id = t.employee_id
                                                        where t.period_label = o.period_label) then 'OK'
                                        when o.overwrite then 'OK(덮어씀)' else 'FAIL' end,
         (select count(*) from public.overtime_monthly_targets t join ot_target_input i on i.employee_id = t.employee_id where t.period_label = o.period_label)::text || '명';

  select count(*) into v_errors from ot_target_result where verdict = 'FAIL';

  if o.apply then
    if v_errors > 0 then
      raise exception '중단: 검사 실패 %건 — 아무것도 적용하지 않았다. apply = false로 미리보기를 먼저 확인하세요', v_errors;
    end if;
    insert into public.overtime_monthly_targets (employee_id, period_label, target_hours)
    select employee_id, o.period_label, target_hours from ot_target_input
    on conflict (employee_id, period_label) do update set target_hours = excluded.target_hours
      where o.overwrite;
    get diagnostics v_written = row_count;
    insert into ot_target_result (check_name, verdict, detail)
    select '적용 행 수', case when v_written = o.expected_count then 'OK' else 'FAIL' end, v_written::text || '행'
    union all
    select '적용 후 ' || o.period_label || ' 대상 직원 목표 = ' || o.expected_count || '명',
           case when (select count(*) from public.overtime_monthly_targets t join ot_target_scope s on s.employee_id = t.employee_id
                       where t.period_label = o.period_label) = o.expected_count then 'OK' else 'FAIL' end,
           (select count(*) from public.overtime_monthly_targets t join ot_target_scope s on s.employee_id = t.employee_id
             where t.period_label = o.period_label)::text || '명';
    if exists (select 1 from ot_target_result where verdict = 'FAIL') then
      raise exception '중단: 적용 후 확인 실패 — 전체 되돌림';
    end if;
  else
    insert into ot_target_result (check_name, verdict, detail) values ('모드', 'INFO', '미리보기만 — 아무것도 바꾸지 않았다 (apply = false)');
  end if;
end $$;

-- 미리보기 / 적용 결과
--   위쪽(검사 행): ID·숫자만. 아래쪽(입력값 행): 화면순번·두 UUID·이름·재직·주소록 연결·기존 목표·입력할 목표 — 이름은 화면 확인용
select r.seq, r.check_name, r.verdict, r.detail,
       null::bigint as 화면순번, null::uuid as overtime_employee_id, null::uuid as 주소록_uuid, null::text as 이름_화면확인용,
       null::boolean as 재직, null::boolean as 주소록_연결, null::numeric as 기존_목표시간, null::numeric as 입력할_목표시간
from ot_target_result r
union all
select 1000 + row_number() over (order by e.sort_order nulls last, e.created_at, i.employee_id), '입력값', 'INFO', '',
       (select x.n from (select s2.employee_id, row_number() over (order by s2.sort_order, s2.created_at, s2.employee_id) as n from ot_target_scope s2) x
         where x.employee_id = i.employee_id),
       i.employee_id, s.contact_id, e.name, e.is_active, s.employee_id is not null,
       (select t.target_hours from public.overtime_monthly_targets t, ot_target_opts o where t.employee_id = i.employee_id and t.period_label = o.period_label),
       i.target_hours
from ot_target_input i
left join public.overtime_employees e on e.id = i.employee_id
left join ot_target_scope s on s.employee_id = i.employee_id
order by 1;

commit;
