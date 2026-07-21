# 데이터베이스 (Supabase)

## 테이블 목록

| 테이블 | 용도 |
|---|---|
| `projects` | 프로젝트 마스터 (입찰 현황) |
| `project_tooltips` | 프로젝트 공고 상세 정보 |
| `project_notes` | 셀 단위 메모 |
| `performing_projects` | 주간보고용 수행 프로젝트 |
| `expected_projects` | 주간보고용 발주예상 프로젝트 |
| `weekly_meta` | 주간보고 교육참가자/기타 메타 |
| `allowed_users` | 접근 허용 사용자 목록 |
| `overtime_employees` | 직원 목록 (연장근무·휴가관리 공용) |
| `overtime_employee_tasks` | 직원별 기본업무내용(자주 쓰는 업무) 목록 — 근무입력 드롭박스 기초자료 |
| `overtime_projects` | 연장근무 관리용 프로젝트 목록 (입찰 현황 `projects`에서 자동 동기화 + 수동 등록) |
| `overtime_project_members` | 프로젝트별 담당직원 배정 (체크) — 향후 프로젝트별 인원·근무일 표기 기초자료 |
| `overtime_work_records` | 연장근무 업무 1건 = 행 1개 (핵심 테이블) |
| `leave_types` | 휴가 유형 (연차/반차/경조 등, 차감 여부·단위) |
| `annual_leave_balances` | 직원·연도별 연차 부여(기본+조정) |
| `annual_leave_balance_history` | 연차 부여/조정 수정 이력 |
| `leave_records` | 휴가 1건 (원본) |
| `leave_record_dates` | 휴가의 날짜별 전개 — 집계·중복검증·월 셀 상세의 기준 |
| `holidays` | 법정공휴일 + 회사휴무 (차감 제외일, 오프라인 동작) |
| `engineer_contacts` | 기술인 주소록 (외부 기술인력 풀 — 내부 직원과 별도) |
| `engineer_specialties` | 기술인 전문분야 마스터 |
| `engineer_contact_specialties` | 기술인별 전문분야 다중 지정 |
| `engineer_sync_logs` | 향후 엑셀 동기화 실행 이력 (구조 예약) |
| `sites` | 현장 현황 (현재 운영 중인 현장 기본정보 대장) |
| `site_sync_logs` | 향후 엑셀 동기화 실행 이력 (구조 예약) |
| `project_participants` | 기술인 출근부 — 프로젝트 참여기술인 (projects × engineer_contacts 연결) |
| `attendance_records` | 기술인 출근부 — 출근기록 핵심 테이블 (레코드 존재 = 출근) |
| `attendance_month_closures` | 기술인 출근부 — 월 마감(마감 시도마다 버전이 쌓이는 append-only 이력) |
| `attendance_closure_snapshot_rows` | 기술인 출근부 — 마감 시점 스냅샷 |
| `project_change_history` | 기술인 출근부 — 프로젝트 변경이력(재공고/변경공고/취소 등의 공식 원본) |
| `attendance_audit_log` | 기술인 출근부 — 마감취소·과거기록수정 등 감사이력 |

---

## projects

프로젝트 입찰 현황 마스터 테이블.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | uuid PK | |
| `project_number` | text default `''` | 프로젝트 번호 (예: A001) |
| `type` | text, CHECK(`면접`\|`SOQ`\|`종심제`\|`TP`\|`PQ`\|`기타`\|`''`) | |
| `client` | text default `''` | 발주처 |
| `name` | text | 용역명 |
| `fee` | numeric (nullable) | 용역비(억) |
| `tp_score` | text default `''` | TP 점수 |
| `duration_days` | text default `''` | 용역 기간 |
| `announce_date` | text (nullable) | 공고일. **이 컬럼만 아직 text**(YYYY-MM-DD 저장) |
| `submit_date` | **date** (nullable) | 제출일 |
| `interview_date` | **date** (nullable) | 발표/면접일 |
| `bid_date` | **date** (nullable) | 개찰일 |
| `status` | text default `'진행중'`, CHECK(`진행중`\|`수주`\|`탈락`\|`취소`) | 실제 저장되는 상태 컬럼(아래 참고) |
| `result_score` | text default `''` | 결과 점수 |
| `evaluation` | text default `''` | 낙찰사 ("선"=자사 수주) |
| `award_fee` | numeric (nullable) | 낙찰 금액 |
| `participants` | text default `''` | 참여사 ("드랍"/"드롭" 포함 시 취소 처리) |
| `participation_ratio` | text default `''` | 참여 비율 |
| `director` | text default `''` | 단장 |
| `status_override` | text (nullable) | 수동 상태 지정 ("취소" 등) |
| `staff_arch` / `staff_civil` / `staff_mech` / `staff_safety` | text default `''` | 건축/토목/기계/안전 담당자 |
| `note` | text default `''` | 비고 |
| `created_at` / `updated_at` | timestamptz | |

