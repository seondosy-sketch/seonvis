# 메뉴 접근통제 — 화면·API·DB 3단계

사이드바에서 메뉴를 숨기는 것은 접근통제가 아니다. 메뉴 권한(`allowed_users.menu_permissions`: none / read / write,
키가 없으면 write)은 아래 세 곳에서 따로 확인한다.

| 단계 | 위치 | 하는 일 |
|---|---|---|
| 화면 | `app/(dashboard)/<메뉴>/layout.tsx` → `lib/auth/menuAccess.ts` `requireMenu(key)` | none이면 화면을 그리기 **전에** `/no-access`로 이동(직접 URL·앱 안 이동 모두). 페이지가 렌더되지 않으므로 데이터 요청도 없다 |
| API | 각 `app/api/**/route.ts` | 서버에서 세션·권한 확인 후 403. 미래봇은 `chatMode()` — projects 권한만 본다(none 403, read 조회, write 실행) |
| DB | RLS (`private.menu_permission`, `private.menu_any_readable`) | 최종 방어. 메뉴 전용 표는 그 메뉴, 공용 표는 아래 매트릭스 |

- 비로그인: `proxy.ts`가 화면·API 모두 `/login`으로 보낸다.
- 미승인(allowed_users 행 없음): `/unauthorized`(접근 신청).
- 관리자: 화면은 `ADMIN_EMAILS`(전체 write), DB는 `allowed_users.is_admin`(전체). 내보내기·가져오기 API는 둘 다 허용.
- read/write 구분(쓰기 버튼 비활성)은 `PermissionsProvider`, 쓰기 차단은 RLS·API.
- 회귀 테스트: `lib/auth/menuAccess.test.ts`(판정·이동·미래봇), `lib/auth/menuRoutes.test.ts`(모든 메뉴 폴더 가드·API 권한),
  `lib/auth/sharedTablesRls.test.ts`(공용 표 정책 ↔ 실제 소비 코드).

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

1. 읽기 전용 확인: `supabase/verify/shared_project_tables_rls_preflight.sql` — 기존 읽기 정책 이름·정의가 예상과 다르면 FAIL
2. 화면 코드(메뉴 가드·`/no-access`·API 권한) 배포 — DB 변경과 무관하게 먼저 배포해도 된다
3. `supabase/migration_allowed_users_rls_recursion_fix.sql` (allowed_users 재귀 수정)
4. `supabase/migration_shared_project_tables_rls.sql` — 기존 정의가 예상과 다르면 스스로 중단, 원래 정의는 백업표에 저장
5. 확인: `supabase/verify/shared_project_tables_rls_postflight.sql`, `supabase/verify/allowed_users_rls_postflight.sql`
6. 되돌리기: `supabase/verify/shared_project_tables_rls_rollback.sql`(백업에서 원래 정의 복원), `supabase/verify/allowed_users_rls_recursion_rollback.sql`

개발 DB 검증: `supabase/dev/shared_project_tables_dev_setup.sql`(개발 DB에 없는 8개 표를 원래 정책으로 생성) →
`supabase/dev/shared_project_tables_rls_check.sql`(적용 전) → migration → postflight → check(적용 후).
