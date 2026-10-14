-- allowed_users RLS 확인 — 개발용 Supabase(zaot…iyas) 전용. 수정 migration 적용 전·후 모두 실행할 수 있다.
--
-- 임시 데이터(시작할 때 넣고 끝날 때 지운다 — 이 3행 말고는 어떤 행도 만들거나 지우지 않는다)
--   allowed_users 3행: rls-user@example.invalid  (일반: overtime write, leave read, 나머지 메뉴 키 없음)
--                       rls-admin@example.invalid (is_admin = true)
--                       rls-other@example.invalid (일반: overtime·field_overtime none — 직원 표는 두 메뉴 어느 쪽으로도 읽힌다)
--   삭제 범위: 위 고정 이메일 3개만 (email IN (...)). 시작 시 같은 이메일이 남아 있으면 먼저 지운다.
-- 쓰기 시도는 전부 "막혀야 정상"인 시도이거나, 값이 같은 no-op UPDATE(시험직원 f1…-01의 sort_order = sort_order)뿐이다.
--   막혀야 할 쓰기가 혹시 통과해도 DO 블록 끝에서 3행을 지우므로 allowed_users에 남는 것은 없다.
-- 안전장치: 시험용이 아닌 연장근무 직원이 있거나 승인 사용자가 3명을 넘으면(운영 흔적) 아무것도 하지 않고 중단.
-- 기대(수정 후): 전부 OK. 수정 전에는 재귀(42P17) 관련 항목이 FAIL로 나오는 것이 정상.

drop table if exists pg_temp.rls_check;
create temp table rls_check (seq int generated always as identity, check_name text, verdict text, detail text);

do $$
declare
  v_total int; v_recursion int := 0;
  -- 일반 사용자
  u_rows int; u_other int; u_err text; u_ins text; u_upd int; u_upd_err text; u_del int; u_del_err text; u_fn text;
  u_emp_rows int; u_emp_err text; u_emp_upd int; u_emp_upd_err text; u_hol_rows int; u_hol_err text; u_hol_ins text;
  -- 권한 없는 사용자(overtime none)
  o_emp_rows int; o_emp_err text;
  -- 관리자
  a_rows int; a_err text; a_ins text; a_upd int; a_upd_err text;
  -- 비로그인
  n_rows int; n_err text; n_ins text;
  v_admin_after boolean;
