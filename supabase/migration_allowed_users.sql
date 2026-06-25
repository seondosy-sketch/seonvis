-- 승인된 사용자 테이블
create table if not exists allowed_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  is_admin boolean not null default false,
  added_by_email text,
  created_at timestamptz default now()
);

-- RLS 활성화
alter table allowed_users enable row level security;

-- 로그인한 사용자는 자신의 행을 조회 가능 (승인 여부 확인용)
create policy "users_read_own" on allowed_users
  for select using (auth.jwt() ->> 'email' = email);

-- 관리자는 전체 조회 가능
create policy "admins_read_all" on allowed_users
  for select using (
    exists (
      select 1 from allowed_users
      where email = auth.jwt() ->> 'email' and is_admin = true
    )
  );

-- 쓰기는 service role만 가능 (API route에서 처리)
