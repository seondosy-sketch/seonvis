-- 연장근무(실무자) — 휴일 근무의 시작시간 (migration_field_overtime.sql 이후 적용)
--
-- 휴일(주말 + 휴가관리 holidays의 법정공휴일·회사휴무)은 정규 근무가 없어 18:00 고정 시작이 맞지 않으므로
-- 시작시간을 입력받는다. null = 평일 기록(18:00 고정 시작) — 기존 기록은 그대로 null.
alter table field_overtime_records add column if not exists start_time text;

-- 공휴일·회사휴무 목록은 휴가관리 holidays 테이블을 그대로 참고한다(목록을 따로 두지 않음).
-- holidays select는 leave 권한만 허용하므로, 실무자 연장근무 사용자도 읽을 수 있게 정책을 더한다(OR).
-- 쓰기는 주지 않는다 — 휴일 편집은 휴가관리에서만.
create policy "field_overtime_select" on holidays for select using (private.menu_permission('field_overtime') <> 'none');
