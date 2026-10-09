# 연장근무 개편 — 운영 적용 체크리스트

운영 project ref `lkvb…odrt`. 개발 `zaot…iyas`에서 Phase 4 검증 완료(2026-10-07).
모든 단계는 별도 승인 후 진행한다. 표의 "확인"은 읽기 전용 SQL이며 결과를 저장해 둔다.

## 적용 순서 (요약)

| 단계 | 내용 | 파일 | 화면 영향 |
|---|---|---|---|
| 0 | 읽기 전용 baseline (+ 관리자 플래그 사전 확인) | `supabase/verify/overtime_planning_catalog.sql`, `overtime_planning_preflight.sql`, `supabase/verify/admin_flag_preflight.sql` | 없음 |
| 0-1 | (p10·p11 STOP일 때만) 직원 수동 연결 → preflight 재실행 | `supabase/verify/overtime_employee_link_check.sql` (읽기만) | 없음 |
| 1 | Migration A (표·칸·sync_team_employees 교체) | `supabase/migration_overtime_planning_a_base.sql` | 구버전 화면 그대로 동작 |
| 2 | 동기화 RPC | `supabase/migration_overtime_project_sync_rpc.sql` | 구버전 화면 무관 |
| 3 | 월 목표 선입력 (해당·다음 급여기간) → 선입력 확인 | `supabase/prod/overtime_monthly_targets_1_list.sql` → `_2_apply.sql` → `supabase/verify/overtime_monthly_target_precheck.sql` | 없음(강제조건 전) |
| 4 | 신버전 화면 배포 | (commit·배포) | 신버전 |
| 5 | Migration B (보호·주 12시간·자동배정 RPC) — 4 직후 | `supabase/migration_overtime_planning_b_activate.sql` | 자동배정 사용 가능 |
| 6 | 월 목표 강제조건 + 격리수준 방어(한 트랜잭션) — 직전 precheck 다시 OK | `supabase/prod/overtime_monthly_target_activation.sql` | 목표 없는 입력 차단 시작 |
| 7 | Migration C (확정·공휴일·직원 연결 보정) | `supabase/migration_overtime_planning_c_corrections.sql` | 없음(운영 B가 이미 수정본이면 no-op) |
| 8 | 공용 표 RLS·관리자·메뉴 권한 (4 코드 배포 뒤, 아래 순서) | 아래 "8. 공용 권한 단계" | 권한 판정이 DB 기준으로 |

원본 `migration_overtime_monthly_target_guard.sql`·`migration_overtime_cap_isolation_guard.sql`을 운영에 따로 적용하지 않는다(6의 통합 파일 사용).

**Migration C의 위치**: 운영은 A·B를 처음 적용하므로 5의 B 파일에 C의 수정(초안 트리거·확정·저장 RPC)이, 1의 A 파일에
직원 분리 방지(sync_team_employees)가 이미 들어 있다. 7의 C는 같은 본문을 다시 쓰는 no-op이지만 개발 DB와 같은 이력을 남기고
`overtime_planning_c_postflight.sql`로 수정본이 실제로 들어갔는지 확인하려고 실행한다. 화면 배포(4)와의 호환: 화면이 보내는
`is_holiday` 키는 수정 전 저장 RPC가 무시하므로 4·5·7 사이 어느 시점에도 깨지지 않는다.

## 0. 적용 전 baseline (읽기 전용)

- [ ] project ref가 운영(`lkvb…odrt`)인지 화면 주소로 확인
- [ ] schema/object 충돌: 새 표 4개·함수·트리거·정책 이름이 아직 없음 (`overtime_planning_preflight.sql`)
- [ ] `overtime_work_records` 행 수 — 2026-10-03 기준 0건. **1단계 직전과 6단계 직전에 다시** 센다
- [ ] 주 12시간 초과 주(weeks_over_12h) 0건 — 5단계 직전 재확인
- [ ] 재직 직원 수(9명 예상)와 주소록 연결: `engineer_contacts.employee_id` 중복 0
- [ ] **직원 분리 위험**: preflight `p10_unlinked_active_employees`(주소록 미연결 재직 직원)와 `p11_unlinked_team_contacts`
      (미연결 미래사업팀 주소록)가 둘 다 0보다 크면 둘 다 STOP. 이 상태에서는 A·C와 `sync_team_employees`가
      `OVERTIME_EMPLOYEE_LINK_REQUIRED`로 아무것도 바꾸지 않고 멈춘다(자동 이름 매칭 없음).
      → `supabase/verify/overtime_employee_link_check.sql`로 UUID 목록을 보고(이름은 화면 확인용, 내보내지 않음) 주소록 행의
      `employee_id`에 기존 직원 UUID를 사람이 한 행씩 지정(별도 승인) → preflight 다시 실행해 p10·p11 STOP 없음 확인.
      한쪽만 있으면 기존 규칙: p11만 → 첫 동기화가 새 직원 행 생성·연결 / p10만 → 주소록에 미래사업팀 재직자가 1명 이상일 때 비활성(행·기록 보존)
