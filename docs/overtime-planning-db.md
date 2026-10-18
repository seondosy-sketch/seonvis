# 연장근무 자동배정 — DB 계약

> 상태: **초안. 어떤 DB에도 적용하지 않았다.** 운영 적용은 단위별로 별도 승인 후 아래 "적용 절차"대로 한다.
> 대상: 제안서팀 연장근무 `/overtime`. 실무자 연장근무(`/field-overtime`)는 범위 밖이지만 공용 객체
> (`overtime_employees`, `sync_team_employees`, `holidays`)를 바꾸므로 회귀 확인 대상이다.
> 관련: [overtime.md](./overtime.md), [database.md](./database.md), `lib/overtime/eligibility.ts`(대상기간 판정), `lib/overtime/sync.ts`(동기화 계획).

## 파일과 적용 단위

| 단위 | 파일 | 적용 시점 |
|---|---|---|
| **Migration A — 기반 스키마** | `supabase/migration_overtime_planning_a_base.sql` | Phase 4 이전 언제든 (A만으로 기존 수동입력·출력 정상) |
| **Migration B — 강제조건·RPC 활성화** | `supabase/migration_overtime_planning_b_activate.sql` | **Phase 4 화면 배포와 같은 배포** (A 필수) |
| **프로젝트 동기화 RPC** | `supabase/migration_overtime_project_sync_rpc.sql` | Phase 4 API route와 같은 배포 (A·B와 독립, 별도 승인) |
| **Migration C — 보정 (forward)** | `supabase/migration_overtime_planning_c_corrections.sql` | A·B(+월 목표·격리수준)가 이미 있는 DB(개발). 운영은 A·B 파일에 같은 수정이 있어 no-op — 순서상 월 목표 activation 뒤 |
| 점검 (읽기 전용) | `supabase/verify/overtime_planning_catalog.sql` | 카탈로그 확인 (완료, 2026-10-03) |
| | `supabase/verify/overtime_planning_preflight.sql` | A 직전, B 직전 각각 |
| | `supabase/verify/overtime_planning_postflight_a.sql` / `_b.sql` | A 직후 / B 직후 (결과 열 `verdict`) |
| | `supabase/verify/overtime_planning_current_postflight.sql` | A·동기화 RPC·B·월 목표·격리수준·C가 모두 적용된 **현재 상태** 전체 확인(`check_name, status, detail`). 정상이면 OK·INFO만 — A 직후용 a04·a10·a13처럼 정상 상태에서 FAIL이 나는 항목이 없다. 함수는 스키마.이름 + 인자 타입 단위로 catalog 속성(언어·변동성·DEFINER·search_path)과 본문 지문을 저장소 migration 체인의 최종 정의와 비교하고, 같은 이름의 다른 인자 함수는 따로 FAIL. 본문 지문의 MD5는 보안 인증이 아니라 일치 확인용이며, 작은따옴표 밖 공백 차이만 무시한다(리터럴 안 공백은 비교) |
| | `supabase/verify/overtime_planning_c_preflight.sql` / `_c_postflight.sql` | C 직전 / C 직후 (결과 컬럼 check_name / status / detail) |
| | `supabase/verify/overtime_employee_link_check.sql` | preflight p10·p11이 STOP일 때 — 미연결 직원·주소록 UUID 목록(이름은 화면 확인용) |
| | `supabase/verify/overtime_monthly_target_precheck.sql` | 월 목표 activation 직전 — 재직 직원 전원 목표 행 확인 |
| 복구 초안 | `supabase/verify/overtime_planning_c_rollback.sql` → `overtime_cap_isolation_guard_rollback.sql` → `overtime_monthly_target_rollback.sql` → `overtime_planning_rollback_b.sql` → `overtime_project_sync_rpc_rollback.sql` → `overtime_planning_rollback_a.sql` | 문제 시 (앞 단계가 남아 있거나 자동배정 데이터가 있으면 스스로 중단) |
| 개발 DB 시험 | `supabase/dev/overtime_confirm_holiday_test.sql`, `overtime_employee_link_test.sql`, `overtime_rollback_rehearsal_*.sql` | 아래 "Migration C" 절의 개발 DB 실행 순서 |
| 타입 | `lib/overtime/planningTypes.ts` | Phase 4부터 사용 |

점검 SQL은 전부 **SELECT 한 문장**이다(Supabase SQL Editor는 마지막 문장의 결과만 보여준다). 결과 컬럼은
`check_name / verdict / detail`, `fp_*` 행은 적용 전후 지문 비교용이다.

**의존성**: A → B (B 0단계가 A 객체를 확인). 동기화 RPC는 `overtime_projects`·`projects`만 써서 A·B와 무관.
**왜 둘로 나누나**: B를 먼저 적용하면 수동 입력에 주 12시간이 걸리는데 화면이 DB 오류 원문을 보여준다. B는 Phase 4의
사전검증·친화적 오류 안내와 같이 켠다. A만 적용된 상태에서는 `overtime_work_records`에 트리거가 없고(postflight a10),
클라이언트가 실행·초안·자동확정 기록을 만들 수 있는 경로도 없다(insert 정책 없음 + FK).

## 카탈로그 확인 결과 (2026-10-03, 운영 DB, 읽기 전용) — 설계 근거

