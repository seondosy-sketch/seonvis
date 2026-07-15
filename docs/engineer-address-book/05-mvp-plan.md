# 기술인 주소록 — MVP 구현 계획

## 사전 조사 결과 (요구 24의 확인 항목)

1. **기술 스택**: Next.js App Router + React Client Component, Supabase 직접 호출,
   inline style, Vercel. (기존 문서와 동일)
2. **사이드바**: `app/sidebar.tsx` GROUPS — 「기술인 주소록」이 id 4, `href: null`(준비중)로
   이미 존재 → `href: '/engineers'`, `key: 'engineers'` 부여만 하면 활성화.
3. **라우팅**: `app/(dashboard)/` 평면 라우트 → `/engineers`.
4. **기존 주소록 관련 코드**: 없음 (grep 확인 — 신규).
5. **기존 직원 테이블**: `overtime_employees` — 팀 내부 11명 근태용.
6. **중복 여부**: 엑셀 667명은 외부 기술인력 풀로 내부 직원 명단과 다른 집단 → 중복 없음.
7. **내부/외부**: 외부 포함 구조 필요 → 별도 `engineer_contacts` (+ `employee_id` 연결 컬럼 예약).
8. **신규 테이블**: 3개 (contacts, specialties, junction) — 03 문서.
9. **재사용**: sticky 테이블·모달·필터 패턴(projects/leave), 항목별 권한(useMenuPermission),
   복사 토스트는 신규 공통 컴포넌트 없이 페이지 내 구현.

## 신규/수정 파일

```
[수정]
app/sidebar.tsx                  # 기술인 주소록에 key/href 부여 (준비중 → 활성)
lib/menuConfig.ts                # RESTRICTABLE_MENU_ITEMS에 'engineers' 추가 (권한 자동 연동)
docs/database.md                 # 신규 테이블 문서화

[신규 — DB]
supabase/migration_engineers.sql # 테이블 3종 + 인덱스 + RLS + 전문분야 12종 시드
(seed_engineers.sql 없음)        # 개인정보 포함이라 저장소에 보관하지 않음 — 1회성 로컬 스크립트로 REST 직접 삽입

[신규 — 로직]
lib/engineers/types.ts           # EngineerContact, Specialty, ContactSpecialty + 직위 서열 상수
lib/engineers/format.ts          # formatPhone, normalizePhone(하이픈 제거 비교), extractRegion

[신규 — 화면]
app/(dashboard)/engineers/page.tsx                        # 요약 카드 + 검색/필터/정렬 + 목록
app/(dashboard)/engineers/_components/EngineerTable.tsx   # 목록 테이블 (sticky, 복사, 즐겨찾기)
app/(dashboard)/engineers/_components/EngineerDetailModal.tsx # 상세 (복사·수정 진입·비활성·삭제)
app/(dashboard)/engineers/_components/EngineerFormModal.tsx   # 추가/수정 (검증·중복 경고)
app/(dashboard)/engineers/_components/SpecialtyManagerModal.tsx # 전문분야 관리
```

## 구현 순서

| 단계 | 내용 | 완료 기준 | 상태 |
|---|---|---|---|
| 1 | 마이그레이션 + 타입/포맷 함수 | 테이블·시드 SQL 확인, formatPhone 케이스 검산 | ✅ |
| 2 | 엑셀 667건 파싱 → seed SQL 생성·적용 | SQL로 667건·직위 분포 일치 확인 | ✅ |
| 3 | 사이드바 활성화 + 페이지 골격(로딩·요약 카드) | 메뉴 클릭 → 667건 카운트 표시 | ✅ |
| 4 | 목록 테이블 + 통합 검색 + 필터/정렬 | 검색·필터 조합 동작 | ✅ |
| 5 | 복사 버튼 + 즐겨찾기 토글 | 클립보드·토스트 동작 | ✅ |
| 6 | 상세 모달 + 추가/수정 모달(검증·중복 경고) + 비활성/삭제 | CRUD 왕복 | ✅ |
| 7 | 전문분야 관리 모달 + 읽기 권한 게이팅 | 권한 read 계정에서 편집 UI 숨김 | ✅ |

## 검증 방법

- `formatPhone`/`normalizePhone`/`extractRegion` 대표 케이스 tsx 검산 (휴가관리 calc 검증과 동일 방식).
- 시드 후 SQL로 건수·직위 분포가 엑셀 통계(01 문서)와 일치하는지 대조.
- `npx tsc --noEmit` + `next build` 통과.
- 기존 화면 영향 범위는 sidebar/menuConfig 2개 파일뿐.
