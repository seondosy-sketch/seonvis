# 기술인 출근부 — 데이터 모델

> 신규 테이블만 다룬다. 기존 테이블(`projects`, `engineer_contacts`, `engineer_specialties`, `holidays`, `allowed_users`)의
> 현재 구조는 `01-current-analysis.md`, `docs/database.md` 참고. 마이그레이션 파일은 기존 관례대로
> `supabase/migration_attendance.sql` 1개(또는 단계별로 `migration_attendance_*.sql` 분할, `06-implementation-plan.md` 참고)로 작성 예정.
> 명명·스타일은 `docs/database.md`/`supabase/migration_overtime*.sql` 관례를 그대로 따른다(uuid PK, snake_case, `ON DELETE RESTRICT`로 이력 보존, RLS는 "인증된 사용자 전체 접근").

---

## 0. 핵심 결정 — 과거 기록 보존 방식 (마스터 프롬프트 2번 항목 응답)

마스터 프롬프트가 제시한 4가지 방식 중 **"유효기간이 있는 프로젝트 참여자 관계 테이블"(운영 데이터) + "월 마감 시 스냅샷 저장"(고정 데이터)을 함께 쓰는 하이브리드**를 제안한다. 순수 이력 테이블이나 출력 시점별 버전 저장은 채택하지 않는다.

**이유**
1. **이 코드베이스의 기존 관례와 일치한다.** `overtime_employees.is_active`, `overtime_projects.status`, `engineer_contacts.employment_status`, `sites.active` 전부 "행을 지우지 않고 상태 컬럼만 바꾸는" 방식이고, 참여기간처럼 "기간이 있는 상태"는 `overtime_projects.start_date/end_date`(nullable)로 이미 표현하고 있다. 별도의 "이력 테이블"을 새로 만드는 패턴은 이 코드베이스 어디에도 없다 — 유효기간이 있는 관계 테이블 하나로 충분하다.
2. **그러나 유효기간 테이블만으로는 "이미 마감된 과거 출력물의 완전한 재현"을 보장할 수 없다.** 참여기간(시작/종료)은 "그 기간에 참여했다"는 사실은 보존하지만, **직책명 오타 수정, 분야 재분류, 프로젝트명 변경** 같은 조회 시점의 데이터 값 자체는 여전히 최신값을 참조하게 된다. 마스터 프롬프트가 "Project List 정보가 수정된 후에도 이미 마감된 월별 출근명부와 과거 출력물이 동일하게 재현되어야 한다"고 명시했으므로, **마감 시점에 값 자체를 통째로 얼려두는 스냅샷이 반드시 필요**하다.
3. **월 마감 이전(아직 열려 있는 달)에는 스냅샷이 없다 — 의도된 동작이다.** 마감 전 데이터는 아직 "확정"되지 않았으므로 Project List 최신값을 그대로 보여주는 것이 맞다(수정 중인 프로젝트명이 바로 반영돼야 함). 스냅샷은 마감이라는 확정 행위와 정확히 결합된다.
4. **출력 시점별 버전 저장은 채택하지 않는다** — "같은 마감월을 여러 번 출력해도 항상 같은 결과"가 목표이지 "출력할 때마다 새 버전"이 목표가 아니다. 마감 스냅샷 1개로 충분하고, 출력마다 새 레코드를 쌓으면 관리 부담만 늘어난다.
5. **개별 `attendance_records` 행에는 프로젝트명·성명 등을 중복 저장하지 않는다.** 레코드는 ID만 참조하고(연장근무 `WorkRecord`가 `project_id`만 갖고 이름은 조인해서 읽는 것과 동일한 원칙), 역사적 재현이 필요한 지점(마감)에서만 통째로 스냅샷을 뜬다. 매 행마다 텍스트를 중복 저장하면 나중에 "그 스냅샷이 진짜 그 시점 값인지" 신뢰하기 어려워진다 — 스냅샷은 마감이라는 단일 이벤트에서만 발생해야 일관성이 보장된다.

---

## 1. `project_participants` — 프로젝트 참여기술인 (신규, 핵심 연결 테이블)

