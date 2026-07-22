-- 기술인 출근부 — Project List 자동연계 확정/재배정 RPC (Phase 3)
--
-- 이 파일은 project_participant_links(supabase/migration_attendance_participant_links.sql)를
-- 다루는 신규 함수 2개와, 기존 attendance_replace_director(supabase/migration_attendance_director_rpc.sql)를
-- "링크 테이블과의 원자적 연계"를 추가해 재정의(create or replace, 시그니처 동일)한다.
--
-- ── 1. attendance_confirm_participant_link ──────────────────────────────────
-- Project List 슬롯을 "최초로" 확정할 때 쓴다(동기화 미리보기에서 자동연결 후보를 반영하거나,
-- 동명이인/주소록미등록 상태에서 사용자가 후보를 직접 골라 확정하는 경우 공용).
-- 참여행 생성(또는 단장이면 기존 attendance_replace_director 재사용)과 링크 행 생성을
-- 같은 트랜잭션으로 묶어, 참여행만 생성되고 링크가 안 생기는 반쪼가리 상태를 막는다.
--
-- 이미 확정된(participant_id not null) 링크가 있는 슬롯은 이 함수로 다시 확정할 수 없다 —
-- 그 경우 재매핑은 반드시 attendance_reassign_engineer(출근기록 유무에 따라 안전하게 분기)를
-- 거쳐야 한다(사용자 지시 #5, #7 — engineer_id를 직접 UPDATE로 바꾸는 경로를 만들지 않는다).
create or replace function attendance_confirm_participant_link(
  p_project_id uuid,
  p_source_slot text,
  p_engineer_id uuid,
  p_role text,
  p_specialty_id uuid,
  p_is_director boolean,
  p_participation_start date,
  p_participation_end date,
  p_source_name_snapshot text,
  p_link_status text -- '자동연결' | '연결완료'
)
returns project_participants
language plpgsql
security invoker
as $$
declare
  v_existing_link project_participant_links;
  v_result_row project_participants;
begin
  if p_source_slot not in ('director', 'staff_arch', 'staff_civil', 'staff_mech', 'staff_safety') then
    raise exception 'invalid source_slot: %', p_source_slot using errcode = 'P0001';
  end if;
  if p_link_status not in ('자동연결', '연결완료') then
    raise exception 'invalid link_status: %', p_link_status using errcode = 'P0001';
  end if;

  -- 슬롯 잠금 + 이미 확정된 연결이면 차단(재매핑은 별도 RPC로만).
  select * into v_existing_link from project_participant_links
    where project_id = p_project_id and source_slot = p_source_slot for update;
  if v_existing_link.id is not null and v_existing_link.participant_id is not null then
    raise exception 'slot already linked; use attendance_reassign_engineer instead' using errcode = 'P0001';
  end if;

  if p_is_director then
    -- 단장 슬롯은 기존 단장교체/승격 원자성 로직을 그대로 재사용한다(중복 구현하지 않음).
    -- p_old_participant_id를 null로 넘기면 "현재 활성 단장 없음" 경로(신규 등록)로 처리된다.
    v_result_row := attendance_replace_director(
      p_project_id, null, p_engineer_id, coalesce(p_role, '단장'), p_specialty_id,
      p_participation_start, p_participation_end
    );
  else
    insert into project_participants (
      project_id, engineer_id, role, specialty_id, is_director,
      participation_start, participation_end, status, sort_order
    )
    values (
      p_project_id, p_engineer_id, coalesce(p_role, ''), p_specialty_id, false,
      p_participation_start, p_participation_end, '진행중',
      coalesce((select max(sort_order) from project_participants where project_id = p_project_id), 0) + 10
    )
    returning * into v_result_row;
  end if;
  -- 위 INSERT(또는 attendance_replace_director 내부의 INSERT/UPDATE)가 실패하면 이 함수 호출
  -- 전체가 자동 롤백된다 — 아래 링크 upsert만 성공하고 참여행이 안 생기는 일은 있을 수 없다.

  insert into project_participant_links (
    project_id, source_slot, source_name_snapshot, engineer_id, participant_id, link_status
  ) values (
    p_project_id, p_source_slot, p_source_name_snapshot, p_engineer_id, v_result_row.id, p_link_status
  )
  on conflict (project_id, source_slot) do update
    set source_name_snapshot = excluded.source_name_snapshot,
        engineer_id = excluded.engineer_id,
        participant_id = excluded.participant_id,
        link_status = excluded.link_status,
        updated_at = now();

  return v_result_row;
end;
$$;

revoke all on function public.attendance_confirm_participant_link(
  uuid, text, uuid, text, uuid, boolean, date, date, text, text
) from public;
revoke all on function public.attendance_confirm_participant_link(
  uuid, text, uuid, text, uuid, boolean, date, date, text, text
) from anon;
grant execute on function public.attendance_confirm_participant_link(
  uuid, text, uuid, text, uuid, boolean, date, date, text, text
) to authenticated;

-- ── 2. attendance_reassign_engineer ─────────────────────────────────────────
-- 출근기록이 있는 "일반(단장 아님)" 참여기술인의 연결 기술인을 바꿀 때 쓴다. attendance_records가
-- engineer_id를 비정규화 복사값으로 들고 있어(project_participants.engineer_id를 직접 UPDATE하면
-- 과거 기록과 불일치가 생김 — 조사 보고서 10번), attendance_replace_director와 동일한 패턴으로
-- "기존 참여행 종료 + 새 참여행 추가"만 쓴다. 과거 attendance_records는 옛 participant_id를 그대로
-- 가리키므로 절대 다른 기술인에게 이전되지 않는다.
--
-- 이 함수가 대상으로 하지 않는 것: is_director = true인 참여행(사용자 지시 #7 — 단장 여부 변경은
-- 반드시 attendance_replace_director를 거쳐야 하며, 이 함수로는 차단한다).
--
-- 링크 원자성(사용자 지시 #5): 옛 참여행을 가리키던 project_participant_links 행이 있으면(없으면
-- 아무 것도 하지 않음) 같은 트랜잭션에서 새 참여행으로 참조를 옮긴다 — 재배정 후 링크가 종료된
-- 옛 참여행을 계속 가리키는 상태가 생기지 않는다.
create or replace function attendance_reassign_engineer(
  p_old_participant_id uuid,
  p_new_engineer_id uuid,
  p_new_role text,
  p_new_specialty_id uuid,
  p_new_participation_start date,
  p_new_participation_end date,
  p_effective_from date -- 기존 참여행의 participation_end로 쓸 값. null이면 오늘 날짜.
)
returns project_participants
language plpgsql
security invoker
as $$
declare
  v_old_row project_participants;
  v_link project_participant_links;
  v_result_row project_participants;
begin
  -- 1) 기존 참여행 FOR UPDATE
  select * into v_old_row from project_participants where id = p_old_participant_id for update;
  if v_old_row.id is null then
    raise exception 'participant not found' using errcode = 'P0001';
  end if;
  if v_old_row.is_director then
    raise exception 'director reassignment must use attendance_replace_director' using errcode = 'P0001';
  end if;
  if v_old_row.status <> '진행중' then
    raise exception 'participant is not active' using errcode = 'P0001';
  end if;
  if v_old_row.engineer_id = p_new_engineer_id then
    raise exception 'new engineer is already assigned to this participant' using errcode = 'P0001';
  end if;

  -- 2) 해당 참여행을 가리키는 link 행도 잠금(있으면)
  select * into v_link from project_participant_links where participant_id = p_old_participant_id for update;

  -- 새 기술인이 이미 이 프로젝트의 진행중 참여자면(단장이든 아니든) 충돌 — unique index로도
  -- 결국 막히지만, 여기서 먼저 명확한 에러 메시지로 차단한다.
  if exists (
    select 1 from project_participants
    where project_id = v_old_row.project_id and engineer_id = p_new_engineer_id and status = '진행중'
  ) then
    raise exception 'new engineer already an active participant in this project' using errcode = 'P0001';
  end if;

  -- 3) 기존 참여행 종료
  update project_participants
  set status = '종료',
      participation_end = coalesce(p_effective_from, current_date),
      updated_at = now()
  where id = p_old_participant_id;

  -- 4) 신규 참여행 생성 — 역할/분야를 새로 지정하지 않으면 기존 값을 승계한다.
  insert into project_participants (
    project_id, engineer_id, role, specialty_id, is_director,
    participation_start, participation_end, status, sort_order
  )
  values (
    v_old_row.project_id, p_new_engineer_id,
    coalesce(p_new_role, v_old_row.role), coalesce(p_new_specialty_id, v_old_row.specialty_id), false,
    p_new_participation_start, p_new_participation_end, '진행중', v_old_row.sort_order
  )
  returning * into v_result_row;
  -- 3)~4) 중 하나라도 실패하면 함수 호출 전체가 롤백된다(부분완료 상태 없음).

  -- 5)~6) link가 있었다면 신규 참여행을 가리키도록 갱신 + engineer_id/상태/snapshot 동기화.
  if v_link.id is not null then
    update project_participant_links
    set participant_id = v_result_row.id,
        engineer_id = p_new_engineer_id,
        source_name_snapshot = coalesce((
          select case v_link.source_slot
            when 'director' then p.director
            when 'staff_arch' then p.staff_arch
            when 'staff_civil' then p.staff_civil
            when 'staff_mech' then p.staff_mech
            when 'staff_safety' then p.staff_safety
          end
          from projects p where p.id = v_old_row.project_id
        ), v_link.source_name_snapshot),
        link_status = '연결완료',
        updated_at = now()
    where id = v_link.id;
  end if;

  -- 7) 신규 참여행 반환
  return v_result_row;
