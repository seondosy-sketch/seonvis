-- 연장근무 개발 시험 — 시험 관리자 승격·원복 SQL의 안전장치 동작 시험 (변경을 남기지 않음)
--
-- ⚠ 개발용 Supabase(zaot…iyas) 전용. overtime_test_admin_enable.sql / _restore.sql과 같은 함수 본문(shared 블록)을 만든 뒤,
--   하위 트랜잭션 안에서 시나리오를 돌리고 매번 되돌린다. 마지막 Z 행이 allowed_users 전체가 시험 전과 같은지 확인한다.
-- 실제 승격 전(0-1단계 전)에 실행한다. 시나리오마다 필요한 상태(시험 계정 is_admin = false 등)를 하위 트랜잭션 안에서 만들고 되돌린다.
-- 이메일 값·개인정보는 출력하지 않는다. 결과: check_name / status / detail
--
-- 시나리오: T1 승격 → 두 번째 승격 거부 → 원복 → 두 번째 원복 거부(대상 행의 다른 열·다른 행 불변)
--          T2 대상 행 0개 → 중단·변경 0   T3 대상 행 2개(이메일 UNIQUE라 만들 수 없음을 확인)
--          T4 운영 흔적(시험용이 아닌 승인 사용자 4명) → 가드 중단·변경 0   T5 다른 관리자 있음 → 승격 중단·변경 0

create temp table if not exists ot_admin_results (seq int generated always as identity, check_name text, status text, detail text);
truncate pg_temp.ot_admin_results restart identity;
create temp table if not exists ot_admin_test_results (seq int generated always as identity, check_name text, status text, detail text);
truncate pg_temp.ot_admin_test_results restart identity;

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

do $$
declare
  c_rollback constant text := 'ot_admin_test: 시나리오 되돌리기';
  v_out jsonb := '[]'::jsonb;
  v_all_before text;
  v_all_after text;
  v_self text;
  v_others text;
  v_flag boolean;
  v_err text;
  v_n int;
  v_target uuid;
  r jsonb;
