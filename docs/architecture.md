# 아키텍처

## 디렉토리 구조

```
app/
├── (dashboard)/            # 인증 필요 영역 (layout.tsx에서 auth guard)
│   ├── layout.tsx          # Server Component: auth 검사 → SidebarContainer 렌더
│   ├── page.tsx            # 메인 대시보드 (달력, 금주일정, 미래봇)
│   ├── projects/
│   │   └── page.tsx        # 프로젝트 List
│   ├── weekly/
│   │   └── page.tsx        # 주간/월간보고 진입점 (dashboard.tsx import)
│   └── admin/
│       ├── page.tsx        # 관리자 페이지
│       └── AdminUserManager.tsx
├── components/
│   ├── WeeklyCalendar.tsx  # 달력 컴포넌트 (메인/주간보고 공용)
│   ├── SidebarContainer.tsx# 모바일 햄버거 메뉴 래퍼 (Client Component)
│   └── TopBar.tsx          # (현재 미사용)
├── api/
│   ├── chat/
│   │   ├── route.ts        # 미래봇 Claude API 호출
│   │   └── execute/
│   │       └── route.ts    # 미래봇 DB 액션 실행
│   ├── hwpx/
│   │   └── route.ts        # 주간/월간 HWPX 파일 생성
│   └── access-requests/
│       └── route.ts        # 접근 요청 처리
├── dashboard.tsx           # 주간/월간보고 실제 컴포넌트 (weekly/page.tsx에서 사용)
├── sidebar.tsx             # 사이드바 네비게이션 (Client Component)
├── layout.tsx              # 루트 레이아웃 (viewport meta 포함)
└── globals.css             # Tailwind reset + .cell-input 클래스

lib/
├── supabase.ts             # anon client + TypeScript 인터페이스 정의
├── supabase-browser.ts     # createSupabaseBrowserClient (Client Component용)
├── supabase-server.ts      # createSupabaseServerClient (Server Component용)
├── supabase-admin.ts       # Service role client (RLS 우회, server only)
├── useIsMobile.ts          # 모바일 감지 훅 (768px 기준)
└── templates/              # HWPX 템플릿 파일
```

## 인증 흐름

```
브라우저 접속
    ↓
app/(dashboard)/layout.tsx  [Server Component]
    → createSupabaseServerClient()로 세션 확인
    → 없으면 /login 리다이렉트
    → 있으면 ADMIN_EMAILS 확인
    → 일반 사용자: allowed_users 테이블 조회 (admin client로 RLS 우회)
    → 없으면 /unauthorized
    → 있으면 SidebarContainer 렌더 → children
```

## 데이터 흐름 (메인 대시보드)

```
page.tsx mount
    → loadPerforming()
        1. performing_projects (이번 주) 조회
           → 데이터 있으면 → setPerforming
           → 없으면 → projects 테이블 전체 조회 → 드랍/취소 제외 후 setPerforming
        2. projects (project_number, name) 조회
        3. project_notes 전체 조회
           → project_number → name 매핑으로 calNotes 맵 구성
    → WeeklyCalendar에 performing + calNotes 전달
```

## 데이터 흐름 (주간보고)

```
dashboard.tsx mount (week 변경 시)
    → load()
        Promise.all([
          performing_projects (해당 주),
          expected_projects (해당 주),
          weekly_meta (해당 주),
          projects (전체 ref),
          project_notes (전체)
        ])
    → performing 분류: categorizeProject() 3단계 규칙 적용
        1. 제출일 < weekStart → 2단계
        2. 발표/면접일 (서면=개찰, 공란=진행중, 날짜<weekStart) → 3단계
        3. 개찰일 < weekStart → 제외 / 나머지 → 개찰
    → 저장된 행 재분류 + 새 행 병합
```

## 컴포넌트 의존 관계

```
SidebarContainer (Client)
    └── Sidebar (Client)

WeeklyCalendar (Client)
    - props: week, performing, notes
    - 내부: events useMemo → dateKey별 CalEvent 배열
    - 툴팁: onMouseEnter/Leave로 fixed 위치 표시

NoteTooltipCell (dashboard.tsx 내 정의)
    - 날짜 input + 메모 dot + hover 툴팁
    - calNotes[row.name]?.[field] 로 메모 조회
```