> **2026-07-21 실제 DB 재확인 결과 정정**: 이 섹션은 한동안 `submit_date`/`interview_date`/`bid_date`를
> text("YYYY-MM-DD 또는 M/D", "서면"/"추후" 같은 비날짜 텍스트 허용)로, `status`는 저장 컬럼 없이
> 클라이언트에서만 계산하는 값으로 문서화하고 있었다. Supabase(`seonvis` 프로젝트)를 `list_tables`로
> 직접 조회한 결과 **셋 다 실제로는 `date` 타입이고, `status`는 CHECK 제약이 있는 실제 저장 컬럼**임을
> 확인해 위 표를 정정했다(기술인 출근부 Phase 1 검토 중 발견, `docs/attendance/01-current-analysis.md`).
> `announce_date`만 아직 text로 남아있다.

**상태 계산 로직 (computeStatus, `app/(dashboard)/projects/page.tsx`)** — 계산 결과를 화면 표시뿐 아니라 실제 `status` 컬럼에 저장한다(위 정정 참고. 계산 자체는 여전히 클라이언트에서 하고, 저장 시점에 그 결과값을 컬럼에 함께 써넣는 방식):
```
status_override 있으면 → 그 값 사용
participants에 "드랍"/"드롭" 포함 → "취소"
evaluation === "선" → "수주"
result_score 또는 evaluation 비어있으면 → "진행중"
나머지 → "탈락"
```
`lib/projectStatus.ts`의 `computeProjectStatus`/`categorizeProject`는 이름이 비슷하지만 **다른 용도**(주간보고 `performing_projects` 행 분류)의 별도 함수다 — 아래 참고.

**`interview_date`가 "서면"/"추후" 같은 비날짜 텍스트를 가질 수 있는지(기술인 출근부 검토 중 확인)**: `projects.interview_date`는 이제 실제 `date` 타입이라 그런 텍스트를 저장할 수 없다. 다만 `lib/projectStatus.ts`의 `categorizeProject`가 여전히 `interview_date === '서면'` 분기를 갖고 있는데, 이는 죽은 코드가 아니다 — `app/dashboard.tsx`(주간보고)가 이 함수를 두 경로에 쓴다: (1) `projects`에서 막 읽어온 행(이제 `date`라 "서면" 불가능), (2) **`performing_projects.interview_date`(실제 `text` 타입)를 사용자가 주간보고 화면에서 직접 자유 텍스트로 수정한 "수동 추가 행"**(2)의 경우 "서면"이 실제로 입력될 수 있다. 즉 이 분기는 `projects` 경로에서는 사실상 도달 불가능하지만 `performing_projects` 경로에서는 여전히 유효하다 — 기술인 출근부는 `projects.interview_date`만 참조하므로 영향받지 않는다.

---

## project_tooltips

