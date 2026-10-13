-- 연장근무 프로젝트 동기화 반영 RPC — 별도 승인 대상 (Phase 4 API route와 같이 배포)
--
-- ⚠ 초안. 어떤 DB에도 실행하지 않았다. Migration A·B와 독립적이다(overtime_projects·projects만 사용).
--
-- 구조(권장안 C, docs/overtime-planning-db.md):
--   1) Next.js API route가 로그인 사용자의 overtime 권한(none 아님)을 서버에서 확인
--   2) 서버가 lib/overtime/sync.ts의 planBidProjectSync(대상기간 판정은 lib/overtime/eligibility.ts)로 계획 생성
--   3) 서버 환경의 service role로 이 RPC를 한 번 호출 → 한 트랜잭션으로 반영
--   판정 규칙은 TypeScript 한 곳에만 있다. 이 RPC는 규칙을 다시 구현하지 않고, 계획이 원본(projects)과
--   어긋나지 않는지만 대조한다:
--     - 연계 행의 name = projects.name
--     - start_date = projects.announce_date (또는 NULL)
--     - end_date ∈ {projects.submit_date, interview_date, bid_date} (또는 NULL)
--     - status ∈ {진행중, 종료}이고, 원본이 진행중이 아니면 반드시 종료
--     - 수동 행(source_project_id NULL)은 "같은 이름의 수동 행을 연계 행으로 전환"하는 경우만 갱신
--   변경 칼럼은 name·start_date·end_date·status·(NULL인) source_project_id뿐. 삭제 없음.
--   참여 인원·업무·근무기록 테이블은 참조조차 하지 않는다. 같은 값이면 쓰지 않는다(멱등).
--   실행 권한은 service_role만(브라우저에서 직접 호출 불가).
-- 의존 인덱스: INSERT의 on conflict (source_project_id) where source_project_id is not null 은
--   public.overtime_projects_source_project_id_key(부분 UNIQUE, migration_overtime_source_project.sql)를 추론해 쓴다.
--   없거나 모양이 다르면 첫 동기화가 실행 시점에 실패하므로, 함수를 만들기 전에 확인하고 다르면 아무것도 바꾸지 않고 중단한다.

begin;

do $
declare
  v record;
begin
  if to_regclass('public.overtime_projects_source_project_id_key') is null then
    raise exception 'OVERTIME_SYNC_INDEX_MISSING: public.overtime_projects_source_project_id_key 없음 — migration_overtime_source_project.sql을 먼저 적용한다';
  end if;
  select i.indrelid = to_regclass('public.overtime_projects') as on_table,
         i.indisunique as is_unique,
         (i.indnatts = 1 and i.indexprs is null and a.attname = 'source_project_id') as on_column,
         coalesce(pg_catalog.pg_get_expr(i.indpred, i.indrelid) = '(source_project_id IS NOT NULL)', false) as partial_ok,
         (i.indisvalid and i.indisready) as valid_ready
    into v
  from pg_catalog.pg_index i
  left join pg_catalog.pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
  where i.indexrelid = to_regclass('public.overtime_projects_source_project_id_key');
  if not found or not (v.on_table and v.is_unique and v.on_column and v.partial_ok and v.valid_ready) then
    raise exception 'OVERTIME_SYNC_INDEX_INVALID: overtime_projects_source_project_id_key 모양이 다르다 — 대상 표=% unique=% 열(source_project_id 하나)=% 부분조건(IS NOT NULL)=% valid·ready=%',
      coalesce(v.on_table::text, '없음'), coalesce(v.is_unique::text, '없음'), coalesce(v.on_column::text, '없음'),
      coalesce(v.partial_ok::text, '없음'), coalesce(v.valid_ready::text, '없음');
  end if;
end $;