| 항목 | 결과 |
|---|---|
| 버전 | PostgreSQL 17.6 |
| `overtime_work_records.hours` / `break_hours` | numeric(4,2) NOT NULL / numeric(3,1) |
| 기록 / 주 12시간 초과 주 / `engineer_contacts.employee_id` 중복 | 0 / 0 / 0 |
| 공휴일 | 2026년 16건 |
| `overtime_employees.name` UNIQUE | `overtime_employees_name_key` |
| `engineer_contacts.employee_id` UNIQUE | 없음 |
| 신규 테이블·RPC·정책 이름 충돌 | 없음 |
| 관련 테이블 RLS | 전부 활성, FORCE 아님. 기존 overtime 정책은 `private.menu_permission('overtime')`, roles=public |
| `private.menu_permission` | SECURITY DEFINER, STABLE |
| `private` 스키마 USAGE | anon·authenticated·service_role 모두 **없음** |
| `sync_team_employees` | SECURITY DEFINER, EXECUTE: postgres·authenticated·service_role |
| public 신규 함수 기본 ACL | anon·authenticated·service_role에 EXECUTE 자동 부여 → **모든 신규·교체 함수는 생성 직후 전부 회수 후 재부여** |
| overtime 관련 트리거 | 없음 |

## 보안 원칙

- 모든 함수: `SET search_path` 고정(`public, pg_temp` 또는 `pg_catalog, pg_temp` — pg_temp는 항상 마지막), 객체는 schema-qualified.
- 권한 판정은 `auth.jwt()`와 DB 원본(`allowed_users`, `private.menu_permission`)으로만. 이메일·관리자 여부를 인자로 받지 않는다.
- 동적 SQL 없음. 사용자 JSON은 정해진 키 이름으로만 읽고 식별자로 쓰지 않는다. 오류 메시지에는 내부 UUID·날짜만(이름 없음).
- `revoke … from public, anon, authenticated, service_role` 후 필요한 역할에만 `grant`. (`public` = PostgreSQL의 PUBLIC 의사 역할)
- `private` 스키마 USAGE는 어떤 클라이언트 역할에도 새로 주지 않는다.
- 신규 테이블 정책은 전부 `TO authenticated`. anon·PUBLIC 정책 없음. 기존 overtime 정책은 건드리지 않는다.

## 함수별 권한표

| 함수 | 단위 | DEFINER | EXECUTE (소유자 외) | 함수 안의 권한 확인 |
|---|---|---|---|---|
| `public.sync_team_employees()` (교체) | A | ✔ | authenticated, service_role (기존과 동일, anon 없음) | overtime 또는 field_overtime ≠ none |
| `private.overtime_week_start(date)` | A | ✘ (순수 계산) | 없음 | — |
| `private.overtime_pay_period(text)` | A | ✘ (순수 계산) | 없음 | — |
| `private.overtime_monthly_targets_touch()` 트리거 | A | ✘ | 없음 | — |
| `public.overtime_save_assignment_run(jsonb,jsonb)` | B | ✔ | authenticated | overtime = write |
| `public.overtime_confirm_run(uuid,uuid[])` | B | ✔ | authenticated | overtime = write |
| `public.overtime_discard_run(uuid)` | B | ✔ | authenticated | overtime = write |
| `public.overtime_unconfirm_drafts(uuid[])` | B | ✔ | authenticated | `allowed_users.is_admin` |
| `private.overtime_require_write()` / `_is_admin()` / `_week_total(...)` / `_assert_weekly_cap(...)` / `_refresh_run_status(uuid)` | B | ✔ | 없음 | — |
| `private.overtime_work_records_protect()` 트리거 | B | **✘ (호출자를 봐야 함)** | 없음 | current_user = 테이블 소유자? |
| `private.overtime_work_records_weekly_cap()` 트리거 | B | ✔ (RLS 무관 합산) | 없음 | — |
| `private.overtime_drafts_guard()` / `_runs_guard()` 트리거 | B | ✘ | 없음 | current_user = 테이블 소유자? |
| `public.overtime_apply_project_sync(jsonb,jsonb)` | 동기화 | ✘ (service_role은 RLS 우회 역할) | **service_role만** | — (API route가 사용자 권한 확인) |

트리거 함수는 트리거로만 실행된다(트리거 발동 시 EXECUTE 검사가 없으므로 모든 역할에서 회수해도 동작).
DEFINER가 아닌 private 함수는 DEFINER 함수 안에서(소유자 권한으로)만 불린다. INVOKER 트리거 본문은 private 객체를 부르지 않는다.

## 신규 테이블 RLS 정책표 (모두 TO authenticated)

| 테이블 | SELECT | INSERT | UPDATE | DELETE | 비고 |
|---|---|---|---|---|---|
| `overtime_monthly_targets` | overtime ≠ none | write | write | write | A |
| `overtime_member_tasks` | overtime ≠ none | write | write | write | A |
| `overtime_assignment_runs` | overtime ≠ none | — | — | — | A. 생성·변경은 B의 DEFINER RPC만 (트리거도 소유자 맥락만 허용) |
| `overtime_assignment_drafts` | overtime ≠ none | — | write (**B에서 추가**) | — | 생성·삭제·상태전이는 RPC만. 담당자 수정은 트리거가 잠금 처리 |
| `holidays` | `overtime_select` 추가 (overtime ≠ none) | 기존 | 기존 | 기존 | 기존 menu_* 4개·field_overtime_select 유지 |

service role 작업(동기화 RPC)은 `overtime_projects`만 바꾸고, authenticated 작업은 위 정책 + RPC 경로로만.

## 보호 방식: GUC 대신 "소유자 맥락" (Phase 3A 초안에서 변경)