begin
  if exists (select 1 from public.overtime_employees e
             where e.id::text not like 'e1000000-0000-4000-8000-00000000000_' and e.id::text not like 'f1000000-0000-4000-8000-00000000000_') then
    raise exception '중단: 시험용이 아닌 연장근무 직원이 있습니다 — 개발용 DB가 아닌 것 같습니다';
  end if;
  if (select count(*) from public.allowed_users where email not like 'rls-%@example.invalid') > 3 then
    raise exception '중단: 승인 사용자가 3명을 넘습니다 — 개발용 DB가 아닌 것 같습니다';
  end if;

  delete from public.allowed_users where email in ('rls-user@example.invalid', 'rls-admin@example.invalid', 'rls-other@example.invalid');
  insert into public.allowed_users (email, is_admin, menu_permissions) values
    ('rls-user@example.invalid', false, '{"overtime": "write", "leave": "read"}'::jsonb),
    ('rls-admin@example.invalid', true, '{}'::jsonb),
    ('rls-other@example.invalid', false, '{"overtime": "none", "field_overtime": "none"}'::jsonb);
  select count(*) into v_total from public.allowed_users;

  -- ── 1) 일반 사용자 ──
  perform set_config('request.jwt.claims', '{"email":"rls-user@example.invalid","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin select count(*), count(*) filter (where email <> 'rls-user@example.invalid') into u_rows, u_other from public.allowed_users;
  exception when others then u_err := sqlstate || ' ' || sqlerrm; end;
  begin insert into public.allowed_users (email) values ('rls-sneak@example.invalid');
  exception when others then u_ins := sqlstate || ' ' || left(sqlerrm, 60); end;
  begin update public.allowed_users set is_admin = true where email = 'rls-user@example.invalid'; get diagnostics u_upd = row_count;
  exception when others then u_upd_err := sqlstate || ' ' || left(sqlerrm, 60); end;
  begin delete from public.allowed_users where email = 'rls-other@example.invalid'; get diagnostics u_del = row_count;
  exception when others then u_del_err := sqlstate || ' ' || left(sqlerrm, 60); end;
  begin perform private.allowed_users_is_admin();
        u_fn := '호출됨';
  exception when others then u_fn := sqlstate || ' ' || left(sqlerrm, 60); end;
  -- 기존 메뉴 권한 정책: overtime write → 직원 표 읽기·쓰기(no-op), leave read → 공휴일 읽기 OK·쓰기 차단
  begin select count(*) into u_emp_rows from public.overtime_employees;
  exception when others then u_emp_err := sqlstate || ' ' || sqlerrm; end;
  begin update public.overtime_employees set sort_order = sort_order where id = 'f1000000-0000-4000-8000-000000000001'; get diagnostics u_emp_upd = row_count;
  exception when others then u_emp_upd_err := sqlstate || ' ' || left(sqlerrm, 60); end;
  begin select count(*) into u_hol_rows from public.holidays;
  exception when others then u_hol_err := sqlstate || ' ' || sqlerrm; end;
  begin insert into public.holidays (holiday_date, name) values ('2099-12-31', 'rls 시험');
  exception when others then u_hol_ins := sqlstate || ' ' || left(sqlerrm, 60); end;
  execute 'reset role';

  -- ── 2) 권한 없는 사용자(overtime none) ──
  perform set_config('request.jwt.claims', '{"email":"rls-other@example.invalid","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin select count(*) into o_emp_rows from public.overtime_employees;
  exception when others then o_emp_err := sqlstate || ' ' || sqlerrm; end;
  execute 'reset role';

  -- ── 3) 관리자(allowed_users.is_admin) ──
  perform set_config('request.jwt.claims', '{"email":"rls-admin@example.invalid","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin select count(*) into a_rows from public.allowed_users;
  exception when others then a_err := sqlstate || ' ' || sqlerrm; end;
  begin insert into public.allowed_users (email) values ('rls-sneak@example.invalid');
  exception when others then a_ins := sqlstate || ' ' || left(sqlerrm, 60); end;
  begin update public.allowed_users set note = 'x' where email = 'rls-other@example.invalid'; get diagnostics a_upd = row_count;
  exception when others then a_upd_err := sqlstate || ' ' || left(sqlerrm, 60); end;
  execute 'reset role';

  -- ── 4) 비로그인 ──
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';
  begin select count(*) into n_rows from public.allowed_users;
  exception when others then n_err := sqlstate || ' ' || sqlerrm; end;
  begin insert into public.allowed_users (email) values ('rls-sneak@example.invalid');
  exception when others then n_ins := sqlstate || ' ' || left(sqlerrm, 60); end;
  execute 'reset role';

  select is_admin into v_admin_after from public.allowed_users where email = 'rls-user@example.invalid';
  v_recursion := (case when u_err like '42P17%' then 1 else 0 end) + (case when a_err like '42P17%' then 1 else 0 end)
               + (case when n_err like '42P17%' then 1 else 0 end) + (case when coalesce(u_upd_err, '') like '42P17%' then 1 else 0 end)
               + (case when coalesce(u_del_err, '') like '42P17%' then 1 else 0 end) + (case when coalesce(a_upd_err, '') like '42P17%' then 1 else 0 end);

  -- 시험 행 정리 (고정 이메일만)
  delete from public.allowed_users where email in ('rls-user@example.invalid', 'rls-admin@example.invalid', 'rls-other@example.invalid', 'rls-sneak@example.invalid');
  delete from public.holidays where holiday_date = '2099-12-31' and name = 'rls 시험';  -- 막혀야 정상이지만 혹시 들어갔을 때만

  insert into rls_check (check_name, verdict, detail) values
    ('1 일반 사용자 조회 — 재귀 오류 없음', case when u_err is null then 'OK' else 'FAIL' end, coalesce(u_err, '오류 없음')),
    ('1 일반 사용자 — 자기 행 정확히 1건', case when u_err is null and u_rows = 1 then 'OK' else 'FAIL' end, coalesce(u_rows::text, '-') || '건'),
    ('2 일반 사용자 — 다른 사용자 행 0건', case when u_err is null and u_other = 0 then 'OK' else 'FAIL' end, coalesce(u_other::text, '-') || '건'),
    ('3 관리자 조회 — 재귀 오류 없음', case when a_err is null then 'OK' else 'FAIL' end, coalesce(a_err, '오류 없음')),
    ('3 관리자 — 전체 행', case when a_err is null and a_rows = v_total then 'OK' else 'FAIL' end, coalesce(a_rows::text, '-') || ' / 전체 ' || v_total),
    ('4 비로그인 — 0건', case when coalesce(n_rows, 0) = 0 and coalesce(n_err, '') not like '42P17%' then 'OK' else 'FAIL' end, coalesce(n_rows::text || '건', n_err)),
    ('5 일반 사용자 INSERT 차단', case when u_ins is not null and u_ins not like '42P17%' then 'OK' else 'FAIL' end, coalesce(u_ins, '통과됨')),
    ('5 일반 사용자 UPDATE(자기 is_admin) 0건', case when coalesce(u_upd, 0) = 0 and coalesce(u_upd_err, '') not like '42P17%' and v_admin_after = false then 'OK' else 'FAIL' end,
       coalesce(u_upd::text || '건', u_upd_err) || ', is_admin=' || coalesce(v_admin_after::text, '-')),
    ('5 일반 사용자 DELETE(다른 행) 0건', case when coalesce(u_del, 0) = 0 and coalesce(u_del_err, '') not like '42P17%' then 'OK' else 'FAIL' end, coalesce(u_del::text || '건', u_del_err)),
    ('6 관리자 INSERT 차단(쓰기는 서버 API만)', case when a_ins is not null and a_ins not like '42P17%' then 'OK' else 'FAIL' end, coalesce(a_ins, '통과됨')),
    ('6 관리자 UPDATE 0건(쓰기는 서버 API만)', case when coalesce(a_upd, 0) = 0 and coalesce(a_upd_err, '') not like '42P17%' then 'OK' else 'FAIL' end, coalesce(a_upd::text || '건', a_upd_err)),
    ('6 비로그인 INSERT 차단', case when n_ins is not null then 'OK' else 'FAIL' end, coalesce(n_ins, '통과됨')),
    ('관리자 판정 함수 직접 호출 불가(private 스키마)', case when u_fn like '42501%' or u_fn like '42883%' or u_fn like '3F000%' then 'OK' else 'FAIL' end, u_fn),
    ('8 overtime write — 직원 표 읽기', case when u_emp_err is null and u_emp_rows > 0 then 'OK' else 'FAIL' end, coalesce(u_emp_rows::text || '건', u_emp_err)),
    ('8 overtime write — 직원 표 쓰기(값 동일 UPDATE)', case when u_emp_upd = 1 then 'OK' else 'FAIL' end, coalesce(u_emp_upd::text || '건', u_emp_upd_err)),
    ('9 leave read — 공휴일 읽기', case when u_hol_err is null and u_hol_rows > 0 then 'OK' else 'FAIL' end, coalesce(u_hol_rows::text || '건', u_hol_err)),
    ('9 leave read — 공휴일 쓰기 차단', case when u_hol_ins is not null then 'OK' else 'FAIL' end, coalesce(u_hol_ins, '통과됨')),
    ('10 권한 없는 메뉴(overtime·field_overtime none) — 직원 표 0건', case when o_emp_err is null and o_emp_rows = 0 then 'OK' else 'FAIL' end, coalesce(o_emp_rows::text || '건', o_emp_err)),
    ('11 42P17 재귀 오류 건수', case when v_recursion = 0 then 'OK' else 'FAIL' end, v_recursion || '건'),
    ('12 시험 행 정리', case when not exists (select 1 from public.allowed_users where email like 'rls-%@example.invalid')
                               and not exists (select 1 from public.holidays where holiday_date = '2099-12-31') then 'OK' else 'FAIL' end, '');
end $$;

select seq, check_name, verdict, detail from rls_check order by seq;
