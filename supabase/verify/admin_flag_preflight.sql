-- 관리자 판정 단일화(DB allowed_users.is_admin) 배포 전 확인 — 읽기 전용, 운영·개발 모두. 결과: check_name / status / detail
--
-- 왜: 이번 배포부터 화면·API·위젯·캘린더·시험 로그인 모두 관리자를 allowed_users.is_admin 하나로만 판정한다.
--   환경변수 ADMIN_EMAILS에만 있고 is_admin = true가 아닌 계정은 배포 직후 관리자 권한을 잃는다
--   (allowed_users 행 자체가 없으면 미승인으로 /unauthorized). 그래서 배포 전에 관리자 행이 DB에 있는지 확인한다.
-- 개인정보: 이메일 목록을 출력하지 않는다(개수와 본인 확인 결과만).
--
-- 사용법
--   1) 그대로 실행 → "01 is_admin = true 계정 수"가 OK(1명 이상)인지 확인. FAIL이면 배포하지 않는다.
--   2) 본인 계정 확인: 아래 my_email의 'admin@example.com'을 본인 로그인 이메일(소문자)로 바꿔 실행한다.
--      이 파일에 실제 이메일을 저장·커밋하지 않는다(실행 후 되돌린다).
--   부족하면(운영자가 직접, 별도 승인 후): update public.allowed_users set is_admin = true where email = '<본인 이메일>';
with my_email(email) as (values
  ('admin@example.com')   -- ← 본인 로그인 이메일로 바꿔서 실행(예시 값 그대로면 "02"는 INFO)
),
admins as (
  select count(*) as n from public.allowed_users where is_admin is true
)
select * from (
  select '01 is_admin = true 계정 수' as check_name,
         case when (select n from admins) > 0 then 'OK' else 'FAIL' end as status,
         (select n from admins)::text || '명 — 0명이면 배포 후 관리자 화면(/admin)에 아무도 들어갈 수 없다' as detail
  union all
  select '02 본인 계정 is_admin',
         case when (select email from my_email) = 'admin@example.com' then 'INFO'
              when exists (select 1 from public.allowed_users u, my_email m where u.email = m.email and u.is_admin is true) then 'OK'
              else 'FAIL' end,
         case when (select email from my_email) = 'admin@example.com' then 'my_email을 본인 이메일로 바꿔 다시 실행한다'
              when exists (select 1 from public.allowed_users u, my_email m where u.email = m.email and u.is_admin is true) then 'allowed_users 행 있음, is_admin = true'
              when exists (select 1 from public.allowed_users u, my_email m where u.email = m.email) then 'allowed_users 행은 있으나 is_admin = false — 배포 후 일반 사용자가 된다'
              else 'allowed_users 행 없음 — 배포 후 미승인(/unauthorized)' end
  union all
  -- DB 쪽 판정 함수가 같은 근거(is_admin)를 쓰는지 — 참고용
  select '03 DB 관리자 판정 함수',
         'INFO',
         'menu_permission=' || case when to_regprocedure('private.menu_permission(text)') is null then '없음' else '있음' end
         || ' overtime_is_admin=' || case when exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                                                        where n.nspname = 'private' and p.proname = 'overtime_is_admin') then '있음' else '없음' end
) x
order by 1;
