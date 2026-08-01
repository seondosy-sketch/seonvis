-- 승인된 사용자 메모 — allowed_users.note
--
-- 배경: 관리자 화면의 "승인된 사용자" 목록은 이메일만 보여준다(allowed_users에 이름 컬럼이
-- 아예 없다). 승인할 때는 누구인지 알지만 시간이 지나면 axlab_14@seon.co.kr 같은 주소만 남아
-- 어느 팀 누구였는지 알 수 없다. 관리자가 사람을 식별할 메모를 직접 남길 수 있게 한다.
--
-- 이름 컬럼(name)이 아니라 자유 텍스트 메모로 둔 이유: 실제로 필요한 건 이름 하나가 아니라
-- "제안서팀 김OO 대리 — 2026-08 입사, 출근부만 사용" 같은 맥락이다. 구조화할 만큼 규칙이
-- 정해져 있지 않고, 관리자 혼자 보는 값이라 자유 텍스트가 맞다.
--
-- 승인 요청(access_requests)을 통해 승인하는 경우, 신청자가 적어둔 이름/사유를 그대로 메모
-- 초기값으로 옮긴다(app/api/admin/access-requests/route.ts) — 이미 받아둔 정보를 관리자가
-- 다시 타이핑하지 않게. 이후 수정은 관리자 화면에서 자유롭게 한다.
--
-- 승인자(누가 승인했는지)는 이미 added_by_email에 기록되고 있어 별도 컬럼을 만들지 않는다.

alter table allowed_users
  add column if not exists note text not null default '';

comment on column allowed_users.note is
  '관리자가 남기는 사용자 식별 메모(소속·직급·용도 등). 승인 요청 경유 시 신청자의 이름/사유로 초기화된다.';
