# Google Calendar 연동 (Hub → Google, 단방향)

프로젝트 일정을 Google Calendar의 **미래사업팀** 캘린더로 자동 전송한다.

- 관리자 화면: 사이드바 **관리자 → Google Calendar 연동** → `/admin/calendar`
- Hub가 원본이다. Google에서 직접 고친 내용은 **가져오지 않는다**. Hub에서 다시 저장하면 Hub 값으로 덮어쓴다.
- 양방향 동기화·Google webhook·변경사항 수신은 구현하지 않는다.

---

## 인증 — 서비스 계정 (refresh token을 저장하지 않는다)

기존 Google 로그인(Supabase Auth)에 Calendar scope를 붙이는 방식은 쓰지 않았다.

1. **Supabase가 provider token을 보관·갱신하지 않는다.** 세션이 갱신되면 `provider_token`/
   `provider_refresh_token`이 사라지고 Google 쪽 토큰은 만료된 채 남는다 → 백그라운드 동기화에 못 쓴다.
2. 팀원 전원에게 캘린더 권한 동의를 요구하게 된다(최소 권한 위반). 캘린더는 하나, 쓰기 주체도 하나면 된다.
3. 로그인 경로에 scope를 추가하면 동의 화면 변경으로 **기존 로그인이 깨질 위험**이 있다.

그래서 **서비스 계정 + 캘린더 공유**를 쓴다. 서버가 개인키로 JWT(RS256)를 서명해 액세스 토큰을
받고, 그 토큰으로 Calendar API를 부른다. **DB에 토큰을 저장하는 컬럼이 아예 없다** — 유출 대상을
만들지 않는 것이 목적이다.

| 항목 | 값 |
|------|-----|
| GCP 프로젝트 | `seonvis-hub` |
| 서비스 계정 | `seonvis-calendar@seonvis-hub.iam.gserviceaccount.com` |
| 대상 캘린더 | `미래사업팀` (`9hpls2qff039h02881jd6v194k@group.calendar.google.com`, Asia/Seoul) |
| 환경변수 | `GOOGLE_SA_CLIENT_EMAIL`, `GOOGLE_SA_PRIVATE_KEY`(개행을 `\n`으로 이스케이프한 한 줄) |

### scope는 3개만 쓴다 (전체 `calendar` scope 아님)

```text
calendar.events              이벤트 생성·수정·삭제
calendar.calendarlist        공유받은 캘린더를 서비스 계정 목록에 등록
calendar.calendars.readonly  캘린더 이름·시간대 확인
```

### ⚠️ 서비스 계정은 공유를 자동 수락하지 않는다