공고 상세 정보. `projects`와 1:1 관계 (`project_number` FK).

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | uuid PK | |
| `project_number` | text UNIQUE | projects 참조 |
| `location` | text | 위치 |
| `area` | text | 면적 |
| `scale` | text | 규모 |
| `est_cost` | text | 추정 금액 |
| `designer` | text | 설계사 |
| `builder` | text | 시공사 |
| `score_dist` | text | 점수 배분 |
| `competitors` | text | 경쟁사 |
| `proposal_p` | text | 제안서 페이지 수 |
| `self_intro_p` | text | 자기소개서 페이지 수 |
| `ppt_p` | text | PPT 페이지 수 |
| `pq_date` | text | PQ 제출일 |
| `soq_date` | text | SOQ 제출일 |
| `interview_time` | text | 면접 시간 |
| `notify_date` | text | 결과 통보일 |
| `announcement` | text | 공고 내용 (긴 텍스트) |

---

## project_notes

프로젝트 List의 특정 셀에 달린 메모. 달력 hover 툴팁에도 사용.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | uuid PK | |
| `project_number` | text | projects 참조 |
| `field` | text | 컬럼 이름: `client`, `submit_date`, `interview_date`, `bid_date`, `competitors` |
| `note` | text | 메모 내용 |
| `updated_at` | timestamptz | |
| UNIQUE | (project_number, field) | 중복 방지 |

**upsert 방식**: `onConflict: 'project_number,field'`

---

## performing_projects

주간보고의 "수행 프로젝트" 섹션 저장.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | uuid PK | |
| `week` | text | ISO 주차 (예: "2026-W26") |
| `status` | text | "개찰" 또는 "진행중" |
| `name` | text | 용역명 |
| `director` | text | 단장 |
| `submit_date` | text | 제출일 (M/D 형식) |
| `interview_date` | text | 발표/면접일 |
| `result_date` | text | 개찰일 |
| `fee` | numeric | 용역비(억) |
| `note` | text | 내용 (자동: 직원 배치 정보) |
| `sort_order` | integer | 정렬 순서 |

---

## expected_projects

주간보고의 "발주예상 프로젝트" 섹션 저장.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | uuid PK | |
| `week` | text | ISO 주차 |
| `name` | text | 용역명 |
| `client` | text | 발주청 |
| `director` | text | 단장 |
| `project_cost` | text | 사업비(억) |
| `order_month` | text | 발주 월 |
| `fee` | text | 용역비(억) |
| `note` | text | 내용 |
| `sort_order` | integer | 정렬 순서 |

---

## weekly_meta

주간보고의 교육참가자/기타 메타 정보.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | uuid PK | |
| `week` | text UNIQUE | ISO 주차 |
| `education_note` | text | 교육 비고 |
| `edu_chief` | text | 책임 담당자 |
| `edu_arch` | text | 건축 담당자 |
| `edu_civil` | text | 토목 담당자 |
| `edu_safety` | text | 안전 담당자 |
| `edu_mech` | text | 기계 담당자 |
| `other_note` | text | 기타 사항 |

---

## allowed_users

서비스 접근 허용 사용자 목록.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | uuid PK | |
| `email` | text UNIQUE | 소문자 이메일 |
| `name` | text | 이름 |
| `menu_permissions` | jsonb | 항목별 권한 `{키: 'none'\|'read'\|'write'}`. 키는 `lib/menuConfig.ts`, 없으면 write. none=사이드바 숨김, read=조회만(수정 UI 숨김) — UI 레벨 제어 (`migration_menu_permissions_v2.sql`) |
| `hidden_menu_items` | text[] | **deprecated** — menu_permissions로 이관됨. 코드에서 더 이상 읽지 않음 |
| `created_at` | timestamptz | |

**주의**: 관리자(`ADMIN_EMAILS`)는 이 테이블에 없어도 접근 가능하며 항상 전체 쓰기 권한.

---

## overtime_employees

직원 목록 — 연장근무와 휴가관리가 **공용**으로 쓴다. `docs/overtime.md`, `docs/leave-management/` 참고.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | uuid PK | |
| `name` | text UNIQUE | 이름 |
| `position` | text | 직급 |
| `is_active` | boolean | 재직여부 — 퇴사해도 행은 삭제하지 않고 false로만 변경 (과거 기록 보존) |
| `sort_order` | integer | 좌측 직원 목록 정렬순서 |
| `hire_date` | date (nullable) | 입사일 — 휴가관리 연차 설정 모달에서 편집 (`migration_leave.sql`) |
| `resign_date` | date (nullable) | 퇴사일. 재직 중이면 null |
| `created_at` | timestamptz | |

