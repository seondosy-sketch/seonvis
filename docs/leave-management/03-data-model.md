# 휴가관리 — 데이터 모델

기존 방식 그대로: `supabase/migration_leave.sql` 파일로 작성하고 MCP `apply_migration`으로
적용, `docs/database.md`에 컬럼 표 추가. RLS는 기존 테이블과 동일하게 "인증된 사용자
전체 접근" 정책만 건다(실제 접근 제어는 `app/(dashboard)/layout.tsx`가 담당).

타입은 `lib/leave/types.ts`에 DB 컬럼명 1:1 snake_case로 정의(기존 컨벤션).

## 0. 기존 테이블 수정 — `overtime_employees` 컬럼 추가

직원 정보는 이 테이블을 공용으로 쓴다(중복 테이블 금지). 입사일·퇴사일이 없어서 추가한다.

```sql
alter table overtime_employees
  add column if not exists hire_date date,     -- 입사일 (nullable — 기존 데이터 호환)
  add column if not exists resign_date date;   -- 퇴사일 (재직 중이면 null)
```

- nullable이라 연장근무 기능·기존 데이터에 영향 없음. `is_active`(재직여부)는 그대로 두고
  퇴사 처리 시 두 값을 함께 관리한다(퇴사일 입력 ≠ 자동 비활성화 — 수동으로 각각).
- 편집 UI는 휴가관리의 연차 설정 모달에 둔다(연장근무 화면 수정 금지).

## 1. `leave_types` — 휴가 유형

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | uuid PK | |
| `name` | text | 유형명 |
| `deducts_annual_leave` | boolean | 연차 차감 여부 |
| `default_deduction_unit` | numeric(2,1) | 기본 차감 단위 (1 / 0.5 / 0) |
| `is_active` | boolean default true | 비활성 유형은 신규 등록 드롭다운에서 제외 |
| `sort_order` | integer | |
| `created_at` | timestamptz | |

시드 8종: 연차(차감 1), 오전 반차(차감 0.5), 오후 반차(차감 0.5), 경조휴가(0),
병가(0), 공가(0), 대체휴무(0), 기타(0).

## 2. `annual_leave_balances` — 연도별 연차 부여

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | uuid PK | |
| `employee_id` | uuid FK → overtime_employees, ON DELETE RESTRICT | |
| `year` | integer | 대상 연도 |
| `granted_days` | numeric(4,1) | 기본 부여 연차 (15, 15.5, 22 등 0.5 단위 허용) |
| `adjustment_days` | numeric(4,1) default 0 | 조정일수 (이월·추가부여·보정·차감, ± 허용) |
| `adjustment_reason` | text default '' | 조정 사유 |
| `created_at` / `updated_at` | timestamptz | |
| UNIQUE | (employee_id, year) | 직원·연도당 1행 |

**최종 사용 가능 연차 = granted_days + adjustment_days** — 저장하지 않고 항상 계산.

## 3. `annual_leave_balance_history` — 부여/수정 이력

연차 설정에서 insert/update 할 때마다 앱 코드에서 한 행씩 남긴다(트리거 안 씀 —
이 코드베이스에 트리거 관례가 없고, 쓰는 곳이 연차 설정 모달 한 곳뿐이라 앱 레이어로 충분).

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | uuid PK | |
| `employee_id` | uuid FK → overtime_employees, ON DELETE RESTRICT | |
| `year` | integer | |
| `previous_granted_days` / `new_granted_days` | numeric(4,1), 이전값은 nullable | 최초 부여면 previous null |
| `previous_adjustment_days` / `new_adjustment_days` | numeric(4,1), 이전값은 nullable | |
| `reason` | text | 조정 사유 (입력값 스냅샷) |
| `changed_at` | timestamptz default now() | |

