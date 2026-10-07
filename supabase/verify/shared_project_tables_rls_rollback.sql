-- 공용 표 읽기 정책 보정 되돌리기 — 백업(private.shared_rls_policy_backup)에 저장된 원래 정의를 그대로 복원한다.
-- menu_read 정책 9개를 지우고 원래 읽기 정책을 만든 뒤, 새 함수·백업표를 지운다. 쓰기 정책·데이터는 건드리지 않는다. 한 트랜잭션.
-- 다시 적용하려면: 이 파일 → supabase/migration_shared_project_tables_rls.sql (그대로 재실행 가능)
begin;

do $$
declare
  b record;
  v_tables text[] := array['projects', 'project_notes', 'project_tooltips', 'performing_projects', 'expected_projects', 'weekly_meta', 'evaluation_types', 'evaluation_roles', 'evaluation_question_categories'];
  t text;
begin
  if to_regclass('private.shared_rls_policy_backup') is null then
    raise exception '중단: 백업표가 없다 — 이 보정이 적용되지 않았거나 이미 되돌렸다';
  end if;
  foreach t in array v_tables loop
    if exists (select 1 from pg_catalog.pg_policy p where p.polrelid = ('public.' || t)::regclass and p.polname = 'menu_read')
       and not exists (select 1 from private.shared_rls_policy_backup x where x.table_name = t) then
      raise exception '중단: %의 원래 정의 백업이 없다', t;
    end if;
  end loop;

  for b in select * from private.shared_rls_policy_backup where table_name = any (v_tables) order by table_name loop
    execute pg_catalog.format('drop policy if exists %I on public.%I', 'menu_read', b.table_name);
    execute pg_catalog.format('drop policy if exists %I on public.%I', b.policy_name, b.table_name);
    execute pg_catalog.format('create policy %I on public.%I as %s for select to %s using (%s)',
      b.policy_name, b.table_name, case when b.permissive then 'permissive' else 'restrictive' end,
      (select string_agg(case when r = 'public' then 'public' else pg_catalog.quote_ident(r) end, ', ') from pg_catalog.unnest(b.roles) r),
      b.qual);
  end loop;
end $$;

drop function if exists private.menu_any_readable(text[]);
drop table if exists private.shared_rls_policy_backup;

commit;

select c.relname::text as table_name, p.polname::text as policy_name, pg_catalog.pg_get_expr(p.polqual, p.polrelid) as using_expr
from pg_catalog.pg_policy p join pg_catalog.pg_class c on c.oid = p.polrelid
where c.relnamespace = 'public'::regnamespace and c.relname in ('projects', 'project_notes', 'project_tooltips', 'performing_projects', 'expected_projects', 'weekly_meta', 'evaluation_types', 'evaluation_roles', 'evaluation_question_categories') and p.polcmd in ('r', '*')
order by 1, 2;