Project List(`projects`)와 기술인 주소록(`engineer_contacts`)을 잇는 관계 테이블. **이 테이블이 없으면 "참여기술인 정보 연계" 자체가 불가능**하다(`01-current-analysis.md` §2.3).

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | uuid PK | |
| `project_id` | uuid FK → `projects(id)` ON DELETE RESTRICT | 이력 보존 — 참여기록이 있는 프로젝트는 삭제 불가(취소 상태로 처리) |
| `engineer_id` | uuid FK → `engineer_contacts(id)` ON DELETE RESTRICT | 기술인 주소록 참조 |
| `role` | text | 참여직책. 자유 텍스트(엑셀 실측 `구분`열이 `단장`만 존재하지만 향후 다른 값 가능 — `docs/conventions.md` 관례대로 enum 강제하지 않음) |
| `specialty_id` | uuid FK → `engineer_specialties(id)` ON DELETE RESTRICT (nullable) | 분야. 기존 마스터 재사용(엑셀 실측: 건축/토목/안전/기계 4종만 등장, 마스터는 12종 보유) |
| `is_director` | boolean not null default false | 단장 여부. 같은 프로젝트에 여러 명 true 가능(교체 이력 — §7.3 실측 근거) |
| `participation_start` | date (nullable) | 참여 시작일. 기본값은 화면에서 프로젝트 공고일로 제안하되 수정 가능 |
| `participation_end` | date (nullable) | 참여 종료일. null = 계속 참여 중 |
| `status` | text check in ('진행중','종료') default '진행중' | 참여 상태 |
| `sort_order` | integer not null default 0 | 프로젝트 내 표시 순서(단장이 먼저 오도록) |
| `created_at` / `updated_at` | timestamptz | |

**제약**
- Partial unique index: `UNIQUE(project_id, engineer_id) WHERE status = '진행중'` — 같은 프로젝트에 같은 기술인의 "활성" 참여는 1건만(중복 참여 방지). 과거 참여(종료됨)까지 막지는 않는다 — 동일 기술인이 같은 프로젝트에 재투입되는 경우를 허용.
- **교체/변경 표현 규칙(Confirmed)**: 직책·분야·단장여부·참여기간처럼 "과거 화면에 보였던 값"에 영향을 주는 변경은 기존 행을 `status='종료'` + `participation_end` 설정 후 **새 행을 추가**한다(엑셀 실측 §7.3의 "단장 교체 시 새 행 추가, 기존 행 보존" 관행과 동일). 단순 오타 수정처럼 과거 표시에 영향이 없는 수정은 in-place UPDATE 허용.