초안은 RPC가 `set_config('overtime.rpc','on', true)`를 켜고 트리거가 그 값을 보는 방식이었다.
- 검토: 클라이언트(PostgREST)는 임의 SQL·`set_config`를 호출할 경로가 없고 노출된 public 함수 중 이를 대신하는 것도 없어
  현재 구조에서 직접 우회 경로는 찾지 못했다. 그러나 **설정값은 권한이 아니다** — 앞으로 SQL을 실행하는 함수나 확장이 하나라도
  노출되면 같은 값을 SET해 보호를 풀 수 있다.
- **최종안**: 보호 트리거를 SECURITY INVOKER로 두고 `current_user`가 **테이블 소유자**인지 본다. 자동배정 RPC는 SECURITY DEFINER이고
  테이블 소유자가 소유하므로 RPC 안의 쓰기는 소유자 맥락이다. 브라우저·service role의 직접 쓰기는 current_user가
  `authenticated`/`service_role`이라 막힌다. 바꿀 수 있는 값이 아니라 **역할(권한)** 에 의존한다.
- 전제: RPC 소유자 = 테이블 소유자 (preflight p15, postflight b02로 확인). 소유자 권한의 DB 관리자는 막지 않는다
  (그 권한이면 트리거를 끌 수 있으므로 보안 경계가 아니다).
- 남는 위험: 소유자가 소유한 다른 DEFINER 함수가 연장근무 테이블을 쓰면 같은 맥락이 된다. 현재 그런 함수는 이번에 만드는 RPC뿐이다
  (기존 DEFINER 함수 `menu_permission`·`can_view_private_legacy`·`evaluation_review_visible`·`sync_team_employees`는 해당 테이블을 쓰지 않음).
  앞으로 DEFINER 함수를 추가할 때 검토 항목으로 둔다.

## 테이블

### overtime_monthly_targets — 월 목표시간 (A)
employee_id(FK RESTRICT), period_label(`'YYYY-MM'` = 전월 21일 ~ 당월 20일, CHECK), target_hours numeric(5,2) ≥ 0,
created/updated_at·by. UNIQUE(employee_id, period_label).
- **행 없음 = 월 목표시간 미입력** → 자동배정 초안 저장·확정 차단(`OVERTIME_MONTHLY_TARGET_MISSING`). 수동입력은 무관.
- **0시간 = 유효** → 자동배정 결과 0건(초안이 하나라도 있으면 합계 > 0 > 목표로 차단). 기존 수동기록은 지우지 않는다.
- 수동기록 합계가 목표보다 크면 그 직원의 초안 저장은 차단된다(엔진은 미리 경고·0건 처리).
- 2·3시간 조합으로 못 만드는 목표도 저장 허용 — 엔진이 가능한 만큼 배정하고 미배정 사유를 낸다.

### overtime_member_tasks — 직원×프로젝트 담당업무 (A)
복합 FK (member_id, employee_id) → members(id, employee_id), (task_id, employee_id) → tasks(id, employee_id), 둘 다 CASCADE.
UNIQUE(member_id, task_id). 같은 `employee_id`를 공유하므로 "같은 직원"이 선언적으로 보장된다(트리거·RPC보다 단순, 우회 불가).
참여관계에 행이 0건이면 그 직원의 기본업무 전체를 쓴다(애플리케이션 계약).

### overtime_assignment_runs — 실행 기록 (A, 생성·변경은 B)
period_label, seed, scope(+ scope_employee_id/scope_project_id, CHECK로 조합 고정), rule_version, input_snapshot
(내부 ID·기간·목표·프로젝트 날짜·업무 관계만), result_summary, status, created_by, created/updated/confirmed/discarded_at.

```
draft ─일부 확정→ partially_confirmed ─나머지 확정→ confirmed
draft/partially_confirmed ─새 실행이 남은 초안 대체→ superseded (확정분이 있으면 confirmed)
draft/partially_confirmed ─overtime_discard_run→ discarded (확정분이 있으면 confirmed)
confirmed ─관리자 확정취소→ partially_confirmed / draft
```

### overtime_assignment_drafts — 초안 (A, 보호·RPC는 B)
run_id, employee_id, project_id, work_date, task_id(FK SET NULL) + task_name(스냅샷), time_type(`2h`/`3h`),
start/end/break_hours/hours(프리셋, 정밀도는 최종기록과 같음), is_weekend/is_holiday(DB 계산), exception_reason,
manually_edited, locked, status, confirmed_at.

| 강제조건 | 수단 |
|---|---|
| 2h/3h 프리셋만 | CHECK + B 트리거가 프리셋 값으로 덮어씀 |
| 하루 한 프로젝트 | partial UNIQUE (employee_id, work_date) WHERE status IN ('draft','confirmed') |
| 주말·공휴일 ⇒ 사유 필수, 평일 ⇒ NULL | CHECK + B 트리거(INSERT에 사유 없으면 거부, 평일은 NULL로). 트리거는 편집 가능한 상태(INSERT, draft→draft)에서만 달력 값을 다시 계산하고, 상태 전이·draft 아닌 행은 저장된 값을 유지 |
| 생성·삭제·상태전이는 RPC만 | insert/delete 정책 없음 + B 트리거(소유자 맥락) |
| 수동 수정 ⇒ 잠금 | B 트리거가 manually_edited·locked = true |
| 재확정·취소초안 확정 방지 | 확정 RPC가 status='draft'만 + 최종기록 assignment_draft_id UNIQUE |

