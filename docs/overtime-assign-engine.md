# 연장근무 자동배정 엔진 (Phase 4A)

> 순수 TypeScript — DB·Supabase·React에 의존하지 않는다. 위치 `lib/overtime/assign/`.
> DB 계약은 [overtime-planning-db.md](./overtime-planning-db.md), 대상기간 판정은 `lib/overtime/eligibility.ts`.
> 화면 `app/(dashboard)/overtime/plan`이 미리보기에 쓰고, 결과를 `overtime_save_assignment_run`으로 저장한다.

## 파일

| 파일 | 역할 |
|---|---|
| `types.ts` | 입력·출력·이슈·위반 타입, `WEEKLY_CAP_HOURS = 12`, `ASSIGNMENT_RULE_VERSION` |
| `rng.ts` | seed 기반 결정적 난수(mulberry32 + FNV-1a). `Math.random()` 미사용 |
| `calendar.ts` | 타임존 무관 날짜 계산(epoch day), 월요일 시작 주, 공휴일 데이터 누락 연도 |
| `hours.ts` | 2·3시간 조합, 주별 정확 배분 |
| `continuity.ts` | 블록·전환·왕복(A→B→A)·업무 전환 평가 |
| `distribution.ts` | 주간 분산 평가 `weeklyLoadSpread` |
| `engine.ts` | `runAssignment(input)` — 배정, `compareProjectPriority`, `relocateWeekendsWithinProject` |
| `search.ts` | 직원 1명의 날짜·프로젝트 배치 정확 탐색(시간순 동적계획법) — 왕복 없음·평일 우선·최소 2일 |
| `validate.ts` | `validateSchedule(input, assignments)` — 엔진과 독립된 강제조건·배치 품질 재검사 |

## 입력 계약 (`AssignmentInput`)

- `period {label, start, end}` — 'YYYY-MM' 급여기간(전월 21일 ~ 당월 20일), `as_of`, `seed`, `rule_version`
- `holidays`, `holiday_data_years` — 급여기간이 걸친 연도가 하나라도 빠지면 **전체 차단**(`OVERTIME_HOLIDAYS_MISSING`, 누락 연도 포함)
- `employees[]` — `active`, `target_hours`(null = 목표행 없음, 0 = 유효), `projects[{project_id, task_ids}]`
  - `task_ids: null` = 직원×프로젝트 업무 미지정 → **그 직원의 기본업무 전체**(overtime_member_tasks 0건)
  - `task_ids: []` = 지정했지만 쓸 업무 없음 → 그 프로젝트 차단. 다른 직원 소유 업무 id는 무시
- `projects[]` — `period_start/period_end`(eligibility 결과), `submit_date`, `announce_date`, `project_number`, `auto_assignable`
- `tasks[]` — 소유 직원, 이름, `sort_order`(선택 — 없거나 null이면 입력 배열 순서)
- `locked_records[]` — 기존 수동·자동확정·잠금 초안. **급여기간 밖이라도 같은 주에 걸친 기록**을 넘겨야 주 12시간이 맞다

## 강제조건 (엔진이 만들지 않고, validate가 다시 검사)

활성 직원만 · 목표행 없으면 차단 · 목표 0이면 0건 · 공휴일 연도 누락이면 전체 차단 · 참여 프로젝트만 · 허용 업무만 ·
프로젝트 대상기간 안 · 급여기간 안 · 직원·날짜당 1건(하루 한 프로젝트) · 하루 2h/3h(기존 프리셋 그대로) ·
주(월~일) 합계 ≤ 12(잠금·다른 프로젝트·기간 밖 같은 주 포함) · 급여기간 합계 ≤ 월 목표(잠금 포함) · 잠금 기록 불변·잠금일 신규 배정 금지 ·
배정 불가(확인 필요·차단·종료) 프로젝트 제외 · 같은 입력+seed → 같은 결과 · 입력 불변.

## 알고리즘 (직원마다 독립 — 한도가 전부 직원 단위라 직원 간 공유 자원이 없다)

규칙 버전 `overtime-assign/2`(2026-10 독립 검토 MAJOR 1·2 수정). 강제조건과 충돌하면 강제조건이 우선.

