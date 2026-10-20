-- 공용 표 읽기 정책 보정 — "로그인한 사용자 전체 읽기"를 "그 표를 실제로 쓰는 메뉴 중 하나라도 read 이상"으로
--
-- ⚠ 개발용 Supabase(zaot…iyas)에서 먼저 검증한다. 운영 적용은 별도 승인(연장근무 migration과 독립).
-- 처음 생성: scratchpad gen_shared_rls.py(지금은 없음) — 이후 이 파일을 직접 고친다. 9개 표 블록은 표 이름·키·예상값만 다르고 같은 모양을 유지한다.
--
-- 바꾸는 것: 아래 9개 표의 SELECT 정책 1개씩만. 쓰기(INSERT·UPDATE·DELETE) 정책·다른 표·데이터는 바꾸지 않는다.
--   기존 결정(migration_shared_master_data_write_permission.sql 주석: "공유 마스터 데이터는 select 전체 허용")을
--   2026-10 결정으로 대체한다 — 관련 메뉴가 전부 none이면 0건.
--   projects                         'authenticated users can read projects'    → menu_read: projects / weekly / trip / attendance / lodging / interview_db / overtime
--   project_notes                    'select_authenticated'                     → menu_read: projects / weekly
--   project_tooltips                 'select_authenticated'                     → menu_read: projects / weekly / trip
--   performing_projects              'select_authenticated'                     → menu_read: weekly
--   expected_projects                'select_authenticated'                     → menu_read: weekly
--   weekly_meta                      'select_authenticated'                     → menu_read: weekly
--   evaluation_types                 'eval_types_select'                        → menu_read: interview_db
--   evaluation_roles                 'eval_roles_select'                        → menu_read: interview_db
--   evaluation_question_categories   'eval_categories_select'                   → menu_read: interview_db
--   관리자(allowed_users.is_admin) = 전체, 비로그인(anon) = 0건(정책 대상 authenticated), 미승인 = 0건.
--   홈 화면(메뉴 키 없음)은 사용자의 관련 메뉴 권한만큼만 보인다. team_events(홈 팀 일정)는 대상 아님(홈 전용 공개 데이터).
--
-- 안전장치: 표마다 기존 읽기 정책이 이름·정의(USING)·permissive·명령(SELECT)·대상 역할까지 예상과 같을 때만 교체한다.
--   예상 역할: projects = authenticated 또는 public(원래 정의가 저장소에 없음 — 개발 기준은 authenticated, 어느 쪽이든
--   교체 후 authenticated만 남아 더 좁아진다), 나머지 8개 = public(저장소 정의에 TO 절 없음).
--   다르면(운영에서 누가 바꿨거나 다른 읽기 정책이 더 있으면) 전체를 되돌리고 중단한다. 이미 적용된 표는 건너뛴다(재실행 가능). 한 트랜잭션.
--   교체 전 정의(명령·역할·permissive·USING·WITH CHECK)는 private.shared_rls_policy_backup에 그대로 저장
--   → 되돌리기는 이 백업에서 원래 정의를 복원한다.
-- private.menu_any_readable 본문은 무효값 기본 거부 규칙(supabase/migration_menu_permission_strict.sql)과 같다 —
--   두 파일 중 어느 쪽을 먼저 실행해도 결과 본문이 같다.
-- 되돌리기: supabase/verify/shared_project_tables_rls_rollback.sql   확인: supabase/verify/shared_project_tables_rls_postflight.sql

begin;

