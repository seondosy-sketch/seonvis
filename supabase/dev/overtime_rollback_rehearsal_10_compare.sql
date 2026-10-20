-- 연장근무 되돌리기 리허설 10단계 — 시작 상태와 비교, 리허설 객체 삭제
--
-- ████████████████████████████████████████████████████████████████████████████
-- ⚠ 경고 — 개발용 Supabase 전용 "전체 되돌리기 리허설". 운영에서 실행 금지.
--   이 리허설은 개발 DB의 연장근무 자동배정 데이터(실행·초안·자동확정 기록·월 목표·참여업무)를 지운다(5단계).
--   A 되돌리기(8단계)는 overtime_work_records의 자동배정 칸(source 등)과 새 표 4개를 지운다. 지운 데이터는 되살리지 않는다
--   (리허설 뒤 화면 시험 데이터가 필요하면 supabase/dev/overtime_ui_seed.sql을 다시 실행한다).
--   리허설 동안 개발 서버(next dev)를 멈춘다 — 화면이 되돌려진 sync_team_employees(이름 매칭)를 부르지 않게.
--   위 내용을 읽었으면 아래 "set local overtime.rehearsal_ack" 줄 맨 앞의 "-- "를 지우고 실행한다.
--   지우지 않으면 안전장치가 아무것도 바꾸지 않고 멈춘다(파일마다 매번).
-- 순서: _1_state → _2_c → _3_isolation → _4_monthly → _5_purge → _6_b → _7_sync_rpc → _8_a → (정방향 재적용: _9_forward 목록)
--       → _10_compare. 각 단계 뒤 overtime_rollback_rehearsal_check.sql(상태 확인).
-- 되돌리기 순서: overtime_planning_c_rollback → overtime_cap_isolation_guard_rollback → overtime_monthly_target_rollback → overtime_planning_rollback_b → overtime_project_sync_rpc_rollback → overtime_planning_rollback_a
-- ████████████████████████████████████████████████████████████████████████████
--
-- 정방향 재적용(9단계 목록 6개 파일)을 모두 끝낸 뒤 실행한다.
-- 비교: 1단계에서 저장한 지문(함수 정의 md5·권한·소유자, 트리거, 표 컬럼·RLS·권한, 제약, 인덱스, 정책)과 지금 상태가
--   모두 같아야 한다(FAIL 0). 데이터 건수는 5단계에서 지웠으므로 INFO로만 보인다(시작 → 지금).
-- 끝에서 private.overtime_rehearsal_snapshot·private.overtime_rehearsal_catalog를 지운다(결과는 그 전에 임시 표에 옮김).
-- 결과: check_name / status / detail

begin;
-- set local overtime.rehearsal_ack = 'yes';   -- ← 맨 위 경고를 읽었으면 이 줄 맨 앞의 "-- "를 지운다

do $$
begin
  if coalesce(current_setting('overtime.rehearsal_ack', true), '') <> 'yes' then
    raise exception '중단: 맨 위 경고를 읽고 set local overtime.rehearsal_ack 줄의 주석을 푼 뒤 실행한다';
  end if;
  -- 개발 DB 확인 (overtime_behavior_test.sql과 같은 기준)
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
  if to_regclass('private.overtime_rehearsal_snapshot') is null then
    raise exception '중단: 1단계(overtime_rollback_rehearsal_1_state.sql)를 먼저 실행한다';
  end if;
end $$;

drop table if exists pg_temp.ot_rehearsal_cmp;
create temp table ot_rehearsal_cmp (sort_key int, check_name text, status text, detail text);

insert into ot_rehearsal_cmp (sort_key, check_name, status, detail)
select 1, 'cmp_' || coalesce(s.kind, c.kind) || ':' || coalesce(s.name, c.name), 'FAIL',
       '시작=' || coalesce(left(s.fp, 60), '없음') || ' / 지금=' || coalesce(left(c.fp, 60), '없음')
from (select kind, name, fp from private.overtime_rehearsal_snapshot where kind not in ('data', 'step')) s
full join private.overtime_rehearsal_catalog c on c.kind = s.kind and c.name = s.name
where s.fp is distinct from c.fp;

insert into ot_rehearsal_cmp (sort_key, check_name, status, detail)
select 0, 'cmp00_summary',
       case when (select count(*) from ot_rehearsal_cmp) = 0 then 'OK' else 'FAIL' end,
       (select count(*) from private.overtime_rehearsal_snapshot where kind not in ('data', 'step')) || '개 지문 중 다른 것 '
       || (select count(*) from ot_rehearsal_cmp) || '개';

insert into ot_rehearsal_cmp (sort_key, check_name, status, detail)
select 2, 'data:' || s.name, 'INFO',
       '시작 ' || s.fp || ' → 지금 ' ||
       case s.name
         when 'overtime_assignment_runs' then (select count(*) from public.overtime_assignment_runs)::text
         when 'overtime_assignment_drafts' then (select count(*) from public.overtime_assignment_drafts)::text
         when 'overtime_work_records(auto)' then (select count(*) from public.overtime_work_records where source = 'auto')::text
         when 'overtime_work_records(전체)' then (select count(*) from public.overtime_work_records)::text
         when 'overtime_monthly_targets' then (select count(*) from public.overtime_monthly_targets)::text
         when 'overtime_member_tasks' then (select count(*) from public.overtime_member_tasks)::text
       end || ' (5단계에서 지운 자동배정 데이터는 되살리지 않는다)'
from private.overtime_rehearsal_snapshot s where s.kind = 'data';

insert into ot_rehearsal_cmp (sort_key, check_name, status, detail)
select 3, 'steps', 'INFO', string_agg(name, ' → ' order by captured_at)
from private.overtime_rehearsal_snapshot where kind = 'step';

-- 리허설 객체 삭제 (마지막)
drop view private.overtime_rehearsal_catalog;
drop table private.overtime_rehearsal_snapshot;

commit;

select check_name, status, detail from ot_rehearsal_cmp order by sort_key, check_name;