- [ ] 공휴일 보유 연도: 2026 16건. **2027년 미등록 → 2026-12 급여기간(11/21~12/20)까지만 자동배정 가능**, 2027-01 급여기간(12/21~)부터는 엔진이 전체 차단. 휴가관리에서 2027 공휴일 등록 필요
- [ ] 프로젝트 List 날짜 이상: 공고일 없음·제출일<공고일·면접일 미정+개찰 경과 건수 (Phase 1 감사 쿼리) — 화면 '확인 필요' 목록과 대조
- [ ] 같은 이름 직원 수(동명이인) — A 적용 후 이름 UNIQUE가 빠진다
- [ ] 관리자 플래그(읽기 전용, 4단계 코드 배포 **전**에도 한 번): `supabase/verify/admin_flag_preflight.sql` — 관리자는 DB의
      `allowed_users.is_admin = true`여야 한다. 새 코드에서는 `ADMIN_EMAILS`가 더 이상 관리자 권한을 주지 않는다

## 단계별 적용 후 확인

| 단계 | 확인 | 되돌리기 판단 기준 | 되돌리기 |
|---|---|---|---|
| 1 A | `overtime_planning_postflight_a.sql` 전부 OK(a16~a21 직원 UUID 보존 포함), 구버전 화면 입력·출력 정상. 첫 동기화(화면 진입) 뒤 postflight_a 한 번 더(B 적용 전까지만 — B 이후에는 `overtime_planning_current_postflight.sql`) | postflight FAIL 또는 구버전 입력 오류 | `overtime_planning_rollback_a.sql` (새 표가 비어 있을 때만) |
| 2 RPC | 함수 존재·EXECUTE는 service_role만 | 권한 FAIL | `overtime_project_sync_rpc_rollback.sql` (화면을 구버전으로 되돌린 뒤) |
| 3 목표 | `_2_apply.sql` 결과 전부 OK, 재직 9명 = 목표 9행, `overtime_monthly_target_precheck.sql` FAIL 0 | 값 오입력 | `_3_rollback.sql` (6단계 전만) |
| 4 화면 | 아래 smoke test | 화면 오류·데이터 이상 | 이전 배포로 되돌림(DB는 A·RPC 상태에서 구버전과 호환) |
| 5 B | `overtime_planning_postflight_b.sql` 전부 OK | FAIL, 수동 입력 오차단 | `overtime_planning_rollback_b.sql` (자동배정 데이터 없고 월 목표 강제조건이 없을 때만) |
| 6 월 목표 | 직전 `overtime_monthly_target_precheck.sql` FAIL 0 → 적용 → `overtime_monthly_target_postflight.sql` 전부 OK(isolation_guard 포함) | 목표 입력된 직원이 막힘 | `overtime_cap_isolation_guard_rollback.sql` → `overtime_monthly_target_rollback.sql` |
| 7 C | 직전 `overtime_planning_c_preflight.sql` STOP 없음 → 적용 → `overtime_planning_c_postflight.sql` 전부 OK·INFO → `overtime_planning_current_postflight.sql`(현재 상태 전체) 전부 OK·INFO, FAIL 0 | FAIL, 확정·확정취소 오류 | `overtime_planning_c_rollback.sql` |
| 8 권한 | 아래 8단계 postflight 3개 | 관리자 화면·로그인·메뉴 접근 이상 | 아래 8단계 되돌리기(역순) |

**전체 되돌리기 순서(연장근무)** — 앞 단계가 남아 있으면 뒤 단계 파일이 스스로 멈춘다:

되돌리기 순서: overtime_planning_c_rollback → overtime_cap_isolation_guard_rollback → overtime_monthly_target_rollback → overtime_planning_rollback_b → overtime_project_sync_rpc_rollback → overtime_planning_rollback_a