-- 메뉴 권한 판정(여러 키 중 하나라도 none이 아니면 true) — private.menu_permission과 같은 규칙
--   is_admin이면 전체, 키 없으면 write, 값이 정확히 'none'|'read'|'write'가 아니면 none(무효값 기본 거부).
--   본문은 supabase/migration_menu_permission_strict.sql과 같다(lib/auth/permissionRuleSync.test.ts가 고정).
-- SECURITY DEFINER로 allowed_users를 소유자 권한으로 읽어 RLS 재귀를 만들지 않는다. 동적 SQL 없음, 모든 이름에 스키마.
create or replace function private.menu_any_readable(p_keys text[])
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select coalesce(
    (select u.is_admin
            or exists (select 1 from pg_catalog.unnest(p_keys) as k(menu_key)
                       where case
                               when u.is_admin then 'write'
                               when u.menu_permissions is null or pg_catalog.jsonb_typeof(u.menu_permissions) = 'null' then 'write'
                               when pg_catalog.jsonb_typeof(u.menu_permissions) <> 'object' then 'none'
                               when not (u.menu_permissions ? k.menu_key) then 'write'
                               when pg_catalog.jsonb_typeof(u.menu_permissions -> k.menu_key) = 'string'
                                    and (u.menu_permissions ->> k.menu_key) in ('none', 'read', 'write') then u.menu_permissions ->> k.menu_key
                               else 'none'
                             end <> 'none')
       from public.allowed_users u
      where u.email = (auth.jwt() ->> 'email')),
    false)
$$;
revoke all on function private.menu_any_readable(text[]) from public, anon, authenticated, service_role;
grant execute on function private.menu_any_readable(text[]) to authenticated;   -- 정책은 호출자 권한으로 함수를 실행한다