캘린더를 서비스 계정에 공유해도 `calendarList.list`가 **빈 목록**을 돌려준다(실측 확인,
[issue 148804709](https://issuetracker.google.com/issues/148804709)). 그래서 연결 화면은
**Calendar ID를 입력받아 `calendarList.insert`로 등록한 뒤** 목록을 조회한다. 캘린더를 새로
만들지는 않는다.

### 최초 설정 (사람이 하는 일)

1. GCP에서 Calendar API 사용 설정 + 서비스 계정 생성 + 키 발급 (`gcloud`로 수행 가능)
2. Google Calendar → `미래사업팀` → **설정 및 공유 → 특정 사용자와 공유** → 서비스 계정 이메일 추가,
   권한 **"일정 변경"** (CLI로는 불가)
3. 같은 화면 **캘린더 통합 → 캘린더 ID** 복사
4. Vercel 환경변수에 `GOOGLE_SA_CLIENT_EMAIL`, `GOOGLE_SA_PRIVATE_KEY` 등록
5. `/admin/calendar`에서 Calendar ID로 등록 → 목록에서 `미래사업팀` 선택 → 연결

---

## 일정 7종

Hub에는 일정 테이블이 없고 프로젝트 행에 날짜 컬럼이 흩어져 있다. 그 컬럼 하나하나를
**행위(action)** 로 이름 붙여 `(projects.id, action)`을 안정적인 일정 식별자로 쓴다
(`project_number`는 사용자가 편집할 수 있어 키로 쓰지 않는다).

| action | 제목의 행위명 | 출처 컬럼 | 색 |
|--------|--------------|-----------|-----|
| `announce` | 공고 | `projects.announce_date` (text) | 보라 |
| `pq` | PQ제출 | `project_tooltips.pq_date` (text) | 노랑 |
| `soq` | SOQ제출 | `project_tooltips.soq_date` (text) | 노랑 |
| `submit` | 제출 | `projects.submit_date` (date) | 노랑 |
| `interview` | 면접 | `projects.interview_date` (date) | 빨강 |
| `bid` | 개찰 | `projects.bid_date` (date) | 회색 |
| `notify` | 평가결과 통보 | `project_tooltips.notify_date` (text) | 파랑 |

- 제목은 `[정제된 프로젝트명] 행위명` — 예: `[345kV 신석문 변전소] PQ제출`
- **PQ제출·SOQ제출을 '제출'로 통합하지 않는다** — 캘린더에서 무슨 제출인지 알 수 없게 된다
- 프로젝트명은 HWPX 보고서·위젯과 **같은 정제 함수**(`lib/hwpx/projectName.ts`의
  `formatProjectNameForReport`)를 쓴다. 연동 전용 규칙을 만들지 않는다
- `수행계획서 제출`은 Hub에 입력 필드가 없어 v1에서 제외했다. 필드가 생기면
  `lib/googleCalendar/actions.ts`에 항목 하나, `desired.ts` 추출부에 한 줄을 더하면 된다
- 종일 일정으로 만든다(`start.date` / `end.date = 다음 날`, Google은 end를 배타적으로 다룸)
- 알림은 끈다(`reminders.useDefault = false`) — 팀원 각자의 캘린더 알림과 충돌하지 않게

### 색상은 하드코딩하지 않는다

연결 시점에 `colors.get`으로 실제 팔레트를 받아 목표색과 가장 가까운 ID를 골라
`google_calendar_connection.color_map`에 저장한다. 공개 자료마다 ID↔이름 대응이 다르게 적혀 있고
API 응답에는 이름이 없기 때문이다.

**RGB 거리로 고르면 틀린다.** 2026-07-30 실측 팔레트는 전부 밝은 파스텔(`#dbadff`, `#e1e1e1`)이고
목표색은 진한 색(`#8e24aa`, `#616161`)이라, RGB 유클리드 거리는 명도에 지배돼
보라 → 파랑(`#5484ed`), 회색 → 초록(`#51b749`)이 뽑혔다. 그래서 **색상(hue) 1순위 + 채도 2순위**로
비교하고, 무채색 목표는 채도가 가장 낮은 항목을 고른다(`lib/googleCalendar/colors.ts`).
채도를 빼면 hue 2도 차이의 연한 라벤더가 채도가 일치하는 진한 파랑을 이겨버린다.

실측 결과: 공고 `3` · 제출/PQ/SOQ `5` · 면접 `11` · 개찰 `8` · 평가결과 통보 `9`.

### 실제 데이터 특성 (2026-07-30 실측)

- `announce_date`는 **67건 전부 입력돼 있지만 가장 늦은 값이 2026-07-28**로, 전부 과거다.
  공고일은 프로젝트가 시작될 때 지나가는 날짜라 진행 중인 건은 이미 공고가 끝난 상태다 →
  최초 동기화("오늘 이후")에서는 공고가 0건이 되는 것이 정상이며, 지난 공고를 넣으려면 소급을 쓴다
  (2026-07-30에 최근 3주 공고 13건을 소급으로 채움).
- `notify_date`·`pq_date`·`soq_date`는 `추후`·`1/28`처럼 날짜가 아닌 값이 많아 39건이 건너뛰어진다.

### 날짜 파싱 — `YYYY-MM-DD`만 인정

`announce_date`·`pq_date`·`soq_date`·`notify_date`는 text이고 실제 데이터에
`2/25`(연도 없음)·`추후` 같은 값이 섞여 있다. **연도를 추측하지 않는다** — 엉뚱한 해에 일정이
생기기 때문이다. 건너뛴 값은 개수로 집계해 관리자 화면에 표시한다(2026-07-30 기준 39건).

### 대상 필터

대시보드·위젯·주간보고와 **같은 기준**으로 제외한다 — `status_override='취소'`,
`participants`에 `드랍`/`드롭`, `evaluation='선'`(자사 수주). 화면에 안 보이는 일정이
캘린더에만 생기는 상황을 막기 위해 일부러 기준을 일치시켰다.

---

## 동기화 방식 — 저장 훅이 아니라 원본 대조(reconcile)

Hub의 프로젝트 쓰기는 **전부 브라우저에서** 일어나고 서버 훅이 없다(projects 화면, 미래봇
실행 라우트). 그래서 저장 시점에 이벤트를 밀어 넣는 방식이 아니라 대조 방식을 쓴다.

```text
① 있어야 하는 상태(desired) = projects + project_tooltips에서 계산
② 지금 연결된 상태(current)  = project_calendar_events
③ 차집합만 실행
   desired에만        → events.insert
   양쪽 + 지문 불일치  → events.patch
   current에만        → events.delete  (날짜 제거·프로젝트 삭제·취소 전환·고아 행 모두 이 경로)
```

- **트리거**: ⓐ 프로젝트 저장·삭제 직후 클라이언트가 `POST /api/calendar/sync {projectId}`를
  **기다리지 않고** 보낸다(`lib/googleCalendar/trigger.ts`) ⓑ 관리자 화면의 전체/실패 재동기화
- **지난 일정은 시간이 지났다고 지우지 않는다** — 이미 동기화된 키는 계속 유지 대상으로 둔다
- **소급(backfill)**: 기본은 "KST 오늘 이후"만 만든다. 이미 지나간 일정을 채워 넣어야 할 때는
  관리자 화면의 `지난 N일 전 일정까지 소급해서 추가`(기본 21일 = 최근 3주)를 쓴다
  (`POST /api/calendar/sync { backfillDays }`). 소급은 **관리자 전체 동기화에서만** 허용하고,
  프로젝트 저장 직후 도는 단건 동기화는 과거를 끌어오지 않는다. 한 번 소급으로 만든 일정은
  `syncedKeys`에 들어가므로 이후 일반 동기화(0일)에서도 **삭제되지 않는다**.
  주의: 소급은 일정 7종 **전체**에 적용된다 — 공고만 채우려면 소급 후 나머지를 정리해야 한다
- **삭제 후 같은 종류를 다시 등록하면** 연결 행이 없으므로 새 이벤트가 생긴다(요구사항 그대로)
- 한 회차 Google 호출 상한 200회. 초과분은 `deferred`로 세고 다음 회차로 넘긴다

### 중복 방지 3중

1. `project_calendar_events` PK `(project_id, action)` — 같은 일정은 행이 하나뿐
2. 이벤트에 `extendedProperties.private.hub_key = '<projectId>:<action>'`을 심는다 → 연결 표가
   유실되거나 다시 연결해도 `events.list(privateExtendedProperty=...)`로 **기존 이벤트를 되찾는다**
3. `(calendar_id, google_event_id)` 부분 유니크 인덱스 — 한 이벤트를 두 행이 물 수 없다

멱등성 실측: 같은 프로젝트를 연속 두 번 대조했을 때 두 번째는 **Google 호출 0회**.

### 실패와 재시도

- Google 호출은 항상 Hub 저장 **이후** 별도 요청이다. 실패해도 원본 저장은 이미 끝난 상태다
- 실패 시 `sync_state='failed'`, `last_error`, `retry_count++`를 기록하고 지문을 비워 다음 회차에
  다시 시도하게 한다
- 재시도 분류: `429`·`5xx`·`403 rateLimitExceeded` → 지수 백오프 재시도(최대 3회).
  `404`/`410` → 사람이 캘린더에서 지운 경우로 보고 **재생성**. 그 밖의 4xx → 재시도하지 않고 실패 고정
- 관리자 화면의 **실패 일정 다시 동기화**로 복구한다

---

## 보안

- **refresh token이 없다** — 서비스 계정 방식이라 저장할 토큰 자체가 없다
- 개인키는 서버 환경변수에만 있고 응답·로그·클라이언트로 나가지 않는다
- 두 테이블 모두 **RLS 켜고 정책 0개** = 클라이언트 전면 차단, service role 전용
  (Supabase 어드바이저의 `rls_enabled_no_policy` INFO는 의도된 상태)
- **연결·해제·전체 재동기화는 관리자만**(`ADMIN_EMAILS`). 저장 직후 도는 단건 동기화는 그 프로젝트를
  저장할 수 있었던 승인 사용자까지 허용한다(`lib/googleCalendar/guard.ts`)
- 캘린더 권한은 **"일정 변경"(writer)** 만 있으면 된다. `owner`로 공유해도 동작한다

## 비용

Google Calendar API는 표준 사용 범위에서 **무료**다. 2026-05-01 이후 생성 프로젝트 기준 쿼터는
프로젝트당 분당 10,000요청 / 사용자당 분당 600요청, 일 1,000,000요청이 과금 임계값이다.
이 연동은 최초 25건 + 저장당 1~7회 호출이라 임계값의 0.01% 수준이다.

## 구현 메모

| 파일 | 역할 |
|------|------|
| `lib/googleCalendar/actions.ts` | 행위 7종·제목 조립·`hub_key`·목표색 |
| `lib/googleCalendar/colors.ts` | HSV 색상 매칭 (`colors.test.ts`) |
| `lib/googleCalendar/desired.ts` | 원본 → 있어야 하는 일정 (순수 함수, 시계를 읽지 않음, `desired.test.ts`) |
| `lib/googleCalendar/auth.ts` | 서비스 계정 JWT → 액세스 토큰(모듈 캐시) |
| `lib/googleCalendar/client.ts` | Calendar API 호출 + 재시도 분류 |
| `lib/googleCalendar/reconcile.ts` | 대조 실행·연결 상태 갱신 |
| `lib/googleCalendar/guard.ts` | 관리자/승인 사용자 판정 |
| `lib/googleCalendar/trigger.ts` | 저장 직후 호출(클라이언트, fire-and-forget) |
| `app/api/calendar/connection` | 상태 조회 · 연결 · 해제(`?purge=1`이면 이벤트도 삭제) |
| `app/api/calendar/calendars` | 캘린더 목록(`?add=<id>`로 등록 후 조회) |
| `app/api/calendar/sync` | 단건/전체/실패 재시도 |
| `app/(dashboard)/admin/calendar` | 관리자 설정 화면 |
| `lib/kstDate.ts` | KST 날짜 공용 — 위젯(`lib/widget/summary.ts`)이 재수출해 함께 쓴다 |
| `supabase/migration_google_calendar.sql` | 테이블 2개 |
