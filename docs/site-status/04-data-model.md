# 현장 현황 — 데이터 모델 (2026-07-15 사용자 확정 반영)

기존 방식: `supabase/migration_sites.sql`(스키마만, 개인정보 없음) + MCP `apply_migration`,
`docs/database.md` 갱신, RLS "인증된 사용자 전체 접근", 타입은 `lib/sites/types.ts`에
컬럼명 1:1. 월별 스냅샷·배치 테이블은 만들지 않는다 (요구 10).

## `sites` — 현장 1개 (단일 테이블, 연락처 분리 안 함)

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | uuid PK | |
| `site_code` | integer generated identity UNIQUE | 자동 고유번호 — 향후 엑셀 동기화 1순위 매칭 키(engineer_no와 동일 패턴). 현재 엑셀엔 없음 — 향후 내보내기 파일을 재이입할 때부터 이 값으로 매칭 가능 |
| `original_site_name` | text | 엑셀 원본 현장명(줄바꿈 그대로) — 동기화 매칭용 보존 |
| `site_name` | text not null | 정규화 현장명(줄바꿈→공백) — 화면 표시·검색용 |
| `source_category` | text not null check in ('건진법','주택법','건축법','전통소') | **원본 시트명 그대로** — 향후 동기화 매칭 기준 |
| `legal_category` | text not null check in ('건설기술진흥법','주택법','건축법','분리발주(전기·통신·소방)') | 화면 표시·필터용 표준값 (source_category → legal_category 매핑은 코드 상수) |
| `manager_name` | text default '' | 감리원/담당자 — 여러 명 원본 텍스트 그대로(줄바꿈 유지) |
| `contractor` | text default '' | 시공사 |
| `site_phone_raw` | text default '' | 현장 연락처 원본 — E열 텍스트 그대로, **정보 손실 없이 보존** |
| `site_landline` | text default '' | 원본에서 추출한 현장 유선전화(추정). 여러 개면 `; `로 이어붙임 — 버리지 않음 |
| `manager_mobile` | text default '' | 원본 괄호 안 첫 010 번호(추정) — "확정된 책임자 번호"로 단정하지 않음, 상세에서 원본과 함께 확인 |
| `phone_uncertain` | boolean default false | 번호가 여럿이거나 패턴이 모호해 자동추출을 확신할 수 없을 때 true — 화면에 "확인 필요" 표시 |
| `site_address` | text default '' | 현장주소 — G열 "현)" 부분 |
| `office_address` | text default '' | 사무실주소 — G열 "사)" 부분 |
| `region` | text default '' | 시·도 — 현장주소에서 자동 추출 (`lib/engineers/format.ts`의 extractRegion 재사용) |
| `start_date` | date (nullable) | 착수일 |
| `planned_completion_date` | date (nullable) | 준공예정일 |
| `manual_status` | text (nullable) check in ('착수 전','진행 중','준공 임박','준공 완료','중지') | null = "자동" 선택(날짜 기준 계산). 값이 있으면 그 값을 그대로 표시하고 자동 계산을 덮어씀 |
| `memo` | text default '' | 비고 |
| `is_favorite` | boolean default false | |
| `active` | boolean default true | false = 비활성(소프트 삭제 역할). `deleted_at` 컬럼 없음 — 완전 삭제 UI는 MVP 미제공(07 문서 ④) |
| `created_at` / `updated_at` | timestamptz | |

인덱스: `site_name`, `source_category`, `region`, `active`.

## 법 구분 원본↔표준 매핑 (코드 상수, `lib/sites/types.ts`)

| `source_category`(원본, DB·동기화용) | `legal_category`(표준 표시값) |
|---|---|
| 건진법 | 건설기술진흥법 |
| 주택법 | 주택법 |
| 건축법 | 건축법 |
| 전통소 | 분리발주(전기·통신·소방) |

시드/등록 시 `source_category`를 기준으로 `legal_category`를 자동 산출해 저장한다(둘 다
컬럼으로 갖되 계산 방향은 일방향 source→legal).

## `site_sync_logs` — 향후 엑셀 동기화 실행 이력 (구조 예약, MVP 미사용)

engineers의 `engineer_sync_logs`와 동일 구조: `executed_at, file_name, added_count,
updated_count, deactivated_count, error_count, note`.

## 재사용

- `lib/engineers/format.ts`의 `formatPhone` / `normalizePhone` / `extractRegion` 재사용.
- 진행 상태 계산은 `lib/sites/status.ts`의 순수 함수(경계값 포함 검산 — 06 문서).

## 개인정보 처리 (07 문서 ⑩)

`migration_sites.sql`은 스키마만 담아 커밋한다. 89건 실데이터는 구현 시점 1회성 로컬
스크립트가 엑셀을 직접 읽어 Supabase REST로 삽입하며, 스크립트·산출 SQL은 리포지토리에
남기지 않는다(`.gitignore`의 `/supabase/seed_*.sql`).
