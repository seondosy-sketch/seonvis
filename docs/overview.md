# 프로젝트 개요

## 서비스 이름
**미래사업팀 Hub**

## 목적
미래사업팀 내부 전용 업무 통합 플랫폼. 프로젝트 입찰 현황 관리, 주간/월간 업무보고 작성, AI 챗봇(미래봇) 활용을 한 곳에서 처리한다.

## 주요 사용자
- 미래사업팀 팀원 (Google 계정 로그인 후 관리자 승인 필요)
- 관리자 (`ADMIN_EMAILS` 환경 변수에 등록된 이메일)

## 기술 스택

| 항목 | 버전 / 서비스 |
|---|---|
| Framework | Next.js 16.2.9 (App Router, Turbopack) |
| Language | TypeScript |
| UI | React 19 — **전체 inline style**, Tailwind는 reset 용도로만 사용 |
| Backend | Supabase (PostgreSQL + Auth + Storage) |
| AI | Claude API (미래봇 챗봇) |
| HWPX 생성 | kordoc 라이브러리 + adm-zip |
| Deployment | Vercel (추정) / 로컬 `npm run dev` |

## 접근 방식 & 설계 원칙
- **인증**: Supabase Google OAuth → `allowed_users` 테이블에 없으면 `/unauthorized` 리다이렉트
- **스타일**: Tailwind 클래스 없이 100% inline style 객체로 작성 (예외: `cell-input` 클래스)
- **주석 없음**: 코드에 주석 최소화, 이름으로 의미 표현
- **모바일 대응**: `useIsMobile` 훅(768px 기준)으로 JS 조건 분기

## 페이지 구조

```
/               → 메인 대시보드 (달력 + 금주일정 + 미래봇 + 참고자료)
/projects       → 프로젝트 List (입찰 현황 테이블)
/weekly         → 주간/월간 업무보고 작성
/admin          → 사용자 관리 (관리자 전용)
/login          → Google 로그인
/unauthorized   → 접근 거부 안내
/request-access → 접근 요청 페이지
```

## 실행 방법

```bash
npm install
npm run dev   # http://localhost:3000
```

필요한 환경 변수 → `docs/deployment.md` 참고