end;
$$;

revoke all on function public.attendance_reassign_engineer(
  uuid, uuid, text, uuid, date, date, date
) from public;
revoke all on function public.attendance_reassign_engineer(
  uuid, uuid, text, uuid, date, date, date
) from anon;
grant execute on function public.attendance_reassign_engineer(
  uuid, uuid, text, uuid, date, date, date
) to authenticated;

-- ── 3. attendance_replace_director 재정의 — 링크 연계 추가 ───────────────────
-- 기존 로직(경로 A/B, 동시성 잠금, no-op 차단)은 전부 그대로 유지하고, 결과 행이 확정된 뒤
-- "이 프로젝트의 director 슬롯 링크가 옛 단장 참여행(p_old_participant_id)을 가리키고 있었는지"만
-- 추가로 확인한다. 있으면 같은 트랜잭션에서 새 단장 참여행으로 참조를 옮긴다(사용자 지시 #6).
-- 없으면(수동 등록 단장 교체 — Project List 슬롯과 무관) 아무 것도 하지 않는다 — 임의로 새
-- 링크를 만들지 않는다. p_old_participant_id가 null(최초 지정)인 경우도 매칭되는 링크가 없으므로
-- 자연히 아무 것도 하지 않는다(최초 확정은 attendance_confirm_participant_link가 별도로 링크를 만든다).
create or replace function attendance_replace_director(
  p_project_id uuid,
  p_old_participant_id uuid,
  p_new_engineer_id uuid,
  p_new_role text,
  p_new_specialty_id uuid,
  p_new_participation_start date,
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
      raise exception 'new director candidate is already the current director' using errcode = 'P0001';
    end if;
  end if;

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
    update project_participants
    set is_director = true,
        role = p_new_role,
        specialty_id = p_new_specialty_id,
        participation_end = p_new_participation_end,
        updated_at = now()
    where id = v_candidate_active_row.id
    returning * into v_result_row;
  else
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

  -- 신규 추가(Phase 3): director 슬롯 링크가 옛 단장 참여행을 가리키고 있었으면 새 결과 행으로 옮긴다.
  -- p_old_participant_id가 null이거나, 있어도 그 참여행을 가리키는 링크가 없으면 0행 매치라 no-op.
  if p_old_participant_id is not null then
    update project_participant_links
    set participant_id = v_result_row.id,
        engineer_id = p_new_engineer_id,
        link_status = '연결완료',
        updated_at = now()
    where project_id = p_project_id and source_slot = 'director' and participant_id = p_old_participant_id;
  end if;

  return v_result_row;
end;
$$;

revoke all on function public.attendance_replace_director(
  uuid, uuid, uuid, text, uuid, date, date
) from public;
revoke all on function public.attendance_replace_director(
  uuid, uuid, uuid, text, uuid, date, date
) from anon;
grant execute on function public.attendance_replace_director(
  uuid, uuid, uuid, text, uuid, date, date
) to authenticated;