1. **차단**: 비활성 → 0건 / 목표 null → `OVERTIME_MONTHLY_TARGET_MISSING` / 목표 < 잠금 또는 (목표 0 & 잠금 있음) → `TARGET_BELOW_LOCKED_HOURS`
2. **배정 목표 T** = `maxRepresentable(min(목표 − 급여기간 잠금, 상한))`. 상한 = 주마다 ⌊한도/2⌋일까지 쓸 때 만들 수 있는 최대 시간.
   남는 값은 `UNREPRESENTABLE_REMAINING_HOURS`
3. **프로젝트**: 배정 가능(대상·업무 있음·기간 겹침)만, 우선순위 = 제출일 → 종료일 → 공고일 → 공사번호 → id (난수 없음)
4. **날짜·프로젝트 배치** (`search.ts searchSchedule`) — T를 만들 수 있는 배치 중 가장 좋은 것을 **정확히** 찾는다. 안 되면 T를 1씩 낮춘다.
   - 날짜를 시간순으로 훑는 동적계획법. 상태 = (지금까지 시작한 프로젝트 집합, 진행 중 프로젝트, 그 일수, 이번 주 일수, 총 일수,
     주 한도 초과로 잃은 시간, 진행 중 블록 안에서 건너뛴 평일 여부). **한 번 끝난 프로젝트는 다시 시작하지 않으므로
     A→B→A 왕복이 구조적으로 생기지 않는다**(기간이 겹치는 프로젝트 사이에 끼워 넣는 경우도 같은 규칙).
   - 강제: 프로젝트 기간·급여기간 안, 잠금일 제외, 하루 1건, 주마다 ⌊(12 − 잠금)/2⌋일 이하, 주별 시간 용량 Σ min(3 × 일수, 12 − 잠금) ≥ T
   - **비교 순서**(사전식, 앞이 우선):
     1. 받은 프로젝트 수 최대 → 제출일 우선(앞선 프로젝트가 빠지지 않게) — 기존 규칙 "여력이 있으면 참여 프로젝트마다 최소 1일" 유지
     2. 주말·공휴일 일수 최소
     3. 피할 수 있었던 1일 블록 수 최소(잠금·주 한도를 빼고도 기간에 평일 2일을 쓸 수 있는 프로젝트가 1일만 받은 수)
     4. 2일 이상 받은 프로젝트 수 최대
     5. 우선순위 역전(제출일이 늦은 프로젝트 블록이 먼저) 최소 6. 블록 끊김(진행 중 블록 안의 빈 평일) 최소
     7. 2·3시간 조합 선호: 혼합 → 개수 차이 최소 → 일수 적음
     8. 남는 일수는 제출일 빠른 프로젝트에 9. 고른 간격 목표 위치(±2평일) → 주간 분산(주별 일수 제곱합) → 목표 위치 거리 10. seed
   - 1차 탐색으로 순서·일수를 정하고, 그 순서로 블록마다 고른 간격 목표 위치(가장 이른 위치 E와 뒤 블록 자리를 남기는 가장 늦은 위치 R
     사이를 (블록 수 + 1)등분)를 계산해 순서·일수를 고정한 2차 탐색으로 위치만 다듬는다(블록 1개면 가운데, ±2평일 안에서 주간 분산).
   - 탐색을 줄이는 규칙은 결과를 나쁘게 하지 않음이 증명되는 것만 쓴다: 기간이 같은 프로젝트는 우선순위 높은 쪽이 먼저 /
     바로 앞 블록 q 다음에 기간이 q보다 늦게 시작·끝나지 않는 상위 프로젝트 p를 시작하지 않음(두 블록 날짜를 그대로 두고 p가 앞을 가지면
     위 1~4가 같고 역전만 준다) / 남은 날짜로 T·최소 일수에 못 닿는 상태 제거 / 기간이 끝난 프로젝트 표시 정리.
   - 직원 1명당 정확 탐색 프로젝트 수 상한 `MAX_SEARCH_PROJECTS = 8`(제출일 우선). 넘는 프로젝트는 `TOO_MANY_PROJECTS`로 알린다.
5. **시간**: `distributeWeekHours(balanced)` — 2시간을 깔고 남는 1시간씩을 (잠금 + 배정) 합계가 가장 작은 주부터, 같으면 3시간 비율이
   낮은 주부터 → **합계 정확 · 주간 분산 · 주마다 2·3시간 혼합**. 주 안에서 3시간 날짜는 seed로(같은 시간이 한쪽에 몰리지 않게)
