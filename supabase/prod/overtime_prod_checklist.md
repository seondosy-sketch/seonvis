# 연장근무 개편 — 운영 적용 체크리스트

운영 project ref `lkvb…odrt`. 개발 `zaot…iyas`에서 Phase 4 검증 완료(2026-10-07).
모든 단계는 별도 승인 후 진행한다. 표의 "확인"은 읽기 전용 SQL이며 결과를 저장해 둔다.

## 적용 순서 (요약)

| 단계 | 내용 | 파일 | 화면 영향 |
|---|---|---|---|
| 0 | 읽기 전용 baseline | `supabase/verify/overtime_planning_catalog.sql`, `overtime_planning_preflight.sql` | 없음 |
| 1 | Migration A (표·칸·sync_team_employees 교체) | `supabase/migration_overtime_planning_a_base.sql` | 구버전 화면 그대로 동작 |
| 2 | 동기화 RPC | `supabase/migration_overtime_project_sync_rpc.sql` | 구버전 화면 무관 |
| 3 | 월 목표 선입력 (해당·다음 급여기간) | `supabase/prod/overtime_monthly_targets_1_list.sql` → `_2_apply.sql` | 없음(강제조건 전) |
| 4 | 신버전 화면 배포 | (commit·배포) | 신버전 |
| 5 | Migration B (보호·주 12시간·자동배정 RPC) — 4 직후 | `supabase/migration_overtime_planning_b_activate.sql` | 자동배정 사용 가능 |
| 6 | 월 목표 강제조건 + 격리수준 방어(한 트랜잭션) | `supabase/prod/overtime_monthly_target_activation.sql` | 목표 없는 입력 차단 시작 |
| 7 | (선택·독립) allowed_users RLS 재귀 수정 | `supabase/migration_allowed_users_rls_recursion_fix.sql` | 없음(앱은 service role로 읽음) |

원본 `migration_overtime_monthly_target_guard.sql`·`migration_overtime_cap_isolation_guard.sql`을 운영에 따로 적용하지 않는다(6의 통합 파일 사용).

## 0. 적용 전 baseline (읽기 전용)

- [ ] project ref가 운영(`lkvb…odrt`)인지 화면 주소로 확인
- [ ] schema/object 충돌: 새 표 4개·함수·트리거·정책 이름이 아직 없음 (`overtime_planning_preflight.sql`)
- [ ] `overtime_work_records` 행 수 — 2026-10-03 기준 0건. **1단계 직전과 6단계 직전에 다시** 센다
- [ ] 주 12시간 초과 주(weeks_over_12h) 0건 — 5단계 직전 재확인
- [ ] 재직 직원 수(9명 예상)와 주소록 연결: `engineer_contacts.employee_id` 중복 0
- [ ] 공휴일 보유 연도: 2026 16건. **2027년 미등록 → 2026-12 급여기간(11/21~12/20)까지만 자동배정 가능**, 2027-01 급여기간(12/21~)부터는 엔진이 전체 차단. 휴가관리에서 2027 공휴일 등록 필요
- [ ] 프로젝트 List 날짜 이상: 공고일 없음·제출일<공고일·면접일 미정+개찰 경과 건수 (Phase 1 감사 쿼리) — 화면 '확인 필요' 목록과 대조
- [ ] 같은 이름 직원 수(동명이인) — A 적용 후 이름 UNIQUE가 빠진다

## 단계별 적용 후 확인

| 단계 | 확인 | 되돌리기 판단 기준 | 되돌리기 |
|---|---|---|---|
| 1 A | `overtime_planning_postflight_a.sql` 전부 OK, 구버전 화면 입력·출력 정상 | postflight FAIL 또는 구버전 입력 오류 | `overtime_planning_rollback_a.sql` (새 표가 비어 있을 때만) |
| 2 RPC | 함수 존재·EXECUTE는 service_role만 | 권한 FAIL | `overtime_project_sync_rpc_rollback.sql` (화면을 구버전으로 되돌린 뒤) |
| 3 목표 | `_2_apply.sql` 결과 전부 OK, 재직 9명 = 목표 9행 | 값 오입력 | `_3_rollback.sql` (6단계 전만) |
| 4 화면 | 아래 smoke test | 화면 오류·데이터 이상 | 이전 배포로 되돌림(DB는 A·RPC 상태에서 구버전과 호환) |
| 5 B | `overtime_planning_postflight_b.sql` 전부 OK | FAIL, 수동 입력 오차단 | `overtime_planning_rollback_b.sql` (자동배정 데이터 없을 때만) |
| 6 월 목표 | `overtime_monthly_target_postflight.sql` 전부 OK(isolation_guard 포함) | 목표 입력된 직원이 막힘 | `overtime_monthly_target_rollback.sql` → `overtime_cap_isolation_guard_rollback.sql` |
| 7 RLS | `allowed_users` 정책 2개 USING 확인 | 관리자 화면·로그인 이상 | `allowed_users_rls_recursion_rollback.sql` |

되돌리기는 역순(6 → 5 → 2 → 1). A 되돌리기는 월 목표 강제조건이 남아 있으면 스스로 중단한다.

## 화면 smoke test (4·5·6단계 후)

- [ ] 일반 사용자(overtime write): 메인 화면, 자동배정 화면 접근, 관리자 메뉴·확정 취소 버튼 없음
- [ ] 읽기 사용자(overtime read): 입력·저장 버튼 없음, 자동배정 설정 입력칸 비활성
- [ ] 관리자: 확정 취소(직원별·전체) 버튼 보임
- [ ] 프로젝트 동기화: 화면 열 때 `POST /api/overtime/sync-projects` 200, 확인 필요 목록 표시
- [ ] 수동 입력: 목표 안 입력 저장·수정·삭제 정상 / 목표 없음·목표 초과·주 12시간 초과 차단 문구(급여기간·목표·현재·입력 후·초과)
- [ ] 자동배정: 미리보기 → 초안 저장 → 직원별 확정 → 전체 확정 → (관리자) 직원별·전체 취소 → 수동 기록 보존
- [ ] 자동확정 기록: 화면에서 수정·삭제 불가 표시
- [ ] 네트워크: 브라우저 요청이 운영 Supabase 한 곳과 앱 서버만, 콘솔 오류 없음

## 배포 후 모니터링 (첫 1주)

- 서버 로그 `[overtime sync] read failed / apply failed` 건수
- 화면 오류 문구 "저장 중 문제가 생겼습니다"(알 수 없는 DB 오류) 신고
- 급여기간 경계(20일→21일) 전에 다음 급여기간 목표 입력 여부 — 없으면 21일부터 수동 입력 차단
- `overtime_assignment_runs` 상태별 건수, `source='auto'` 기록 수, 주 12시간 초과 주 0건 유지
- 구버전 화면 탭(배포 전부터 열려 있던 탭)이 예전 방식으로 프로젝트를 동기화하지 않는지 — 배포 공지에 "새로고침" 안내
