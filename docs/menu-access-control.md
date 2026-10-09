# 메뉴 접근통제 — 화면·API·DB 3단계

사이드바에서 메뉴를 숨기는 것은 접근통제가 아니다. 메뉴 권한(`allowed_users.menu_permissions`: none / read / write,
키가 없으면 write, **그 밖의 값은 none**)은 아래 세 곳에서 따로 확인한다.

| 단계 | 위치 | 하는 일 |
|---|---|---|
| 화면 | `app/(dashboard)/<메뉴>/layout.tsx` → `lib/auth/menuAccess.ts` `requireMenu(key)` | none이면 화면을 그리기 **전에** `/no-access`로 이동(직접 URL·앱 안 이동 모두). 페이지가 렌더되지 않으므로 데이터 요청도 없다 |
| API | 각 `app/api/**/route.ts` → `canUseMenu(key, need)` / 관리자 API는 `getAdminAccess()` | 서버에서 세션·권한 확인 후 403. 미래봇은 `chatMode()` — projects 권한만 본다(none 403, read 조회, write 실행) |
| DB | RLS (`private.menu_permission`, `private.menu_any_readable`) | 최종 방어. 메뉴 전용 표는 그 메뉴, 공용 표는 아래 매트릭스 |

- 비로그인: `proxy.ts`가 화면·API 모두 `/login`으로 보낸다.
- 미승인(allowed_users 행 없음): `/unauthorized`(접근 신청).
- 관리자: **DB `allowed_users.is_admin` 하나로만 판정**(화면·API·DB RLS·RPC `private.overtime_is_admin`·홈 위젯·캘린더 연동·시험 로그인 모두 같은 근거).
  is_admin = true면 menu_permissions 값과 무관하게 모든 메뉴 write. 서버가 매 요청 DB에서 읽고(`lib/auth/menuAccess.ts` `getMenuAccess`),
  클라이언트가 보낸 값은 쓰지 않는다. 화면 표시용 `useIsAdmin()`도 이 서버 값이다.
  환경변수 `ADMIN_EMAILS`는 어떤 인증·권한 판정에도 쓰지 않는다(변수 자체는 남아 있음 — `lib/auth/adminEmailsUsage.test.ts`가 고정).
  관리자 화면의 메뉴 권한 칸은 is_admin 계정이면 잠기고 "관리자는 전체 권한이며 메뉴별 설정이 적용되지 않습니다"를 보여 준다.
- 이메일 대조: 서버 코드는 세션 이메일을 소문자·trim해 `allowed_users.email`과 정확히 비교하고, DB 정책은 JWT email을 그대로 비교한다.
  allowed_users.email은 항상 소문자로 저장되므로 같은 행을 찾는다(대소문자 정책 변경은 별도 과제).
- 메뉴 권한 값 해석(한 곳: `lib/menuConfig.ts` `permissionFor`, DB: `private.menu_permission`·`private.menu_any_readable`):

  | 저장값 | 판정 |
  |---|---|
  | is_admin = true | write (값 무시) |
  | allowed_users 행 없음 | none (미승인) |
  | 키 없음 | write (기본값) |
  | 정확히 `none` / `read` / `write` | 그 값 |
  | 그 밖(`NONE`, `Read`, `''`, `" read"`, null, true, 객체 등) | **none** (모르는 값은 거부) |
  | menu_permissions 자체가 객체가 아님(배열 등) | none / jsonb null이면 키 없음과 같음(write) |

  TS·SQL 규칙 일치는 `lib/auth/permissionRuleSync.test.ts`가 SQL 본문을 해석해 확인한다.
- read/write 구분(쓰기 버튼 비활성)은 `PermissionsProvider`, 쓰기 차단은 RLS·API.
- 회귀 테스트: `lib/auth/menuAccess.test.ts`(판정·이동·미래봇·관리자 시나리오), `lib/auth/menuRoutes.test.ts`(모든 메뉴 폴더 가드·API 권한),
  `lib/auth/sharedTablesRls.test.ts`(공용 표 정책 ↔ 실제 소비 코드, migration 안전장치·되돌리기),
  `lib/auth/permissionRuleSync.test.ts`(TS ↔ SQL 권한 규칙), `lib/auth/adminEmailsUsage.test.ts`(ADMIN_EMAILS 미사용),
  `lib/auth/permissionValues.test.ts`(무효값), `lib/auth/adminScenarios.test.ts`(위젯 토큰·캘린더 관리자·시험 로그인 판정).