6. **평일 이동(안전장치)**: 주말·공휴일 배정을 **같은 프로젝트** 기간의 평일(빈 날·잠금 아님·그 주 합계+시간 ≤ 12·옮긴 뒤 왕복 없음)로
   옮길 수 있으면 옮긴다. 탐색이 이미 주말을 최소로 쓰므로 정상이면 옮길 것이 없다. 다른 프로젝트의 평일로는 옮기지 않는다.
7. **업무**: 프로젝트 배정일을 시간순으로, 업무 우선순위 = `sort_order` 오름차순(없거나 null이면 있는 업무 뒤) → 같으면 입력 배열 순서
   - 일수 ≥ 업무 수: 모든 업무를 우선순위 순서로 연속 하위 블록 — 전환은 업무 수 − 1번
   - 일수 < 업무 수: **우선순위가 높은 업무부터** 일수만큼(seed로 고르지 않는다). 안 쓴 업무는 `by_project.unused_task_ids` +
     `TASKS_PARTIALLY_USED`(정보)
   - 입력 배열 순서는 항상 서로 다르므로 이 순서가 완전히 정해진다 → seed는 업무 선택·순서에 쓰이지 않는다
     (규칙상 "sort_order와 입력 순서까지 같을 때만 seed"인데, 그런 경우가 생기지 않는다)
   - **1일 블록**: 직원×프로젝트 배정일이 정확히 1일이면 `SINGLE_DAY_PROJECT_BLOCK`(정보). 탐색이 1일 블록을 가장 적게 고른 뒤 남은 것이다.
     `detail = { assigned_days: 1, reason }`, reason은 최종 배치의 사실로 위에서부터 처음 맞는 것:
     `PERIOD_TOO_SHORT`(기간 안 평일 1일 이하) → `LOCKED_OR_WEEKLY_CAP`(평일은 있지만 잠금일·주 일수 한도를 빼면 1일 이하) →
     `TARGET_TOO_SMALL`(직원 전체 배정이 하루) → `NOT_ENOUGH_DAYS`(배정 일수 < 2 × 배정받은 프로젝트 수) → `OTHER_PROJECTS`(그 밖 — 다른 프로젝트와 날짜·주 한도를 나눠 씀).
     이전 코드 `CAPACITY_OR_CONFLICT`는 원인이 섞여 있어 `LOCKED_OR_WEEKLY_CAP`·`OTHER_PROJECTS`로 나눴다.
8. **주말·공휴일 사유**(`types.ts WEEKEND_REASONS`, 엔진·검증 공통 문구): 그 프로젝트 기간의 다른 평일을 최종 배치에서 하나씩 보고 —
   다른 프로젝트가 쓰거나, 비어 있어도 옮기면 왕복이 생기면 `같은 기간 다른 프로젝트 배정으로 평일 배정 불가` →
   비어 있지만 그 주가 12시간을 넘으면 `주간 12시간 제한으로 평일 배정 불가` → 평일이 모두 이 프로젝트 배정·잠금일이면
   `프로젝트 유효기간 내 평일 부족`(종료일 = 제출일이면 `제출일까지 평일 배정 가능시간 부족`)
9. **검증**: `validateSchedule`로 전부 다시 검사. 위반이 있으면 `ok=false` + `VALIDATION_FAILED`(정상이면 발생하지 않음).
   강제조건 외에 입력과 최종 결과만으로 배치 품질을 다시 계산한다(엔진 탐색 상태를 쓰지 않음):
   `PROJECT_REVISIT`(왕복), `UNNECESSARY_WEEKEND`(같은 프로젝트의 빈 평일로 옮길 수 있음 — 주 12시간 유지·왕복 없음),
   `EXCEPTION_REASON_MISMATCH`(사유 문구 ≠ 위 8의 실제 원인), `PROJECT_BLOCK_SPLIT`(블록 끝 하루를 블록 안 빈 평일로 옮기면 덜 끊김),
   `AVOIDABLE_SINGLE_DAY`(1일 블록 옆 빈 평일에 3시간 2건을 2시간으로 줄이거나 3일 이상 프로젝트의 끝 하루를 옮겨 2일을 줄 수 있음).
   왕복 외의 품질 검사는 "바꾸면 위 비교 순서상 확실히 더 좋은 배치가 있다"일 때만 위반으로 본다 — 정상 결과를 잘못 잡지 않는다.
   전체 최적성은 `regression.test.ts`의 완전 탐색 비교로 확인한다.

