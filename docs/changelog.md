# 변경 이력

최신순 정렬. 주요 기능 추가/변경/버그수정만 기록.

---

## 2026-07

### 프로젝트 정렬을 공사번호 순으로 통일
- 기준: **프로젝트 List의 공사번호 오름차순**. 비교 로직은 `lib/projectOrder.ts` 한 곳(`compareProjectNumber` / `byProjectNumber`)
- 예전에는 화면마다 제각각이었다 — 대부분 공사번호 **내림차순**, 출장지원은 **발표일순**, 숙소 프로젝트 선택은 **용역명순**
- 적용: 주간/월간보고(화면 + **HWPX 출력물**), 출장지원, 출근부, 연장근무(화면 + 인쇄물 + 프로젝트 관리), 숙소, 메인 달력, 홈 위젯, 미래봇
- 주간/월간보고는 저장된 행까지 다시 줄 세우고 `sort_order`를 재부여 — 화면·저장·HWPX 순서가 항상 일치. 지난주 복사도 같은 순서로 다시 세운다
- 연장근무는 `source_project_id`로 공사번호를 찾아 정렬(`lib/overtime/projectOrder.ts`). 입찰 List에 없는 수동 등록 행은 뒤쪽에 모여 기존 `sort_order` 순서를 유지하고, 연계 행의 정렬순서 입력칸은 쓰이지 않으므로 비활성 처리
- 공사번호는 text라 자릿수·접두어가 섞여도 사람이 기대하는 순서가 나오도록 숫자 인식 비교(`numeric: true`) 사용. 번호 없는 행은 맨 뒤

### 프로젝트 List 서식 정리 + 발표일 "서면평가"
- 프로젝트 List 표: 수정/삭제 버튼을 맨 왼쪽 → **맨 오른쪽 "관리" 열**로 이동(읽기 권한이면 열 자체를 만들지 않음). 합계 행이 용역명 열 아래에 붙던 열 어긋남도 함께 정정
- 발표/면접일 입력 폼에 **"날짜 지정 / 서면평가"** 선택 추가. 서면평가를 고르면 날짜는 비워 저장
- 신규 컬럼 `projects.interview_written`(boolean) — 마이그레이션 `supabase/migration_project_interview_written.sql`. 기존에 `project_tooltips.interview_time`에 "서면평가"로 적어둔 건들을 이 컬럼으로 이관
- 주간/월간보고: 서면평가 건은 기다릴 발표가 없으므로 **제출일이 지나는 즉시 개찰 항목으로 이동**(`categorizeProject`). 월간 표 발표/면접 열은 "서면평가"로 표기
- 판정은 `lib/projectStatus.ts`의 `isWrittenEvaluation()` 하나로 통일 — 주간보고 수동 추가 행에 사람이 적어 넣은 "서면"/"서면평가" 텍스트도 같이 인정
- 영향 파일: `app/(dashboard)/projects/page.tsx`, `app/dashboard.tsx`, `lib/projectStatus.ts`, `lib/hwpx/monthlyFormat.ts`, `app/api/hwpx/route.ts`

### 발주예상 Project 이월 로직 개선
- 이전 주 1주만 보던 방식 → DB에서 현재 주 이전 중 가장 최근 주차를 직접 쿼리
- 중간에 저장 없이 여러 주가 비어 있어도 항상 마지막 저장 데이터를 가져옴
- 진행중에 올라온 용역명(사업명)과 동일한 항목은 발주예상에서 자동 제외
- 영향 파일: `app/dashboard.tsx`

### 미래봇 날짜 인식 수정 (`8ee0054`)
- 시스템 프롬프트에 오늘 날짜(`Asia/Seoul` 기준) 명시 → 학습 컷오프 날짜 오답 해결
- projects 쿼리에 `submit_date`, `interview_date`, `bid_date` 추가
- "오늘 개찰", "이번 주 발표" 등 날짜 기반 질문 정확 응답 가능

