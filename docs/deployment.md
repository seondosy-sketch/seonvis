# 배포 및 환경 설정

## 환경 변수

`.env.local` 파일에 설정 (Git에 포함하지 않음).

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...   # 서버 사이드 전용, 클라이언트 노출 금지

# 관리자 이메일 (콤마 구분)
ADMIN_EMAILS=admin@example.com,admin2@example.com

# Claude API (미래봇)
ANTHROPIC_API_KEY=sk-ant-...
```

## 로컬 실행

```bash
git clone <repo>
cd seonvis
npm install
# .env.local 파일 생성 후 위 환경 변수 입력
npm run dev
# → http://localhost:3000
```

## 빌드 & 프로덕션

```bash
npm run build
npm start
```

## Supabase 설정

### Google OAuth 설정
1. Supabase Dashboard → Authentication → Providers → Google 활성화
2. Google Cloud Console에서 OAuth 클라이언트 ID 발급
3. Authorized redirect URI: `https://<supabase-project>.supabase.co/auth/v1/callback`
4. 로컬: `http://localhost:3000/auth/callback`

### RLS 정책
- `projects`, `project_tooltips`, `project_notes`: 인증 사용자 SELECT/INSERT/UPDATE/DELETE
- `performing_projects`, `expected_projects`, `weekly_meta`: 인증 사용자 전체
- `allowed_users`: 읽기는 service role만 (관리자 기능에서 admin client로 우회)

### 필요한 테이블 생성
→ `docs/database.md` 스키마 참고하여 Supabase SQL Editor에서 직접 생성.

## 브랜치 전략

| 브랜치 | 용도 |
|---|---|
| `main` | 프로덕션 (항상 배포 가능 상태) |
| `feature/*` | 새 기능 개발 |
| `v1.0-stable` | tag — 모바일 반응형 작업 전 안정 버전 |

## 주요 패키지 버전 고정 이유

| 패키지 | 이유 |
|---|---|
| `next@16.2.9` | App Router API가 이 버전 기준. 업그레이드 시 `node_modules/next/dist/docs/` 변경사항 확인 필수 |
| `react@19.2.4` | Next.js 16과 페어 버전 |
| `kordoc@3.5.0` | HWPX 생성 라이브러리, API 변경 가능성 있음 |
