# 기술인 출근부 — 구현 단계별 계획

> 마스터 프롬프트 14번이 지시한 7단계 구조를 그대로 채택한다. **각 Phase는 승인 후 하나씩 순서대로 진행하며,
> 이전 Phase 완료·보고 없이 다음 Phase로 임의로 넘어가지 않는다**(연장근무 기능의 진행 원칙과 동일,
> `docs/overtime.md` 최상단 "8단계로 나누어 진행" 원칙 재사용). 각 Phase 완료 시 구현내용/수정파일/DB변경/테스트결과/한계/수동확인사항을 보고한다.

---

## Phase 1 — 공통 기간 계산 및 데이터 모델

**목표**: DB 스키마 확정 + 연간 기간 계산 유틸.

| 작업 | 파일 |
|---|---|
| 마이그레이션 | `supabase/migration_attendance.sql` (7개 신규 테이블, `03-data-model.md` 전체) |
| DB 문서 갱신 | `docs/database.md`에 신규 테이블 7종 추가 |
| 도메인 타입 | `lib/attendance/types.ts` (`ProjectParticipant`, `AttendanceRecord`, `MonthClosure`, `ClosureSnapshotRow`, `ProjectChangeHistory`) — 기존 관례대로 컬럼명 1:1, camelCase 변환 없음 |
| 연간 기간 유틸 | `lib/overtime/summary.ts`에 `annualPeriodRange(year)`(전년도 12/21~해당연도 12/20, `Open Question #1` 해결 후 확정) 추가 — **연장근무 파일에 함께 둔다**(기존 `payPeriodDays`와 같은 "회계기간" 개념이라 별도 `lib/attendance/`로 분리하면 같은 로직이 두 곳에 존재하는 것처럼 보일 위험. 대안: `lib/period/` 신규 공용 모듈로 승격하고 연장근무 쪽 import도 갱신 — Phase 1 착수 시 확정) |
| 메뉴 권한 키 | `lib/menuConfig.ts`의 `RESTRICTABLE_MENU_ITEMS`에 `attendance` 추가 |
| 마감 권한 컬럼 | `supabase/migration_attendance.sql`에 `allowed_users.can_close_attendance` 포함(Open Question #6 확정안 반영) |

**의존 확정 필요**: Phase 1 착수 전 `02-requirements.md`/`03-data-model.md`의 Open Question(특히 #1 연간범위, #6 마감권한, `03-data-model.md` #1 is_present 방식)이 확정돼야 마이그레이션 컬럼이 최종 확정된다.

---

## Phase 2 — 월별 출근부 기본 화면

| 작업 | 파일 |
|---|---|
| 페이지 | `app/(dashboard)/attendance/page.tsx` |
| 그리드 | `app/(dashboard)/attendance/_components/AttendanceGrid.tsx`(연장근무 `ProjectGrid.tsx` 구조 응용) |
| 참여기술인 관리 모달 | `app/(dashboard)/attendance/_components/ParticipantManagerModal.tsx`(Project List 프로젝트 선택 + 기술인 검색·추가, 연장근무 `ProjectManagerModal` 패턴) |
| 셀 토글 로직 | 그리드 내부(팝오버 없이 즉시 토글, `04-ui-flow.md` §2.3) |
| 집계 유틸 | `lib/attendance/summary.ts` (`presentCount`, 필터링 헬퍼) |
| 필터/검색 | 프로젝트명·상태·분야·기술인명 — `projects`/`project_participants` 조인 쿼리 |

**Project List 연계 조회(Confirmed 방식)**: 페이지 로드 시 (a) 선택 기간과 겹치는 프로젝트를 `projects`에서 조회(공고일 ≤ 기간끝 AND (면접일 없음 OR 면접일 ≥ 기간시작) — 연장근무 `syncBidProjects`의 겹침 조건과 동일 로직 재사용, 단 별도 mirror 테이블(`overtime_projects` 같은)은 만들지 않고 `projects`를 직접 조회), (b) 그 프로젝트들의 `project_participants`(status='진행중' 우선 + 그 기간에 걸치는 종료 참여자)를 조회.

---

## Phase 3 — 비고 및 프로젝트 변경이력

| 작업 | 파일 |
|---|---|
| 변경이력 CRUD | `_components/ProjectChangeHistoryModal.tsx` |
| 비고 조립 유틸 | `lib/attendance/changeHistory.ts` (`formatChangeHistoryForPeriod(records, start, end)` → 마스터 프롬프트 예시 포맷 문자열 배열) |
| Project List 연동 지점 검토 | `app/(dashboard)/projects/page.tsx`에 "변경이력 보기" 진입점을 추가할지 여부(Proposed, 필수 아님 — 출근부 쪽에서만 먼저 노출해도 요구사항 충족) |

---

## Phase 4 — 월 마감

| 작업 | 파일 |
|---|---|
| 마감 전 검증 | `lib/attendance/closeValidation.ts` — 마스터 프롬프트 7번의 오류/경고 목록을 함수로 구현, 반환 타입 `{ errors: Issue[], warnings: Issue[] }` |
| 마감 실행 | `_components/CloseMonthButton.tsx` → 검증 통과 시 `attendance_month_closures` insert + `attendance_closure_snapshot_rows` 일괄 insert(스냅샷 조립) |
| 마감취소 | `_components/ReopenMonthModal.tsx` — 사유 필수 입력 폼 + `attendance_audit_log` insert |
| 감사이력 조회(관리자) | Phase 7의 권한 작업과 함께 필요 시 `/admin` 하위에 뷰 추가(Proposed, 1차 범위에서는 DB 조회만으로 충분할 수 있음 — Open Question) |

---

## Phase 5 — 월별 Excel 출력

| 작업 | 파일 |
|---|---|
| 의존성 추가 | `package.json`에 `exceljs` (Open Question, `05-export-spec.md` §1 승인 후) |
| 워크북 조립 | `lib/attendance/export/monthlyWorkbook.ts` — `05-export-spec.md` §2 레이아웃 그대로 구현 |
| API Route | `app/api/attendance/export/route.ts` (월별) |
| 인쇄 미리보기 | `app/(dashboard)/attendance/print/page.tsx` |

---

## Phase 6 — 연간 통합 명부

| 작업 | 파일 |
|---|---|
| 연간 조회 화면 | `app/(dashboard)/attendance/annual/page.tsx` |
| 가상 스크롤 그리드 | `_components/AnnualGrid.tsx`(Phase 7 성능 작업과 맞물림 — 가상 스크롤 라이브러리 도입 여부는 Phase 7에서 최종 결정, 여기서는 데이터 조립까지) |
| 스냅샷 조립 공용 함수 | `lib/attendance/annual.ts` — 연간 화면과 연간 출력이 공유(§`04-ui-flow.md` §3) |
| 연간 워크북 | `lib/attendance/export/annualWorkbook.ts` |
| API Route | `app/api/attendance/export/annual/route.ts` |

---

## Phase 7 — 권한, 성능 및 최종 검증

| 작업 | 내용 |
|---|---|
| 권한 게이팅 전면 적용 | `04-ui-flow.md` §5 표대로 버튼/셀 노출 조건 전면 점검 |
| 가상 스크롤 도입 | 연간 그리드 365~376열 — 라이브러리 후보 검토(신규 의존성 여부는 그 시점에 별도 Open Question으로 제기) |
| 회귀 테스트 | `07-test-plan.md` 회귀 목록 실행 — Project List, 연장근무, 기존 출력 기능, 기술인 관리 |
| 실사용 흐름 검증 | 실제 Excel 출력물을 열어 음영·병합·인쇄영역·비고 수동 확인(마스터 프롬프트 16번 완료 기준) |

---

## 부록 — Phase별 선행 확정 필요 Open Question 매핑

| Phase | 선행 확정 필요 항목 |
|---|---|
| 1 | `02-requirements.md` #1(연간범위), `03-data-model.md` #1(is_present), #3(마감권한) |
| 2 | `02-requirements.md` #3(면접일 미입력 처리) |
| 3 | `02-requirements.md` #2(재공고/변경공고 저장 위치), #5(비고 화면 분리) |
| 4 | `03-data-model.md` #3(마감권한) |
| 5 | `05-export-spec.md` §1(exceljs 의존성 승인) |
| 6 | `02-requirements.md` #1(연간범위) |
| 7 | (없음 — 이전 단계 확정사항을 검증만) |
