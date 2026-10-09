-- 연장근무 개발 시험 — 시험 관리자 원복(restore): ot-ui-test@example.com 의 allowed_users.is_admin true → false
--
-- ⚠ 개발용 Supabase(zaot…iyas) 전용. 운영 흔적(시험용이 아닌 직원·기록, projects 10건 초과, 시험용이 아닌 승인 사용자 3명 초과)이
--   하나라도 있으면 어떤 변경보다 먼저 중단한다. 이메일 값·개인정보는 출력하지 않는다.
-- 바꾸는 것: 고정 이메일 한 행의 is_admin 한 열만. menu_permissions 등 다른 열과 다른 사용자 행은 그대로(변경 후 지문으로 확인).
-- 전체가 한 트랜잭션 — 어느 확인이든 실패하면 예외로 끝나고 아무것도 바뀌지 않는다.
-- 전제: 변경 전 is_admin = true(이번 절차에서 overtime_test_admin_enable.sql로 승격한 상태).
-- 짝: supabase/dev/overtime_test_admin_enable.sql. 실행 후 supabase/verify/admin_flag_preflight.sql로 관리자 수를 다시 확인한다.
-- 다시 실행하면 두 번째는 변경 전 상태가 달라 중단된다(같은 동작을 두 번 하지 않는다).
-- 결과: check_name / status / detail

begin;

create temp table if not exists ot_admin_results (seq int generated always as identity, check_name text, status text, detail text);
truncate pg_temp.ot_admin_results restart identity;

-- BEGIN shared:ot_test_admin (세 파일에서 글자 그대로 같아야 한다 — lib/overtime/sql/overtimeSql.test.ts)
-- 개발 DB 안전장치 — 운영 흔적이 하나라도 있으면 아무것도 바꾸지 않고 중단한다(overtime_behavior_test.sql과 같은 기준 + 승인 사용자 수)
create or replace function pg_temp.ot_test_admin_guard()
returns void
language plpgsql
as $fn$
begin
  if exists (select 1 from public.overtime_employees e
             where e.id::text not like 'e1000000-0000-4000-8000-%' and e.id::text not like 'f1000000-0000-4000-8000-%') then
    raise exception '중단: 시험용이 아닌 연장근무 직원이 있습니다 — 개발용 DB가 아닌 것 같습니다';
  end if;
  if exists (select 1 from public.overtime_work_records r
             where r.employee_id::text not like 'e1000000-0000-4000-8000-%' and r.employee_id::text not like 'f1000000-0000-4000-8000-%') then
    raise exception '중단: 시험용이 아닌 연장근무 기록이 있습니다 — 개발용 DB가 아닌 것 같습니다';
  end if;
  if (select count(*) from public.projects) > 10 then
    raise exception '중단: projects가 10건을 넘습니다 — 개발용 DB가 아닌 것 같습니다';
  end if;
  if (select count(*) from public.allowed_users
      where email not like '%@example.com' and email not like '%@example.invalid') > 3 then
    raise exception '중단: 시험용이 아닌 승인 사용자가 3명을 넘습니다 — 개발용 DB가 아닌 것 같습니다';
  end if;
end $fn$;

-- 시험 계정(고정 이메일 1개)의 is_admin만 p_target으로 바꾼다. 결과는 pg_temp.ot_admin_results에 남긴다(개인정보 없음).
--   enable(p_target = true): 변경 전 false, 다른 관리자 0명이어야 함 / restore(p_target = false): 변경 전 true여야 함
--   대상 행이 정확히 1개가 아니면, 변경 전 상태가 다르면, 다른 행·다른 열이 바뀌면 예외 → 트랜잭션 전체가 되돌아간다.
create or replace function pg_temp.ot_test_admin_set(p_target boolean)
returns void
language plpgsql
as $fn$
declare
  c_email constant text := 'ot-ui-test@example.com';
  v_rows int;
  v_before boolean;
  v_after boolean;
  v_changed int;
  v_other_admins int;
  v_others_before text;
  v_others_after text;
  v_self_before text;
  v_self_after text;
