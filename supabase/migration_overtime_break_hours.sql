-- 연장근무 관리 — 휴게시간 컬럼 추가
--
-- 셀 팝오버 입력(2시간/3시간/기타 유형)에서 휴게시간을 명시적으로 입력받게 되면서,
-- 인정시간 계산 근거(종료 - 시작 - 휴게, 1시간 단위 절삭)를 기록에 남기기 위해 추가한다.
-- null = 기존 방식으로 저장된 레코드 (저장 시점에 식사시간 1시간 자동 차감 규칙 적용,
-- lib/overtime/time.ts의 calculateHours 참고) — 기존 데이터는 건드리지 않는다.

alter table overtime_work_records
  add column if not exists break_hours numeric(3,1);