- 격리수준 되돌리기가 **먼저**, 월 목표 되돌리기가 그다음이다. (예전 문서의 반대 순서는 격리수준 되돌리기가
  `private.overtime_assert_monthly_target`을 되살려 A 되돌리기가 멈췄다. 지금 격리수준 되돌리기는 함수가 있을 때만 바꾼다.)
- B 되돌리기는 자동배정 데이터가 있거나 월 목표 강제조건이 남아 있으면 멈춘다. A 되돌리기는 월 목표 강제조건·새 표 데이터가 있으면 멈춘다.
- 동기화 RPC 되돌리기는 A·B와 독립(위치는 B 뒤·A 앞), 화면을 구버전으로 되돌린 뒤에만.
- 개발 DB 리허설: `supabase/dev/overtime_rollback_rehearsal_*.sql` (개발 데이터 삭제 포함 — 파일 맨 위 경고).

## 8. 공용 권한 단계 (4단계 코드 배포 뒤, 이 순서로)

| 순서 | 파일 | 확인 |
|---|---|---|
| 8-1 | `supabase/verify/admin_flag_preflight.sql` (읽기 전용) | 관리자 전원 `allowed_users.is_admin = true` — `ADMIN_EMAILS`는 더 이상 관리자 권한을 주지 않는다 |
| 8-2 | `supabase/migration_allowed_users_rls_recursion_fix.sql` | — |
| 8-3 | `supabase/verify/shared_project_tables_rls_preflight.sql` (읽기 전용) | STOP 없음 |
| 8-4 | `supabase/migration_shared_project_tables_rls.sql` | — |
| 8-5 | `supabase/migration_menu_permission_strict.sql` | — |
| 8-6 | postflight: `supabase/verify/allowed_users_rls_postflight.sql`, `supabase/verify/shared_project_tables_rls_postflight.sql`, `supabase/verify/menu_permission_strict_postflight.sql` | 전부 OK |

되돌리기(역순): `supabase/verify/menu_permission_strict_rollback.sql` → `supabase/verify/shared_project_tables_rls_rollback.sql` → `supabase/verify/allowed_users_rls_recursion_rollback.sql`.
연장근무 되돌리기와는 독립이다(서로의 객체를 건드리지 않는다).

## 화면 smoke test (4·5·6단계 후)

- [ ] 일반 사용자(overtime write): 메인 화면, 자동배정 화면 접근, 관리자 메뉴·확정 취소 버튼 없음
- [ ] 읽기 사용자(overtime read): 입력·저장 버튼 없음, 자동배정 설정 입력칸 비활성
- [ ] 관리자: 확정 취소(직원별·전체) 버튼 보임
- [ ] 프로젝트 동기화: 화면 열 때 `POST /api/overtime/sync-projects` 200, 확인 필요 목록 표시
- [ ] 수동 입력: 목표 안 입력 저장·수정·삭제 정상 / 목표 없음·목표 초과·주 12시간 초과 차단 문구(급여기간·목표·현재·입력 후·초과)
- [ ] 자동배정: 미리보기 → 초안 저장 → 직원별 확정 → 전체 확정 → (관리자) 직원별·전체 취소 → 수동 기록 보존
- [ ] 자동확정 기록: 화면에서 수정·삭제 불가 표시
- [ ] (7단계 후) 공휴일이 바뀐 날: 바뀌기 전 미리보기를 저장하면 "공휴일 정보가 바뀌었습니다" 안내(OVERTIME_HOLIDAY_CHANGED), 확정분은 공휴일이 다시 바뀌어도 관리자 확정 취소 가능 — 개발 DB 검증은 `supabase/dev/overtime_confirm_holiday_test.sql`
- [ ] 네트워크: 브라우저 요청이 운영 Supabase 한 곳과 앱 서버만, 콘솔 오류 없음

## 배포 후 모니터링 (첫 1주)

- 서버 로그 `[overtime sync] read failed / apply failed` 건수
- 화면 오류 문구 "저장 중 문제가 생겼습니다"(알 수 없는 DB 오류) 신고
- 급여기간 경계(20일→21일) 전에 다음 급여기간 목표 입력 여부 — 없으면 21일부터 수동 입력 차단
- `overtime_assignment_runs` 상태별 건수, `source='auto'` 기록 수, 주 12시간 초과 주 0건 유지
- 구버전 화면 탭(배포 전부터 열려 있던 탭)이 예전 방식으로 프로젝트를 동기화하지 않는지 — 배포 공지에 "새로고침" 안내
