-- ============================================================================
-- 연장근무 직원 동기화 — 직원 분리 방지 시험 (sync_team_employees 0단계) — 개발용 Supabase 전용
--
-- ⚠ 개발용 프로젝트의 SQL Editor에서만 실행한다. 전체를 한 번에 실행한다.
--   안전장치(하나라도 걸리면 아무것도 바꾸지 않고 중단) — overtime_behavior_test.sql과 같은 기준:
--     Migration A가 없음 / projects가 10건 초과 / 시험용(e1…·f1…)이 아닌 연장근무 직원·기록이 있음 / 이 시험의 고정 ID가 이미 있음
-- 데이터: 네 경우를 각각 DO 블록 안의 하위 트랜잭션에서 돌리고, 끝에서 일부러 예외를 내 그 하위 트랜잭션을 통째로 되돌린다.
--   → 주소록·직원·계정 등 이 시험이 바꾼 것은 하나도 남지 않는다(정리 파일 불필요, 결과 표의 Z 행이 확인).
--   경우마다 먼저 "개발 DB에 원래 있던" 미연결 미래사업팀 주소록은 소속을 잠시 바꾸고, 주소록 미연결 재직 직원은 잠시
--   비활성으로 돌려(같은 하위 트랜잭션 안 — 끝나면 원래대로) 전역 건수를 시험 데이터만으로 맞춘다.
-- 이름 규칙(preflight와 같음): p10 = 주소록 미연결 재직 직원 수, p11 = 미연결 '미래사업팀' 주소록 수.
--   L1 p10=0, p11=0 → 성공, 변경 없음
--   L2 p10=0, p11>0 → 성공, 미연결 주소록마다 새 직원 행(새 UUID) 생성·연결 (기존 생성 규칙)
--   L3 p10>0, p11=0 → 성공, 미연결 재직 직원 비활성(주소록에 미래사업팀 재직자가 있을 때만), 행은 남음 (기존 비활성 규칙)
--   L4 p10>0, p11>0 → OVERTIME_EMPLOYEE_LINK_REQUIRED, 직원·주소록 변경 0
-- 역할: set_config('request.jwt.claims', …, true) + set local role authenticated (overtime_behavior_test.sql과 같음).
-- 결과: check_name / status(OK·FAIL·INFO) / detail — status가 전부 OK(또는 INFO)여야 한다.
-- 고정 ID: 직원 e3000000-0000-4000-8000-00000000000{1,2}, 주소록 e3100000-0000-4000-8000-00000000000{1,2},
--          계정 ot-link-tester@example.invalid. 주소록 시험 행에는 이름·소속·재직상태만 넣는다(전화·이메일 없음).
-- ============================================================================

-- 0. 안전장치 (아무것도 바꾸기 전)
do $$
begin
  if to_regclass('public.engineer_contacts_employee_id_key') is null or to_regprocedure('private.overtime_pay_period(text)') is null then
    raise exception '중단: Migration A가 적용되지 않은 DB입니다';
  end if;
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
  if exists (select 1 from public.overtime_employees where id::text like 'e3000000-0000-4000-8000-00000000000_')
     or exists (select 1 from public.engineer_contacts where id::text like 'e3100000-0000-4000-8000-00000000000_')
     or exists (select 1 from public.allowed_users where email = 'ot-link-tester@example.invalid') then
    raise exception '중단: 이 시험의 고정 ID·계정이 이미 있습니다 — 남은 행을 먼저 확인합니다';
  end if;
end $$;

create temp table if not exists ot_l_results (seq int generated always as identity, check_name text, status text, detail text);
truncate ot_l_results;

do $$
declare
  c_jwt constant text := '{"email":"ot-link-tester@example.invalid","role":"authenticated"}';
  c_linked_emp constant uuid := 'e3000000-0000-4000-8000-000000000001';   -- 연결된 재직 직원 (3단계가 돌도록)
  c_unlinked_emp constant uuid := 'e3000000-0000-4000-8000-000000000002'; -- 주소록 미연결 재직 직원 (p10)
  c_linked_contact constant uuid := 'e3100000-0000-4000-8000-000000000001';
  c_unlinked_contact constant uuid := 'e3100000-0000-4000-8000-000000000002'; -- 미연결 미래사업팀 주소록 (p11)
  v_case int;
  v_out jsonb := '[]'::jsonb;
  v_err text;
  v_emp_before int;
  v_emp_after int;
  v_fp_before text;
  v_fp_after text;
  v_p10 int;
  v_p11 int;
  v_new_emp uuid;
  v_ok boolean;
  v_detail text;
