# SEONvis — 미래사업팀 Hub

(주)선 미래사업팀 전용 내부 대시보드. 주간업무보고 작성, 프로젝트 현황 관리, AI 어시스턴트(미래봇)를 통합한 웹 애플리케이션.

- **배포 URL**: https://seonvis.vercel.app
- **GitHub**: https://github.com/seondosy-sketch/seonvis

---

## 주요 기능

| 메뉴 | 설명 |
|------|------|
| 미래봇 | Gemini AI 기반 챗봇 — 프로젝트 조회·추가·수정 가능 |
| 주간/월간보고 | 프로젝트 현황 테이블 인라인 편집, HWPX 보고서 자동 생성·다운로드 |
| 프로젝트 List | 전체 프로젝트 CRUD, 용역명 클릭 시 상세 툴팁 모달 |
| 방문자 접근 신청 | 비승인 사용자 자기 서비스 접근 요청 시스템 |

### 주간/월간보고 세부 기능
- 수행 프로젝트 테이블 (개찰 / 진행중 그룹 자동 분류)
- 발주예상 프로젝트 테이블 — 이전 주차 미진입 항목 자동 이월
- 교육참가자 항목별 입력 + 행별 인원수 표시 + 총계
- 주간 달력 — 주차 변경 시 자동 이동, 두 달 걸치는 주차도 정상 표시
- 교육참가자 자동완성 (진행중 프로젝트 기준)

---

## 기술 스택

| 영역 | 기술 |
|------|------|
| 프레임워크 | Next.js 16 (App Router, Turbopack) |
| 언어 | TypeScript |
| 스타일 | Tailwind CSS |
| DB | Supabase (PostgreSQL) |
| 인증 | Google OAuth (Supabase Auth) |
| AI | Google Gemini API (`gemini-3.1-flash-lite`) |
| HWPX 생성 | adm-zip + @xmldom/xmldom (XML 직접 조작) |
| 배포 | Vercel |

---

## 로컬 개발 — 새 컴퓨터에서 10분 안에 시작하기

```bash
# 1. 클론
git clone https://github.com/seondosy-sketch/seonvis.git
cd seonvis

# 2. 의존성 설치
npm install

# 3. 환경변수 가져오기 — 아래 두 방법 중 하나
```

**방법 A. Vercel CLI로 가져오기 (권장, 별도 복사 불필요)**

```bash
npm i -g vercel        # 최초 1회
vercel login           # 계정 로그인 (브라우저 인증)
vercel link             # 이 프로젝트를 Vercel의 seonvis 프로젝트와 연결
vercel env pull .env.local
```

Vercel 프로젝트에 설정된 환경변수를 그대로 받아오므로, **Vercel 쪽에 새 환경변수(예: `NEXT_PUBLIC_KAKAO_MAP_KEY`)를 추가했다면 반드시 Vercel 대시보드에도 동일하게 등록**해둬야 이 방법으로 최신 값을 받을 수 있습니다.

**방법 B. 수동 복사**

`.env.example`을 `.env.local`로 복사한 뒤, 값은 팀 비밀번호 관리자(1Password 등)에 저장해둔 값을 채워 넣습니다.

```bash
cp .env.example .env.local
```

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ADMIN_EMAILS=
GEMINI_API_KEY=
NEXT_PUBLIC_KAKAO_MAP_KEY=   # Kakao Developers JavaScript 키 (지도/주소검색/길찾기)
```

`NEXT_PUBLIC_KAKAO_MAP_KEY`는 [Kakao Developers](https://developers.kakao.com)에서 앱 등록 후 발급받는 JavaScript 키이며, 사용하는 도메인(localhost, Vercel 배포 도메인)을 등록하고 **카카오맵 제품(서비스)을 활성화**해야 동작합니다.

```bash
# 4. 개발 서버 실행
npm run dev
```

브라우저에서 http://localhost:3000 접속.

---

## 프로젝트 구조

```
app/
├── (dashboard)/          # 인증 후 레이아웃
│   ├── page.tsx          # 미래봇 (기본 랜딩)
│   ├── weekly/           # 주간/월간보고
│   └── projects/         # 프로젝트 List
├── api/
│   ├── chat/             # 미래봇 Gemini API 라우트
│   ├── download-hwpx/    # 주간 HWPX 생성
│   └── download-monthly/ # 월간 HWPX 생성
├── auth/callback/        # Google OAuth 콜백
├── dashboard.tsx         # 주간보고 핵심 컴포넌트
└── components/
    └── WeeklyCalendar.tsx # 주간 달력 컴포넌트

public/
└── tooltip_data.json     # 프로젝트 툴팁 정적 데이터 (46개)
```

---

## 데이터베이스 (Supabase)

| 테이블 | 설명 |
|--------|------|
| `projects` | 전체 프로젝트 마스터 (미래봇 관리) |
| `performing_projects` | 주차별 수행 프로젝트 (주간보고용) |
| `expected_projects` | 주차별 발주예상 프로젝트 |
| `weekly_meta` | 주차별 교육참가자·기타 메타 |
| `access_requests` | 방문자 접근 신청 |

---

## 배포

`main` 브랜치에 푸시하면 Vercel이 자동 배포.  
로컬 DB 변경 사항은 Supabase에 직접 반영되므로 배포된 사이트에도 즉시 동기화됨.