업무는 FK + 이름 스냅샷 둘 다 저장(FK = 허용업무 검증·재배정, 스냅샷 = 업무 삭제·이름 변경 후에도 보존).

### overtime_work_records 추가 컬럼 (A, 전부 nullable·기본값 없음)
| 컬럼 | 의미 |
|---|---|
| source | NULL = 기존(수동)기록 · `manual` = B 이후 신규 수동(트리거가 채움) · `auto` = 자동배정 확정 |
| assignment_run_id / assignment_draft_id / confirmed_at | auto일 때만, 셋 다 필수 (CHECK). draft_id UNIQUE |
| employee/project/task_name_snapshot | 신규 확정 기록부터. backfill 없음 |
| **assignment_exception_reason** | 자동배정 주말·공휴일 사유. auto만 허용, auto+주말이면 필수(CHECK), 공휴일은 확정 RPC가 초안에서 복사해 보장. **`note`(수동 메모)와 분리** — 확정 기록의 note는 빈 문자열 |

`task_description`은 계속 쓴다(출력 호환) — auto 기록은 업무명을 여기에도 넣는다. auto 기록은 직원·근무일당 1건(partial UNIQUE).
수동 기록의 같은 날 여러 건은 제한하지 않는다(기존 구조).

## 주 12시간 DB 방어 (B)

- 주 = 월~일 (`date_trunc('week', date::timestamp)` — 세션 타임존 무관). 모든 프로젝트 합산.
- 규칙 함수 하나(`private.overtime_assert_weekly_cap`)를 트리거(`overtime_work_records_b_weekly_cap`)와 확정 RPC(트리거 경유)가 공유.
  초안 저장 RPC는 같은 기준으로 (최종기록 + draft 초안) 합계를 검사.

| 변경 | 판단 |
|---|---|
| INSERT | 변경 후 > 12면 거부 |
| UPDATE 같은 직원·같은 주 | 변경 전 시간을 기존 합계에 포함 → 과거 초과 주에서도 줄이거나 그대로면 허용, 늘리면 거부 |
| UPDATE 다른 주로 / 직원 변경 | 대상 주 기준 |
| UPDATE 직원·날짜·시간 그대로 | 검사 생략 |
| DELETE | 검사 안 함 |

같은 직원·주의 동시 변경은 advisory lock으로 직렬화. 과거 초과 기록은 그대로 둔다(현재 0건, B 직전 preflight p06으로 재확인).
Phase 4 화면은 저장 전에 같은 기준으로 사전검증하고 `현재 배정시간 / 12시간`을 보여준다. DB 오류는 최종 방어선이며,
화면은 `OVERTIME_DB_ERRORS` 접두어로 판별해 친화적 문구로 바꾼다(원문 노출 금지).

## 자동확정·확정취소 (B)

**저장** `overtime_save_assignment_run(p_run, p_drafts) → run id` (write)
급여기간 연도의 공휴일 데이터 존재(없으면 `OVERTIME_HOLIDAYS_MISSING`) → 급여기간 advisory lock → 실행 기록 생성 →
초안의 선택 키 `is_holiday`가 지금 공휴일 표와 다르면 `OVERTIME_HOLIDAY_CHANGED`(errcode 55000, 아무것도 쓰기 전) →
범위 안 잠기지 않은 draft를 superseded → 초안 삽입(시간·업무명·주말/공휴일은 DB가 채움) → 재검증(급여기간·범위·재직·참여·
프로젝트 진행중이고 기간 안·허용업무) → 주 12시간(기록+초안) → 월 목표 행 있음 & 합계 ≤ 목표 → 이전 실행 상태 갱신.

**확정** `overtime_confirm_run(p_run_id, p_employee_ids = null) → {confirmed, run_status}` (write)
실행 행 FOR UPDATE + advisory lock → status='draft' 초안만 FOR UPDATE → 재검증(급여기간·재직·참여·기간·같은 날 auto 없음) →
초안마다 확정 직전 달력 재계산 1회(draft→draft UPDATE — 트리거가 지금 공휴일 표로 주말·공휴일·사유 계산, 새로 공휴일이 된 날에
사유가 없으면 고정 문구 **`확정 시 공휴일 변경 반영`**, 더 이상 주말·공휴일이 아니면 NULL) → 다시 읽은 그 값으로 최종기록 생성
(source=auto, 스냅샷, 예외사유는 전용 컬럼, note 빈 값; 주 12시간은 트리거) → 초안 confirmed(상태만 바꾸는 UPDATE라 트리거가
달력 값을 다시 계산하지 않음 → 기록과 초안의 사유가 같게 남는다) → 월 목표 확인 → 실행 상태.
하나라도 실패하면 전체 롤백. 동시 호출은 행 잠금 + UNIQUE로 같은 초안이 두 번 확정되지 않는다.

**확정취소** `overtime_unconfirm_drafts(p_draft_ids) → {unconfirmed}` (**관리자만**, `allowed_users.is_admin`)
초안 confirmed + 연결된 최종기록 존재 + 최종기록의 (source, run_id, 직원, 프로젝트, 날짜, 시간, 시작/종료/휴게, 업무명,
업무명 스냅샷, 예외사유, 확정시각)이 초안과 모두 같을 때만 최종기록 삭제·초안 draft 복귀. 하나라도 다르면 `OVERTIME_CONFIRMED_RECORD_CHANGED`.
확정 뒤 공휴일이 바뀌어도 초안 스냅샷은 바뀌지 않으므로(위 확정 절차) 취소할 수 있다. 외부 경로로 auto 기록이 바뀌면 계속 거부.
(Migration C 이전에는 확정 시 상태만 바꾸는 UPDATE에서 트리거가 공휴일을 다시 계산해 초안 사유만 달라졌고, 그 날은 영구히 취소 불가였다.)

