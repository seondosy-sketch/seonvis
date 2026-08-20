# 개발환경 전용 Test Auth + UI 자동검증

## 왜 필요한가

미래Hub 로그인은 Google OAuth 하나뿐이다(`app/login/page.tsx`). 그래서 자동화 도구나 AI 도구가
`/interviews` 같은 인증 화면을 열 수 없고, UI 검증을 사람이 매번 눈으로 해야 했다.

Test Auth는 **Google OAuth 화면만 건너뛴다.** 권한은 건너뛰지 않는다:

- 전용 Supabase Auth 사용자로 **실제 로그인**해서 평소와 같은 쿠키 세션을 만든다.
- 따라서 JWT에 실제 email이 들어가고 `allowed_users` · `menu_permissions` · RLS
  (`private.menu_permission`)가 그대로 적용된다.
- "개발이면 통과" 같은 DB 세션 없는 우회가 아니다. 그렇게 하면 화면은 열리지만 Supabase 질의가
  `auth.jwt()`를 못 받아 조용히 빈 결과가 나오고, 검증이 의미를 잃는다.

실제 사용자의 Google 비밀번호·OTP·쿠키는 쓰지 않는다. 그런 값을 저장하지도 않는다.

## 구성 요소

| 파일 | 역할 |
|---|---|
| `lib/testAuth.ts` | 순수 게이트 함수 `resolveTestAuth()` — production 차단 판정 |
| `lib/testAuth.test.ts` | 그 판정을 고정하는 단위테스트 |
| `app/api/test-auth/login/route.ts` | 개발환경 전용 로그인(세션 쿠키 발급) |
| `app/api/test-auth/logout/route.ts` | 세션 정리 |
| `proxy.ts` | 위 두 경로를 로그인 리다이렉트 예외로 — **test auth가 켜진 환경에서만** |
| `playwright.config.ts`, `e2e/` | UI 자동검증 |

## 로컬 준비

### 1. 환경변수 (`.env.local`)

`.env.local`은 `.gitignore` 대상이다. 실제 값은 여기에만 둔다.

```
TEST_AUTH_ENABLED=true
TEST_AUTH_EMAIL=<개발용 테스트 계정 이메일>
TEST_AUTH_PASSWORD=<그 계정 비밀번호>
```

- 이름만 `.env.example`에 있고 값은 비어 있다.
- 비밀번호는 사람이 쓰는 계정이 아니라 **테스트 전용 계정**의 것이다.
- 이 값들을 로그·스크린샷·보고서·커밋에 넣지 않는다.

### 2. 테스트 사용자

전용 Supabase Auth 사용자(이메일/비밀번호) 1개를 쓴다. Google 로그인 사용자와 완전히 별개이고,
실제 사람의 계정을 test identity로 쓰지 않는다.

준비 조건:

- `auth.users`에 그 이메일이 있고 `email_confirm`이 되어 있다(비밀번호 로그인이 가능해야 한다).
- `allowed_users`에 그 이메일 행이 있다. 구분을 위해 `note`에 `[TEST]` 표시를 남긴다.
- `menu_permissions`는 실제 정책을 그대로 태운다. 권고 값:
  - `interview_db: "write"` — 이번 검증 대상
  - 나머지 메뉴: `"read"` — 테스트가 오작동해도 다른 도메인 데이터를 바꿀 수 없다

권한을 바꾸면 UI에도 그대로 반영된다(등록/수정/삭제 버튼이 사라진다). 즉 권한 시나리오 자체를
테스트할 수 있다.

### 3. 동작 확인

```bash
curl -s -X POST http://localhost:3000/api/test-auth/login
```

성공 응답에는 토큰이 들어 있지 않다 — 세션 존재 여부만 알려준다:

```json
{"ok":true,"email":"...","hasSession":true,"isAdmin":false,"menuPermissions":{"interview_db":"write"}}
```

로그아웃:

```bash
curl -s -X POST http://localhost:3000/api/test-auth/logout
```

> Supabase `signOut()`은 기본이 global scope다. 로그아웃하면 같은 계정의 다른 세션(예: 열어 둔
> 브라우저 탭)도 함께 끊긴다.

## production 안전장치

`resolveTestAuth()`가 아래 순서로 판정하고, 거부는 대부분 **404**다(경로의 존재 자체를 알리지 않는다).

