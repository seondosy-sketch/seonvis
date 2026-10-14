-- allowed_users RLS 되돌리기·재적용 리허설 — 개발용 Supabase(zaot…iyas) 전용, 수정 migration 적용 "후"에 실행
--
-- 한 DO 블록의 하위 트랜잭션 안에서:
--   ① supabase/verify/allowed_users_rls_recursion_rollback.sql과 같은 문장으로 원래 정책 복원 → 상태·재귀(42P17) 재현 확인
--   ② supabase/migration_allowed_users_rls_recursion_fix.sql과 같은 문장으로 다시 수정 → 상태·재귀 해소 확인
--   ③ 일부러 예외를 내 하위 트랜잭션 전체를 되돌린다 → 개발 DB는 실행 전(수정된 상태) 그대로 남는다
-- 데이터 행은 읽기만 한다(allowed_users 행을 만들거나 지우지 않는다). 다른 표의 정책 수가 변하지 않았는지도 본다.

drop table if exists pg_temp.rls_rollback_check;
create temp table rls_rollback_check (seq int generated always as identity, check_name text, verdict text, detail text);

do $$
declare
  v_other_before int; v_other_mid int;
  rb_policies int; rb_public int; rb_selfref int; rb_fn boolean; rb_rec text;
  re_policies int; re_auth int; re_selfref int; re_fn boolean; re_rec text;
  v_done boolean := false;
begin
  if to_regprocedure('private.allowed_users_is_admin()') is null then
    raise exception '중단: 수정 migration이 적용된 상태에서 실행한다';
  end if;
  select count(*) into v_other_before from pg_catalog.pg_policy where polrelid <> 'public.allowed_users'::regclass;

  begin
    -- ① 되돌리기 (rollback 파일과 같은 문장)
    drop policy if exists "admins_read_all" on public.allowed_users;
    create policy "admins_read_all" on public.allowed_users
      for select using (exists (select 1 from allowed_users where email = auth.jwt() ->> 'email' and is_admin = true));
    drop policy if exists "users_read_own" on public.allowed_users;
    create policy "users_read_own" on public.allowed_users
      for select using (auth.jwt() ->> 'email' = email);
    drop function if exists private.allowed_users_is_admin();

    select count(*), count(*) filter (where 0 = any (polroles)),
           count(*) filter (where pg_catalog.pg_get_expr(polqual, polrelid) ~* '\mfrom\s+(public\.)?allowed_users\M')
      into rb_policies, rb_public, rb_selfref
    from pg_catalog.pg_policy where polrelid = 'public.allowed_users'::regclass;
    rb_fn := to_regprocedure('private.allowed_users_is_admin()') is not null;
    perform set_config('request.jwt.claims', '{"email":"rls-rehearsal@example.invalid","role":"authenticated"}', true);
    execute 'set local role authenticated';
    begin perform count(*) from public.allowed_users;
    exception when others then rb_rec := sqlstate; end;
    execute 'reset role';

    -- ② 다시 수정 (migration 파일과 같은 문장)
    create or replace function private.allowed_users_is_admin()
    returns boolean language sql stable security definer set search_path = public, pg_temp
    as $fn$
      select coalesce((select u.is_admin from public.allowed_users u where u.email = (auth.jwt() ->> 'email')), false)
    $fn$;
    revoke all on function private.allowed_users_is_admin() from public, anon, authenticated, service_role;
    grant execute on function private.allowed_users_is_admin() to authenticated;
    drop policy if exists "admins_read_all" on public.allowed_users;
    create policy "admins_read_all" on public.allowed_users for select to authenticated using (private.allowed_users_is_admin());
    drop policy if exists "users_read_own" on public.allowed_users;
    create policy "users_read_own" on public.allowed_users for select to authenticated using ((auth.jwt() ->> 'email') = email);

    select count(*), count(*) filter (where polroles = array['authenticated'::regrole::oid]),
           count(*) filter (where pg_catalog.pg_get_expr(polqual, polrelid) ~* '\mfrom\s+(public\.)?allowed_users\M')
      into re_policies, re_auth, re_selfref
    from pg_catalog.pg_policy where polrelid = 'public.allowed_users'::regclass;
    re_fn := to_regprocedure('private.allowed_users_is_admin()') is not null;
    execute 'set local role authenticated';
    begin perform count(*) from public.allowed_users;
    exception when others then re_rec := sqlstate; end;
    execute 'reset role';

    select count(*) into v_other_mid from pg_catalog.pg_policy where polrelid <> 'public.allowed_users'::regclass;
    v_done := true;
    -- ③ 하위 트랜잭션 전체 되돌림
    raise exception 'RLS_ROLLBACK_REHEARSAL_DONE';
  exception when raise_exception then
    if sqlerrm <> 'RLS_ROLLBACK_REHEARSAL_DONE' then raise; end if;
  end;

  insert into rls_rollback_check (check_name, verdict, detail) values
    ('① 되돌리기 — 정책 2개(중복 없음)', case when rb_policies = 2 then 'OK' else 'FAIL' end, rb_policies || '개'),
    ('① 되돌리기 — 원래 정의(public 대상·자기참조 1개)', case when rb_public = 2 and rb_selfref = 1 then 'OK' else 'FAIL' end, 'public ' || rb_public || ', 자기참조 ' || rb_selfref),
    ('① 되돌리기 — 새 함수 제거', case when not rb_fn then 'OK' else 'FAIL' end, rb_fn::text),
    ('① 되돌리기 상태에서 재귀(42P17) 재현', case when rb_rec = '42P17' then 'OK' else 'FAIL' end, coalesce(rb_rec, '오류 없음')),
    ('② 재적용 — 정책 2개(중복 없음)', case when re_policies = 2 then 'OK' else 'FAIL' end, re_policies || '개'),
    ('② 재적용 — authenticated 대상 2개·자기참조 0개', case when re_auth = 2 and re_selfref = 0 then 'OK' else 'FAIL' end, 'authenticated ' || re_auth || ', 자기참조 ' || re_selfref),
    ('② 재적용 — 함수 존재', case when re_fn then 'OK' else 'FAIL' end, re_fn::text),
    ('② 재적용 후 재귀 없음', case when re_rec is null then 'OK' else 'FAIL' end, coalesce(re_rec, '오류 없음')),
    ('다른 표 정책 수 변화 없음(되돌리기가 다른 정책을 지우지 않음)', case when v_other_before = v_other_mid then 'OK' else 'FAIL' end, v_other_before || ' → ' || v_other_mid),
    ('리허설 끝까지 실행', case when v_done then 'OK' else 'FAIL' end, ''),
    ('③ 최종 상태 = 수정된 상태(리허설 되돌림)',
       case when to_regprocedure('private.allowed_users_is_admin()') is not null
             and (select count(*) from pg_catalog.pg_policy where polrelid = 'public.allowed_users'::regclass
                    and polroles = array['authenticated'::regrole::oid]
                    and pg_catalog.pg_get_expr(polqual, polrelid) !~* '\mfrom\s+(public\.)?allowed_users\M') = 2 then 'OK' else 'FAIL' end, '');
end $$;

select seq, check_name, verdict, detail from rls_rollback_check order by seq;