---

## overtime_employee_tasks

직원별 기본업무내용(자주 쓰는 업무) 목록. `overtime_employees`의 하위 데이터로, 근무입력 화면에서
업무내용을 드롭박스로 고를 수 있게 하는 기초자료다 (드롭박스 연동 자체는 별도 단계).

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | uuid PK | |
| `employee_id` | uuid FK → overtime_employees, ON DELETE CASCADE | |
| `task_name` | text | 업무내용 (직원별 UNIQUE) |
| `sort_order` | integer | 정렬순서 |
| `created_at` | timestamptz | |

**마이그레이션**: `supabase/migration_overtime_employee_tasks.sql`

---

## overtime_projects

연장근무 관리용 프로젝트 목록. 입찰 현황 `projects`와 겹치는 프로젝트는
`lib/overtime/sync.ts`가 자동 등록/갱신한다(공고일~발표일 기간 기준, 단방향 동기화 —
`docs/overtime.md`의 "입찰 프로젝트 자동 연계" 참고). 수동 등록도 여전히 가능하다.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | uuid PK | |
| `name` | text | 프로젝트명. 연계 행은 `projects.name` 미러라 UNIQUE 아님 (구 UNIQUE 제약은 연계 도입 때 제거) |
| `status` | text | `진행중` 또는 `종료`. 종료된 프로젝트는 신규 업무 등록 시 선택 목록에서 제외. 연계 행은 입찰 상태가 `진행중`일 때만 `진행중`, 그 외(수주/탈락/취소)는 `종료`로 동기화 |
| `sort_order` | integer | |
| `start_date` | date (nullable) | 프로젝트 시작일. 연계 행은 공고일(`announce_date`)로 동기화 |
| `end_date` | date (nullable) | 프로젝트 종료일. 연계 행은 발표일(`interview_date`)로 동기화 — 발표일이 없으면 null(종료일 없이 계속 표기) |
| `source_project_id` | uuid FK → projects, ON DELETE SET NULL (nullable) | 입찰 연계 원본. null이면 수동 프로젝트. partial UNIQUE(중복 동기화 방지) |
| `created_at` | timestamptz | |

**마이그레이션**: `supabase/migration_overtime.sql` + `supabase/migration_overtime_project_dates.sql` (시작일/종료일 추가)

---

## overtime_project_members

프로젝트별 담당직원 배정. 프로젝트 관리 화면에서 체크로 지정하며, 실제 근무 이력
(`overtime_work_records`)과 별개의 "배정" 정보다 — 향후 프로젝트별 인원을 나열해 근무일을
표기하는 화면의 기초자료.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | uuid PK | |
| `project_id` | uuid FK → overtime_projects, ON DELETE CASCADE | |
| `employee_id` | uuid FK → overtime_employees, ON DELETE CASCADE | |
| `created_at` | timestamptz | |
| UNIQUE | (project_id, employee_id) | 중복 배정 방지 |

**마이그레이션**: `supabase/migration_overtime_project_members.sql`

---

## overtime_work_records

연장근무의 핵심 테이블. **"직원 1명 + 날짜 1개 + 프로젝트 1개 + 업무 1개 = 행 1개"** 단위를 절대 어기지 않는다.
총 연장시간·건수 컬럼은 두지 않고, 화면(월간 그리드 셀 "6h (3)")은 항상 이 테이블을
`employee_id` + `work_date`로 `SUM(hours)` / `COUNT(*)` 해서 구한다.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | uuid PK | |
| `employee_id` | uuid FK → overtime_employees, ON DELETE RESTRICT | |
| `project_id` | uuid FK → overtime_projects, ON DELETE RESTRICT | |
| `work_date` | date | 업무 수행일 |
| `task_description` | text | 업무내용 |
| `start_time` | text | `"HH:mm"` (예: `"18:00"`) |
| `end_time` | text | `"HH:mm"`. 자정을 넘기면 `"24:00"` 이상으로 표기 (예: 21:00~24:00) |
| `hours` | numeric(4,2) | 인정시간. 저장 시점에 계산해 저장 (매 조회마다 재계산하지 않고 `SUM()`으로 바로 집계하기 위함) |
| `break_hours` | numeric(3,1) (nullable) | 휴게시간. 팝오버 입력은 명시값(인정 = 종료−시작−휴게, 1시간 절삭), null은 기존 방식(식사시간 자동 차감) 레코드 |
| `note` | text | 비고 |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

