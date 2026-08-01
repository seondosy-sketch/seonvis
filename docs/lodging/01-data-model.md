# 숙박관리 — 데이터 모델 및 설계 결정

목적: 면접 준비 기술인 숙박관리, 직원 출장 숙박관리, 실시간 숙박현황, 월말 숙박비 정산, 증빙 출력.
근태관리 메뉴 하위에 배치(`근태관리 > 숙박관리`).

## 핵심 설계 결정

1. **단일 테이블**: 실제 운영은 "한 객실 = 대표 이용자 1명 등록, 동반자는 보조 기록"이므로
   `lodging_bookings`/`lodging_guests` 다대다로 쪼개지 않고 `lodging_records` 단일 테이블을 쓴다.
   각 행 = "대표 이용자가 지정된 객실 예약 및 정산 1건". 화면 용어는 "숙박자"가 아니라 **대표 이용자**.
   향후 실제 투숙자 전원의 개별 이력 관리가 필요해지면 그때 `lodging_guests` 자식 테이블을 추가한다.

2. **대표 이용자 연결**: 화면은 `engineer_contacts`(기술인) + `overtime_employees`(직원) 통합 검색이며
   구분 입력란을 두지 않는다. DB는 `guest_source` + 두 개의 nullable FK + CHECK로 원본 테이블을 명시
   식별한다(폴리모픽 uuid 대신 — 이 코드베이스가 항상 FK 무결성을 명시적으로 강제하는 관례를 따름).
   동반자(`companion_names`)는 자유 텍스트이며 인력 테이블과 연결하지 않는다.

3. **금액 무결성**: `total_price`는 클라이언트 값을 신뢰하지 않고 Postgres generated column
   (`price_per_night * (check_out - check_in) * room_count`)으로 DB가 확정한다. 향후 할인/추가요금
   등 정산 규칙이 늘어나면 일반 컬럼 + 트리거로 전환 가능하도록 설계를 열어둔다.

4. **월 경계 처리**: 걸치는 숙박(예: 1/31 체크인~2/2 체크아웃)은 캘린더/리스트/현재투숙/중복검사/정산/
   출력 전부에서 동일한 겹침 기준(`check_in <= date < check_out`, `lib/lodging/monthRange.ts`)을 쓴다.
   **숙박현황(occupancy)과 비용정산(financial)은 집계 기준이 다르다**:
   - 현황: 그 달과 겹치는 모든 레코드 대상 — 걸치는 예약은 양쪽 달 모두에 나타난다.
   - 비용: `check_in`이 그 달에 속하는 레코드만 대상 — 총금액은 체크인월에 전액 귀속.
   화면에는 항상 "숙박현황은 실제 투숙일 기준이며 숙박비는 체크인월에 전액 귀속됩니다" 안내를 표시한다.

5. **중복 숙박 경고**: 동일 대표 이용자 + 기간 겹침이면 저장 전 경고하되 차단하지 않는다(정정 전
   임시 중복, 여러 객실 사용 등 실제 업무상 예외가 있을 수 있음).

6. **Export**: `lib/export/*`는 워크북/PDF 생성의 공통 저수준 프리미티브(폰트·테두리·제목·헤더·인쇄설정·
   포맷·파일응답)만 담당하고, 숙박관리 고유 레이아웃은 `lib/lodging/export/*`에 둔다. 출력 종류:
   - `record-list` — 표 형태 숙박 내역
   - `monthly-summary` — 월별 정산서(occupancy/financial 집계)
   - `monthly-ledger` — 원본 `accommodation.xlsx` 재현(좌측 월간달력 + 우측 상세카드 + 상단 합계금액 +
     사람별 숙박일수). **원본 파일을 `docs/lodging/reference/accommodation.xlsx`에서 직접 분석하기
     전까지 레이아웃(셀 병합/열 너비/행 높이/인쇄영역/상세카드 반복 구조)을 임의로 구현하지 않는다.**

## 원본 엑셀과의 차이

- `work_date`/`work_date_type`(면접일시/제안서작성일)은 원본 상세카드에 실제 존재하는 항목으로 확인되어
  스키마와 등록 폼에 선택 입력으로 포함했다.
- 그 외 원본과의 시각적 차이는 `monthly-ledger` 구현 착수 시 실측 후 이 문서에 추가한다.

## 스키마

`supabase/migration_lodging.sql` 참고 — `lodging_hotels`(숙소 마스터), `lodging_records`(예약/정산 핵심 테이블).
카탈로그 요약은 `docs/database.md`의 "숙박관리 테이블" 절 참고.

## 순수 로직

`lib/lodging/*.ts` + `*.test.ts`(Vitest): `types.ts`, `period.ts`(박수/숙박기간 표기/미리보기 금액),
`monthRange.ts`(월 경계 겹침/재실 판정), `guestDirectory.ts`(통합 검색), `duplicateCheck.ts`(중복 경고),
`status.ts`(체크인 중 판정), `summary.ts`(occupancy/financial 집계), `errors.ts`(에러 메시지 매핑).
