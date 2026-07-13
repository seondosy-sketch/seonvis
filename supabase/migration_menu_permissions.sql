-- 사이드바 메뉴를 사람별로 다르게 보여주기 위한 컬럼.
-- 값은 lib/menuConfig.ts의 RESTRICTABLE_MENU_ITEMS 키 중 "이 사람에게는 숨길" 항목만 담는다.
-- 기본값은 빈 배열 — 기존 사용자는 전부 지금처럼 다 보인다(권한을 추가하는 게 아니라 뺄 것만 저장).
-- 관리자(ADMIN_EMAILS)는 이 테이블을 거치지 않고 항상 전체 메뉴를 보므로 이 컬럼의 영향을 받지 않는다.
alter table allowed_users
  add column if not exists hidden_menu_items text[] not null default '{}';
