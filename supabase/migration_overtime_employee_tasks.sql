-- 연장근무 관리 — 직원별 기본업무내용(자주 쓰는 업무 목록)
--
-- 목적: 직원마다 자주 쓰는 업무내용(예: "품질관리 검토", "현장 점검")을 직원 관리 화면에서
-- 미리 등록해두면, 향후 근무입력 화면(WorkRecordForm/BulkWorkRecordModal)에서 그 직원의
-- 업무내용을 드롭박스로 바로 고를 수 있는 기초자료가 된다.
-- 이번 마이그레이션은 이 목록 테이블만 추가한다 — 근무입력 화면의 드롭박스 연동은 별도 단계.

create table if not exists overtime_employee_tasks (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references overtime_employees(id) on delete cascade,
  task_name text not null,
  sort_order integer not null default 0,
  created_at timestamptz default now(),
  unique (employee_id, task_name) -- 같은 직원에게 같은 업무명을 중복 등록하지 못하게 방지
);

-- on delete cascade인 이유: overtime_work_records(실제 근무 기록)와 달리 이 테이블은
-- "자주 쓰는 업무명" 제안 목록일 뿐 이력 데이터가 아니므로, 직원 행이 지워지면(실무에서는
-- is_active=false로만 바꾸고 거의 삭제하지 않지만) 같이 정리되어도 무방하다.

create index if not exists idx_overtime_employee_tasks_employee
  on overtime_employee_tasks (employee_id, sort_order);

alter table overtime_employee_tasks enable row level security;

create policy "authenticated_full_access" on overtime_employee_tasks
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
