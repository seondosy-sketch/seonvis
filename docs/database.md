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
| `overtime_employees` | 연장근무 관리용 직원 목록 |
| `overtime_employee_tasks` | 직원별 기본업무내용(자주 쓰는 업무) 목록 — 근무입력 드롭박스 기초자료 |
| `overtime_projects` | 연장근무 관리용 프로젝트 목록 (입찰 현황 `projects`와 별개) |
| `overtime_project_members` | 프로젝트별 담당직원 배정 (체크) — 향후 프로젝트별 인원·근무일 표기 기초자료 |
| `overtime_work_records` | 연장근무 업무 1건 = 행 1개 (핵심 테이블) |

---

## projects

프로젝트 입찰 현황 마스터 테이블.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | uuid PK | |
| `project_number` | text UNIQUE | 프로젝트 번호 (예: A001) |
| `type` | text | 면접/SOQ/종심제/TP/PQ/기타 |
| `client` | text | 발주처 |
| `name` | text | 용역명 |
| `fee` | numeric | 용역비(억) |
| `tp_score` | text | TP 점수 |
| `duration_days` | text | 용역 기간 |
| `announce_date` | text | 공고일 (YYYY-MM-DD) |
| `submit_date` | text | 제출일 (YYYY-MM-DD 또는 M/D) |
| `interview_date` | text | 발표/면접일 (날짜 또는 "서면"/"추후") |
| `bid_date` | text | 개찰일 |
| `result_score` | text | 결과 점수 |
| `evaluation` | text | 낙찰사 ("선"=자사 수주) |
| `award_fee` | numeric | 낙찰 금액 |
| `participants` | text | 참여사 ("드랍"/"드롭" 포함 시 취소 처리) |
| `participation_ratio` | text | 참여 비율 |
| `director` | text | 단장 |
| `status_override` | text | 수동 상태 지정 ("취소" 등) |
| `staff_arch` | text | 건축 담당자 |
| `staff_civil` | text | 토목 담당자 |
| `staff_mech` | text | 기계 담당자 |
| `staff_safety` | text | 안전 담당자 |
| `note` | text | 비고 |
| `created_at` | timestamptz | |

**상태 계산 로직 (computeStatus)**
```
status_override 있으면 → 그 값 사용
participants에 "드랍"/"드롭" 포함 → "취소"
evaluation === "선" → "수주"
result_score 또는 evaluation 비어있으면 → "진행중"
나머지 → "탈락"
```

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
| `created_at` | timestamptz | |

**주의**: 관리자(`ADMIN_EMAILS`)는 이 테이블에 없어도 접근 가능.

---

## overtime_employees

연장근무 관리용 직원 목록. `docs/overtime.md` 참고.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | uuid PK | |
| `name` | text UNIQUE | 이름 |
| `position` | text | 직급 |
| `is_active` | boolean | 재직여부 — 퇴사해도 행은 삭제하지 않고 false로만 변경 (과거 기록 보존) |
| `sort_order` | integer | 좌측 직원 목록 정렬순서 |
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

연장근무 관리용 프로젝트 목록. 입찰 현황용 `projects` 테이블과는 별개의 단순 조회 목록.
(향후 계획: 이 목록을 직접 입력하는 대신 입찰 현황 `projects` 테이블에서 가져오는 방안 예정 — `docs/overtime.md` 참고)

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | uuid PK | |
| `name` | text UNIQUE | 프로젝트명 |
| `status` | text | `진행중` 또는 `종료`. 종료된 프로젝트는 신규 업무 등록 시 선택 목록에서 제외 |
| `sort_order` | integer | |
| `start_date` | date (nullable) | 프로젝트 시작일. 아직 정하지 않았으면 null |
| `end_date` | date (nullable) | 프로젝트 종료일 |
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