**인덱스**: `(employee_id, work_date)`, `(work_date)`, `(project_id)` — 월간 그리드 조회·대시보드 집계용.

**마이그레이션**: `supabase/migration_overtime.sql`

---

## Supabase 클라이언트 구분

| 파일 | 용도 | 주의 |
|---|---|---|
| `lib/supabase.ts` | 주간보고 도메인 타입만 제공 (레거시 anon 클라이언트는 제거됨 — localStorage 세션이라 토큰 만료 시 RLS에 걸려 빈 결과가 돌아오는 버그가 있었음) | 클라이언트 생성 금지 |
| `lib/supabase-browser.ts` | `createSupabaseBrowserClient()` — Client Component용 | 세션 쿠키 자동 처리 |
| `lib/supabase-server.ts` | `createSupabaseServerClient()` — Server Component/API Route용 | `await` 필요 |
| `lib/supabase-admin.ts` | Service role — RLS 우회, **서버 사이드 전용** | 클라이언트 노출 금지 |

---

## 휴가관리 테이블 (leave_*)

상세 설계는 [docs/leave-management/03-data-model.md](./leave-management/03-data-model.md) 참고.
핵심 원칙: 월별/연간 사용일수·잔여 연차는 저장하지 않고 항상 `leave_record_dates`에서 계산.

- `leave_types(id, name, deducts_annual_leave, default_deduction_unit, is_active, sort_order)` — 기본 8종 시드
- `annual_leave_balances(id, employee_id FK, year, granted_days, adjustment_days, adjustment_reason, updated_at)` — UNIQUE(employee_id, year). 최종 = granted + adjustment (계산값)
- `annual_leave_balance_history(id, employee_id, year, previous/new_granted_days, previous/new_adjustment_days, reason, changed_at)` — 연차 설정 저장 시 앱이 1행씩 기록
- `leave_records(id, employee_id FK, leave_type_id FK, start_date, end_date, start/end_day_unit(full|am|pm), total_calendar_days, deducted_days, memo)` — 몇 박은 total_calendar_days-1로 파생
- `leave_record_dates(id, leave_record_id FK CASCADE, leave_date, day_unit, deducted_days, is_weekend, is_holiday, holiday_name)` — 기간 내 모든 달력 날짜 저장(주말·공휴일 차감 0), 공휴일 여부는 저장 시점 스냅샷. 수정 시 전체 삭제 후 재생성
- `holidays(id, holiday_date UNIQUE, name, holiday_type: 법정공휴일|회사휴무)` — 2026년 법정공휴일 시드, `/api/holidays`로 연도별 불러오기 가능

**마이그레이션**: `supabase/migration_leave.sql` (overtime_employees의 hire_date/resign_date 추가 포함)

---

## 기술인 주소록 테이블 (engineer_*)

상세 설계는 [docs/engineer-address-book/03-data-model.md](./engineer-address-book/03-data-model.md) 참고.
외부 기술인력 풀(667명 규모)이라 팀 내부용 `overtime_employees`와 별도 테이블.

- `engineer_contacts(id, engineer_no identity UNIQUE, employee_id FK→overtime_employees SET NULL, name, rank, position, company, mobile_phone, office_phone, email, region, address, employment_status(재직|퇴직|비활성), joined_date, retired_date, memo, is_favorite)` — engineer_no는 향후 Excel 내보내기/동기화의 1순위 매칭 키. 비활성이 소프트 삭제 역할. 인덱스: name, mobile_phone, region, employment_status
- `engineer_specialties(id, name UNIQUE, is_active, sort_order)` — 전문분야 마스터, 12종 시드
- `engineer_contact_specialties(contact_id FK CASCADE, specialty_id FK RESTRICT, UNIQUE쌍)` — 다중 지정
- `engineer_sync_logs(executed_at, file_name, added/updated/deactivated/error_count, note)` — 향후 엑셀 동기화 실행 이력 (구조 예약, MVP 미사용)