begin
  v_out := v_out || jsonb_build_object('c', 'L00 sync 직원 분리 방지 적용 여부', 's', 'INFO', 'd',
    case when coalesce(pg_catalog.pg_get_functiondef(to_regprocedure('public.sync_team_employees()')) like '%OVERTIME_EMPLOYEE_LINK_REQUIRED%', false)
         then '적용됨(A 수정본 또는 C)' else '미적용 — L4가 FAIL로 나오는 것이 원래 위험' end);

  for v_case in 1..4 loop
    v_err := null; v_ok := false; v_detail := null;
    begin  -- ── 경우별 하위 트랜잭션: 끝에서 OT_LINK_TEST_ROLLBACK으로 되돌린다 ──
      -- 개발 DB에 원래 있던 미연결 상태를 이 하위 트랜잭션 안에서만 치운다
      update public.engineer_contacts set company = company || ' (연결 시험 중 제외)'
      where company = '미래사업팀' and employee_id is null;
      update public.overtime_employees e set is_active = false
      where e.is_active and not exists (select 1 from public.engineer_contacts c where c.employee_id = e.id);

      insert into public.allowed_users (email, is_admin, menu_permissions)
      values ('ot-link-tester@example.invalid', false, '{"overtime":"write","field_overtime":"none"}'::jsonb);
      -- 공통: 연결된 미래사업팀 재직자 1명(주소록 값과 직원 값이 같아 2단계 UPDATE 없음)
      insert into public.overtime_employees (id, name, position, is_active, sort_order)
      values (c_linked_emp, 'ZZ연결시험연결', '사원', true, 9201);
      insert into public.engineer_contacts (id, employee_id, name, rank, company, employment_status)
      values (c_linked_contact, c_linked_emp, 'ZZ연결시험연결', '사원', '미래사업팀', '재직');
      if v_case in (3, 4) then
        insert into public.overtime_employees (id, name, position, is_active, sort_order)
        values (c_unlinked_emp, 'ZZ연결시험직원', '사원', true, 9202);
      end if;
      if v_case in (2, 4) then
        insert into public.engineer_contacts (id, employee_id, name, rank, company, employment_status)
        values (c_unlinked_contact, null, 'ZZ연결시험주소록', '사원', '미래사업팀', '재직');
      end if;

      select count(*) into v_p10 from public.overtime_employees e
      where e.is_active and not exists (select 1 from public.engineer_contacts c where c.employee_id = e.id);
      select count(*) into v_p11 from public.engineer_contacts c where c.company = '미래사업팀' and c.employee_id is null;
      select count(*) into v_emp_before from public.overtime_employees;
      select md5(coalesce((select string_agg(e.id::text || e.name || e.position || e.is_active::text, '|' order by e.id) from public.overtime_employees e), '')
                 || coalesce((select string_agg(c.id::text || coalesce(c.employee_id::text, '-') || c.company, '|' order by c.id) from public.engineer_contacts c), ''))
        into v_fp_before;

      perform set_config('request.jwt.claims', c_jwt, true);
      execute 'set local role authenticated';
      begin
        perform public.sync_team_employees();
      exception when others then v_err := sqlerrm;
      end;
      execute 'reset role';

      select count(*) into v_emp_after from public.overtime_employees;
      select md5(coalesce((select string_agg(e.id::text || e.name || e.position || e.is_active::text, '|' order by e.id) from public.overtime_employees e), '')
                 || coalesce((select string_agg(c.id::text || coalesce(c.employee_id::text, '-') || c.company, '|' order by c.id) from public.engineer_contacts c), ''))
        into v_fp_after;

      if v_case = 1 then
        v_ok := v_err is null and v_p10 = 0 and v_p11 = 0 and v_fp_before = v_fp_after;
        v_detail := 'p10=' || v_p10 || ' p11=' || v_p11 || ' 오류=' || coalesce(v_err, '없음')
                    || ' 변경=' || case when v_fp_before = v_fp_after then '없음' else '있음' end;
      elsif v_case = 2 then
        select c.employee_id into v_new_emp from public.engineer_contacts c where c.id = c_unlinked_contact;
        v_ok := v_err is null and v_p10 = 0 and v_p11 = 1 and v_emp_after = v_emp_before + 1
                and v_new_emp is not null and v_new_emp not in (c_linked_emp, c_unlinked_emp)
                and exists (select 1 from public.overtime_employees e where e.id = v_new_emp and e.is_active and e.name = 'ZZ연결시험주소록');
        v_detail := 'p10=' || v_p10 || ' p11=' || v_p11 || ' 오류=' || coalesce(v_err, '없음')
                    || ' 직원 ' || v_emp_before || '→' || v_emp_after || '명, 새 직원 연결=' || case when v_new_emp is null then '없음' else '있음' end;
      elsif v_case = 3 then
        v_ok := v_err is null and v_p10 = 1 and v_p11 = 0 and v_emp_after = v_emp_before
                and exists (select 1 from public.overtime_employees where id = c_unlinked_emp and not is_active)
                and exists (select 1 from public.overtime_employees where id = c_linked_emp and is_active);
        v_detail := 'p10=' || v_p10 || ' p11=' || v_p11 || ' 오류=' || coalesce(v_err, '없음')
                    || ' 미연결 직원 재직=' || coalesce((select is_active::text from public.overtime_employees where id = c_unlinked_emp), '없음')
                    || ' 행 수 ' || v_emp_before || '→' || v_emp_after;
      else
        v_ok := v_err is not null and position('OVERTIME_EMPLOYEE_LINK_REQUIRED' in v_err) > 0
                and v_p10 = 1 and v_p11 = 1 and v_fp_before = v_fp_after and v_emp_after = v_emp_before
                and exists (select 1 from public.overtime_employees where id = c_unlinked_emp and is_active)
                and exists (select 1 from public.engineer_contacts where id = c_unlinked_contact and employee_id is null);
        v_detail := 'p10=' || v_p10 || ' p11=' || v_p11 || ' 오류=' || coalesce(v_err, '없음')
                    || ' 변경=' || case when v_fp_before = v_fp_after then '없음' else '있음' end;
      end if;

      raise exception 'OT_LINK_TEST_ROLLBACK';
    exception when others then
      if sqlerrm <> 'OT_LINK_TEST_ROLLBACK' then
        v_ok := false;
        v_detail := '예기치 않은 오류(이 경우의 변경은 모두 되돌림): ' || sqlerrm;
      end if;
    end;
    execute 'reset role';
    v_out := v_out || jsonb_build_object(
      'c', case v_case
             when 1 then 'L1 p10=0·p11=0 → 성공, 변경 없음'
             when 2 then 'L2 p10=0·p11>0 → 새 직원 생성·연결(기존 규칙)'
             when 3 then 'L3 p10>0·p11=0 → 미연결 재직 직원 비활성(기존 규칙)'
             else 'L4 p10>0·p11>0 → OVERTIME_EMPLOYEE_LINK_REQUIRED, 변경 0' end,
      's', case when v_ok then 'OK' else 'FAIL' end,
      'd', coalesce(v_detail, '-'));
  end loop;
  perform set_config('request.jwt.claims', '', true);

  insert into ot_l_results (check_name, status, detail)
  select x ->> 'c', x ->> 's', x ->> 'd' from jsonb_array_elements(v_out) with ordinality as t(x, n) order by n;
end $$;

-- Z. 남은 시험 데이터 0, 개발 DB의 원래 미연결 상태 복원 확인(하위 트랜잭션 되돌림)
insert into ot_l_results (check_name, status, detail)
select 'Z 시험 데이터 남지 않음', case when n = 0 then 'OK' else 'FAIL' end, n::text || '행'
from (select (select count(*) from public.overtime_employees where id::text like 'e3000000-0000-4000-8000-00000000000_')
           + (select count(*) from public.overtime_employees where name like 'ZZ연결시험%')
           + (select count(*) from public.engineer_contacts where id::text like 'e3100000-0000-4000-8000-00000000000_')
           + (select count(*) from public.engineer_contacts where company like '%(연결 시험 중 제외)')
           + (select count(*) from public.allowed_users where email = 'ot-link-tester@example.invalid') as n) z;

select check_name, status, detail from ot_l_results order by seq;
