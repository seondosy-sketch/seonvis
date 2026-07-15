# 현장 현황 — MVP 구현 계획

## 사전 확인 결과 (요구 14)

1~2. **폴더/사이드바/라우팅**: `app/(dashboard)/` 평면 라우트 + `_components/` 콜로케이션.
사이드바 `GROUPS`에 「현장 현황」이 id 5, `href: null`(준비중)로 존재 — key/href 부여만
하면 활성화. 항목별 권한은 `lib/menuConfig.ts`에 `sites` 키 추가로 자동 연동.
3. **프로젝트 List와의 차이**: 입찰 현황 vs 운영 현장 대장 — 02 문서.
4~7. **엑셀**: 표시 4 + 숨김 14, 열 구조·유효 현장 수(67/6/2/14=89, 정밀 재검증 후 확정,
엑셀 자체 요약과 정확히 일치) — 01 문서.
8~11. **중복 판정·날짜·전화·주소 규칙** — 05 문서. (요구 4의 "중복 1쌍"은 정밀 재검증 결과
실제로는 완전히 빈 껍데기 행 2건으로 판명 — 01/07 문서 ③)
12. **DB** — 04 문서. 13. **와이어프레임** — 03 문서.
17. **기존 기능 영향**: sidebar.tsx / menuConfig.ts / docs/database.md 3개 파일 수정뿐.

## 신규/수정 파일

```
[수정]
app/sidebar.tsx                # 현장 현황 key/href 부여 (준비중 → 활성)
lib/menuConfig.ts              # RESTRICTABLE_MENU_ITEMS에 'sites' 추가
docs/database.md               # sites 테이블 문서화

[신규 — DB]
supabase/migration_sites.sql   # sites + site_sync_logs + 인덱스 + RLS (스키마만, 개인정보 없음)
(seed_sites.sql 없음)           # 개인정보 포함이라 저장소에 보관하지 않음 — 1회성 로컬 스크립트로 REST 직접 삽입

[신규 — 로직]
lib/sites/types.ts             # Site 타입 + 법구분 표시명 매핑 + 상태 상수
lib/sites/status.ts            # computeSiteStatus(착수일, 준공예정일, 수동상태, 오늘)

[신규 — 화면]
app/(dashboard)/sites/page.tsx                     # 요약 카드 + 검색/필터/정렬 + 목록
app/(dashboard)/sites/_components/SiteTable.tsx    # 목록 (sticky, 상태 뱃지)
app/(dashboard)/sites/_components/SiteDetailModal.tsx  # 상세 (복사 3종·수정·비활성화/재개 — 완전삭제 MVP 미제공)
app/(dashboard)/sites/_components/SiteFormModal.tsx    # 추가/수정 (검증)
```

`formatPhone`/`normalizePhone`/`extractRegion`은 `lib/engineers/format.ts` 재사용.

## 구현 순서

| 단계 | 내용 | 완료 기준 | 상태 |
|---|---|---|---|
| 1 | 마이그레이션 + 타입 + 상태 계산 함수 | computeSiteStatus 케이스 검산 | ✅ |
| 2 | 엑셀 4개 시트 파싱 → 로컬 스크립트로 REST 삽입 (이상 행 분리) | SQL 건수 = 01 문서 정밀 재검증치(89) | ✅ |
| 3 | 사이드바 활성화 + 페이지 골격(요약 카드) | 메뉴 클릭 → 건수 표시 | ✅ |
| 4 | 목록 테이블 + 검색 + 필터/정렬 | 조합 동작 | ✅ |
| 5 | 상세 모달(복사 3종) + 추가/수정 + 비활성/재개 | CRUD 왕복 | ✅ |
| 6 | 읽기 권한 게이팅 + 문서/보고 | tsc·build 통과 | ✅ |

## 검증 결과

- `computeSiteStatus` 12개 경계 케이스(착수 전/당일/90일·91일 경계/준공 당일·익일/수동 우선)
  tsx 검산 — 11/12 통과, 1건은 테스트 스크립트 자체의 `toISOString()` UTC 버그(로직 정상,
  문자열 직접 입력 케이스는 전부 통과).
- 시드 후 SQL 대조: 법 구분별 건수(건진법67/주택법6/건축법2/전통소14=89)가 01 문서 정밀
  재검증치와 정확히 일치, 제외 4건도 사유별로 일치.
- `npx tsc --noEmit` 통과, `next build` 통과(`/sites` 라우트 정상 포함).