### 모바일 달력 및 툴팁 개선 (`b59a31e`)
- WeeklyCalendar: 헤더 범례 숨김, 칩 글자 축약(제/발/개), 최대 2개 + `+N` 뱃지
- WeeklyCalendar/NoteTooltipCell: `onTouchStart` 탭 토글 + 글로벌 dismiss
- projects/page.tsx 메모 팝업: `position: fixed`로 전환, `scrollY` 제거, 화면 밖 넘침 방지 (flip)

### 프로젝트 문서화 (`7a99473`)
- `docs/` 폴더 신규 생성
- AI(Claude Code 등)가 프로젝트를 이어서 작업할 수 있도록 8개 Markdown 파일 작성
  - `README.md`: 문서 목록 + 빠른 컨텍스트 요약
  - `overview.md`: 서비스 목적, 기술 스택, 페이지 구조
  - `architecture.md`: 디렉토리 구조, 인증 흐름, 데이터 흐름
  - `database.md`: 전체 테이블 스키마 + 컬럼 설명
  - `features.md`: 기능별 동작 방식, 분류 로직, 컴포넌트 props
  - `conventions.md`: 스타일 규칙, 날짜 파싱 주의사항, Supabase 클라이언트 선택 가이드
  - `deployment.md`: 환경 변수, 실행 방법, Supabase OAuth/RLS 설정
  - `changelog.md`: 기능 변경 이력 + 기록 템플릿

### 모바일 반응형 레이아웃 (`17903e8`)
- `useIsMobile` 훅 추가 (768px 기준)
- `SidebarContainer`: 모바일에서 햄버거 메뉴 + 슬라이드 오버레이 사이드바
- 메인 대시보드: 모바일에서 단일 컬럼 세로 스크롤 레이아웃
- 주간보고: 헤더 축약, 요약카드 2열, 교육/기타 단일 컬럼
- viewport meta 태그 추가

### 메인페이지 달력 데이터 소스 개선 (`941e50e`)
- `performing_projects`에 이번 주 데이터 없으면 `projects` 직접 표시
- `project_notes` 쿼리 실패해도 달력 데이터 유지 (로드 순서 분리)

### 캘린더 메모 hover 툴팁 (`0266605`)
- `WeeklyCalendar`에 `notes` prop 추가
- 이벤트 칩에 메모 있으면 `●` 표시 + hover 툴팁
- 메인 페이지, 주간보고 날짜 셀 모두 적용

## 2026-06

### 프로젝트 List 셀 메모 기능 (`cb068ba`)
- `project_notes` 테이블 신규
- 발주처·제출일·발표일·개찰일·참여사 컬럼에 메모 CRUD
- 주황색 점(●) 인디케이터

### 관리자 뒤로가기 → 메인페이지 연결 (`01e4dd2`)
- 사이드바 `← 뒤로` 버튼: `/weekly` → `/`로 변경

### 주간보고 달력 제거 (`a211b07`)
- 주간/월간보고 하단 달력 제거
- 메인 대시보드 달력 제목 스타일 통일

### 주간보고 프로젝트 분류 규칙 확정 (`49463a6`, `05619b2`)
- 3단계 분류 규칙 구현 (제출일 → 발표/면접일 → 개찰일)
- 서면 = 개찰 처리
- UTC 타임존 버그 수정 (`parseLocalDate` 함수 도입)
- 저장된 데이터 재분류 로직 추가 (금산군, 세종-천안간 미삭제 버그 수정)
- `visibilitychange` 이벤트로 메인 달력 자동 새로고침

### 대시보드 2×2 레이아웃 (`05619b2`)
- 메인 대시보드: 달력 + 금주일정 + 미래봇 + 참고자료 4분할

### 프로젝트 + 툴팁 단일 폼 (`e72f8de`)
- 추가/수정 모달에서 `projects`와 `project_tooltips` 동시 저장

### 툴팁 CRUD UI (`967d092`)
- 용역명 클릭 → 공고 상세 모달

---

## 앞으로 추가 예정 기능 (템플릿)

> 새 기능을 추가할 때 아래 형식으로 기록하세요.

### YYYY-MM — 기능명 (`커밋 해시`)
- 변경 내용
- 영향받는 파일
- 특이사항/주의점