**폐기** `overtime_discard_run(p_run_id) → {discarded}` (write) — 남은 draft만 discarded, 확정분 유지.

**자동확정 기록 보호**: 보호 트리거가 소유자 맥락이 아닌 UPDATE·DELETE를 막는다(`OVERTIME_AUTO_RECORD_LOCKED`).
수동 기록(source NULL·manual)은 기존처럼 수정·삭제 가능. source 변경은 NULL→manual만.

**프로젝트 기간 기준**: 저장·확정 RPC는 `overtime_projects`(동기화 사본)의 status·기간을 본다 → 동기화 C안으로 사본을 신뢰할 수 있게 한다.

**오류 접두어** (`planningTypes.ts OVERTIME_DB_ERRORS`): `OVERTIME_WEEKLY_CAP`, `OVERTIME_MONTHLY_TARGET_MISSING`, `OVERTIME_MONTHLY_TARGET`,
`OVERTIME_HOLIDAYS_MISSING`, `OVERTIME_DRAFT_INVALID`, `OVERTIME_CONFIRM_INVALID`, `OVERTIME_AUTO_RECORD_LOCKED`, `OVERTIME_RUN_NOT_CONFIRMABLE`,
`OVERTIME_HOLIDAY_CHANGED`(55000, 저장), `OVERTIME_EMPLOYEE_LINK_REQUIRED`(55000, 직원 동기화).

## 직원 식별자 (A)

- 연결키 = `engineer_contacts.employee_id`. partial UNIQUE `engineer_contacts_employee_id_key` → 직원 1명 ↔ 기술인 최대 1명
  (기술인 → 직원은 컬럼 하나라 원래 최대 1명).
- `overtime_employees_name_key` 제거 → 동명이인 허용. 이름은 연결 판단에 쓰지 않는다.
- `sync_team_employees()` 최종안:
  0. **직원 분리 방지**: 미연결 '미래사업팀' 주소록(preflight p11)과 주소록 미연결 재직 직원(p10)이 **둘 다** 있으면 아무것도 바꾸지 않고
     `OVERTIME_EMPLOYEE_LINK_REQUIRED`(55000). 그대로 두면 첫 동기화가 같은 사람을 새 UUID로 만들고 기존 행을 비활성으로 돌려
     과거 기록·목표·업무·참여가 옛 UUID에 남는다. 자동 이름 매칭은 하지 않는다 — `supabase/verify/overtime_employee_link_check.sql`로
     UUID를 보고 사람이 주소록 행의 `employee_id`를 지정한 뒤 preflight를 다시 실행한다(p10·p11 둘 다 STOP).
     같은 조건을 migration A 0단계와 Migration C 0단계도 확인한다. 한쪽만 있으면 아래 1·3 규칙 그대로.
  1. 미연결 미래사업팀 기술인 → 항상 새 직원 행 생성·연결 (이름 매칭 없음, 재직 상태면 활성). FOR UPDATE + UNIQUE로 동시 호출 이중 생성 방지
  2. 연결된 직원 → 이름·직급·재직(= 미래사업팀 AND 재직)을 주소록 값으로. 바뀐 행만 UPDATE
  3. 연결이 끊긴 직원 → 비활성. 주소록에 미래사업팀 재직자가 0명이면 데이터 사고로 보고 건너뜀
  - DB 안에서 주소록 전체를 소유자 권한으로 읽으므로 RLS·네트워크로 "일부만 읽히는" 일이 없고, 실패하면 전체 롤백 →
    조회 실패를 퇴직으로 오판하는 경로가 없다.
  - 재연결: 주소록에서 그 기술인의 `employee_id`를 기존 직원 id로 지정하면 다음 동기화에서 2)가 재활성화한다(관리 화면은 Phase 4 검토).
  - 행 삭제 없음 → 과거 기록·참여·업무 보존.
- 현재 9명은 전부 연결돼 있고 주소록 값과 같다(그중 1명은 비활성 — 재직 8명이 월 목표 대상) → 적용·동기화 시 UPDATE 0건(preflight p08·p09·p10, postflight a14·a15·fp_linked_employees).
- 이름 기반 수동 프로젝트 전환(`lib/overtime/sync.ts`)은 별개 — Phase 4 코드 항목.

## 프로젝트 동기화 — C안 (최종)

1. Next.js API route(Phase 4)가 로그인과 `menu_permission('overtime') ≠ none`을 서버에서 확인
2. 서버가 `planBidProjectSync`(TS, 테스트 완료)로 계획 생성 — 판정 규칙은 TS 한 곳
3. 서버 환경 service role로 `overtime_apply_project_sync(p_inserts, p_updates)` 1회 호출 → 한 트랜잭션 반영
4. service role key는 브라우저 번들·응답·로그에 넣지 않는다. 서버 로그에 개인정보·자격증명 출력 금지