-- 교체 전 정의 백업 (되돌리기용, 클라이언트 접근 없음)
-- cmd(pg_policy.polcmd: r/a/w/d/*)·with_check까지 저장해 되돌리기가 원래 정책을 명령·역할·조건 그대로 다시 만든다.
create table if not exists private.shared_rls_policy_backup (
  table_name text not null,
  policy_name text not null,
  cmd text,
  permissive boolean not null,
  roles text[] not null,
  qual text,
  with_check text,
  saved_at timestamptz not null default now(),
  primary key (table_name, policy_name)
);
-- 이전 버전 파일로 이미 만들어진 백업표(개발 DB)에는 열이 없을 수 있다 — 추가만(기존 행은 cmd null = SELECT 정책 백업)
alter table private.shared_rls_policy_backup add column if not exists cmd text;
alter table private.shared_rls_policy_backup add column if not exists with_check text;
revoke all on table private.shared_rls_policy_backup from public, anon, authenticated, service_role;

-- ── projects ── 읽기: projects / weekly / trip / attendance / lodging / interview_db / overtime
do $$
declare
  v_old record;
begin
  if not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.projects'::regclass) then
    raise exception '중단: public.projects의 RLS가 꺼져 있다';
  end if;
  select p.polname, p.polcmd::text as polcmd, p.polpermissive,
         array(select case when r = 0 then 'public' else pg_catalog.pg_get_userbyid(r)::text end from pg_catalog.unnest(p.polroles) r order by 1) as roles,
         pg_catalog.pg_get_expr(p.polqual, p.polrelid) as qual,
         pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) as with_check
    into v_old
  from pg_catalog.pg_policy p where p.polrelid = 'public.projects'::regclass and p.polname = 'authenticated users can read projects';

  if not found then
    if exists (select 1 from pg_catalog.pg_policy p where p.polrelid = 'public.projects'::regclass and p.polname = 'menu_read') then
      return;   -- 이미 적용됨
    end if;
    raise exception '중단: public.projects의 기존 읽기 정책 "authenticated users can read projects"가 없다 — preflight 결과를 확인한다';
  end if;
  if v_old.qual is null or not (v_old.qual = any (array['true'])) or v_old.polpermissive is not true then
    raise exception '중단: public.projects 기존 읽기 정책 정의가 예상과 다르다: %', v_old.qual;
  end if;
  -- 명령은 SELECT('r')만, 대상 역할은 예상한 한 가지만 — 다르면(ALL·다른 역할 등) 교체하지 않고 중단
  if v_old.polcmd is distinct from 'r' or pg_catalog.array_length(v_old.roles, 1) is distinct from 1
     or not (v_old.roles[1] = any (array['authenticated', 'public'])) then
    raise exception '중단: public.projects 기존 읽기 정책의 명령·역할이 예상과 다르다: cmd=% roles=%', v_old.polcmd, v_old.roles;
  end if;
  -- 이 표에 다른 읽기 가능 정책(SELECT·ALL)이 있으면 교체해도 전체 읽기가 남는다 → 중단
  if exists (select 1 from pg_catalog.pg_policy p where p.polrelid = 'public.projects'::regclass
               and p.polcmd in ('r', '*') and p.polname not in ('authenticated users can read projects', 'menu_read')) then
    raise exception '중단: public.projects에 예상하지 않은 읽기 정책이 더 있다';
  end if;

  insert into private.shared_rls_policy_backup (table_name, policy_name, cmd, permissive, roles, qual, with_check)
  values ('projects', v_old.polname, v_old.polcmd, v_old.polpermissive, v_old.roles, v_old.qual, v_old.with_check)
  on conflict (table_name, policy_name) do nothing;

  drop policy "authenticated users can read projects" on public.projects;
  create policy "menu_read" on public.projects
    for select to authenticated
    using (private.menu_any_readable(array['projects', 'weekly', 'trip', 'attendance', 'lodging', 'interview_db', 'overtime']::text[]));
end $$;

-- ── project_notes ── 읽기: projects / weekly
do $$
declare
  v_old record;
begin
  if not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.project_notes'::regclass) then
    raise exception '중단: public.project_notes의 RLS가 꺼져 있다';
  end if;
  select p.polname, p.polcmd::text as polcmd, p.polpermissive,
         array(select case when r = 0 then 'public' else pg_catalog.pg_get_userbyid(r)::text end from pg_catalog.unnest(p.polroles) r order by 1) as roles,
         pg_catalog.pg_get_expr(p.polqual, p.polrelid) as qual,
         pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) as with_check
    into v_old
  from pg_catalog.pg_policy p where p.polrelid = 'public.project_notes'::regclass and p.polname = 'select_authenticated';

  if not found then
    if exists (select 1 from pg_catalog.pg_policy p where p.polrelid = 'public.project_notes'::regclass and p.polname = 'menu_read') then
      return;   -- 이미 적용됨
    end if;
    raise exception '중단: public.project_notes의 기존 읽기 정책 "select_authenticated"가 없다 — preflight 결과를 확인한다';
  end if;
  if v_old.qual is null or not (v_old.qual = any (array['(auth.role() = ''authenticated''::text)'])) or v_old.polpermissive is not true then
    raise exception '중단: public.project_notes 기존 읽기 정책 정의가 예상과 다르다: %', v_old.qual;
  end if;
  -- 명령은 SELECT('r')만, 대상 역할은 예상한 한 가지만 — 다르면(ALL·다른 역할 등) 교체하지 않고 중단
  if v_old.polcmd is distinct from 'r' or pg_catalog.array_length(v_old.roles, 1) is distinct from 1
     or not (v_old.roles[1] = any (array['public'])) then
    raise exception '중단: public.project_notes 기존 읽기 정책의 명령·역할이 예상과 다르다: cmd=% roles=%', v_old.polcmd, v_old.roles;
  end if;
  -- 이 표에 다른 읽기 가능 정책(SELECT·ALL)이 있으면 교체해도 전체 읽기가 남는다 → 중단
  if exists (select 1 from pg_catalog.pg_policy p where p.polrelid = 'public.project_notes'::regclass
               and p.polcmd in ('r', '*') and p.polname not in ('select_authenticated', 'menu_read')) then
    raise exception '중단: public.project_notes에 예상하지 않은 읽기 정책이 더 있다';
  end if;

  insert into private.shared_rls_policy_backup (table_name, policy_name, cmd, permissive, roles, qual, with_check)
  values ('project_notes', v_old.polname, v_old.polcmd, v_old.polpermissive, v_old.roles, v_old.qual, v_old.with_check)
  on conflict (table_name, policy_name) do nothing;

  drop policy "select_authenticated" on public.project_notes;
  create policy "menu_read" on public.project_notes
    for select to authenticated
    using (private.menu_any_readable(array['projects', 'weekly']::text[]));
end $$;

-- ── project_tooltips ── 읽기: projects / weekly / trip
do $$
declare
  v_old record;
begin
  if not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.project_tooltips'::regclass) then
    raise exception '중단: public.project_tooltips의 RLS가 꺼져 있다';
  end if;
  select p.polname, p.polcmd::text as polcmd, p.polpermissive,
         array(select case when r = 0 then 'public' else pg_catalog.pg_get_userbyid(r)::text end from pg_catalog.unnest(p.polroles) r order by 1) as roles,
         pg_catalog.pg_get_expr(p.polqual, p.polrelid) as qual,
         pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) as with_check
    into v_old
  from pg_catalog.pg_policy p where p.polrelid = 'public.project_tooltips'::regclass and p.polname = 'select_authenticated';

  if not found then
    if exists (select 1 from pg_catalog.pg_policy p where p.polrelid = 'public.project_tooltips'::regclass and p.polname = 'menu_read') then
      return;   -- 이미 적용됨
    end if;
    raise exception '중단: public.project_tooltips의 기존 읽기 정책 "select_authenticated"가 없다 — preflight 결과를 확인한다';
  end if;
  if v_old.qual is null or not (v_old.qual = any (array['(auth.role() = ''authenticated''::text)'])) or v_old.polpermissive is not true then
    raise exception '중단: public.project_tooltips 기존 읽기 정책 정의가 예상과 다르다: %', v_old.qual;
  end if;
  -- 명령은 SELECT('r')만, 대상 역할은 예상한 한 가지만 — 다르면(ALL·다른 역할 등) 교체하지 않고 중단
  if v_old.polcmd is distinct from 'r' or pg_catalog.array_length(v_old.roles, 1) is distinct from 1
     or not (v_old.roles[1] = any (array['public'])) then
    raise exception '중단: public.project_tooltips 기존 읽기 정책의 명령·역할이 예상과 다르다: cmd=% roles=%', v_old.polcmd, v_old.roles;
  end if;
  -- 이 표에 다른 읽기 가능 정책(SELECT·ALL)이 있으면 교체해도 전체 읽기가 남는다 → 중단
  if exists (select 1 from pg_catalog.pg_policy p where p.polrelid = 'public.project_tooltips'::regclass
               and p.polcmd in ('r', '*') and p.polname not in ('select_authenticated', 'menu_read')) then
    raise exception '중단: public.project_tooltips에 예상하지 않은 읽기 정책이 더 있다';
  end if;

  insert into private.shared_rls_policy_backup (table_name, policy_name, cmd, permissive, roles, qual, with_check)
  values ('project_tooltips', v_old.polname, v_old.polcmd, v_old.polpermissive, v_old.roles, v_old.qual, v_old.with_check)
  on conflict (table_name, policy_name) do nothing;

  drop policy "select_authenticated" on public.project_tooltips;
  create policy "menu_read" on public.project_tooltips
    for select to authenticated
    using (private.menu_any_readable(array['projects', 'weekly', 'trip']::text[]));
end $$;

-- ── performing_projects ── 읽기: weekly
do $$
declare
  v_old record;
begin
  if not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.performing_projects'::regclass) then
    raise exception '중단: public.performing_projects의 RLS가 꺼져 있다';
  end if;
  select p.polname, p.polcmd::text as polcmd, p.polpermissive,
         array(select case when r = 0 then 'public' else pg_catalog.pg_get_userbyid(r)::text end from pg_catalog.unnest(p.polroles) r order by 1) as roles,
         pg_catalog.pg_get_expr(p.polqual, p.polrelid) as qual,
         pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) as with_check
    into v_old
  from pg_catalog.pg_policy p where p.polrelid = 'public.performing_projects'::regclass and p.polname = 'select_authenticated';

  if not found then
    if exists (select 1 from pg_catalog.pg_policy p where p.polrelid = 'public.performing_projects'::regclass and p.polname = 'menu_read') then
      return;   -- 이미 적용됨
    end if;
    raise exception '중단: public.performing_projects의 기존 읽기 정책 "select_authenticated"가 없다 — preflight 결과를 확인한다';
  end if;
  if v_old.qual is null or not (v_old.qual = any (array['(auth.role() = ''authenticated''::text)'])) or v_old.polpermissive is not true then
    raise exception '중단: public.performing_projects 기존 읽기 정책 정의가 예상과 다르다: %', v_old.qual;
  end if;
  -- 명령은 SELECT('r')만, 대상 역할은 예상한 한 가지만 — 다르면(ALL·다른 역할 등) 교체하지 않고 중단
  if v_old.polcmd is distinct from 'r' or pg_catalog.array_length(v_old.roles, 1) is distinct from 1
     or not (v_old.roles[1] = any (array['public'])) then
    raise exception '중단: public.performing_projects 기존 읽기 정책의 명령·역할이 예상과 다르다: cmd=% roles=%', v_old.polcmd, v_old.roles;
  end if;
  -- 이 표에 다른 읽기 가능 정책(SELECT·ALL)이 있으면 교체해도 전체 읽기가 남는다 → 중단
  if exists (select 1 from pg_catalog.pg_policy p where p.polrelid = 'public.performing_projects'::regclass
               and p.polcmd in ('r', '*') and p.polname not in ('select_authenticated', 'menu_read')) then
    raise exception '중단: public.performing_projects에 예상하지 않은 읽기 정책이 더 있다';
  end if;

  insert into private.shared_rls_policy_backup (table_name, policy_name, cmd, permissive, roles, qual, with_check)
  values ('performing_projects', v_old.polname, v_old.polcmd, v_old.polpermissive, v_old.roles, v_old.qual, v_old.with_check)
  on conflict (table_name, policy_name) do nothing;

  drop policy "select_authenticated" on public.performing_projects;
  create policy "menu_read" on public.performing_projects
    for select to authenticated
    using (private.menu_any_readable(array['weekly']::text[]));
end $$;

-- ── expected_projects ── 읽기: weekly
do $$
declare
  v_old record;
begin
  if not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.expected_projects'::regclass) then
    raise exception '중단: public.expected_projects의 RLS가 꺼져 있다';
  end if;
  select p.polname, p.polcmd::text as polcmd, p.polpermissive,
         array(select case when r = 0 then 'public' else pg_catalog.pg_get_userbyid(r)::text end from pg_catalog.unnest(p.polroles) r order by 1) as roles,
         pg_catalog.pg_get_expr(p.polqual, p.polrelid) as qual,
         pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) as with_check
    into v_old
  from pg_catalog.pg_policy p where p.polrelid = 'public.expected_projects'::regclass and p.polname = 'select_authenticated';

  if not found then
    if exists (select 1 from pg_catalog.pg_policy p where p.polrelid = 'public.expected_projects'::regclass and p.polname = 'menu_read') then
      return;   -- 이미 적용됨
    end if;
    raise exception '중단: public.expected_projects의 기존 읽기 정책 "select_authenticated"가 없다 — preflight 결과를 확인한다';
  end if;
  if v_old.qual is null or not (v_old.qual = any (array['(auth.role() = ''authenticated''::text)'])) or v_old.polpermissive is not true then
    raise exception '중단: public.expected_projects 기존 읽기 정책 정의가 예상과 다르다: %', v_old.qual;
  end if;
  -- 명령은 SELECT('r')만, 대상 역할은 예상한 한 가지만 — 다르면(ALL·다른 역할 등) 교체하지 않고 중단
  if v_old.polcmd is distinct from 'r' or pg_catalog.array_length(v_old.roles, 1) is distinct from 1
     or not (v_old.roles[1] = any (array['public'])) then
    raise exception '중단: public.expected_projects 기존 읽기 정책의 명령·역할이 예상과 다르다: cmd=% roles=%', v_old.polcmd, v_old.roles;
  end if;
  -- 이 표에 다른 읽기 가능 정책(SELECT·ALL)이 있으면 교체해도 전체 읽기가 남는다 → 중단
  if exists (select 1 from pg_catalog.pg_policy p where p.polrelid = 'public.expected_projects'::regclass
               and p.polcmd in ('r', '*') and p.polname not in ('select_authenticated', 'menu_read')) then
    raise exception '중단: public.expected_projects에 예상하지 않은 읽기 정책이 더 있다';
  end if;

  insert into private.shared_rls_policy_backup (table_name, policy_name, cmd, permissive, roles, qual, with_check)
  values ('expected_projects', v_old.polname, v_old.polcmd, v_old.polpermissive, v_old.roles, v_old.qual, v_old.with_check)
  on conflict (table_name, policy_name) do nothing;

  drop policy "select_authenticated" on public.expected_projects;
  create policy "menu_read" on public.expected_projects
    for select to authenticated
    using (private.menu_any_readable(array['weekly']::text[]));
end $$;

-- ── weekly_meta ── 읽기: weekly
do $$
declare
  v_old record;
begin
  if not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.weekly_meta'::regclass) then
    raise exception '중단: public.weekly_meta의 RLS가 꺼져 있다';
  end if;
  select p.polname, p.polcmd::text as polcmd, p.polpermissive,
         array(select case when r = 0 then 'public' else pg_catalog.pg_get_userbyid(r)::text end from pg_catalog.unnest(p.polroles) r order by 1) as roles,
         pg_catalog.pg_get_expr(p.polqual, p.polrelid) as qual,
         pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) as with_check
    into v_old
  from pg_catalog.pg_policy p where p.polrelid = 'public.weekly_meta'::regclass and p.polname = 'select_authenticated';

  if not found then
    if exists (select 1 from pg_catalog.pg_policy p where p.polrelid = 'public.weekly_meta'::regclass and p.polname = 'menu_read') then
      return;   -- 이미 적용됨
    end if;
    raise exception '중단: public.weekly_meta의 기존 읽기 정책 "select_authenticated"가 없다 — preflight 결과를 확인한다';
  end if;
  if v_old.qual is null or not (v_old.qual = any (array['(auth.role() = ''authenticated''::text)'])) or v_old.polpermissive is not true then
    raise exception '중단: public.weekly_meta 기존 읽기 정책 정의가 예상과 다르다: %', v_old.qual;
  end if;
  -- 명령은 SELECT('r')만, 대상 역할은 예상한 한 가지만 — 다르면(ALL·다른 역할 등) 교체하지 않고 중단
  if v_old.polcmd is distinct from 'r' or pg_catalog.array_length(v_old.roles, 1) is distinct from 1
     or not (v_old.roles[1] = any (array['public'])) then
    raise exception '중단: public.weekly_meta 기존 읽기 정책의 명령·역할이 예상과 다르다: cmd=% roles=%', v_old.polcmd, v_old.roles;
  end if;
  -- 이 표에 다른 읽기 가능 정책(SELECT·ALL)이 있으면 교체해도 전체 읽기가 남는다 → 중단
  if exists (select 1 from pg_catalog.pg_policy p where p.polrelid = 'public.weekly_meta'::regclass
               and p.polcmd in ('r', '*') and p.polname not in ('select_authenticated', 'menu_read')) then
    raise exception '중단: public.weekly_meta에 예상하지 않은 읽기 정책이 더 있다';
  end if;

  insert into private.shared_rls_policy_backup (table_name, policy_name, cmd, permissive, roles, qual, with_check)
  values ('weekly_meta', v_old.polname, v_old.polcmd, v_old.polpermissive, v_old.roles, v_old.qual, v_old.with_check)
  on conflict (table_name, policy_name) do nothing;

  drop policy "select_authenticated" on public.weekly_meta;
  create policy "menu_read" on public.weekly_meta
    for select to authenticated
    using (private.menu_any_readable(array['weekly']::text[]));
end $$;

-- ── evaluation_types ── 읽기: interview_db
do $$
declare
  v_old record;
begin
  if not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.evaluation_types'::regclass) then
    raise exception '중단: public.evaluation_types의 RLS가 꺼져 있다';
  end if;
  select p.polname, p.polcmd::text as polcmd, p.polpermissive,
         array(select case when r = 0 then 'public' else pg_catalog.pg_get_userbyid(r)::text end from pg_catalog.unnest(p.polroles) r order by 1) as roles,
         pg_catalog.pg_get_expr(p.polqual, p.polrelid) as qual,
         pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) as with_check
    into v_old
  from pg_catalog.pg_policy p where p.polrelid = 'public.evaluation_types'::regclass and p.polname = 'eval_types_select';

  if not found then
    if exists (select 1 from pg_catalog.pg_policy p where p.polrelid = 'public.evaluation_types'::regclass and p.polname = 'menu_read') then
      return;   -- 이미 적용됨
    end if;
    raise exception '중단: public.evaluation_types의 기존 읽기 정책 "eval_types_select"가 없다 — preflight 결과를 확인한다';
  end if;
  if v_old.qual is null or not (v_old.qual = any (array['(auth.role() = ''authenticated''::text)'])) or v_old.polpermissive is not true then
    raise exception '중단: public.evaluation_types 기존 읽기 정책 정의가 예상과 다르다: %', v_old.qual;
  end if;
  -- 명령은 SELECT('r')만, 대상 역할은 예상한 한 가지만 — 다르면(ALL·다른 역할 등) 교체하지 않고 중단
  if v_old.polcmd is distinct from 'r' or pg_catalog.array_length(v_old.roles, 1) is distinct from 1
     or not (v_old.roles[1] = any (array['public'])) then
    raise exception '중단: public.evaluation_types 기존 읽기 정책의 명령·역할이 예상과 다르다: cmd=% roles=%', v_old.polcmd, v_old.roles;
  end if;
  -- 이 표에 다른 읽기 가능 정책(SELECT·ALL)이 있으면 교체해도 전체 읽기가 남는다 → 중단
  if exists (select 1 from pg_catalog.pg_policy p where p.polrelid = 'public.evaluation_types'::regclass
               and p.polcmd in ('r', '*') and p.polname not in ('eval_types_select', 'menu_read')) then
    raise exception '중단: public.evaluation_types에 예상하지 않은 읽기 정책이 더 있다';
  end if;

  insert into private.shared_rls_policy_backup (table_name, policy_name, cmd, permissive, roles, qual, with_check)
  values ('evaluation_types', v_old.polname, v_old.polcmd, v_old.polpermissive, v_old.roles, v_old.qual, v_old.with_check)
  on conflict (table_name, policy_name) do nothing;

  drop policy "eval_types_select" on public.evaluation_types;
  create policy "menu_read" on public.evaluation_types
    for select to authenticated
    using (private.menu_any_readable(array['interview_db']::text[]));
end $$;

-- ── evaluation_roles ── 읽기: interview_db
do $$
declare
  v_old record;
begin
  if not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.evaluation_roles'::regclass) then
    raise exception '중단: public.evaluation_roles의 RLS가 꺼져 있다';
  end if;
  select p.polname, p.polcmd::text as polcmd, p.polpermissive,
         array(select case when r = 0 then 'public' else pg_catalog.pg_get_userbyid(r)::text end from pg_catalog.unnest(p.polroles) r order by 1) as roles,
         pg_catalog.pg_get_expr(p.polqual, p.polrelid) as qual,
         pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) as with_check
    into v_old
  from pg_catalog.pg_policy p where p.polrelid = 'public.evaluation_roles'::regclass and p.polname = 'eval_roles_select';

  if not found then
    if exists (select 1 from pg_catalog.pg_policy p where p.polrelid = 'public.evaluation_roles'::regclass and p.polname = 'menu_read') then
      return;   -- 이미 적용됨
    end if;
    raise exception '중단: public.evaluation_roles의 기존 읽기 정책 "eval_roles_select"가 없다 — preflight 결과를 확인한다';
  end if;
  if v_old.qual is null or not (v_old.qual = any (array['(auth.role() = ''authenticated''::text)'])) or v_old.polpermissive is not true then
    raise exception '중단: public.evaluation_roles 기존 읽기 정책 정의가 예상과 다르다: %', v_old.qual;
  end if;
  -- 명령은 SELECT('r')만, 대상 역할은 예상한 한 가지만 — 다르면(ALL·다른 역할 등) 교체하지 않고 중단
  if v_old.polcmd is distinct from 'r' or pg_catalog.array_length(v_old.roles, 1) is distinct from 1
     or not (v_old.roles[1] = any (array['public'])) then
    raise exception '중단: public.evaluation_roles 기존 읽기 정책의 명령·역할이 예상과 다르다: cmd=% roles=%', v_old.polcmd, v_old.roles;
  end if;
  -- 이 표에 다른 읽기 가능 정책(SELECT·ALL)이 있으면 교체해도 전체 읽기가 남는다 → 중단
  if exists (select 1 from pg_catalog.pg_policy p where p.polrelid = 'public.evaluation_roles'::regclass
               and p.polcmd in ('r', '*') and p.polname not in ('eval_roles_select', 'menu_read')) then
    raise exception '중단: public.evaluation_roles에 예상하지 않은 읽기 정책이 더 있다';
  end if;

  insert into private.shared_rls_policy_backup (table_name, policy_name, cmd, permissive, roles, qual, with_check)
  values ('evaluation_roles', v_old.polname, v_old.polcmd, v_old.polpermissive, v_old.roles, v_old.qual, v_old.with_check)
  on conflict (table_name, policy_name) do nothing;

  drop policy "eval_roles_select" on public.evaluation_roles;
  create policy "menu_read" on public.evaluation_roles
    for select to authenticated
    using (private.menu_any_readable(array['interview_db']::text[]));
end $$;

-- ── evaluation_question_categories ── 읽기: interview_db
do $$
declare
  v_old record;
begin
  if not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.evaluation_question_categories'::regclass) then
    raise exception '중단: public.evaluation_question_categories의 RLS가 꺼져 있다';
  end if;
  select p.polname, p.polcmd::text as polcmd, p.polpermissive,
         array(select case when r = 0 then 'public' else pg_catalog.pg_get_userbyid(r)::text end from pg_catalog.unnest(p.polroles) r order by 1) as roles,
         pg_catalog.pg_get_expr(p.polqual, p.polrelid) as qual,
         pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) as with_check
    into v_old
  from pg_catalog.pg_policy p where p.polrelid = 'public.evaluation_question_categories'::regclass and p.polname = 'eval_categories_select';

  if not found then
    if exists (select 1 from pg_catalog.pg_policy p where p.polrelid = 'public.evaluation_question_categories'::regclass and p.polname = 'menu_read') then
      return;   -- 이미 적용됨
    end if;
    raise exception '중단: public.evaluation_question_categories의 기존 읽기 정책 "eval_categories_select"가 없다 — preflight 결과를 확인한다';
  end if;
  if v_old.qual is null or not (v_old.qual = any (array['(auth.role() = ''authenticated''::text)'])) or v_old.polpermissive is not true then
    raise exception '중단: public.evaluation_question_categories 기존 읽기 정책 정의가 예상과 다르다: %', v_old.qual;
  end if;
  -- 명령은 SELECT('r')만, 대상 역할은 예상한 한 가지만 — 다르면(ALL·다른 역할 등) 교체하지 않고 중단
  if v_old.polcmd is distinct from 'r' or pg_catalog.array_length(v_old.roles, 1) is distinct from 1
     or not (v_old.roles[1] = any (array['public'])) then
    raise exception '중단: public.evaluation_question_categories 기존 읽기 정책의 명령·역할이 예상과 다르다: cmd=% roles=%', v_old.polcmd, v_old.roles;
  end if;
  -- 이 표에 다른 읽기 가능 정책(SELECT·ALL)이 있으면 교체해도 전체 읽기가 남는다 → 중단
  if exists (select 1 from pg_catalog.pg_policy p where p.polrelid = 'public.evaluation_question_categories'::regclass
               and p.polcmd in ('r', '*') and p.polname not in ('eval_categories_select', 'menu_read')) then
    raise exception '중단: public.evaluation_question_categories에 예상하지 않은 읽기 정책이 더 있다';
  end if;

  insert into private.shared_rls_policy_backup (table_name, policy_name, cmd, permissive, roles, qual, with_check)
  values ('evaluation_question_categories', v_old.polname, v_old.polcmd, v_old.polpermissive, v_old.roles, v_old.qual, v_old.with_check)
  on conflict (table_name, policy_name) do nothing;

  drop policy "eval_categories_select" on public.evaluation_question_categories;
  create policy "menu_read" on public.evaluation_question_categories
    for select to authenticated
    using (private.menu_any_readable(array['interview_db']::text[]));
end $$;

commit;

-- 확인 (읽기만): 9개 표의 읽기 정책
select c.relname::text as table_name, p.polname::text as policy_name, pg_catalog.pg_get_expr(p.polqual, p.polrelid) as using_expr
from pg_catalog.pg_policy p join pg_catalog.pg_class c on c.oid = p.polrelid
where c.relnamespace = 'public'::regnamespace and c.relname in ('projects', 'project_notes', 'project_tooltips', 'performing_projects', 'expected_projects', 'weekly_meta', 'evaluation_types', 'evaluation_roles', 'evaluation_question_categories') and p.polcmd in ('r', '*')
order by 1, 2;