**마이그레이션**: `supabase/migration_engineers.sql` / **초기 시드**: `supabase/seed_engineers.sql` (address book.xls 667건 1회 이관)

---

## 현장 현황 테이블 (sites)

상세 설계는 [docs/site-status/04-data-model.md](./site-status/04-data-model.md) 참고.
월별 배치/스냅샷은 다루지 않는다 — 현재 운영 중인 현장 기본정보 단일 대장.

- `sites(id, site_code identity UNIQUE, original_site_name, site_name, source_category(건진법|주택법|건축법|전통소, 원본), legal_category(건설기술진흥법|주택법|건축법|분리발주(전기·통신·소방), 표준 표시값), manager_name, contractor, site_phone_raw(원본 보존), site_landline(추출), manager_mobile(추출), phone_uncertain, site_address, office_address, region, start_date, planned_completion_date, manual_status(nullable=자동), memo, is_favorite, active)` — active가 소프트 삭제 역할, deleted_at 없음. site_code는 향후 Excel 동기화 1순위 매칭 키
- `site_sync_logs(executed_at, file_name, added/updated/deactivated/error_count, note)` — 향후 엑셀 동기화 실행 이력 (구조 예약, MVP 미사용)

**마이그레이션**: `supabase/migration_sites.sql` (스키마만, 개인정보 없음). **89건 초기 데이터**는 구현 시점 1회성 로컬 스크립트가 `Project Portfolio.xlsx`(건진법·주택법·건축법·전통소 4개 시트만, 숨김 월별 시트 제외)를 직접 읽어 Supabase REST로 삽입 — 개인정보 포함 시드는 저장소에 커밋하지 않는다.

---

## 기술인 출근부 테이블 (Phase 1 — attendance_*, project_participants, project_change_history)

상세 설계는 [docs/attendance/03-data-model.md](./attendance/03-data-model.md) 참고.
핵심 원칙: `attendance_records`는 "기술인 1명 + 날짜 1개 + 프로젝트 1개 = 행 1개"이며, **레코드 존재 자체가 출근을
의미한다**(미출근 날짜는 행을 만들지 않음 — 연장근무 `overtime_work_records`와 동일 철학). 과거 기록 보존은
"유효기간이 있는 `project_participants`(운영 데이터) + 월 마감 시 `attendance_closure_snapshot_rows`(고정 데이터)"
하이브리드로 처리하고, 재공고/변경공고/취소 여부는 `projects`에 별도 컬럼을 두지 않고 `project_change_history`를
공식 원본으로 삼는다.