begin
  -- 0. 개발 DB 안전장치 — 시나리오 준비(하위 트랜잭션 쓰기)보다 먼저
  perform pg_temp.ot_test_admin_guard();
  v_out := v_out || jsonb_build_object('c', 'T0 개발 DB 가드', 's', 'OK', 'd', '통과');
  -- 대상 행은 shared 함수가 쓰는 고정 이메일 행이다. 여기서는 이메일을 다시 쓰지 않고 그 행의 id로 가리킨다.
  select count(*) into v_n from public.allowed_users u where u.email like 'ot-ui-test@%';
  if v_n <> 1 then
    raise exception '중단: 시험 계정 행이 정확히 1개가 아님(%행) — overtime_ui_seed.sql 상태를 확인한다', v_n;
  end if;
  select u.id into v_target from public.allowed_users u where u.email like 'ot-ui-test@%';
  select md5(coalesce(string_agg(to_jsonb(u)::text, '|' order by u.id), '')) into v_all_before from public.allowed_users u;

  -- T1 정상 흐름 + 두 번 실행 중단
  begin
    update public.allowed_users set is_admin = false where id = v_target;              -- 준비(되돌려짐)
    delete from public.allowed_users where is_admin is true and id <> v_target;        -- 준비: 다른 관리자 0명(되돌려짐)
    select md5((to_jsonb(u) - 'is_admin')::text) into v_self from public.allowed_users u where u.id = v_target;
    select md5(coalesce(string_agg(to_jsonb(u)::text, '|' order by u.id), '')) into v_others from public.allowed_users u where u.id <> v_target;
    perform pg_temp.ot_test_admin_set(true);
    select is_admin into v_flag from public.allowed_users where id = v_target;
    v_out := v_out || jsonb_build_object('c', 'T1-1 승격 후 is_admin', 's', case when v_flag then 'OK' else 'FAIL' end, 'd', 'is_admin=' || v_flag::text);
    -- 예상 거부 시나리오 판정(T1-2·T1-4·T2·T4·T5 공통): 기대한 오류로 거부되고 상태가 그대로면 OK, 거부되지 않거나 다른 오류면 FAIL
    begin
      perform pg_temp.ot_test_admin_set(true);
      v_err := null;
    exception when others then v_err := sqlerrm;
    end;
    v_out := v_out || jsonb_build_object('c', 'T1-2 두 번째 승격 거부', 's',
      case when v_err like 'OVERTIME_TEST_ADMIN: 변경 전 is_admin이 false여야 함%'
                and (select is_admin from public.allowed_users where id = v_target) is true then 'OK' else 'FAIL' end,
      'd', '기대 거부: OVERTIME_TEST_ADMIN 변경 전 is_admin이 false여야 함 / 실제: ' || coalesce(left(v_err, 80), '거부되지 않음'));
    perform pg_temp.ot_test_admin_set(false);
    select is_admin into v_flag from public.allowed_users where id = v_target;
    v_out := v_out || jsonb_build_object('c', 'T1-3 원복 후 is_admin', 's', case when not v_flag then 'OK' else 'FAIL' end, 'd', 'is_admin=' || v_flag::text);
    begin
      perform pg_temp.ot_test_admin_set(false);
      v_err := null;
    exception when others then v_err := sqlerrm;
    end;
    v_out := v_out || jsonb_build_object('c', 'T1-4 두 번째 원복 거부', 's',
      case when v_err like 'OVERTIME_TEST_ADMIN: 변경 전 is_admin이 true여야 함%'
                and (select is_admin from public.allowed_users where id = v_target) is false then 'OK' else 'FAIL' end,
      'd', '기대 거부: OVERTIME_TEST_ADMIN 변경 전 is_admin이 true여야 함 / 실제: ' || coalesce(left(v_err, 80), '거부되지 않음'));
    v_out := v_out || jsonb_build_object('c', 'T1-5 대상 행의 다른 열 불변(승격·원복 후)', 's',
      case when (select md5((to_jsonb(u) - 'is_admin')::text) from public.allowed_users u where u.id = v_target) = v_self then 'OK' else 'FAIL' end,
      'd', 'menu_permissions 등');
    v_out := v_out || jsonb_build_object('c', 'T1-6 다른 사용자 행 불변', 's',
      case when (select md5(coalesce(string_agg(to_jsonb(u)::text, '|' order by u.id), '')) from public.allowed_users u where u.id <> v_target) = v_others
           then 'OK' else 'FAIL' end, 'd', '다른 행 0건 변경');
    raise exception '%', c_rollback;
  exception when others then
    if sqlerrm <> c_rollback then v_out := v_out || jsonb_build_object('c', 'T1 예외', 's', 'FAIL', 'd', left(sqlerrm, 120)); end if;
  end;

  -- T2 대상 행 0개 → 중단, 변경 0
  begin
    delete from public.allowed_users where id = v_target;                              -- 준비(되돌려짐)
    select md5(coalesce(string_agg(to_jsonb(u)::text, '|' order by u.id), '')) into v_others from public.allowed_users u;
    begin
      perform pg_temp.ot_test_admin_set(true);
      v_err := null;
    exception when others then v_err := sqlerrm;
    end;
    v_out := v_out || jsonb_build_object('c', 'T2 대상 0행 거부·변경 0', 's',
      case when v_err like 'OVERTIME_TEST_ADMIN: 대상 행이 정확히 1개가 아님 (0행)%'
                and (select md5(coalesce(string_agg(to_jsonb(u)::text, '|' order by u.id), '')) from public.allowed_users u) = v_others then 'OK' else 'FAIL' end,
      'd', '기대 거부: OVERTIME_TEST_ADMIN 대상 행이 정확히 1개가 아님 (0행) / 실제: ' || coalesce(left(v_err, 80), '거부되지 않음'));
    raise exception '%', c_rollback;
  exception when others then
    if sqlerrm <> c_rollback then v_out := v_out || jsonb_build_object('c', 'T2 예외', 's', 'FAIL', 'd', left(sqlerrm, 120)); end if;
  end;

  -- T3 대상 행 2개 → 이메일 UNIQUE라 만들 수 없다(함수도 1행이 아니면 중단 — T2와 같은 분기)
  begin
    begin
      insert into public.allowed_users (email, is_admin) select u.email, false from public.allowed_users u where u.id = v_target;
      v_out := v_out || jsonb_build_object('c', 'T3 대상 2행', 's', 'FAIL', 'd', '같은 이메일 두 번째 행이 들어감 — UNIQUE 없음');
    exception when unique_violation then
      v_out := v_out || jsonb_build_object('c', 'T3 대상 2행', 's', 'OK', 'd', 'allowed_users.email UNIQUE — 2행 불가(함수는 1행이 아니면 중단)');
    end;
    raise exception '%', c_rollback;
  exception when others then
    if sqlerrm <> c_rollback then v_out := v_out || jsonb_build_object('c', 'T3 예외', 's', 'FAIL', 'd', left(sqlerrm, 120)); end if;
  end;

  -- T4 운영 흔적(시험용이 아닌 승인 사용자 4명) → 가드에서 중단, 변경 0
  begin
    update public.allowed_users set is_admin = false where id = v_target;
    insert into public.allowed_users (email, is_admin)
      select 'zz-guard-' || g || '@guard.test', false from generate_series(1, 4) g;   -- 준비(되돌려짐)
    select md5(coalesce(string_agg(to_jsonb(u)::text, '|' order by u.id), '')) into v_others from public.allowed_users u;
    begin
      perform pg_temp.ot_test_admin_set(true);
      v_err := null;
    exception when others then v_err := sqlerrm;
    end;
    v_out := v_out || jsonb_build_object('c', 'T4 운영 흔적 가드 거부·변경 0', 's',
      case when v_err like '중단: 시험용이 아닌 승인 사용자가 3명을 넘습니다%'
                and (select md5(coalesce(string_agg(to_jsonb(u)::text, '|' order by u.id), '')) from public.allowed_users u) = v_others then 'OK' else 'FAIL' end,
      'd', '기대 거부: 중단: 시험용이 아닌 승인 사용자가 3명을 넘습니다 / 실제: ' || coalesce(left(v_err, 80), '거부되지 않음'));
    raise exception '%', c_rollback;
  exception when others then
    if sqlerrm <> c_rollback then v_out := v_out || jsonb_build_object('c', 'T4 예외', 's', 'FAIL', 'd', left(sqlerrm, 120)); end if;
  end;

  -- T5 다른 관리자가 이미 있음 → 승격 중단, 변경 0
  begin
    update public.allowed_users set is_admin = false where id = v_target;
    delete from public.allowed_users where is_admin is true and id <> v_target;
    insert into public.allowed_users (email, is_admin) values ('zz-admin@guard.test', true); -- 준비(되돌려짐)
    select md5(coalesce(string_agg(to_jsonb(u)::text, '|' order by u.id), '')) into v_others from public.allowed_users u;
    begin
      perform pg_temp.ot_test_admin_set(true);
      v_err := null;
    exception when others then v_err := sqlerrm;
    end;
    v_out := v_out || jsonb_build_object('c', 'T5 다른 관리자 있음 승격 거부·변경 0', 's',
      case when v_err like 'OVERTIME_TEST_ADMIN: 이미 다른 관리자 1명%'
                and (select md5(coalesce(string_agg(to_jsonb(u)::text, '|' order by u.id), '')) from public.allowed_users u) = v_others then 'OK' else 'FAIL' end,
      'd', '기대 거부: OVERTIME_TEST_ADMIN 이미 다른 관리자 1명 / 실제: ' || coalesce(left(v_err, 80), '거부되지 않음'));
    raise exception '%', c_rollback;
  exception when others then
    if sqlerrm <> c_rollback then v_out := v_out || jsonb_build_object('c', 'T5 예외', 's', 'FAIL', 'd', left(sqlerrm, 120)); end if;
  end;

  -- Z 시험 뒤 allowed_users 전체가 시험 전과 같다(남은 변경 0)
  select md5(coalesce(string_agg(to_jsonb(u)::text, '|' order by u.id), '')) into v_all_after from public.allowed_users u;
  v_out := v_out || jsonb_build_object('c', 'Z 시험 후 allowed_users 변경 0', 's', case when v_all_after = v_all_before then 'OK' else 'FAIL' end,
    'd', case when v_all_after = v_all_before then '시험 전과 같음' else '바뀜' end);

  for r in select * from jsonb_array_elements(v_out) loop
    insert into pg_temp.ot_admin_test_results (check_name, status, detail) values (r ->> 'c', r ->> 's', r ->> 'd');
  end loop;
end $$;

select check_name, status, detail from pg_temp.ot_admin_test_results order by seq;