RPC: service_role만 EXECUTE · advisory lock · patch 키 허용목록 · 반영 후 값을 `projects` 원본과 대조(이름 = 원본, 시작일 = 공고일,
종료일 ∈ {제출일, 면접일, 개찰일}, 원본이 진행중이 아니면 종료, 신규는 진행중만, 수동 행은 전환 때만) · 없는 행 갱신 거부 ·
insert(on conflict do nothing)/update만 · 같은 값이면 쓰지 않음 · members·tasks·records 미접촉.
예상 변경: Phase 2 dry run(2026-10-03 기준) UPDATE 20, INSERT 0, DELETE 0 — 적용 직전에 그날 기준으로 다시 계산해 보고한다.

## 적용 절차 (각 단계 별도 승인)

**Migration A** (Phase 4 이전 가능)
1. preflight 실행 → STOP 없음, `p01_state_A = A 미적용`, fp_* 기록
2. A 실행 (한 트랜잭션)
3. postflight_a → 전부 OK, fp_*가 1과 같음
4. 회귀: `/overtime` 수동 입력·수정·삭제·출력, `/field-overtime`, 휴가관리·숙박관리 직원 목록, 주소록 연동

**Migration B + 동기화 RPC** (Phase 4 배포와 같이)
1. 2027년 공휴일 등록 여부 확인(별도 운영 작업, 12/21 전), preflight 실행 → `p01 = A 적용됨`, `p02 = B 미적용`, p06 재확인, fp_* 기록
2. B 실행 → (동기화 RPC 실행) → Phase 4 코드 배포
3. postflight_b → 전부 OK, fp_* 일치
4. 회귀: 수동 입력의 12시간 안내, 자동배정 저장·확정·취소, 동기화

문제 시 아래 "되돌리기 순서" 그대로. B·A 되돌리기는 자동배정 데이터나 앞 단계 객체(월 목표 강제조건)가 있으면 스스로 중단한다.

**Migration C (A·B가 이미 적용된 DB — 개발 DB)**
1. `overtime_planning_c_preflight.sql` → STOP 없음(A·B 적용, 직원 연결 c_pre06), fp_* 기록
2. `migration_overtime_planning_c_corrections.sql` (한 트랜잭션, 함수 4개 create or replace + 같은 revoke/grant, 데이터 변경 없음)
3. `overtime_planning_c_postflight.sql` → 전부 OK·INFO, fp_other_functions·fp_triggers·fp_planning_rows가 1과 같음
   이어서 `overtime_planning_current_postflight.sql` → FAIL 0(전부 OK·INFO). A 직후용 `overtime_planning_postflight_a.sql`은 B 적용 뒤에는 쓰지 않는다
   개발 DB에 실제 관리자(`allowed_users.is_admin = true`)가 0명이면 관리자 검사를 완화하지 않고 시험 계정만 잠시 승격한다:
   `supabase/verify/admin_flag_preflight.sql`(관리자 수) → 0명일 때만 `supabase/dev/overtime_test_admin_enable.sql`
   (개발 DB 가드 → 고정 시험 계정 1행의 is_admin false→true만, 다른 열·행 불변 확인, 다른 관리자가 있으면 중단) →
   시험 → 성공·실패와 관계없이 마지막에 `supabase/dev/overtime_test_admin_restore.sql`(true→false) → `admin_flag_preflight.sql`로 시험 전 관리자 수로 돌아왔는지 확인.
   안전장치 자체는 `supabase/dev/overtime_test_admin_toggle_test.sql`(하위 트랜잭션 안에서 두 번 실행·0행·운영 흔적·다른 관리자 시나리오, 변경 남기지 않음)로 먼저 확인한다.
   공휴일 확정·취소 시험은 이 승격과 무관하게 자기 시험 관리자 행(`ot-holiday-admin@example.invalid`, is_admin = true)을 만들고
   그 JWT + `authenticated` 역할로 `overtime_unconfirm_drafts`를 불러 실제 `private.overtime_is_admin()` 경로를 시험한 뒤 모두 되돌린다.
4. 개발 시험: `supabase/dev/overtime_confirm_holiday_test.sql`(공휴일 추가→확정→공휴일 변경→관리자 확정취소),
   `supabase/dev/overtime_employee_link_test.sql`(p10·p11 네 경우) — 둘 다 하위 트랜잭션을 되돌려 데이터가 남지 않는다
5. (선택) 전체 되돌리기 리허설 `supabase/dev/overtime_rollback_rehearsal_1_state.sql` → `_2_c` → `_3_isolation` → `_4_monthly`
   → `_5_purge` → `_6_b` → `_7_sync_rpc` → `_8_a` (각 단계 뒤 `overtime_rollback_rehearsal_check.sql`) → `_9_forward`의 목록대로
   A → 동기화 RPC → B → 월 목표 → 격리수준 → C 재적용 → `_10_compare`. **개발 DB의 자동배정 데이터를 지운다**(파일 맨 위 경고,
   `set local overtime.rehearsal_ack = 'yes'` 주석을 풀어야 실행됨). strict 메뉴 권한·공용 표 RLS는 리허설이 건드리지 않으므로
   다시 적용하지 않는다. 리허설 전과 `overtime_ui_seed.sql` 복원 뒤에 `supabase/dev/overtime_rollback_rehearsal_baseline.sql`
   (읽기 전용 58행, 건수·참거짓·md5만)을 실행해 비교한다 — `d03`(메뉴 권한 함수)·`d07`(공용 표 정책)과 seed 고정 행 밖 데이터
   지문(`e01`~`e12`)은 같아야 한다. seed 복원 뒤 기대: 시험 직원 4명·업무 12건·수동 기록 3건·월 목표 4건(2026-10 3명, 2026-09 1명)·
   참여 0건·실행 0건·초안 0건·시험 입찰 프로젝트 5건·시험 계정 `is_admin=false`.

