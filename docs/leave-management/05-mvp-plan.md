# 휴가관리 — MVP 구현 계획

## 현재 프로젝트 확인 결과 (2026-07 조사)

- **기술 스택**: Next.js App Router(주의: `node_modules/next/dist/docs/` 문서 우선 —
  AGENTS.md), React Client Component 중심, Supabase(Postgres, `@supabase/supabase-js`
  직접 호출 — 별도 쿼리 레이어 없음), 전체 inline style, Vercel 배포.
- **라우팅**: `app/(dashboard)/` 아래 평면 라우트(`/overtime`, `/projects`, `/weekly`, ...).
  라우트 전용 컴포넌트는 `_components/` private 폴더 콜로케이션.
- **사이드바**: `app/sidebar.tsx`의 `GROUPS` 배열 하드코딩. 근태관리는 `children` 배열
  방식(현재 연장근무 1개). 사람별 숨김 키는 `lib/menuConfig.ts`.
- **직원 테이블**: `overtime_employees(id, name, position, is_active, sort_order, created_at)`
  — 입사일/퇴사일 없음 → nullable 컬럼 추가 필요.
- **공휴일**: `app/api/holidays/route.ts` (date.nager.at 프록시)가 이미 있고 대시보드
  캘린더가 사용 중 → 휴가관리의 "인터넷에서 불러오기"에 재사용.
- **재사용 가능**: 직원 데이터·정렬, sticky 테이블 패턴(MonthGrid/ProjectGrid 참고),
  onBlur 즉시저장 모달 패턴(ProjectManagerModal), 팝오버 패턴(OvertimeEntryPopover),
  버튼/색상 스타일 상수. 단 **연장근무 컴포넌트 파일 자체는 수정·import하지 않고
  패턴만 복제**한다(독립성 유지, 연장근무 무영향 원칙).

## 신규/수정 파일 목록

```
[수정]
app/sidebar.tsx                 # 근태관리 children에 휴가관리 추가 (유일한 기존 화면 수정)
lib/menuConfig.ts               # RESTRICTABLE_MENU_ITEMS에 'leave' 추가
docs/database.md                # 신규 테이블·컬럼 문서화

[신규 — DB]
supabase/migration_leave.sql    # 컬럼 추가 + 테이블 5종 + 유형/공휴일 시드

[신규 — 로직]
lib/leave/types.ts              # LeaveType, AnnualLeaveBalance(+History), LeaveRecord, LeaveRecordDate, Holiday
lib/leave/calc.ts               # expandLeaveDates, totalCalendarDays, formatNightsDays, 집계 함수, 검증 함수

[신규 — 화면]
app/(dashboard)/leave/page.tsx                      # 연도·검색·필터 + 데이터 로딩 + 레이아웃
app/(dashboard)/leave/_components/LeaveYearTable.tsx      # 직원×월 메인 그리드
app/(dashboard)/leave/_components/LeaveRecordModal.tsx    # 휴가 추가/수정
app/(dashboard)/leave/_components/BalanceManagerModal.tsx # 연차 설정(+입사/퇴사일, 이력 기록)
app/(dashboard)/leave/_components/LeaveTypeManagerModal.tsx # 휴가 유형 관리
app/(dashboard)/leave/_components/HolidayManagerModal.tsx  # 공휴일/회사휴무 관리(+불러오기)
app/(dashboard)/leave/_components/MonthCellPopover.tsx     # 월 셀 상세 (읽기 전용)
app/(dashboard)/leave/_components/EmployeeLeaveHistory.tsx # 직원 요약 카드 + 이력 테이블
```

연장근무 쪽 파일(`app/(dashboard)/overtime/**`, `lib/overtime/**`)은 수정하지 않는다.

## 구현 순서 (단계별 확인 가능하게)

| 단계 | 내용 | 완료 기준 | 상태 |
|---|---|---|---|
| 1 | 마이그레이션 + `docs/database.md` + `lib/leave/types.ts` | 테이블·시드 생성 확인 (SQL 조회) | ✅ |
| 2 | `lib/leave/calc.ts` — 순수 함수(전개·박/일·집계·검증) | 대표 케이스 수동 검산 (금~월=2일 등) | ✅ (20개 케이스 tsx 검산 통과) |
| 3 | 사이드바 메뉴 + `/leave` 페이지 골격(연도 이동·데이터 로딩) | 메뉴 클릭 → 빈 테이블 렌더 | ✅ |
| 4 | 연차 설정 모달 (+입사일/퇴사일 편집, 이력 기록) | 부여 입력 → 메인 테이블 부여·잔여 반영 | ✅ |
| 5 | 휴가 추가/수정/삭제 모달 (계산 표시줄 + 검증) | 등록 → 월 셀·사용·잔여 자동 갱신 | ✅ |
| 6 | 메인 테이블 완성 (sticky 고정열, 분기선, 경고색, 검색/필터) | 엑셀 원본과 같은 구조로 표시 | ✅ |
| 7 | 직원 상세이력 + 월 셀 팝오버 | 행/셀 클릭 동작 | ✅ |
| 8 | 공휴일 관리 + 휴가 유형 관리 모달 | 불러오기·수동 편집 동작 | ✅ |

각 단계 완료 시 이 표의 상태를 갱신한다(연장근무 로드맵과 동일한 방식).

## 검증 방법

- `npx tsc --noEmit` 통과.
- 계산 함수는 04 문서의 예시 케이스(0박1일, 2박3일, 금~월 2일 차감, 반차 조합 2일,
  월 걸침 7월1일+8월1일)를 페이지에서 실제 입력해 확인.
- 기존 연장근무 페이지가 변경 전과 동일하게 동작하는지 확인(수정 파일이 sidebar/menuConfig
  뿐이므로 회귀 범위 작음).