## 공용 표 읽기 매트릭스 (`supabase/migration_shared_project_tables_rls.sql`)

"그 표를 실제로 읽는 화면의 메뉴 중 하나라도 read 이상"이면 읽기 허용. 쓰기 정책은 바꾸지 않았다.

| 표 | 읽기 허용 메뉴 | 읽는 화면(브라우저) | 쓰기(변경 없음) |
|---|---|---|---|
| projects | projects · weekly · trip · attendance · lodging · interview_db · overtime | 프로젝트 List, 주간보고, 출장지원, 출근부, 숙박, 면접 DB, 연장근무(정렬·자동배정), 홈, 미래봇 | projects write |
| project_notes | projects · weekly | 프로젝트 List, 주간보고, 홈 | projects write |
| project_tooltips | projects · weekly · trip | 프로젝트 List, 주간보고(월간 쪽수), 출장지원(장소) | projects 또는 trip write (삭제는 projects) |
| performing_projects | weekly | 주간보고, 홈 | weekly write |
| expected_projects | weekly | 주간보고 | weekly write |
| weekly_meta | weekly | 주간보고 | weekly write |
| evaluation_types · _roles · _question_categories | interview_db | 면접 DB | interview_db write |

- 서버(service role) 소비자는 RLS와 무관: 내보내기 API, 연장근무 동기화, 홈 위젯 이미지(`lib/widget/summary.ts`), 구글 캘린더 동기화.
- `team_events`(홈 팀 일정)는 홈 전용 공개 데이터로 대상 아님.
- 2026-10 결정으로 이전 결정("공유 마스터 데이터 select는 인증 사용자 전체", `migration_shared_master_data_write_permission.sql` 주석)을 대체.

### 홈 화면 동작 (2026-10 결정: 현재 동작 수용)

홈(`/`)은 메뉴 키가 없다. 홈이 읽는 공용 표는 사용자의 관련 메뉴 권한만큼만 보인다.

| 홈 영역 | 읽는 표 | 보이려면 필요한 메뉴(read 이상) |
|---|---|---|
| 프로젝트 일정(제출·면접·개찰 등) | projects | projects · weekly · trip · attendance · lodging · interview_db · overtime 중 하나 |
| 프로젝트 비고 | project_notes (+ projects) | projects · weekly 중 하나 |
| 수행사업(주차별) | performing_projects | weekly |

- 관련 메뉴가 없으면 해당 영역이 **빈 상태**로 보인다(오류 아님). 예: 휴가관리·현장 현황만 있는 사용자는 위 세 영역이 모두 빈다.
- 홈을 위한 우회 조회 권한은 두지 않는다. 빈 영역을 숨기거나 안내 문구를 넣는 화면 수정도 하지 않았다(필요하면 별도 과제).
- 홈 위젯 이미지(`lib/widget/summary.ts`)는 서버(service role)로 읽으므로 이 정책의 영향을 받지 않는다.

### 열 단위 접근 — 향후 별도 과제 (2026-10 결정: 이번 범위 제외)

RLS는 행 단위다. 읽기가 허용된 메뉴의 사용자는 그 표의 **모든 열**을 읽는다
(예: overtime·attendance·lodging 사용자도 projects의 수수료·참여자 등 모든 열, trip 사용자도 project_tooltips의 모든 열).
열까지 제한하려면 아래 중 하나를 별도 과제로 진행한다 — 이번 작업에서는 뷰·RPC·화면·migration을 추가하지 않았다.

- 화면별 축약 뷰(필요 열만, 메뉴 조건 포함) 또는 SECURITY DEFINER RPC로 바꾸고, 해당 화면의 직접 표 조회를 교체
- 대상 우선순위 후보: 연장근무(projects의 번호·이름·제출일만), 출근부·숙박(일정·상태 열만), 출장(tooltips의 장소 열만)
- 교체 후 `projects` 등의 `menu_read` 허용 메뉴를 줄이고 `lib/auth/sharedTablesRls.test.ts` 매트릭스를 함께 갱신

## 적용 (운영은 별도 승인, 연장근무 migration과 독립)