C와 기존 migration의 관계: 신규 설치(운영)는 수정된 A·B만으로 같은 결과가 나오고 C는 no-op 재적용이다. 이미 A·B가 있는 DB는
C가 forward 보정이다. 함수 본문은 A·B와 글자 그대로 같다(`lib/overtime/sql/overtimeSql.test.ts`).

### 되돌리기 순서 (전체)

되돌리기 순서: overtime_planning_c_rollback → overtime_cap_isolation_guard_rollback → overtime_monthly_target_rollback → overtime_planning_rollback_b → overtime_project_sync_rpc_rollback → overtime_planning_rollback_a

- 격리수준 되돌리기가 월 목표 되돌리기보다 **먼저**다. 격리수준 되돌리기는 월 목표·주 12시간 검사 함수를 "지금 있을 때만" 원래 본문으로
  바꾼다(반대 순서로 실행해도 월 목표 함수를 되살리지 않음 — 되살아나면 A 되돌리기가 월 목표 잔존 검사에서 멈췄다).
- 동기화 RPC는 A·B와 독립이라 위치는 편의상 B 뒤·A 앞(화면을 구버전으로 되돌린 뒤에만).
- 월 목표 선입력 되돌리기(`supabase/prod/overtime_monthly_targets_3_rollback.sql`)는 데이터용이며 activation 전에만 쓴다(이 순서와 별개).

## 기존 데이터 영향

- A·B 모두 기존 행 UPDATE/DELETE 0건, `hours` 재계산 없음, 이름 backfill 없음, 새 테이블 비어 있음.
- 새 CHECK는 기존 행(source NULL)이 항상 만족 — 기록 0건 가정에 의존하지 않는다.
- A 적용 후 동작 변화: 동명이인 직원 생성 가능, overtime 권한 사용자 공휴일 조회 가능, 주소록 연결이 끊긴 직원 비활성(현재 0명).
- B 적용 후 동작 변화: 수동 입력에 주 12시간, 신규 수동기록 source='manual', 자동확정 기록 직접 수정·삭제 불가.

## 화면·API 연결 (Phase 4)

| 위치 | 하는 일 |
|---|---|
| `app/api/overtime/sync-projects/route.ts` | 프로젝트 동기화(C안). 로그인·연장근무 권한(none 아님)을 서버에서 확인 → `planBidProjectSync` → service role로 `overtime_apply_project_sync` 1회 호출. 응답은 건수와 `attention`(확인 필요·배정 불가)만, 로그는 오류 코드만 |
| `lib/overtime/sync.ts` `requestProjectSync` | 브라우저가 위 API를 부른다(브라우저가 overtime_projects에 직접 쓰던 방식 제거) |
| `lib/overtime/weeklyCap.ts` | 수동 입력 3경로(셀 팝오버·일괄 입력·직원별 모달)의 저장 전 주 12시간 사전검증 — DB 트리거와 같은 규칙. 최종 판단은 트리거 |
| `lib/overtime/planning/errors.ts` | DB 오류 코드 → 한국어 안내문. 원문은 화면에 내보내지 않는다 |
| `lib/overtime/planning/input.ts` | DB 행 → 엔진 입력. 대체되지 않는 초안(잠김·수동 수정·범위 밖)은 잠금 기록으로 넘긴다 — `overtime_save_assignment_run`과 같은 조건 |
| `app/(dashboard)/overtime/plan/` | 자동배정 화면: ① 설정(월 목표·참여 프로젝트·업무) ② 자동배정 미리보기·다시 섞기·초안 저장 ③ 초안 수정(2h/3h·업무·빼기), 전체/직원별 확정, 초안 버리기, 관리자 확정 취소 |

- 자동확정 기록(`source = 'auto'`)은 기존 입력 화면에서 "자동" 표시와 함께 보기만 된다(수정·삭제 버튼 없음).
- 실행 기록 `input_snapshot`·`result_summary`에는 내부 ID·기간·목표·시간·이슈 코드만 넣는다(이름 없음).
- 관리자 버튼(확정 취소) 표시와 실제 허용 모두 DB의 `allowed_users.is_admin`(화면은 서버가 매 요청 조회). `ADMIN_EMAILS`는 쓰지 않는다.

### 개발용 DB로 화면 확인

- `supabase/dev/run-dev-server.mjs` (`node supabase/dev/run-dev-server.mjs`, 포트 3100): `.env.dev.local` 값으로 next dev 실행.
  개발 ref ≠ 운영 ref, service role key 다름을 확인한 뒤에만 시작한다. 외부 연동(Google 캘린더·Gemini) 키는 비운다.
- `supabase/dev/overtime_ui_seed.sql` / `overtime_ui_seed_cleanup.sql`: 시험직원 4명·업무 12건·입찰 5건·수동 기록 3건·월 목표 4건(2026-10 3명, 2026-09 1명) 등 가짜 데이터와 정리. 참여·실행·초안은 넣지 않는다.
- 시험 로그인 계정(`ot-ui-test@example.com`)은 개발용 Supabase Authentication에서 사람이 직접 만든다.

## 월 목표시간 = 급여기간 총 한도 (수동 입력 포함)

월 목표시간은 자동배정 참고값이 아니라 급여기간(전월 21일~당월 20일) 직원별 **총 연장근무 한도**다.
합산 = 그 기간의 모든 기록(수동·자동확정, 모든 프로젝트).

