-- 메뉴 권한 무효값 기본 거부 — 적용 후 확인 (읽기 전용, 운영·개발 모두). 결과: check_name / status / detail
-- 대상: supabase/migration_menu_permission_strict.sql 이 재정의한 private.menu_permission(text) · private.menu_any_readable(text[])
-- 개인정보 없음: 함수 설정·본문 패턴·권한만 본다(행 데이터 읽지 않음).
-- 동작(무효값 → none, 키 없음 → write, is_admin → write, 행 없음 → none) 시험은 개발 DB에서 supabase/dev/menu_permission_strict_check.sql
with fn as (
  select p.oid, p.proname::text as name, p.prosecdef, p.provolatile, p.proconfig, p.proacl,
         pg_catalog.pg_get_userbyid(p.proowner)::text as owner, p.prosrc as src
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname in ('menu_permission', 'menu_any_readable')
),
target(name, signature) as (values
  ('menu_permission', 'private.menu_permission(text)'),
  ('menu_any_readable', 'private.menu_any_readable(text[])')
)
select * from (
  select t.name || ' 01 함수 존재' as check_name,
         case when exists (select 1 from fn where fn.name = t.name) then 'OK' else 'FAIL' end as status,
         coalesce((select 'owner=' || fn.owner from fn where fn.name = t.name), '함수 없음') as detail
  from target t
  union all
  select t.name || ' 02 SECURITY DEFINER·STABLE',
         case when (select fn.prosecdef and fn.provolatile = 's' from fn where fn.name = t.name) then 'OK' else 'FAIL' end,
         coalesce((select 'secdef=' || fn.prosecdef::text || ' volatile=' || fn.provolatile::text from fn where fn.name = t.name), '-')
  from target t
  union all
  select t.name || ' 03 search_path 고정(pg_catalog, pg_temp)',
         case when (select array_to_string(fn.proconfig, ';') from fn where fn.name = t.name) = 'search_path=pg_catalog, pg_temp' then 'OK' else 'FAIL' end,
         coalesce((select array_to_string(fn.proconfig, ';') from fn where fn.name = t.name), '-')
  from target t
  union all
  select t.name || ' 04 본문: 유효값은 정확히 none/read/write',
         case when (select fn.src ~ 'in \(''none'', ''read'', ''write''\)' and fn.src ~ 'jsonb_typeof\(u\.menu_permissions -> (k\.)?menu_key\) = ''string'''
                    from fn where fn.name = t.name) then 'OK' else 'FAIL' end,
         ''
  from target t
  union all
  select t.name || ' 05 본문: 그 밖의 값은 none(else ''none'')',
         case when (select fn.src ~ 'else ''none''' from fn where fn.name = t.name) then 'OK' else 'FAIL' end, ''
  from target t
  union all
  select t.name || ' 06 본문: 키 없음 → write, is_admin → write',
         case when (select fn.src ~ 'when not \(u\.menu_permissions \? (k\.)?menu_key\) then ''write'''
                       and fn.src ~ 'when u\.is_admin then ''write'''
                    from fn where fn.name = t.name) then 'OK' else 'FAIL' end, ''
  from target t
  union all
  select t.name || ' 07 본문: 예전 fail-open 규칙 없음',
         case when (select fn.src !~ 'coalesce\(u\.menu_permissions ->> (k\.)?menu_key, ''write''\)' from fn where fn.name = t.name) then 'OK' else 'FAIL' end,
         '예전: coalesce(menu_permissions ->> key, ''write'') — 무효값을 허용'
  from target t
  union all
  select t.name || ' 08 본문: 스키마 이름(public.allowed_users)·동적 SQL 없음',
         case when (select fn.src ~ 'from public\.allowed_users u' and fn.src !~* '\mexecute\M' from fn where fn.name = t.name) then 'OK' else 'FAIL' end, ''
  from target t
  union all
  select t.name || ' 09 PUBLIC 실행권한 없음',
         case when (select fn.proacl is null or array_to_string(fn.proacl, ',') ~ '(^|,)=X/' from fn where fn.name = t.name) then 'FAIL' else 'OK' end,
         coalesce((select array_to_string(fn.proacl, ',') from fn where fn.name = t.name), '-')
  from target t
  union all
  -- authenticated는 정책 평가에 EXECUTE가 필요하다. anon·service_role은 menu_any_readable만 원래 파일이 명시적으로 회수했으므로
  -- 그 함수만 FAIL로 보고, menu_permission(원래 PUBLIC만 회수)은 현재 값을 INFO로 보여 준다.
  select t.name || ' 10 EXECUTE:' || r,
         case when r = 'authenticated' then
                case when pg_catalog.has_function_privilege(r, t.signature, 'EXECUTE') then 'OK' else 'FAIL' end
              when t.name = 'menu_any_readable' then
                case when pg_catalog.has_function_privilege(r, t.signature, 'EXECUTE') then 'FAIL' else 'OK' end
              else 'INFO' end,
         'EXECUTE=' || pg_catalog.has_function_privilege(r, t.signature, 'EXECUTE')::text
  from target t cross join pg_catalog.unnest(array['anon', 'authenticated', 'service_role']) r
  where exists (select 1 from fn where fn.name = t.name)
) x
order by 1;
