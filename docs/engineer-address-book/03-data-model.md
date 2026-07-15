# 기술인 주소록 — 데이터 모델

기존 방식 그대로: `supabase/migration_engineers.sql` + MCP `apply_migration`,
`docs/database.md`에 표 추가, RLS는 "인증된 사용자 전체 접근", 타입은
`lib/engineers/types.ts`에 컬럼명 1:1.

## 기존 직원 테이블과의 관계 (요구 18)

**별도 테이블로 간다.** 근거:
- 실데이터가 667명의 **외부 기술인력 풀**이고, `overtime_employees`는 팀 내부 11명의
  근태(연장근무·휴가) 대상자다 — 용도·수명주기·규모가 전혀 다르다.
- 합치면 연장근무/휴가관리의 직원 드롭다운·그리드에 667명이 쏟아진다.
- 내부 직원 연결(`employee_id uuid null references overtime_employees`)은 컬럼만
  예약해두고 MVP에서는 쓰지 않는다(확장: 팀원이 기술인 풀에도 있을 때 1:1 연결).

## 1. `engineer_contacts` — 기술인 1명

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | uuid PK | |
| `employee_id` | uuid FK → overtime_employees, ON DELETE SET NULL (nullable) | 내부 직원 연결 (MVP 미사용, 확장 예약) |
| `name` | text not null | 성명 |
| `rank` | text not null default '' | 직위 (상무·이사·부장 등 — 엑셀 원본 항목) |
| `position` | text default '' | 직책 (팀장·본부장 등 — 원본에 없어 선택 입력) |
| `company` | text default '' | 소속 회사/부서 |
| `mobile_phone` | text default '' | 핸드폰 (하이픈 포함 표시 형식으로 저장) |
| `office_phone` | text default '' | 사무실 전화 |
| `email` | text default '' | |
| `region` | text default '' | 지역 (시·도 — 필터용 별도 필드, 요구 7) |
| `address` | text default '' | 주소 (단일 텍스트 — 안 1) |
| `employment_status` | text default '재직' check in ('재직','퇴직','비활성') | |
| `joined_date` / `retired_date` | date (nullable) | 입사일/퇴사일 |
| `memo` | text default '' | 비고 |
| `is_favorite` | boolean default false | 즐겨찾기 |
| `created_at` / `updated_at` | timestamptz | |

- 우편번호/기본주소/상세주소 분리는 안 2로의 확장 때 컬럼 추가(지금은 단일 `address`).
- `deleted_at`/`active` 대신 `employment_status='비활성'`이 소프트 삭제 역할 —
  상태 하나로 재직/퇴직/비활성을 다 표현해 필드 중복을 피한다. 완전 삭제는 hard delete
  (참조 테이블이 전문분야 junction뿐이라 CASCADE로 안전).
- **인덱스**: `name`, `mobile_phone`, `region`, `employment_status` — 667건이라 당장은
  과하지만 검색 필드 명세(요구 19)대로 걸어둔다.

## 2. `engineer_specialties` — 전문분야 마스터

| 컬럼 | 타입 |
|---|---|
| `id` uuid PK / `name` text UNIQUE / `is_active` boolean default true / `sort_order` integer |

시드 12종: 건축, 토목, 기계, 전기, 통신, 소방, 안전, 품질, 공정, 사업관리, 조경, 기타.

## 3. `engineer_contact_specialties` — 다중 지정 junction

| 컬럼 | 타입 |
|---|---|
| `id` uuid PK / `contact_id` FK → engineer_contacts ON DELETE CASCADE / `specialty_id` FK → engineer_specialties ON DELETE RESTRICT / UNIQUE(contact_id, specialty_id) |

문자열 하나로 저장하지 않는 이유(요구 5): 분야별 필터·집계가 조인으로 정확해지고,
분야명 변경이 마스터 한 곳 수정으로 끝난다.

## 4. 직위 순서 — 테이블 대신 코드 상수

`rank_settings` 테이블은 만들지 않는다. 정렬용 직위 순서는 `lib/engineers/types.ts`의
상수 배열(사원→대리→과장→차장→부팀장→팀장→부장→소장→이사→상무이사→상무→전무→부사장→
사장→총괄사장→고문, 목록에 없는 값은 뒤로)로 시작 — 667건 실데이터의 16종을 반영했다.
관리자 설정 화면이 필요해지면 그때 테이블로 승격(06 문서 ③).