**유니크 제약 재검토 — role/specialty를 키에 포함해야 하는지 (사용자 검토 지시 #1, Confirmed by 실데이터)**
"한 기술인이 동일 프로젝트에서 동시에 복수 직책 또는 복수 분야를 가질 수 있는가?"를 추측하지 않고 두 개의 독립된 실데이터로 직접 확인했다.
1. **첨부 엑셀(`commute_sample.xlsx`) 84개 프로젝트 블록 전수 조사**: 같은 프로젝트 블록 안에 동일 성명이 두 번 이상 등장하는 사례 — **0건**.
2. **실제 운영 Supabase(`seonvis`) `projects` 60건 전수 조회**: `director`가 `staff_arch`/`staff_civil`/`staff_mech`/`staff_safety` 중 어느 것과도 동일한 이름인 사례(=같은 사람이 두 역할을 겸함) —
   ```sql
   select project_number, name, director, staff_arch, staff_civil, staff_mech, staff_safety
   from projects
   where director <> '' and (
     director = staff_arch or director = staff_civil or director = staff_mech or director = staff_safety
   );
   ```
   결과 **0행**.

두 실데이터 모두 "한 기술인 = 한 프로젝트에서 한 역할"만 보여준다. **결론: 현재의 partial unique `(project_id, engineer_id) WHERE status='진행중'`를 그대로 유지한다** — role/specialty를 유니크 키에 포함하지 않는다. 향후 실제로 한 사람이 같은 프로젝트에서 두 역할을 겸하는 사례가 발견되면, 그때 이 제약을 `(project_id, engineer_id, role)` 등으로 넓히는 별도 마이그레이션을 검토한다(지금은 근거 없는 선제적 완화를 하지 않는다).

### 1.1 단장 교체의 원자성 — `attendance_replace_director` RPC (Phase 2 재검토, 사용자 검토 지시 반영)

**문제**: 단장 교체는 "기존 활성 단장 종료(UPDATE) + 신규 단장 추가(INSERT)" 두 단계다. 클라이언트가 이 둘을 별도 요청으로 순차 호출하면, 첫 요청만 성공하고 두 번째가 실패하는 경우(네트워크 오류, 제약조건 위반 등) "활성 단장이 아무도 없는" 부분완료 상태가 생길 수 있다.

**해결**: `supabase/migration_attendance_director_rpc.sql`에 Postgres 함수 `attendance_replace_director(p_project_id, p_old_participant_id, p_new_engineer_id, p_new_role, p_new_specialty_id, p_new_participation_start, p_new_participation_end)`를 만들어, 관련 작업 전부를 **하나의 RPC 호출(= 하나의 트랜잭션)**로 묶는다. 함수 내부에서 INSERT/UPDATE가 실패하면(FK 위반, partial unique 위반 등) 그 호출 안에서 이미 실행됐던 UPDATE(기존 단장 종료)까지 자동으로 롤백된다 — PL/pgSQL 함수 하나의 실행은 호출자의 트랜잭션 안에서 이뤄지고, 처리되지 않은 예외가 발생하면 그 트랜잭션 전체가 취소되기 때문에 별도로 `BEGIN`/`COMMIT`을 직접 다룰 필요가 없다.

**두 경로(승격 엣지 케이스 반영, 사용자 재검토 지시)**: 신규 단장 후보가 이 프로젝트에 이미 "진행중" 참여자로 있는지에 따라 갈린다.
- **경로 A**(활성 참여자가 아님): 기존 단장 종료 + 새 행 INSERT.
- **경로 B**(이미 활성 일반 참여자 — 승격): 기존 단장 종료 + **새 행을 만들지 않고** 그 기존 참여행을 `is_director=true`로 UPDATE한다. 동일 기술인의 참여 이력을 불필요하게 중복 생성하지 않기 위함이다. `participation_start`는 승격 시 **절대 덮어쓰지 않는다**(실제 참여 시작 사실을 임의로 잃지 않기 위함 — 사용자가 새 시작일을 입력해도 무시), `participation_end`는 사용자가 이번에 입력한 값을 그대로 반영한다.
- **동일 인물 재지정**(이미 그 사람이 활성 단장)은 no-op이 아니라 `raise exception 'new director candidate is already the current director'`로 명확히 차단한다 — 사용자가 실제로 무슨 일이 일어났는지 혼동하지 않도록.

**동시성 안전장치**: `p_old_participant_id`가 있으면 그 행을 `SELECT ... FOR UPDATE`로 잠그고 `status='진행중' AND is_director=true`인지 재확인한다. 이미 다른 요청이 먼저 처리해 종료된 상태라면(동시 교체 시도, 재시도 등) `raise exception 'old director is not currently active'`로 명확히 실패시킨다. 신규 단장 후보의 기존 활성 행 조회도 `FOR UPDATE`로 잠근다.

**보안**: `security invoker`(기본값, 명시적으로 선언)로 실행되어 호출한 사용자의 권한 그대로 `project_participants`의 기존 RLS 정책(`authenticated_full_access`)을 따른다. `security definer`나 service role을 쓰지 않는다 — 이 함수만을 위한 RLS 우회 경로를 만들지 않기 위함.

**범위**: 이번 단계는 단장 종료·등록·승격 작업만 묶는다. `project_change_history` 기록은 포함하지 않았다 — 비고/변경이력 화면 자체가 아직 없는 Phase 2 범위 밖이라, 지금 포함하면 범위가 과도하게 늘어난다는 사용자 판단에 따름(향후 Phase 3에서 변경이력 UI를 만들 때 이 함수에 이력 insert를 추가하는 편이 자연스럽다).

**클라이언트 사용 방식**: `ParticipantManagerModal.tsx`는 `is_director=true`인 추가/교체/승격 요청만 이 RPC로 보내고(교체 대상이 없으면 `p_old_participant_id=null`), 단장이 아닌 일반 참여기술인 추가는 기존처럼 단순 `insert` 한 번으로 처리한다. 클라이언트는 선택한 기술인이 이미 이 프로젝트의 활성 일반 참여자인지만 판단해 확인 문구를 다르게 보여줄 뿐, 실제 "새 행이냐 승격이냐"의 분기는 전부 RPC 안에서 처리한다. RPC가 실패하면 화면 목록을 갱신하지 않아 기존 표시가 그대로 유지되고, 에러 메시지는 `lib/attendance/directorReplace.ts`의 `directorReplaceErrorMessage()`가 에러 코드/메시지를 문구로 변환한다.

**검증**: 트랜잭션(`BEGIN ... ROLLBACK`) 안에서 가상 프로젝트·기술인(실사용 데이터 아님)으로 신규등록/교체/승격(참여시작일 보존·종료일 반영·기존단장 종료·활성단장 1명 유지·다른 참여자 무영향)/중복·재시도 차단/동일인물 재지정 차단/실패 시 롤백까지 전 시나리오를 검증했다. **이 함수는 실사용 DB(seonvis)에 적용 완료되었다** — 적용 시각·카탈로그 검증 결과는 완료 보고 참고.

---

## 2. `attendance_records` — 출근기록 (핵심 테이블, 1행 = "기술인 1명 + 날짜 1개 + 프로젝트 1개")

연장근무 `overtime_work_records`와 동일한 설계 원칙(`docs/overtime.md`의 불변 원칙)을 출근기록에 그대로 적용한다.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | uuid PK | |
| `project_id` | uuid FK → `projects(id)` ON DELETE RESTRICT | 마스터 프롬프트 5번 항목이 명시적으로 요구 |
| `engineer_id` | uuid FK → `engineer_contacts(id)` ON DELETE RESTRICT | 〃 |
| `participant_id` | uuid FK → `project_participants(id)` ON DELETE RESTRICT | 참여기술인 관계 ID(마스터 프롬프트 "필요하다면 포함" 항목 — 어느 참여 구간에 속한 출근인지 명확히 하기 위해 포함 채택) |
| `work_date` | date not null | 출근일자 |
| `is_present` | boolean not null default true | 출근 여부 — 아래 "레코드 존재 = 출근" 설계 참고 |
| `created_by` / `updated_by` | text | 입력자/수정자 — Supabase Auth 세션의 이메일(`allowed_users.email`과 동일 개념). **이 코드베이스 최초의 입력자/수정자 컬럼**(기존 테이블 어디에도 선례 없음 — Open Question 아님, 신규 요구사항이라 그대로 신설) |
| `created_at` / `updated_at` | timestamptz | |
| `note` | text (nullable) | 수정사유(마감 후 예외 수정 시 필수 입력 강제는 애플리케이션 레이어) |

**제약**
- `UNIQUE(project_id, engineer_id, work_date)` — 마스터 프롬프트 5번 항목의 중복 방지 요구를 정확히 만족.
- 인덱스: `(engineer_id, work_date)`, `(project_id, work_date)`, `(work_date)` — 월간 그리드/연간 조회/대시보드용(연장근무와 동일 이유).

**설계 결정 — "레코드 존재 = 출근" (Confirmed, 사용자 확정)**
`status` 컬럼을 두되, **1차 구현에서는 항상 `'present'`이고 미출근 날짜는 아예 행을 만들지 않는다** — 체크 해제 시 `UPDATE`가 아니라 `DELETE`. 이유:
- 연장근무 `WorkRecord`와 동일하게 "기록이 없으면 그 날은 아무 일도 없었다"는 철학을 유지 — 1년(376일) × 프로젝트당 최대 4~5명 규모라도 "미출근" 행까지 전부 저장하면 실제 유효 데이터보다 수십 배 많은 빈 행이 쌓인다.
- `status` 컬럼 자체는 남겨둔다(boolean이 아니라 문자열) — 향후 "반차/지각/외근" 같은 세분화된 출근 상태가 필요해지면 이 컬럼의 CHECK만 넓히면 된다(과잉설계 방지 차원에서 지금은 `'present'` 한 값만 허용).

**`closure_id` 컬럼을 두지 않는 이유 (사용자 검토 지시 #2 — 재검토 후 제거)**
1차 설계에서는 "이 기록이 어느 마감 회차에 속해 있었는지" 표시하려고 `closure_id uuid references attendance_month_closures(id) on delete set null`를 뒀으나, 제거했다.
- **문제**: 마감취소→재마감이 반복되면(§3 버전 관리) 재마감마다 새 `attendance_month_closures` 행(새 버전)이 생긴다. `attendance_records.closure_id`를 유지하려면 재마감 때마다 그 기간에 속한 **모든** 레코드의 `closure_id`를 새 버전 id로 다시 써야 하는데, 이 일괄 갱신을 누락하면 "이 기록이 잠겨 있는지" 판정이 옛 버전을 가리킨 채로 틀어진다 — 정확히 사용자가 우려한 "덮어쓰기 또는 과거 이력 손실" 위험이다.
- **대안**: `attendance_records`는 `attendance_month_closures`를 전혀 몰라도 된다. "이 기록의 `work_date`가 지금 잠긴 기간에 속하는가?"는 `work_date`로 회계기간 라벨을 역산(`lib/attendance/closureLifecycle.ts`의 `periodLabelForDate`)한 뒤 `attendance_month_closures`에서 그 라벨의 **최신 버전** 상태를 조회하면 항상 정확하다 — 저장된 컬럼 갱신이 전혀 필요 없다.
- 결과적으로 `attendance_records`는 순수하게 "운영 원본"으로만 남고, "이 기간이 마감됐는지"라는 파생 질문은 매번 계산한다(연장근무의 `DailySummary`가 저장 없이 매번 `SUM()`으로 계산하는 것과 같은 원칙 — 저장된 파생값과 실제 상태가 어긋날 여지를 원천 차단).

---

## 3. `attendance_month_closures` — 월 마감 (버전 관리, 사용자 검토 지시 #3 반영)

**"기간당 1행"이 아니라 "마감 시도(episode)당 1행"인 append-only 버전 이력이다.** 최초 설계는 `UNIQUE(period_year, period_month)`로 기간당 딱 1행만 허용했는데, 다음 시나리오를 그 구조로는 보존할 수 없었다:

```
최초 마감 → 마감취소 → 수정 → 재마감 → 재차 마감취소 → 두 번째 재마감
```

기간당 1행뿐이면 재마감마다 그 한 행을 덮어쓰거나(직전 마감취소 사유·시각이 사라짐), 스냅샷(§4)을 지우고 다시 만들어야 한다 — 마스터 프롬프트가 "과거 확정본 재현을 위해 이전 스냅샷을 단순 삭제하면 안 된다"고 명시했으므로 이 구조는 채택할 수 없다.

**해결책**: `version` 컬럼을 추가하고 유니크 제약을 `(period_year, period_month, version)`으로 바꿨다. 최초 마감 시 `version=1, status='closed'` 행을 만든다. 그 마감이 취소되면 **같은 행**의 `reopened_by/reopened_at/reopen_reason`만 채우고 `status`를 `'reopened'`로 바꾼다(행을 지우거나 새로 만들지 않음 — 그 버전의 이력을 그대로 보존). 재마감하면 `version=2, status='closed'`인 **새 행**을 만든다. 이 과정을 반복하면 `version` 1, 2, 3...이 전부 테이블에 쌓여 남는다.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | uuid PK | |
| `period_year` | integer | 기간 라벨 연도 |
| `period_month` | integer (1–12) | 기간 라벨 월 |
| `version` | integer not null default 1 | 같은 기간의 몇 번째 마감 시도인지(1부터, 재마감마다 +1) |
| `status` | text check in ('closed','reopened') default 'closed' | 이 버전(마감 시도) 자체의 최종 상태 — 지금도 유효한 마감인지, 나중에 취소됐는지 |
| `closed_by` | text not null | 이 버전이 생성(마감)된 시점의 입력자. **행 자체가 마감이라는 행위의 결과물**이라 항상 채워짐(더 이상 'open' 상태를 표현하는 행은 없다 — 한 번도 마감 안 한 기간은 행이 아예 없다는 뜻) |
| `closed_at` | timestamptz not null default now() | |
| `reopened_by` / `reopened_at` / `reopen_reason` | text / timestamptz / text (nullable) | 마감취소 — 사유 필수(애플리케이션에서 강제) |
| `created_at` | timestamptz | |

**제약**: `UNIQUE(period_year, period_month, version)`.

**"현재" 마감 상태 판단 로직** (`lib/attendance/closureLifecycle.ts`):
- 그 기간의 행을 전부 조회해 `version`이 가장 큰 행을 찾는다(`latestVersion`).
- 행이 하나도 없으면 → 한 번도 마감한 적 없음 → `open`.
- 최신 행의 `status`가 `'closed'`면 → 지금 잠겨있음(`closed`). `'reopened'`면 → 지금 열려있음(`open`, 재마감 가능).
- `canClose`/`canReopen`은 이 상태를 기준으로 마감·마감취소 버튼의 활성화 여부를 결정한다(Phase 4에서 UI에 연결).

이 방식으로 "최초마감→마감취소→재마감→재차마감취소→두번째재마감"을 전부 거쳐도 모든 버전 행이 테이블에 남고, 각 버전에 딸린 `attendance_closure_snapshot_rows`(§4)도 전부 독립적으로 보존된다 — `lib/attendance/closureLifecycle.test.ts`에서 이 전체 시나리오를 그대로 재현해 검증했다.

---

## 4. `attendance_closure_snapshot_rows` — 마감 스냅샷 (마스터 프롬프트 "마감 시점 데이터 스냅샷 저장" 구현체)

마감 버튼을 누르는 순간, 그 기간에 표시되던 그리드 한 줄 한 줄을 그대로 얼려서 저장한다. 연간 통합 명부는 이 테이블 12개월치를 이어붙이기만 하면 되므로, Project List가 나중에 바뀌어도 절대 흔들리지 않는다.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | uuid PK | |
| `closure_id` | uuid FK → `attendance_month_closures(id)` ON DELETE CASCADE | 마감 1건에 속한 스냅샷 행들(마감 자체를 취소/재마감하면 스냅샷도 다시 생성되므로 CASCADE 적절) |
| `project_id` | uuid FK → `projects(id)` ON DELETE RESTRICT | 조회 편의(스냅샷이어도 원본 참조는 유지 — 취소 안 함, 값은 아래 `*_snapshot`이 진실) |
| `project_name_snapshot` | text | 마감 시점의 프로젝트명 |
| `participant_id` | uuid FK → `project_participants(id)` ON DELETE RESTRICT | |
| `engineer_id` | uuid FK → `engineer_contacts(id)` ON DELETE RESTRICT | |
| `name_snapshot` | text | 마감 시점 성명 |
| `role_snapshot` | text | 마감 시점 직책 |
| `specialty_snapshot` | text | 마감 시점 분야명(조인 없이 바로 렌더링하도록 이름 텍스트로 저장) |
| `is_director_snapshot` | boolean | |
| `sort_order` | integer | 출력 순서 |
| `attendance_dates` | date[] | 그 기간 중 출근 처리된 날짜 배열(마감 시점의 `attendance_records`에서 복사) |
| `present_count` | integer | 출근일수(캐시 — 매번 배열 길이를 셀 필요 없이 바로 표시) |
| `note_snapshot` | text (nullable) | 마감 시점 비고(§6 참고) |

**참고**: `project_change_history`(§5)는 스냅샷을 별도로 뜨지 않는다 — 변경이력은 "발생일 기준 이력"이라 그 자체가 이미 불변(과거 이벤트를 수정하지 않는다는 원칙, §5). 출력 시점에 `change_date`가 해당 기간에 속하는 이력만 조회해 비고란에 조립하면 되고, 이는 마감 여부와 무관하게 항상 정확하다.

**`attendance_dates`/`present_count` 무결성 규칙 (사용자 검토 지시 #5)**

| 원칙 | 강제 방법 |
|---|---|
| 운영 조회·통계의 원본은 항상 `attendance_records` | 문서화(이 표) — `attendance_closure_snapshot_rows`는 절대 실시간 조회에 쓰지 않는다 |
| `attendance_dates`는 마감 당시 출력 재현 전용 | 문서화 + `lib/attendance/snapshotBuilder.ts`가 유일한 생성 경로 |
| 배열 값은 그 마감기간(`periodStart`~`periodEnd`) 안에 있어야 함 | **애플리케이션 레이어**에서 강제 — `buildAttendanceDatesForSnapshot()`가 기간 밖 날짜를 발견하면 조용히 버리지 않고 예외를 던진다. SQL `CHECK` 제약은 subquery를 쓸 수 없어 회계기간(21일~20일) 규칙을 SQL에도 재구현해야 하는데, 그러면 같은 규칙이 JS와 SQL 두 곳에 존재하게 된다(마스터 프롬프트가 경고하는 로직 중복) — 그래서 이 항목만 DB 레벨로 강제하지 않기로 했다 |
| 배열에 중복 날짜가 없어야 함 | **DB 트리거**로 강제(`attendance_closure_snapshot_rows_no_dup_dates`, BEFORE INSERT/UPDATE) — 회계기간 규칙과 무관한 순수 배열 무결성이라 subquery 제약 없이 트리거로 안전하게 구현 가능 |
| `present_count`는 배열 길이와 반드시 일치 | **SQL CHECK 제약**(`present_count = cardinality(attendance_dates)`) — subquery가 필요 없어 CHECK로 바로 강제 가능 |

**스냅샷 행 식별 — `UNIQUE(closure_id, participant_id)` 시나리오 검증 (사용자 검토 지시 #4)**

| 시나리오 | 결과 |
|---|---|
| 한 정산월 안에 단장 교체 | 기존 단장·신규 단장은 §1의 "새 행 추가" 규칙에 따라 **서로 다른 `participant_id`**를 가진 별개의 `project_participants` 행이다. 같은 `closure_id`에 두 개의 스냅샷 행(참여자별로 1개씩)이 생기며 `UNIQUE(closure_id, participant_id)`와 충돌하지 않는다. `lib/attendance/snapshotBuilder.test.ts`에서 이 시나리오를 그대로 재현해 검증했다. |
| 동일 기술인이 종료 후 재참여 | 재참여도 §1 규칙상 새 `project_participants` 행(새 `participant_id`)을 만든다 — 같은 `engineer_id`라도 `participant_id`가 다르므로 스냅샷 행도 별개다. |
| 기존 단장과 신규 단장이 같은 월에 모두 출근 | 위 "단장 교체" 시나리오와 동일 — 문제없다. |
| 참여자 원본이 비활성화 또는 삭제 처리됨 | 아래 "물리 삭제 정책" 참고 — `project_participants`는 물리 삭제가 구조적으로 불가능하므로(FK RESTRICT) 이 상황 자체가 발생하지 않는다. "비활성화"는 `status='종료'`로만 표현되고, 이미 생성된 스냅샷 행에는 영향이 없다(스냅샷은 `participant_id`만 참조하고 그 시점 값은 `*_snapshot` 컬럼에 이미 복사돼 있다). |

**물리 삭제 금지 정책 (사용자 검토 지시 #4 — "삭제 금지 또는 삭제 후에도 재현 가능한 구조")**

두 옵션 중 **"금지"를 선택**했다 — 스키마 전체에 걸쳐 `ON DELETE RESTRICT` 체인으로 강제한다:
- `project_participants.project_id → projects` RESTRICT, `project_participants.engineer_id → engineer_contacts` RESTRICT — 참여 이력이 하나라도 있으면 프로젝트·기술인 행 자체를 지울 수 없다.
- `attendance_records.*_id`(project/engineer/participant) 전부 RESTRICT — 출근기록이 있으면 그 어떤 상위 행도 지울 수 없다.
- `attendance_closure_snapshot_rows.*_id`(project/participant/engineer) 전부 RESTRICT — 스냅샷이 있으면(=한 번이라도 마감을 거쳤으면) 더더욱 지울 수 없다.

즉 "삭제 후에도 스냅샷이 재현되는 구조"를 별도로 만들 필요가 없다 — 애초에 참조가 하나라도 남아있으면 Postgres가 삭제 자체를 거부한다. 기존 코드베이스의 "행을 지우지 않고 상태만 바꾼다"는 관례(`overtime_employees.is_active`, `engineer_contacts.employment_status` 등)와도 정확히 일치한다.

---

## 5. `project_change_history` — 프로젝트 변경이력

Project List에는 이런 이력 테이블이 없다(`01-current-analysis.md` §6 근거) — 신규 생성 후 **출근부는 이 테이블을 연계해서 읽기만** 한다(중복 관리 금지, 마스터 프롬프트 지시).

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | uuid PK | |
| `project_id` | uuid FK → `projects(id)` ON DELETE RESTRICT | |
| `change_type` | text check in ('director_change','participant_change','cancelled','reannounced','amended','announce_date_change','interview_date_change','field_change','other') | |
| `change_date` | date not null | 발생일자 — 출력 시 날짜순 정렬·기간 필터링 기준 |
| `before_value` / `after_value` | text (nullable) | 예: "홍길동" → "김철수" |
| `memo` | text (nullable) | |
| `created_by` | text | |
| `created_at` | timestamptz | |

**Confirmed(사용자 확정 #2)**: `project_change_history`가 재공고/변경공고/공고취소 여부의 **공식 원본**이다. `projects`에 `is_reannounced`/`is_amended` 같은 boolean 컬럼을 두지 않는다 — 상태 컬럼과 이력 테이블 두 곳에 같은 사실이 존재하면 서로 어긋날 위험이 있기 때문. "재공고 여부" 배지가 필요하면 이 테이블에 `change_type='reannounced'` 이력이 있는지로 파생 조회한다. 목록 조회 성능이나 현재 상태 표시가 실제로 느려지면(Phase 2 이후 실측 후) `projects`에 캐시성 필드를 추가할 수 있다고 사용자가 승인했으나, **그 경우에도 공식 기준은 항상 이 테이블**이며 캐시 필드는 이 테이블의 최신 이벤트를 반영하는 파생값일 뿐이다 — Phase 1에서는 캐시 필드를 추가하지 않는다(필요성이 아직 실증되지 않음).

---

## 6. 비고 처리 방식 (신규 테이블 없음 — §5 재사용)

마스터 프롬프트는 "월별 출근명부 비고"와 "프로젝트 변경이력"을 구분하되 후자가 있으면 중복 관리하지 말라고 지시했다. 위 §5 하나로 통합한다:
- 월별 화면/출력의 "비고"란 = 해당 프로젝트의 `project_change_history` 중 `change_date`가 그 회계월(전월21~당월20) 범위에 속하는 행들을 날짜순으로 조립한 텍스트(마스터 프롬프트 예시 포맷 그대로: `03.14 단장 홍길동 → 김철수 변경` 등).
- 연간 출력의 "비고"/"연간 변경이력"도 동일 테이블에서 연간 범위로 조회.
- 첨부 엑셀에서 실측된 "날짜 셀에 직접 적힌 이벤트"(심사/교체/취소/재공고, §01문서 7.4)는 이 테이블의 `change_date`가 곧 그 날짜가 되도록 입력 UI에서 유도 — 별도의 "날짜 셀 이벤트" 개념을 새로 만들지 않는다.

---

## 7. `attendance_audit_log` — 감사이력

마감취소·과거기록수정·기간외 출근입력에 대해 감사이력을 남기라는 요구(마스터 프롬프트 12번)를 위한 범용 로그. 특정 도메인 테이블에 종속시키지 않고 범용으로 설계 — 이유: 감사 대상 액션이 여러 테이블(`attendance_records`, `attendance_month_closures`)에 걸쳐 있고, "무엇을, 누가, 왜" 기록하는 목적이 테이블마다 갈라질 필요가 없다.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | uuid PK | |
| `action_type` | text check in ('closure_reopen','past_record_edit','out_of_period_check','other') | |
| `table_name` | text | 대상 테이블명 |
| `record_id` | uuid (nullable) | 대상 행 ID |
| `actor` | text | 이메일 |
| `reason` | text | 사유(마감취소는 애플리케이션에서 필수 입력 강제) |
| `before_data` / `after_data` | jsonb (nullable) | |
| `created_at` | timestamptz | |

---

## 8. 권한 표현 (Confirmed — 사용자 확정 #6)

`01-current-analysis.md` §6 확인대로, 현재 `menu_permissions`(none/read/write 3단계)에는 "마감 권한"처럼 쓰기 권한과 분리된 개별 액션 권한 개념이 없다. 검토했던 3가지 대안:

| 방안 | 구현 | 장점 | 단점 |
|---|---|---|---|
| A. `ADMIN_EMAILS`만 마감 가능 | 코드 조건문만 추가, DB 변경 없음 | 가장 단순, 즉시 구현 가능 | 관리자가 아닌 팀장급 담당자에게 위임 불가 |
| B. `menu_permissions`에 4번째 값 추가(예: `'close'`) | `lib/menuConfig.ts`의 `MenuPermission` 타입 확장 | 기존 체계 재사용 | `'close'`는 다른 8개 메뉴에는 의미가 없는 값이라 타입 전체가 이 기능 하나 때문에 지저분해짐 |
| **C. `allowed_users.can_close_attendance boolean default false` 신설 — 채택** | 신규 컬럼 1개 + 관리자 화면에 체크박스 1개 | 기존 3단계 체계를 건드리지 않고 이 기능 전용 권한만 깔끔히 추가. `ADMIN_EMAILS`는 이 컬럼과 무관하게 항상 가능(기존 관례와 동일) | 이 기능에만 있는 특수 컬럼이 하나 생김(다만 향후 "마감 권한이 필요한 다른 기능"이 생기면 같은 패턴 재사용 가능) |

**사용자 확정**: C안 채택. `can_close_attendance`는 **월 마감과 마감취소 둘 다**를 통제한다("마감취소는 can_close_attendance 권한이 있는 사용자만 가능"). "출근기록 입력·수정"은 기존 `menu_permissions`의 `attendance` 키 write 권한으로 별도 통제되므로, 두 권한(입력·수정 vs 마감·마감취소)이 서로 분리된 축으로 존재한다 — write 권한자라고 자동으로 마감 권한을 갖지 않는다.

---

## 9. 신규 메뉴 키

`lib/menuConfig.ts`의 `RESTRICTABLE_MENU_ITEMS`에 `{ key: 'attendance', label: '기술인 출근부' }` 1건 추가(코드 변경 — DB 마이그레이션 아님, `06-implementation-plan.md`에서 다룸).

---

## 10. ERD 요약

```
projects (기존, 무변경)
  └─< project_participants >── engineer_contacts (기존)
         │                         │
         │                    engineer_specialties (기존, FK)
         │
         ├─< attendance_records >── engineer_contacts
         │     (closure_id 없음 — work_date로 회계기간을 역산해 판단)
         │
         └─< project_change_history

attendance_month_closures (period_year, period_month, version — 마감 시도마다 새 행)
  └─< attendance_closure_snapshot_rows >── project_participants / engineer_contacts / projects (참조용)

attendance_audit_log (독립 로그 테이블)
```

---

## 11. 재검토 반영 사항 요약 (2차 검토, 이번 문서에서 확정)

최초 Phase 1 승인 이후 사용자 지시로 재검토해 다음과 같이 확정했다 — 전부 Open Question이 아니라 **Confirmed**:

| # | 항목 | 확정 내용 |
|---|---|---|
| 1 | `project_participants` 유니크 제약 | 실측(엑셀 84개 전수 + 실제 DB 60건 전수) 결과 role/specialty 포함 불필요 — 기존 제약 유지 |
| 2 | `attendance_records.closure_id` | **제거**. `work_date` → 회계기간 라벨 역산으로 대체(`periodLabelForDate`) |
| 3 | `attendance_month_closures` | "기간당 1행" → **"마감 시도(버전)당 1행"**으로 변경. 재마감마다 새 버전 행 생성, 이전 버전은 보존 |
| 4 | 스냅샷 행 식별 | `UNIQUE(closure_id, participant_id)` 그대로 유지 — 버전마다 `closure_id`가 다르므로 문제없음. 물리 삭제는 RESTRICT 체인으로 전면 금지 |
| 5 | `attendance_dates`/`present_count` | present_count는 SQL CHECK로, 중복 날짜는 DB 트리거로, 기간 내 검증은 애플리케이션 레이어(`snapshotBuilder.ts`)로 각각 강제 |

남은 Open Question은 `02-requirements.md`의 것과 동일하며, 이번 재검토로 새로 발생한 미확정 사항은 없다.