create or replace function public.overtime_apply_project_sync(p_inserts jsonb, p_updates jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_inserted int := 0;
  v_updated int := 0;
  v_bad text;
begin
  -- 동시 실행 직렬화
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('overtime_project_sync', 0));

  -- 형식: patch 키는 허용 목록만 (키를 SQL 식별자로 쓰지 않는다 — 아래에서 정해진 이름으로만 읽음)
  if exists (select 1 from jsonb_array_elements(coalesce(p_updates, '[]'::jsonb)) e,
                    jsonb_object_keys(e -> 'patch') k
             where k not in ('name', 'start_date', 'end_date', 'status', 'source_project_id')) then
    raise exception 'OVERTIME_SYNC_INVALID_PATCH' using errcode = '22023';
  end if;

  -- 반영 후 값(최종값)을 만든 뒤 원본과 대조한다
  create temporary table if not exists pg_temp.overtime_sync_changes (
    kind text, target_id uuid, source_project_id uuid, name text, start_date date, end_date date, status text, sort_order int
  ) on commit drop;
  truncate pg_temp.overtime_sync_changes;

  insert into pg_temp.overtime_sync_changes (kind, target_id, source_project_id, name, start_date, end_date, status, sort_order)
  select 'insert', null, x.source_project_id, x.name, x.start_date, x.end_date, x.status, x.sort_order
  from jsonb_to_recordset(coalesce(p_inserts, '[]'::jsonb))
         as x(source_project_id uuid, name text, start_date date, end_date date, status text, sort_order int);

  insert into pg_temp.overtime_sync_changes (kind, target_id, source_project_id, name, start_date, end_date, status, sort_order)
  select 'update', op.id,
         coalesce(op.source_project_id, case when u.patch ? 'source_project_id' then (u.patch ->> 'source_project_id')::uuid end),
         case when u.patch ? 'name' then u.patch ->> 'name' else op.name end,
         case when u.patch ? 'start_date' then (u.patch ->> 'start_date')::date else op.start_date end,
         case when u.patch ? 'end_date' then (u.patch ->> 'end_date')::date else op.end_date end,
         case when u.patch ? 'status' then u.patch ->> 'status' else op.status end,
         op.sort_order
  from (select (e ->> 'id')::uuid as id, e -> 'patch' as patch
        from jsonb_array_elements(coalesce(p_updates, '[]'::jsonb)) e) u
  join public.overtime_projects op on op.id = u.id;

  select case
           when c.source_project_id is null then 'source_project_id 없음'
           when p.id is null then '원본 프로젝트 없음'
           when c.name is distinct from p.name then '이름이 원본과 다름'
           when c.start_date is not null and to_char(c.start_date, 'YYYY-MM-DD') is distinct from p.announce_date then '시작일이 원본 공고일과 다름'
           when c.end_date is not null and c.end_date is distinct from p.submit_date
                and c.end_date is distinct from p.interview_date and c.end_date is distinct from p.bid_date then '종료일이 원본 날짜와 다름'
           when c.status not in ('진행중', '종료') then '상태값 오류'
           when c.status = '진행중' and p.status <> '진행중' then '원본이 진행중이 아닌데 진행중'
           when c.kind = 'insert' and c.status <> '진행중' then '신규 행은 진행중만'
         end
    into v_bad
  from pg_temp.overtime_sync_changes c
  left join public.projects p on p.id = c.source_project_id
  where c.source_project_id is null or p.id is null
     or c.name is distinct from p.name
     or (c.start_date is not null and to_char(c.start_date, 'YYYY-MM-DD') is distinct from p.announce_date)
     or (c.end_date is not null and c.end_date is distinct from p.submit_date
         and c.end_date is distinct from p.interview_date and c.end_date is distinct from p.bid_date)
     or c.status not in ('진행중', '종료')
     or (c.status = '진행중' and p.status <> '진행중')
     or (c.kind = 'insert' and c.status <> '진행중')
  limit 1;
  if v_bad is not null then
    raise exception 'OVERTIME_SYNC_PLAN_MISMATCH: %', v_bad using errcode = '22023';
  end if;
  -- 갱신 대상 id가 실제 행과 다 맞는지(없는 id는 위 join에서 빠지므로 개수로 확인)
  if (select count(*) from pg_temp.overtime_sync_changes where kind = 'update')
     <> jsonb_array_length(coalesce(p_updates, '[]'::jsonb)) then
    raise exception 'OVERTIME_SYNC_PLAN_MISMATCH: 없는 행 갱신' using errcode = '22023';
  end if;

  insert into public.overtime_projects (name, status, sort_order, start_date, end_date, source_project_id)
  select c.name, c.status, c.sort_order, c.start_date, c.end_date, c.source_project_id
  from pg_temp.overtime_sync_changes c where c.kind = 'insert'
  on conflict (source_project_id) where source_project_id is not null do nothing;
  get diagnostics v_inserted = row_count;

  update public.overtime_projects op
  set name = c.name, start_date = c.start_date, end_date = c.end_date, status = c.status,
      source_project_id = c.source_project_id
  from pg_temp.overtime_sync_changes c
  where c.kind = 'update' and op.id = c.target_id
    and (op.source_project_id is null or op.source_project_id = c.source_project_id)
    and (op.name, op.start_date, op.end_date, op.status, op.source_project_id)
        is distinct from (c.name, c.start_date, c.end_date, c.status, c.source_project_id);
  get diagnostics v_updated = row_count;

  return jsonb_build_object('inserted', v_inserted, 'updated', v_updated);
end $$;

revoke all on function public.overtime_apply_project_sync(jsonb, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.overtime_apply_project_sync(jsonb, jsonb) to service_role;

commit;
