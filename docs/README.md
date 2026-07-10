# 문서 목록

AI(Claude Code, ChatGPT 등)가 이 프로젝트를 이어서 작업할 때 반드시 이 폴더를 먼저 읽으세요.

| 파일 | 내용 | 언제 읽나 |
|---|---|---|
| [overview.md](./overview.md) | 프로젝트 목적, 기술 스택, 페이지 구조 | 처음 시작할 때 |
| [architecture.md](./architecture.md) | 디렉토리 구조, 인증 흐름, 데이터 흐름 | 파일 위치·관계 파악 시 |
| [database.md](./database.md) | 모든 테이블 스키마, 컬럼 설명, 클라이언트 구분 | DB 쿼리 작성 전 |
| [features.md](./features.md) | 기능별 동작 방식, 분류 로직, 컴포넌트 props | 기능 수정·추가 시 |
| [conventions.md](./conventions.md) | 스타일 규칙, 날짜 파싱 주의사항, 패턴 | 코드 작성 전 |
| [deployment.md](./deployment.md) | 환경 변수, 실행 방법, Supabase 설정 | 환경 구성 시 |
| [changelog.md](./changelog.md) | 기능 변경 이력 | 히스토리 파악 시 |
| [overtime.md](./overtime.md) | 연장근무 관리(제안서팀) 단계별 설계·로드맵 | 이 기능 작업 시 |

## 빠른 컨텍스트 요약

- **언어**: 한국어 서비스, 코드는 영어/한국어 혼용
- **스타일**: 전체 inline style (Tailwind 클래스 사용 안 함)
- **DB 날짜**: `YYYY-MM-DD` 저장 → 화면 `M/D` 표시. `parseLocalDate()` 필수 사용
- **Supabase 클라이언트**: Browser/Server/Admin 3종 구분 — `docs/conventions.md` 참고
- **모바일**: `useIsMobile()` 훅 (768px) + JS 조건 분기
- **주간 분류 규칙**: 3단계 (제출일 → 발표일 → 개찰일). `docs/features.md` 참고
