-- 메뉴 권한 무효값 기본 거부 — 동작 시험 (개발용 Supabase 전용). 결과: check_name / status / detail (전부 OK여야 한다)
--
-- 대상: supabase/migration_menu_permission_strict.sql 적용 후의 private.menu_permission · private.menu_any_readable
--   (적용 전에 실행하면 "무효값 → none" 칸이 FAIL로 나오는 것이 정상 — 예전 규칙은 무효값을 허용했다)
-- 방법: JWT 클레임(request.jwt.claims)을 시험 이메일로 바꿔 가며 두 함수를 직접 부른다.
--   함수는 SECURITY DEFINER라 소유자 권한으로 allowed_users를 읽는다. 정책 평가에 필요한 authenticated EXECUTE 권한은 따로 확인한다.
-- 임시 데이터: allowed_users 7행 menu-strict-*@example.com — 모두 하위 트랜잭션(BEGIN … EXCEPTION 블록) 안에서 넣고,
--   시험이 끝나면 일부러 예외를 내 그 하위 트랜잭션 전체를 ROLLBACK한다. 중간에 오류가 나도 전체가 취소되므로 남는 행이 없다.
--   결과는 되돌리기 전에 변수에 모아 두었다가, 되돌린 뒤 임시 표(pg_temp)에 옮겨 출력한다.
-- 안전장치(supabase/dev/shared_project_tables_rls_check.sql과 같은 기준): 시험용이 아닌 연장근무 직원이 있거나
--   승인 사용자가 3명을 넘으면(운영 흔적) 아무것도 하지 않고 중단한다.

create temp table if not exists menu_strict_check (seq int generated always as identity, check_name text, status text, detail text);
truncate menu_strict_check restart identity;

do $$
declare
  c record;
  v_results jsonb := '[]'::jsonb;
  v_perm text;
  v_read boolean;
  v_err text;
  v_left int;
  v_rollback_msg constant text := 'menu_strict_check: 시험 데이터 되돌리기';
