-- 홈화면 위젯용 토큰 (docs/widget/README.md)
--
-- 위젯은 브라우저가 아니라 아이폰/안드로이드의 "이미지 위젯 앱"이 URL을 주기적으로 긁어가는
-- 구조다. 그 앱들은 Supabase 쿠키 세션을 들고 갈 수 없으므로 앱 로그인과 별개로
-- "URL 자체가 비밀"인 토큰을 쓴다. 즉 이 토큰이 담긴 URL을 아는 사람은 그 사용자에게
-- 허용된 범위의 위젯 이미지를 볼 수 있다 — 그래서
--   * 위젯 이미지는 읽기 전용이고, 이번 주 일정 요약만 담는다 (원본 테이블 노출 없음)
--   * 언제든 재발급(=기존 토큰 즉시 무효화)할 수 있게 revoked_at을 둔다
--   * 발급 후에도 요청 시점마다 allowed_users 권한을 다시 확인한다
--     (lib/widget/token.ts — 퇴사·권한 회수 시 토큰이 살아 있어도 이미지가 막힌다)
--
-- 사용자당 활성 토큰은 1개로 운영한다(재발급 시 이전 토큰 revoke). 여러 기기에서 쓰려면
-- 같은 URL을 공유하면 되고, 유출이 의심되면 재발급 한 번으로 전부 끊는 게 더 단순하다.
create table if not exists widget_tokens (
  token text primary key,              -- 'wgt_' + 랜덤 32 hex (lib/widget/token.ts)
  email text not null,                 -- 발급 대상 (allowed_users.email과 같은 소문자 정규화 값)
  created_at timestamptz not null default now(),
  last_used_at timestamptz,            -- 위젯이 마지막으로 이미지를 가져간 시각 (미사용 토큰 파악용)
  revoked_at timestamptz               -- null이 아니면 무효 (재발급 시 이전 토큰에 기록)
);

create index if not exists widget_tokens_email_idx on widget_tokens (email);

-- RLS 활성화 후 정책을 하나도 만들지 않는다 = anon/authenticated 전부 거부.
-- (그래서 Supabase 보안 어드바이저에 rls_enabled_no_policy INFO가 뜨는데, 의도된 상태다.)
-- 토큰 값은 발급 API 응답(app/api/widget/token)으로만 사용자에게 전달되고, 조회·검증은
-- service role(lib/supabase-admin.ts)로만 한다. 브라우저에서 이 테이블을 직접 읽을 수 있으면
-- 다른 사람 토큰까지 노출될 수 있으므로 클라이언트 접근 경로를 아예 만들지 않는 게 맞다.
alter table widget_tokens enable row level security;