1. `NODE_ENV === 'production'` → 404
2. `VERCEL_ENV`가 `production` / `preview` → 404 (NODE_ENV와 무관하게)
3. `TEST_AUTH_ENABLED !== 'true'` → 404 (기본값은 꺼짐)
4. `TEST_AUTH_EMAIL` 없음 → 404
5. `TEST_AUTH_PASSWORD` 없음 → 404
6. 요청이 지목한 이메일 ≠ `TEST_AUTH_EMAIL` → 403
7. 그 이메일이 `allowed_users`(또는 `ADMIN_EMAILS`)에 없음 → 403

여기에 더해 `proxy.ts`는 test auth가 켜진 환경에서만 로그인 리다이렉트 예외를 연다. production에서는
예외가 아예 생기지 않아 요청이 라우트에 닿기도 전에 `/login`으로 간다.

즉 **실수로 Vercel production에 `TEST_AUTH_ENABLED=true`가 들어가도** ①proxy가 막고 ②라우트가
404를 돌려준다. 두 겹 모두 실측으로 확인한다(아래 "회귀" 참고).

## Playwright UI 테스트

### 실행

```bash
npm run e2e
```

- `webServer` 설정이 `npm run dev`를 띄우거나 이미 떠 있는 서버를 재사용한다.
- `e2e/global-setup.ts`가 Test Auth로 한 번 로그인해 세션을 `.playwright/.auth/user.json`에
  저장하고, 모든 테스트가 그 파일을 재사용한다(테스트마다 로그인하지 않는다).
- 그 파일에는 실제 세션 쿠키가 담긴다 — `.gitignore` 대상이고 커밋하지 않는다.
- `trace` / `screenshot` / `video`는 기본 off다. 산출물에 인증정보가 남지 않게 하려는 것이며,
  필요할 때만 커맨드라인으로 켠다.

특정 서버를 대상으로 하려면:

```bash
E2E_BASE_URL=http://localhost:3001 npm run e2e
```

### read-only 테스트와 mutation 테스트

| 종류 | 파일 | 기본 실행 |
|---|---|---|
| read-only (로그인·메뉴·목록·필터·pagination·drawer·master select) | `e2e/auth.spec.ts`, `e2e/interviews.spec.ts` | 항상 |
| mutation (후기 생성·삭제) | `e2e/interviews.mutation.spec.ts` | **건너뜀** |

mutation 테스트는 운영 Supabase에 실제로 쓰기 때문에 명시적으로 허용해야 돈다:

```bash
E2E_ALLOW_MUTATION=true npm run e2e:mutation
```

지킬 것:

- 테스트 데이터에는 `[E2E-DELETE-ME]` 표시를 넣는다(사람이 눈으로도 구분할 수 있게).
- 같은 테스트 안에서 삭제까지 하고, 질문이 함께 지워졌는지(cascade) 화면에서 다시 확인한다.
- 실패로 중단되면 `[E2E-DELETE-ME]`로 검색해 남은 행을 직접 지운다.

## 다른 화면에도 재사용

Test Auth는 면접 DB 전용이 아니다. `e2e/env.ts` + `global-setup.ts`가 세션을 만들어 두므로
새 spec 파일에서 곧바로 `page.goto('/attendance')` 같은 식으로 쓸 수 있다. 다만 테스트 사용자의
`menu_permissions`가 그 메뉴에서 `read`라면 쓰기 UI는 보이지 않는다 — 필요하면 그 메뉴만 `write`로
올리거나, 읽기 전용 사용자를 따로 하나 더 만든다.

## 하지 않는 것

- 실제 사용자 Google 비밀번호 / OTP / 세션 쿠키 저장
- refresh token 커밋
- service role로 UI 세션 위조
- production auth bypass, RLS 비활성화, 모든 사용자 관리자 처리
- 비밀 값 로그·보고서 출력 (토큰은 존재 여부만 boolean으로 다룬다)

## 회귀

```bash
npx tsc --noEmit
npx eslint .
npm test          # vitest — lib/testAuth.test.ts 포함
npm run build
npm run e2e
```

production 차단은 다음으로 확인한다(`TEST_AUTH_ENABLED=true`를 그대로 둔 상태에서):

```bash
npm run build
npx next start -p 3100
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3100/api/test-auth/login   # 307 → /login
```

유효한 세션 쿠키를 붙여 proxy를 통과시키면 라우트 자체가 404를 돌려준다 — 두 겹 모두 살아 있다는
뜻이다.
