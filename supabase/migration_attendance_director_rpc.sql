-- 기술인 출근부 — 단장 교체/승격 원자성 RPC (Phase 2 재검토, 사용자 검토 지시 반영)
--
-- 문제: 클라이언트에서 "기존 활성 단장 종료(UPDATE)" 후 "신규 단장 추가(INSERT)"를 별도 요청
-- 두 번으로 나눠 호출하면, 첫 요청만 성공하고 두 번째가 실패할 경우 "활성 단장이 아무도 없는"
-- 부분 완료 상태가 생길 수 있다. 이 함수는 관련 작업 전부를 Postgres 함수 하나로 묶어, 하나라도
-- 실패하면 전체가 자동으로 롤백되게 한다(단일 RPC 호출은 하나의 트랜잭션으로 실행되므로,
-- 함수 안에서 예외가 발생하면 그 호출에서 이미 실행된 UPDATE까지 전부 취소된다).
--
-- 두 경로:
--   경로 A — 신규 단장 후보가 이 프로젝트의 "진행중" 참여자가 아님: 기존 단장 종료 + 새 행 INSERT.
--   경로 B — 신규 단장 후보가 이미 이 프로젝트의 "진행중" 일반 참여자임(승격): 기존 단장 종료 +
--            새 행을 만들지 않고 그 기존 참여행을 UPDATE해서 단장으로 승격한다. 동일 기술인의
--            참여 이력을 불필요하게 중복 생성하지 않기 위함(사용자 검토 지시).
--            participation_start는 승격 시 절대 덮어쓰지 않는다 — 실제 참여를 시작한 사실은
--            승격 이전부터 있었던 것이므로 임의로 잃지 않는다. participation_end는 사용자가
--            이번에 입력한 값을 그대로 반영한다(비워두면 계속 참여 중인 것으로 열어둠).
--
-- 같은 사람을 다시 단장으로 지정하려는 시도(이미 그 사람이 활성 단장)는 예외로 명확히 차단한다
-- (no-op으로 조용히 넘기지 않음 — 사용자가 실제로 무슨 일이 일어났는지 혼동하지 않도록).
--
-- 범위: project_change_history 기록은 포함하지 않았다(비고/변경이력 화면 자체가 Phase 2 범위 밖).
--
-- 보안: security invoker(기본값, 명시적으로 선언) — 호출한 사용자의 권한으로 실행되어
-- project_participants의 기존 RLS 정책("authenticated_full_access")을 그대로 따른다.
-- service role이나 이 함수만을 위한 별도 우회 권한을 만들지 않는다.
create or replace function attendance_replace_director(
  p_project_id uuid,
  p_old_participant_id uuid, -- null이면 "교체"가 아니라 활성 단장이 없는 상태에서의 신규 지정
  p_new_engineer_id uuid,
  p_new_role text,
  p_new_specialty_id uuid,
  p_new_participation_start date, -- 경로 A(신규 INSERT)에서만 사용. 경로 B(승격)에서는 무시된다.
  p_new_participation_end date
)
returns project_participants
language plpgsql
security invoker
as $$
declare
  v_old_row project_participants;
  v_candidate_active_row project_participants;
  v_result_row project_participants;
begin
  if p_old_participant_id is not null then
    -- FOR UPDATE로 잠가, 동시에 같은 단장을 교체하려는 두 번째 요청이 끼어들지 못하게 한다.
    select * into v_old_row from project_participants
      where id = p_old_participant_id and project_id = p_project_id
      for update;
    if v_old_row.id is null then
      raise exception 'old director row not found' using errcode = 'P0001';
    end if;
    if v_old_row.status <> '진행중' or v_old_row.is_director <> true then
      raise exception 'old director is not currently active' using errcode = 'P0001';
    end if;
    if v_old_row.engineer_id = p_new_engineer_id then
      -- 같은 사람을 다시 단장으로 지정하는 요청 — no-op이 아니라 명확히 차단한다.
      raise exception 'new director candidate is already the current director' using errcode = 'P0001';
    end if;
  end if;

  -- 신규 단장 후보가 이 프로젝트에 이미 "진행중" 참여자로 등록돼 있는지(단장 여부와 무관하게) 확인.
  -- 있으면 경로 B(승격), 없으면 경로 A(신규 등록)로 분기한다.
  select * into v_candidate_active_row from project_participants
    where project_id = p_project_id and engineer_id = p_new_engineer_id and status = '진행중'
    for update;

  if p_old_participant_id is not null then
    update project_participants
    set status = '종료',
        participation_end = coalesce(participation_end, p_new_participation_start, current_date),
        updated_at = now()
    where id = p_old_participant_id;
  end if;

  if v_candidate_active_row.id is not null then
    -- 경로 B(승격): 새 행을 만들지 않고 기존 참여행을 단장으로 승격한다.
    update project_participants
    set is_director = true,
        role = p_new_role,
        specialty_id = p_new_specialty_id,
        participation_end = p_new_participation_end,
        updated_at = now()
    where id = v_candidate_active_row.id
    returning * into v_result_row;
  else
    -- 경로 A: 새 행 추가
    insert into project_participants (
      project_id, engineer_id, role, specialty_id, is_director,
      participation_start, participation_end, status, sort_order
    )
    select
      p_project_id, p_new_engineer_id, p_new_role, p_new_specialty_id, true,
      p_new_participation_start, p_new_participation_end, '진행중',
      coalesce((select max(sort_order) from project_participants where project_id = p_project_id), 0) + 10
    returning * into v_result_row;
  end if;
  -- 위 INSERT/UPDATE(경로 A/B) 중 하나가 실패하면 이 함수 호출 전체가 자동 롤백되어
  -- 앞서 실행한 "기존 단장 종료" UPDATE도 함께 취소된다 — 부분 완료 상태가 생기지 않는다.

  return v_result_row;
end;
$$;

-- 최소 권한 원칙: 이 함수는 단장 교체/승격이라는 쓰기 작업이라, security invoker + RLS로
-- 실제 데이터 변경이 막히더라도 미인증(anon) 역할에게 실행 권한 자체를 남겨둘 이유가 없다.
--
-- 주의: Supabase 프로젝트는 새 함수 생성 시 기본 권한(ALTER DEFAULT PRIVILEGES)으로
-- PUBLIC뿐 아니라 anon/authenticated/service_role에게도 각각 개별 EXECUTE grant를 자동으로
-- 부여한다(카탈로그 proacl로 실측 확인). `REVOKE ... FROM PUBLIC`만으로는 anon에게 직접
-- 부여된 권한이 남아있으므로, anon 역할도 명시적으로 revoke해야 한다. service_role은
-- 이 앱의 서버 전용 관리 클라이언트(lib/supabase-admin.ts)가 이미 RLS를 우회하는 신뢰된
-- 역할이라 건드리지 않는다(이번 요구사항은 "미인증 실행 차단"이지 서버 관리 권한 축소가 아님).
revoke all on function public.attendance_replace_director(
  uuid, uuid, uuid, text, uuid, date, date
) from public;

revoke all on function public.attendance_replace_director(
  uuid, uuid, uuid, text, uuid, date, date
) from anon;

grant execute on function public.attendance_replace_director(
  uuid, uuid, uuid, text, uuid, date, date
) to authenticated;