0. **관리자 잠김 방지(코드 배포 전 필수)**: `supabase/verify/admin_flag_preflight.sql`(읽기 전용) — `is_admin = true` 계정이 1명 이상이어야 OK.
   파일 안 `my_email`을 본인 이메일로 바꿔 실행해 본인 계정이 `is_admin = true`인지도 확인한다(이메일을 파일에 저장하지 않는다).
   이번 배포부터 `ADMIN_EMAILS`에만 있던 계정은 관리자가 아니다(행이 없으면 미승인). 부족하면 운영자가 직접 `is_admin`을 켠 뒤 배포한다.
1. 읽기 전용 확인: `supabase/verify/shared_project_tables_rls_preflight.sql` — 기존 읽기 정책 이름·명령(SELECT)·역할·정의가 예상과 다르면 FAIL
2. 화면 코드(메뉴 가드·`/no-access`·API 권한·관리자 판정) 배포 — 0번 확인 후
3. `supabase/migration_allowed_users_rls_recursion_fix.sql` (allowed_users 재귀 수정)
4. `supabase/migration_shared_project_tables_rls.sql` — 기존 정의가 예상과 다르면 스스로 중단, 원래 정의는 백업표에 저장
5. 확인: `supabase/verify/shared_project_tables_rls_postflight.sql`, `supabase/verify/allowed_users_rls_postflight.sql`
6. 되돌리기: `supabase/verify/shared_project_tables_rls_rollback.sql`(백업에서 원래 정의를 명령·역할·USING·WITH CHECK 그대로 복원), `supabase/verify/allowed_users_rls_recursion_rollback.sql`

### 무효값 기본 거부 (`supabase/migration_menu_permission_strict.sql`)

- `private.menu_permission`·`private.menu_any_readable` 본문만 재정의(SECURITY DEFINER·STABLE·권한 그대로, search_path `pg_catalog, pg_temp` 고정). 재실행 가능.
- 순서: `migration_menu_permission_function.sql` 이후 언제든. 공용 표 보정(`migration_shared_project_tables_rls.sql`)보다 먼저든 나중이든 결과 본문이 같다
  (공용 표 migration의 menu_any_readable도 같은 규칙으로 갱신했다). 권장: 공용 표 보정 4번 다음.
- 적용 전 확인: 운영에 무효값이 저장돼 있으면 그 메뉴가 적용 직후 none이 된다 — 관리자 화면 저장 API는 none/read/write만 받으므로 보통 없다.
- 확인: `supabase/verify/menu_permission_strict_postflight.sql` / 되돌리기: `supabase/verify/menu_permission_strict_rollback.sql`
  (공용 표 보정 되돌리기는 menu_any_readable을 지우므로, 그 뒤에는 strict 되돌리기가 menu_any_readable을 만들지 않는다)
- 개발 DB 동작 시험: `supabase/dev/menu_permission_strict_check.sql`(시험 행은 하위 트랜잭션 안에서 넣고 끝에서 ROLLBACK)

개발 DB 검증: `supabase/dev/shared_project_tables_dev_setup.sql`(개발 DB에 없는 8개 표를 원래 정책으로 생성) →
`supabase/dev/shared_project_tables_rls_check.sql`(적용 전) → migration → postflight → check(적용 후).


**공용 표 정책 복원 시험(rollback → 재적용)** 전에는 개발 서버를 멈추고 개발 앱 브라우저 탭을 모두 닫는다. rollback부터 재적용 전까지
공용 표가 예전의 "로그인 사용자 전체 읽기" 정책으로 돌아가므로, 그 사이 요청이 들어오지 않게 하고 다른 사람이 개발 DB를 쓰지 않는지 확인한다.
순서(중간에 멈추지 않는다): `supabase/verify/shared_project_tables_rls_rollback.sql` → `supabase/verify/shared_project_tables_rls_preflight.sql`
→ `supabase/migration_shared_project_tables_rls.sql` → `supabase/verify/shared_project_tables_rls_postflight.sql`
→ `supabase/dev/shared_project_tables_rls_check.sql` → `supabase/verify/menu_permission_strict_postflight.sql`.
어느 파일이든 실패하면 다음 파일을 실행하지 말고 마지막 성공 단계와 실패 상태를 보고한다.