## 4. `leave_records` — 휴가 1건 (원본)

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | uuid PK | |
| `employee_id` | uuid FK → overtime_employees, ON DELETE RESTRICT | |
| `leave_type_id` | uuid FK → leave_types, ON DELETE RESTRICT | |
| `start_date` / `end_date` | date | 시작일/종료일 (같은 날 허용) |
| `start_day_unit` / `end_day_unit` | text | `full` / `am` / `pm` (같은 날이면 두 값 동일하게 저장) |
| `total_calendar_days` | integer | 전체 기간 일수 = 종료−시작+1 (몇 박은 −1로 파생, 별도 저장 안 함) |
| `deducted_days` | numeric(4,1) | 실제 연차 차감일수 합 (leave_record_dates 합과 항상 일치해야 함) |
| `memo` | text default '' | |
| `created_at` / `updated_at` | timestamptz | |

`total_nights`는 저장하지 않는다 — `total_calendar_days - 1`로 언제나 파생 가능
(요구 14의 "원본 기준 계산 우선" 원칙). 표시 포맷 `N박 M일`은 lib 함수로.

## 5. `leave_record_dates` — 날짜별 전개 (집계·검증의 기준)

휴가 1건을 날짜 단위로 전개한 하위 테이블. **월별 집계·중복 검증·월 셀 상세보기가
전부 이 테이블만 본다.** 저장 시점에 계산 규칙(04 문서)으로 생성하고, 휴가 수정 시
그 record의 행을 전부 지우고 재생성한다(delete → insert, 부분 수정 없음).

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | uuid PK | |
| `leave_record_id` | uuid FK → leave_records, ON DELETE CASCADE | 휴가 삭제 시 함께 삭제 |
| `leave_date` | date | |
| `day_unit` | text | `full` / `am` / `pm` |
| `deducted_days` | numeric(2,1) | 이 날짜의 차감 (1 / 0.5 / 0) |
| `is_weekend` | boolean | 토·일 여부 (차감 0 사유 표시용) |
| `is_holiday` | boolean | 공휴일/회사휴무 여부 |
| `holiday_name` | text (nullable) | 해당 시 이름 스냅샷 (이후 공휴일 편집과 무관하게 당시 기준 보존) |

- 기간 내 **모든 달력 날짜를 행으로 저장**한다(주말·공휴일 포함, 차감 0으로). 이유:
  ① 중복 검증이 "날짜 점유" 단위로 단순해짐(차감 없는 경조휴가도 날짜는 점유),
  ② 월 셀 상세에서 제외된 날을 설명할 수 있음.
- 인덱스: `(employee_id 조회용) leave_record_id`, `(leave_date)` — 연간 조회는
  records와 join해서 `leave_date between 'YYYY-01-01' and 'YYYY-12-31'`.
- `employee_id`를 여기 중복 저장하지 않는다 — 항상 records와 join (원본 일원화).

## 6. `holidays` — 공휴일/회사휴무

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | uuid PK | |
| `holiday_date` | date UNIQUE | |
| `name` | text | 예: 설날, 대체공휴일, 창립기념일 |
| `holiday_type` | text | `법정공휴일` / `회사휴무` |
| `created_at` | timestamptz | |

- `year` 컬럼은 두지 않는다 — `holiday_date`에서 파생 가능.
- 시드: 2026년 대한민국 법정공휴일(대체공휴일 포함)을 마이그레이션에 INSERT.
  이후 연도는 공휴일 관리 모달의 「인터넷에서 불러오기」(기존 `/api/holidays` 재사용)
  또는 수동 입력으로 채운다 — 04 문서 참고.

## 집계는 저장하지 않는다

월별 사용일수·연간 사용일수·잔여 연차는 전부 조회 시점에 `leave_record_dates`(+balances)로
계산한다(연장근무의 "총 시간·건수는 컬럼으로 저장하지 않는다" 원칙과 동일).
`leave_records.deducted_days`만 예외적으로 저장하는데(이력 테이블 표시용 합계),
이 값은 dates 재생성 때마다 함께 다시 계산해 넣으므로 불일치가 생기지 않는다.
