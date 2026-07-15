-- 사용자별 · 메뉴 항목별 권한 (숨김/읽기/쓰기).
-- 값: { "<menuConfig 키>": "none" | "read" | "write" } — 키가 없으면 write(기본).
--   none  = 사이드바에서 숨김 (기존 hidden_menu_items와 동일한 효과)
--   read  = 페이지는 보이지만 추가/수정/삭제 UI 비활성화
--   write = 전체 사용 (기본)
-- 관리자(ADMIN_EMAILS)는 이 컬럼과 무관하게 항상 전체 쓰기.
alter table allowed_users
  add column if not exists menu_permissions jsonb not null default '{}';

-- 기존 숨김 설정 이관: hidden_menu_items의 키를 'none'으로.
-- hidden_menu_items 컬럼은 남겨두되 이후 코드는 menu_permissions만 읽는다 (deprecated).
update allowed_users
set menu_permissions = (
  select coalesce(jsonb_object_agg(k, to_jsonb('none'::text)), '{}'::jsonb)
  from unnest(hidden_menu_items) as k
)
where coalesce(array_length(hidden_menu_items, 1), 0) > 0
  and menu_permissions = '{}'::jsonb;