begin
  -- 0. 안전장치 (개발 DB가 아니면 중단)
  if to_regclass('public.overtime_employees') is not null and exists (
       select 1 from public.overtime_employees e
       where e.id::text not like 'e1000000-0000-4000-8000-00000000000_' and e.id::text not like 'f1000000-0000-4000-8000-00000000000_') then
    raise exception '중단: 시험용이 아닌 연장근무 직원이 있습니다 — 개발용 DB가 아닌 것 같습니다';
  end if;
  if (select count(*) from public.allowed_users
      where email not like '%@example.invalid' and email not like '%@example.com') > 3 then
    raise exception '중단: 승인 사용자가 3명을 넘습니다 — 개발용 DB가 아닌 것 같습니다';
  end if;
  if to_regprocedure('private.menu_permission(text)') is null or to_regprocedure('private.menu_any_readable(text[])') is null then
    raise exception '중단: private.menu_permission 또는 private.menu_any_readable이 없다 — migration을 먼저 적용한다';
  end if;

  -- 1. 시험 (하위 트랜잭션 — 끝에서 반드시 ROLLBACK)
  begin
    delete from public.allowed_users where email like 'menu-strict-%@example.com';
    insert into public.allowed_users (email, is_admin, menu_permissions) values
      ('menu-strict-invalid@example.com', false,
       '{"projects": "NONE", "weekly": "Read", "trip": "", "leave": " read", "sites": null, "web": true, "engineers": {"v": "write"}, "overtime": "read"}'::jsonb),
      ('menu-strict-empty@example.com', false, '{}'::jsonb),
      ('menu-strict-valid@example.com', false, '{"projects": "none", "weekly": "read", "overtime": "write"}'::jsonb),
      ('menu-strict-admin@example.com', true,
       '{"projects": "none", "weekly": "NONE", "overtime": "", "leave": "none", "trip": "none", "interview_db": "none"}'::jsonb),
      ('menu-strict-array@example.com', false, '["projects", "write"]'::jsonb),
      ('menu-strict-jsonnull@example.com', false, 'null'::jsonb),
      ('menu-strict-mixed@example.com', false, '{"projects": "NONE", "weekly": "read"}'::jsonb);

    for c in select * from (values
      -- 무효값 → none / 읽기 불가
      ('01 무효값 "NONE" → none',           'menu-strict-invalid@example.com', array['projects'], 'none', false),
      ('02 무효값 "Read"(대소문자) → none',  'menu-strict-invalid@example.com', array['weekly'], 'none', false),
      ('03 무효값 ""(빈 문자열) → none',     'menu-strict-invalid@example.com', array['trip'], 'none', false),
      ('04 무효값 " read"(공백) → none',     'menu-strict-invalid@example.com', array['leave'], 'none', false),
      ('05 무효값 JSON null → none',         'menu-strict-invalid@example.com', array['sites'], 'none', false),
      ('06 무효값 true(문자열 아님) → none', 'menu-strict-invalid@example.com', array['web'], 'none', false),
      ('07 무효값 객체 → none',              'menu-strict-invalid@example.com', array['engineers'], 'none', false),
      ('08 같은 행의 유효값 read → read',    'menu-strict-invalid@example.com', array['overtime'], 'read', true),
      ('09 같은 행의 키 없음 → write',       'menu-strict-invalid@example.com', array['lodging'], 'write', true),
      -- 키 없음 → write
      ('10 키 없음({}) → write',             'menu-strict-empty@example.com', array['projects'], 'write', true),
      ('11 키 없음({}) → write (다른 메뉴)', 'menu-strict-empty@example.com', array['interview_db'], 'write', true),
      -- 유효값 그대로(회귀)
      ('12 유효값 none → none',              'menu-strict-valid@example.com', array['projects'], 'none', false),
      ('13 유효값 read → read',              'menu-strict-valid@example.com', array['weekly'], 'read', true),
      ('14 유효값 write → write',            'menu-strict-valid@example.com', array['overtime'], 'write', true),
      -- 관리자 → write (메뉴 설정·무효값과 무관)
      ('15 is_admin + none → write',         'menu-strict-admin@example.com', array['projects'], 'write', true),
      ('16 is_admin + 무효값 → write',       'menu-strict-admin@example.com', array['weekly'], 'write', true),
      ('17 is_admin + 빈 문자열 → write',    'menu-strict-admin@example.com', array['overtime'], 'write', true),
      -- 행 없음(미승인) → none
      ('18 allowed_users 행 없음 → none',    'menu-strict-norow@example.com', array['projects'], 'none', false),
      -- 객체가 아닌 저장값 → none, jsonb null → 키 없음과 같음(write)
      ('19 배열 저장값 → none',              'menu-strict-array@example.com', array['projects'], 'none', false),
      ('20 jsonb null 저장값 → write',       'menu-strict-jsonnull@example.com', array['projects'], 'write', true)
    ) as x(check_name, email, menu_keys, expected_perm, expected_readable) loop
      v_perm := null; v_read := null; v_err := null;
      perform pg_catalog.set_config('request.jwt.claims',
        pg_catalog.json_build_object('email', c.email, 'role', 'authenticated')::text, true);
      begin
        v_perm := private.menu_permission(c.menu_keys[1]);
        v_read := private.menu_any_readable(c.menu_keys);
      exception when others then v_err := sqlstate || ' ' || left(sqlerrm, 80);
      end;
      v_results := v_results || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'check_name', c.check_name,
        'status', case when v_err is null and v_perm = c.expected_perm and v_read = c.expected_readable then 'OK' else 'FAIL' end,
        'detail', coalesce(v_err, 'menu_permission=' || coalesce(v_perm, 'null') || ' (예상 ' || c.expected_perm || ')'
                                  || ' / menu_any_readable=' || coalesce(v_read::text, 'null') || ' (예상 ' || c.expected_readable::text || ')')));
    end loop;

    -- 여러 키: 하나라도 유효한 read 이상이면 읽기 허용, 무효값 키는 허용 근거가 되지 않는다
    perform pg_catalog.set_config('request.jwt.claims',
      pg_catalog.json_build_object('email', 'menu-strict-mixed@example.com', 'role', 'authenticated')::text, true);
    v_results := v_results || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('check_name', '21 여러 키: NONE(무효) + read → 읽기 허용',
        'status', case when private.menu_any_readable(array['projects', 'weekly']) then 'OK' else 'FAIL' end,
        'detail', 'menu_any_readable([projects, weekly])=' || private.menu_any_readable(array['projects', 'weekly'])::text),
      pg_catalog.jsonb_build_object('check_name', '22 여러 키: 무효값 키만 → 읽기 불가',
        'status', case when not private.menu_any_readable(array['projects']) then 'OK' else 'FAIL' end,
        'detail', 'menu_any_readable([projects])=' || private.menu_any_readable(array['projects'])::text));

    raise exception using errcode = 'P0001', message = v_rollback_msg;
  exception when raise_exception then
    if sqlerrm <> v_rollback_msg then raise; end if;   -- 시험 중 예상하지 않은 오류는 그대로 올린다(전체 취소)
  end;
  perform pg_catalog.set_config('request.jwt.claims', '', true);

  -- 2. 정책 평가에 필요한 권한(authenticated EXECUTE)
  v_results := v_results || pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('check_name', '23 authenticated EXECUTE menu_permission',
      'status', case when pg_catalog.has_function_privilege('authenticated', 'private.menu_permission(text)', 'EXECUTE') then 'OK' else 'FAIL' end,
      'detail', ''),
    pg_catalog.jsonb_build_object('check_name', '24 authenticated EXECUTE menu_any_readable',
      'status', case when pg_catalog.has_function_privilege('authenticated', 'private.menu_any_readable(text[])', 'EXECUTE') then 'OK' else 'FAIL' end,
      'detail', ''));

  -- 3. 되돌림 확인 — 시험 이메일 행이 하나도 남지 않아야 한다
  select count(*) into v_left from public.allowed_users where email like 'menu-strict-%@example.com';
  v_results := v_results || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'check_name', '25 시험 데이터 ROLLBACK — 남은 행 0',
    'status', case when v_left = 0 then 'OK' else 'FAIL' end,
    'detail', v_left::text || '행'));

  insert into menu_strict_check (check_name, status, detail)
  select r ->> 'check_name', r ->> 'status', r ->> 'detail'
  from pg_catalog.jsonb_array_elements(v_results) with ordinality as e(r, n)
  order by e.n;
end $$;

select check_name, status, detail from menu_strict_check order by seq;