| 상황 | 결과 |
|---|---|
| 목표 행 없음(또는 null) | 합계가 줄어드는 수정만 허용, 그 외 `OVERTIME_MONTHLY_TARGET_MISSING` |
| 변경 후 합계 ≤ 목표 | 허용(같아도 허용, 목표 0이면 양수 입력 전부 차단) |
| 변경 후 합계 > 목표 | 합계가 줄어드는 수정만 허용, 그 외(같거나 증가) `OVERTIME_MONTHLY_TARGET_EXCEEDED` |
| 직원·날짜·시간 그대로인 수정(업무명·비고·시각) | 검사 안 함 |
| 다른 급여기간으로 날짜 이동 | 도착 기간만 검사(출발 기간은 줄기만 함) |
| 삭제 | 검사 안 함(자동확정 기록 삭제 금지는 `a_protect`가 계속 막음) |
| 목표를 기존 합계보다 낮춤 | 기록은 그대로, 설정 화면에 "목표 초과 N시간" 표시, 이후 증가만 차단 |

- 화면: `lib/overtime/monthlyCap.ts` `precheckManualSave` — 3경로(셀 팝오버·일괄 입력·직원별 모달) 공통.
  검사 순서: 필수 입력·시간 산출 → 자동확정 잠금 → 월 목표 존재 → 월 목표 초과 → 주 12시간 → 저장.
- DB: `supabase/migration_overtime_monthly_target_guard.sql` — 트리거 `overtime_work_records_ab_monthly_target`
  (순서: `a_protect` → `ab_monthly_target` → `b_weekly_cap`). 누가 실행하든(authenticated·service_role·RPC) 적용,
  같은 직원·급여기간 advisory lock으로 직렬화. 되돌리기: `supabase/verify/overtime_cap_isolation_guard_rollback.sql` →
  `supabase/verify/overtime_monthly_target_rollback.sql` (격리수준 먼저).
- 오류 문구: `friendlyOvertimeError`가 트리거 메시지에서 급여기간·목표·현재·입력 후·초과시간만 뽑아 보여준다.

### 부분 자동배정 (`lib/overtime/planning/partial.ts`)

- 제외: 그 직원의 error 이슈, `OVERTIME_MONTHLY_TARGET_MISSING`, `TARGET_BELOW_LOCKED_HOURS`(목표 초과 상태), `EMPLOYEE_INACTIVE`.
- 저장 가능 = 엔진 결과 정상 && 정상 직원 ≥ 1명. 저장하는 초안은 정상 직원 것만.
- 실행 기록 `result_summary`에 `included_employee_count`·`assigned_employee_count`·`excluded_employee_count`·`excluded[{employee_id, code}]`.

## 운영 적용 준비 (Phase 5A)

- 순서·확인·되돌리기 기준: `supabase/prod/overtime_prod_checklist.md`
- 월 목표 강제조건은 운영에서 `supabase/prod/overtime_monthly_target_activation.sql` 한 트랜잭션으로 켠다
  (원본 `migration_overtime_monthly_target_guard.sql` + `migration_overtime_cap_isolation_guard.sql` 본문을 그대로 묶은 생성물).
- 월 목표 선입력: `supabase/prod/overtime_monthly_targets_1_list.sql`(ID 목록) → `_2_apply.sql`(검사·적용, 기본 `v_apply = false`, 재직 8명 × 급여기간) → `_3_rollback.sql`(기본 검사만, 지정 ID × 급여기간 = `v_expected` × 기간 수(16)행이 정확히 있을 때만 지우고 삭제 행·잔여·범위 밖 행을 다시 확인).
  rollback은 지금의 재직 미래사업팀 여부를 묻지 않는다(그 사이 비활성·주소록 변경돼도 2단계가 넣은 행을 되돌릴 수 있게) — ID 존재와 정확한 행 수로 막는다.
  두 파일 결과표 맨 앞 t00·r00은 같은 트랜잭션의 DO 블록 결과일 때만 OK — 결과 SELECT만 골라 실행하면 FAIL.
  두 파일은 맨 바깥에서 표에 쓰지 않는다 — 입력값은 DO 블록 안 배열 변수, 결과는 마지막 SELECT(운영 SQL Editor가 맨 바깥 임시표 쓰기를 실행 전 42P01로 막았다)
- 선입력 확인: `supabase/verify/overtime_monthly_target_precheck.sql`(재직 직원 전원 목표 행, 라벨은 파일 맨 위 [설정]) — FAIL 0일 때만 activation.
  activation 맨 앞 DO 블록도 오늘(Asia/Seoul) 급여기간 라벨로 다시 확인하고, 21일 경계 7일 전(14~20일)이면 다음 급여기간 목표까지 요구한다
  (경계 직전에 켜면 다음 날부터 목표 없는 전원의 수동 입력이 막히므로 일부러 막는다 — 그 기간에는 다음 기간 목표를 먼저 넣는다).
- 되돌리기 추가: `supabase/verify/overtime_project_sync_rpc_rollback.sql`, A 되돌리기는 월 목표 강제조건이 남아 있으면 중단
- Migration C는 activation 뒤(체크리스트 7단계). 운영 A·B는 수정본이라 C는 no-op 확인용.
- 별건: `allowed_users` RLS 재귀 수정 `supabase/migration_allowed_users_rls_recursion_fix.sql`(+ rollback, dev 확인 `supabase/dev/allowed_users_rls_check.sql`)