- `project_participants(id, project_id FK→projects RESTRICT, engineer_id FK→engineer_contacts RESTRICT, role, specialty_id FK→engineer_specialties RESTRICT, is_director, participation_start, participation_end, status(진행중|종료), sort_order, created_at, updated_at)` — partial UNIQUE(project_id, engineer_id) WHERE status='진행중'(활성 참여 중복 방지, 과거 참여는 허용). role/specialty를 키에 포함하지 않는 이유: 첨부 엑셀 84개 프로젝트 전수 + 실제 `projects` 60건(director가 staff_*와 동일한 사례 검색) 둘 다 "한 기술인=한 프로젝트에서 한 역할"만 확인되어, 굳이 role/specialty까지 유니크 키에 넣지 않았다. 직책·분야·단장여부·참여기간처럼 과거 표시에 영향을 주는 변경은 기존 행을 종료하고 새 행을 추가하는 방식으로 이력을 보존한다(덮어쓰지 않음).
- `attendance_records(id, project_id, engineer_id, participant_id FK→project_participants RESTRICT, work_date, status('present'만 사용 — 향후 absent/leave/business_trip/excluded로 확장 가능한 문자열 컬럼), created_by, updated_by, created_at, updated_at, note)` — UNIQUE(project_id, engineer_id, work_date). 인덱스: (engineer_id, work_date), (project_id, work_date), (work_date). **`closure_id` 컬럼은 두지 않는다** — 마감취소→재마감이 반복될 때마다 이 컬럼을 새 버전으로 다시 써야 하는 위험이 있어(검토 후 제거), 대신 `work_date`에서 회계기간 라벨을 역산(`lib/attendance/closureLifecycle.ts`의 `periodLabelForDate`)해 `attendance_month_closures`를 조회하는 방식으로 잠금 여부를 판단한다.
- `attendance_month_closures(id, period_year, period_month(1~12 사람이 읽는 라벨 — `lib/overtime/summary.ts`의 payPeriodDays가 쓰는 0-indexed month와 다르므로 변환은 반드시 `lib/attendance/period.ts`를 거친다), version, status(closed|reopened), closed_by, closed_at, reopened_by, reopened_at, reopen_reason, created_at)` — **"기간당 1행"이 아니라 "마감 시도(버전)당 1행"**인 append-only 이력이다(검토 후 변경). UNIQUE(period_year, period_month, version). 같은 기간을 마감→마감취소→재마감하면 version 1, 2, 3...으로 새 행이 쌓이고 이전 버전 행은 지우지 않는다 — 그 기간의 "현재" 상태는 version이 가장 큰 행으로 판단한다(`lib/attendance/closureLifecycle.ts`의 `currentClosureStatus`).
- `attendance_closure_snapshot_rows(id, closure_id FK CASCADE, project_id, project_name_snapshot, participant_id, engineer_id, name_snapshot, role_snapshot, specialty_snapshot, is_director_snapshot, sort_order, attendance_dates date[], present_count, note_snapshot)` — 마감 시점 값을 통째로 얼려 Project List가 나중에 바뀌어도 과거 출력물이 재현되게 한다. UNIQUE(closure_id, participant_id) — `closure_id`가 마감 "버전"의 id를 가리키므로 재마감으로 새 버전이 생겨도 이전 버전의 스냅샷 행은 그대로 남는다. CHECK(present_count = cardinality(attendance_dates)) + 중복 날짜 방지 트리거로 배열 무결성을 DB 레벨로도 강제한다("기간 내 날짜인지"는 회계기간 규칙이 JS에만 있어 SQL로 재검증하지 않고 생성 함수(`lib/attendance/snapshotBuilder.ts`)가 예외를 던져 보장한다).
- `project_change_history(id, project_id FK→projects RESTRICT, change_type(director_change|participant_change|cancelled|reannounced|amended|announce_date_change|interview_date_change|field_change|other), change_date, before_value, after_value, memo, created_by, created_at)` — 재공고/변경공고/공고취소 여부의 공식 원본(사용자 확정). 월별 화면·출력의 "비고"는 이 테이블을 기간별로 조회해 조립한다(`lib/attendance/changeHistoryFormat.ts`), 별도 비고 테이블을 두지 않는다.
- `attendance_audit_log(id, action_type(closure_reopen|past_record_edit|out_of_period_check|other), table_name, record_id, actor, reason, before_data jsonb, after_data jsonb, created_at)` — 마감취소·과거기록수정·기간외 입력 전용 범용 감사 로그.
- `allowed_users.can_close_attendance`(boolean, default false) — 월 마감/마감취소 전용 권한(사용자 확정 #6). 기존 `menu_permissions`(none/read/write)와 별개이며, `ADMIN_EMAILS` 관리자는 기존 관례대로 이 컬럼과 무관하게 항상 가능.

**마이그레이션**: `supabase/migration_attendance.sql`. 순수 계산 로직(기간 계산·체크기간 검증·마감 전 검증·비고 조립)은 `lib/attendance/*.ts` + `lib/attendance/*.test.ts`(Vitest) 참고 — 이 코드베이스 관례상 쿼리 레이어(`queries.ts`)를 두지 않으므로 실제 Supabase 호출은 Phase 2 이후 화면 컴포넌트 안에 직접 작성한다.