## 5. 초기 시드 — 엑셀 667건 1회 이관

범용 가져오기 UI 대신 **구현 시점에 `address book.xls`를 파싱해 INSERT SQL로 직접
이관**한다(요구 20의 "데이터가 많다면 가져오기가 효율적" — 단, UI 없이 1회 실행).

- 성명·직위·핸드폰·주소 → 그대로. 직위 이상치("8" 1건, 김도영)는 사용자 지시에 따라
  임의 변경 없이 원본 그대로 이관하고 별도 보고 — 화면에서 수정한다.
- `region`은 주소 첫 토큰에서 best-effort 추출(서울/경기/인천/충남/충북/세종/대전/강원/…
  — "화성시"처럼 시·도가 생략된 주소는 빈 값으로 두고 화면에서 수정).
- 전화 결측 1건은 빈 값, 중복 전화 3건·동명이인 4건은 그대로 이관(실제 데이터).
- 전원 `employment_status='재직'`, 전문분야 미지정으로 시작.
- **개인정보 보호**: 전화·주소 667명분이 담긴 재현용 SQL은 저장소에 커�밋하지 않는다
  (`.gitignore`의 `/supabase/seed_*.sql`). 이관은 구현 시점 1회성 로컬 스크립트가
  `address book.xls`를 직접 읽어 Supabase REST로 삽입하고, 스크립트·산출 SQL은
  세션 스크래치패드에만 남는다 — 리포지토리에는 스키마(마이그레이션)만 남는다.

범용 Excel/CSV 가져오기(열 매핑·미리보기·중복확인·갱신)와 내보내기는 확장 —
내보내기는 개인정보라 관리자/쓰기 권한 전용으로 (요구 21·22).

---

## 향후 엑셀 동기화 설계 (승인 시 추가 요청 — MVP 미구현, 구조만 반영)

같은 양식의 엑셀을 다시 불러와 「파일 선택 → 기존 DB 비교 → 미리보기 → 사용자 확인 →
반영」 하는 기능을 추후 추가한다. 이를 위해 지금 반영하는 것:

### `engineer_no` — 기술인 고유번호

`engineer_contacts.engineer_no integer generated always as identity unique` —
프로그램이 자동 발급하는 사람 친화적 고유번호. 추후 Excel 내보내기에 포함하고,
그 파일을 다시 가져올 때 **1순위 매칭 키**가 된다 (uuid `id`는 내부용, 엑셀에 노출 안 함).

### 동일인 판정 우선순위 (자동 병합 금지)

1. `engineer_no` (내보낸 엑셀을 수정해 다시 가져온 경우 — 정확 매칭)
2. 휴대전화 번호 (하이픈·공백 제거 `normalizePhone` 비교)
3. 성명 + 직위 + 주소 전부 일치

어느 것도 확실치 않으면(예: 성명만 일치) **"동일인 판단 불가"로 분류해 사용자 확인** —
자동 병합하지 않는다.

### 비교 결과 상태 5종

| 상태 | 처리 |
|---|---|
| 기존과 동일 | 변경 없음 |
| 신규 기술인 | "신규" 표시 → 확인 후 추가 |
| 기존 정보 변경 | 직위/전화/주소 변경 전→후 나란히 표시 → 확인 후 갱신 |
| 새 엑셀에 없는 기존 기술인 | **자동 처리 금지** — "비활성 후보"로 표시, 사용자가 유지/비활성/퇴사 선택 |
| 동일인 판단 불가 | 사용자 확인 대상 |

### `engineer_sync_logs` — 동기화 실행 이력 (미리 생성, MVP 미사용)

| 컬럼 | 타입 |
|---|---|
| `id` uuid PK / `executed_at` timestamptz default now() / `file_name` text / `added_count` int / `updated_count` int / `deactivated_count` int / `error_count` int / `note` text |

### 다른 데이터 보호 원칙

추후 프로젝트 이력 등이 기술인을 참조하게 되면 FK는 `ON DELETE RESTRICT`(이력 보존) 또는
`SET NULL` — 주소록에서 삭제/비활성해도 이력이 지워지지 않는다. 비활성은 상태 값 변경일
뿐이라 어떤 참조에도 영향이 없다. 동기화 반영 로직도 삭제 대신 상태 변경만 쓴다.