begin
  -- 0. 개발 DB 안전장치 — 어떤 변경보다 먼저
  perform pg_temp.ot_test_admin_guard();
  insert into pg_temp.ot_admin_results (check_name, status, detail) values ('01 개발 DB 가드', 'OK', '통과');

  -- 1. 대상: 고정 이메일 정확히 1행
  select count(*) into v_rows from public.allowed_users where email = c_email;
  insert into pg_temp.ot_admin_results (check_name, status, detail)
    values ('02 대상 행 수', case when v_rows = 1 then 'OK' else 'FAIL' end, v_rows || '행 (정확히 1행이어야 함)');
  if v_rows <> 1 then
    raise exception 'OVERTIME_TEST_ADMIN: 대상 행이 정확히 1개가 아님 (%행)', v_rows;
  end if;

  -- 2. 변경 전 상태
  select u.is_admin into v_before from public.allowed_users u where u.email = c_email;
  insert into pg_temp.ot_admin_results (check_name, status, detail)
    values ('03 변경 전 관리자 여부', case when v_before is not distinct from (not p_target) then 'OK' else 'FAIL' end,
            'is_admin=' || coalesce(v_before::text, 'null') || ' (기대 ' || (not p_target)::text || ')');
  if v_before is distinct from (not p_target) then
    raise exception 'OVERTIME_TEST_ADMIN: 변경 전 is_admin이 %여야 함 (현재 %)', (not p_target)::text, coalesce(v_before::text, 'null');
  end if;
  if p_target then
    select count(*) into v_other_admins from public.allowed_users u where u.is_admin is true and u.email <> c_email;
    insert into pg_temp.ot_admin_results (check_name, status, detail)
      values ('04 다른 관리자 수', case when v_other_admins = 0 then 'OK' else 'FAIL' end, v_other_admins || '명 (0명일 때만 시험 계정을 승격)');
    if v_other_admins > 0 then
      raise exception 'OVERTIME_TEST_ADMIN: 이미 다른 관리자 %명 — 시험 계정을 승격하지 않음', v_other_admins;
    end if;
  end if;

  -- 3. 변경 전 지문(행 내용 비교용 — 출력하지 않음): 다른 행 전체 / 대상 행의 is_admin 밖 열
  select md5(coalesce(string_agg(to_jsonb(u)::text, '|' order by u.id), '')) into v_others_before
    from public.allowed_users u where u.email <> c_email;
  select md5((to_jsonb(u) - 'is_admin')::text) into v_self_before from public.allowed_users u where u.email = c_email;

  -- 4. 변경: 이 계정의 is_admin 한 열만
  update public.allowed_users set is_admin = p_target where email = c_email and is_admin is distinct from p_target;
  get diagnostics v_changed = row_count;
  insert into pg_temp.ot_admin_results (check_name, status, detail)
    values ('05 변경 행 수', case when v_changed = 1 then 'OK' else 'FAIL' end, v_changed || '행');
  if v_changed <> 1 then
    raise exception 'OVERTIME_TEST_ADMIN: 변경 행 수가 1이 아님 (%행)', v_changed;
  end if;

  -- 5. 변경 후 확인
  select u.is_admin into v_after from public.allowed_users u where u.email = c_email;
  select md5((to_jsonb(u) - 'is_admin')::text) into v_self_after from public.allowed_users u where u.email = c_email;
  select md5(coalesce(string_agg(to_jsonb(u)::text, '|' order by u.id), '')) into v_others_after
    from public.allowed_users u where u.email <> c_email;
  insert into pg_temp.ot_admin_results (check_name, status, detail)
    values ('06 변경 후 관리자 여부', case when v_after is not distinct from p_target then 'OK' else 'FAIL' end,
            'is_admin=' || coalesce(v_after::text, 'null') || ' (기대 ' || p_target::text || ')'),
           ('07 대상 행의 다른 열', case when v_self_after = v_self_before then 'OK' else 'FAIL' end,
            case when v_self_after = v_self_before then '변경 없음(menu_permissions 등)' else '바뀜' end),
           ('08 다른 행 변경', case when v_others_after = v_others_before then 'OK' else 'FAIL' end,
            case when v_others_after = v_others_before then '0건' else '바뀜' end);
  if v_after is distinct from p_target or v_self_after <> v_self_before or v_others_after <> v_others_before then
    raise exception 'OVERTIME_TEST_ADMIN: 변경 후 확인 실패 — 되돌림';
  end if;
end $fn$;
-- END shared:ot_test_admin

select pg_temp.ot_test_admin_set(false);

commit;

select check_name, status, detail from pg_temp.ot_admin_results order by seq;