**기준일(`as_of`)**: 엔진은 기준일 이전 날짜도 배정한다(월간 실적 사후 정리용). 기준일은 프로젝트 대상 판정(eligibility — 개찰일·제출일 경과)에만 쓰인다.

### 시간 조합

하루 2/3시간 → 만들 수 있는 합계는 0과 2 이상 정수. D일·합계 H의 조합은 3시간 `H−2D`개·2시간 `3D−H`개(둘 다 ≥ 0)로 유일하고,
가능한 D는 `ceil(H/3)..floor(H/2)`. 선호 순서는 **혼합 → 개수 차이 최소 → 일수 적음**:
2 → 2, 3 → 3, 4 → 2+2, 5 → 2+3, 6 → 3+3(다음 2+2+2), 7 → 2+2+3, 8 → 2+3+3, 9 → 2+2+2+3, 10 → 2+2+3+3, 11 → 2+3+3+3, 12 → 2+2+2+3+3, 24 → 2×6+3×4.
가용 평일이 모자라면 혼합보다 배정 가능성이 우선(예: 월~목 4일에 12h → 3+3+3+3, 주말을 쓰지 않음).

### 주간 분산 평가

`distribution.ts weeklyLoadSpread(주별 시간[])` → 평균·표준편차·최대·최소·범위·배정 있는 주 수. 직원 요약의 `weekly_stdev`는
그 직원이 평일에 배정받을 수 있었던 주들의 신규 배정시간 표준편차다. 예: 4주 가용기간에 24h → 주별 8·8·8·0(표준편차 약 3.5),
보정 전 방식은 12·12·0·0(표준편차 6).

### 난수 사용 범위

쓰는 곳: 분산 점수까지 같은 블록 시작점 고르기, 주 안에서 3시간을 줄 날짜.
직원마다 `deriveSeed(seed, 직원id, 용도)`로 독립된 수열을 써서 다른 직원 입력이 바뀌어도 그 직원 결과가 흔들리지 않는다.
쓰지 않는 곳: 프로젝트 우선순위, 평일/주말 순서, 참여·업무 허용 여부, 업무 선택·순서(sort_order → 입력 순서로 정해짐), 주 12시간·목표 판단.

## 출력 (`AssignmentResult`)

- `assignments[]` — overtime_assignment_drafts 행 형태(+ is_weekend·is_holiday·holiday_name·exception_reason·seed·rule_version)
- `employees[]` — 목표·잠금·신규·미배정 시간, 주별 합계(잠금 포함), 프로젝트별 시간·일수, 주말·공휴일 건수
- `projects[]` — 참여 직원, 총 시간, 배정 기간, 연속 블록 수, 배정받지 못한 참여 직원과 사유
- `issues[]` — `code`(기계 판별) + `message`(사용자용) + 직원·프로젝트·detail
- `violations[]` — validate 결과(정상이면 빈 배열)

이슈 코드: `INVALID_INPUT`, `OVERTIME_HOLIDAYS_MISSING`, `OVERTIME_MONTHLY_TARGET_MISSING`, `EMPLOYEE_INACTIVE`, `TARGET_BELOW_LOCKED_HOURS`,
`UNREPRESENTABLE_REMAINING_HOURS`, `NO_ELIGIBLE_PROJECT`, `UNKNOWN_PROJECT`, `PROJECT_NOT_ASSIGNABLE`, `NO_ALLOWED_TASK`, `NO_VALID_DATE`,
`WEEKLY_CAPACITY_EXHAUSTED`, `TARGET_EXHAUSTED`, `PROJECT_UNASSIGNED`, `WEEKEND_OR_HOLIDAY_USED`, `TASKS_PARTIALLY_USED`,
`SINGLE_DAY_PROJECT_BLOCK`, `TOO_MANY_PROJECTS`, `VALIDATION_FAILED`.

## 복잡도

직원 1명: 날짜 W(≤ 31) × 상태 수. 상태 수는 프로젝트 집합에 대해 지수적이지만 위 탐색 축소 규칙으로 기간이 같은 프로젝트는 순서가
하나로 고정된다. 실측(로컬 Node, 직원 1명): 프로젝트 2~3개 2~10ms, 기간이 같은 6~8개 10~15ms, 기간이 모두 다른 6~8개(극단) 250~350ms.
T는 상한에서 시작하므로 보통 첫 T에서 끝난다.
