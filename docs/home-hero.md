# 홈 브랜드 Hero (미래사업팀 소개 영상)

## 목적

미래Hub Home 상단에 미래사업팀 브랜드 영상을 두어 팀 아이덴티티를 보여준다. **splash가
아니다** — Home에 들어온 순간부터 아래 대시보드 기능을 그대로 쓸 수 있어야 하고, Hero는
업무 화면을 밀어내지 않는다.

UI/branding 레이어 한정이다. KPI·일정·프로젝트·권한·DB·API는 아무것도 건드리지 않는다.

## Placement

| 화면 | 위치 | 크기 |
|---|---|---|
| Desktop (≥768px) | 우측 상단 컬럼(row1/col2) 최상단, 금주 일정 **위** | 재생 중 `aspectRatio:16/9`(`maxHeight:340`) ↔ 그 외 **86px 로고 띠** |
| Mobile (<768px) | 스택 최상단, 금주 일정 위 | `margin:'12px 12px 0'` + `aspectRatio:16/9`, `maxHeight:200` |

Home의 바깥 격자(`gridTemplateColumns:'2fr 1fr'`, `gridTemplateRows:'58vh 42vh'`,
`height:100vh`, `overflow:hidden`)는 **바꾸지 않는다.** 우측 상단 셀이 원래부터
`display:flex; flexDirection:column; gap:8`이라, Hero를 그 안 첫 자식으로 넣고 금주 일정에
`minHeight:0`만 더했다. 그래서 달력·미래봇·CM업계소식·참고자료의 크기가 그대로고, 스크롤
없던 데스크톱 화면에 스크롤이 생기지 않는다.

전체폭 Hero는 쓰지 않는다. 콘텐츠 폭 ~1700px에서 16:9를 지키면 높이가 950px를 넘고,
crop하면 마지막 장면의 텍스트와 캐릭터가 잘린다. 컬럼 폭(≈535px)에 16:9를 맞추면 높이가
≈300px로 떨어지고, 폭이 줄면 높이도 같이 줄어 별도 breakpoint 없이 반응형이 된다.

## Playback policy

| 상황 | 동작 |
|---|---|
| KST 기준 그날 첫 접속 | `muted` + `playsInline`으로 1회 자동재생 (`loop` 없음) |
| 재생 종료 | video를 내리고 poster로 복귀 |
| 같은 KST 날짜 재방문 | **video를 마운트하지 않음** → mp4를 한 바이트도 받지 않는다 |
| 다음 KST 날짜 | 다시 1회 자동재생 |
| `다시보기` 클릭 | 언제든 수동 재생 |
| `prefers-reduced-motion: reduce` | 자동재생 안 함. 다시보기는 허용 |
| `navigator.connection.saveData` | 자동재생 안 함. 다시보기는 허용 |

상태는 `idle` / `playing` / `ended` 셋이고, SSR과 첫 페인트는 **항상 `idle`(poster)** 이다.

## localStorage key

```
key   : futurehub:hero:last-played
value : YYYY-MM-DD  (KST — lib/kstDate.ts의 kstTodayKey())
```

계정별로 나누지 않는다. 잘못 맞았을 때의 비용이 "브랜드 영상을 한 번 더 봄"뿐이고, 이메일을
키에 넣으면 공용 PC의 localStorage에 계정 흔적이 남는다. 저장값이 손상됐으면 "아직 안 본
것"으로 보고 재생한다.

### 재마운트 주의

`useIsMobile()`은 첫 렌더에서 무조건 `false`라, 모바일에서는 데스크톱 분기로 한 번
마운트됐다가 모바일 분기로 재마운트된다. 마운트할 때마다 localStorage를 다시 읽으면 첫
마운트가 남긴 기록 때문에 두 번째 마운트가 "오늘 이미 봤음"으로 판정해 재생이 끊긴다.

그래서 판정은 `lib/hero/dailyPlayback.ts`의 모듈 스코프에 한 번만 담고
(`useSyncExternalStore`로 읽는다), 재마운트는 같은 답을 재사용한다. 값이 바뀌는 건 page
load당 최대 한 번 — 재생이 끝나면 `false`로 내려가 같은 load에서 두 번째 자동재생이 시작되지
않는다. 서버 스냅샷은 항상 `false`여서 hydration mismatch가 없다.

## Accessibility

- poster `<img alt="SEON 미래사업팀">`가 의미를 전달한다. video는 `aria-hidden` + `tabIndex={-1}`이라 스크린리더가 같은 내용을 두 번 읽지 않는다.
- `다시보기`는 진짜 `<button>`이라 Tab·Enter로 닿는다. `aria-label="미래사업팀 소개 영상 다시 재생"`.
- hover 전용 UI가 아니다 — `idle`/`ended`에서 항상 보인다(모바일에서 hover는 동작하지 않는다, `docs/conventions.md` 주의사항 7).
- 영상은 음성 트랙이 없고 muted로만 재생하므로 자막 의무가 없다.
- 명시적 클릭은 motion preference보다 우선한다 — reduced-motion 사용자도 원하면 볼 수 있다.

## Asset paths

```
public/brand/future-team-hero.mp4          H.264 1280x720 24fps 10.000s, 음성 트랙 없음, 2.28MB
public/brand/future-team-hero-poster.webp  1280x720 WebP q85, 35KB
```

poster는 영상의 **마지막 프레임(n=239, t=9.9583s)** 을 그대로 뽑은 것이다. 영상이 멈추는
프레임과 poster가 같은 그림이라 재생→정지 전환에서 점프가 없다. video와 poster 모두
`objectFit:'contain'`이라 framing도 같다.

원본에서 만드는 법 (재생성이 필요할 때):

```bash
ffmpeg -i <원본>.mp4 -map 0:v:0 -c:v copy -an -movflags +faststart public/brand/future-team-hero.mp4
ffmpeg -i public/brand/future-team-hero.mp4 -vf "select='eq(n\,239)'" -frames:v 1 -c:v libwebp -quality 85 -preset picture public/brand/future-team-hero-poster.webp
```

영상 스트림은 재인코딩하지 않는다(`-c:v copy`) — 오디오만 떼어내므로 화질 손실이 0이다.

## Failure fallback

poster가 바닥 레이어로 **항상** 깔려 있고 video는 재생할 때만 그 위에 마운트된다. 그래서
실패가 예외 경로가 아니라 "원래 상태로 남는 것"이다.

| 실패 | 결과 |
|---|---|
| mp4 404 / 네트워크 실패 | `onError` → `idle`. poster 유지 |
| autoplay 차단 | `play()` reject → `idle`. poster + 다시보기 |
| 8초 안에 재생이 시작되지 않음 | `idle`로 복귀(무한 대기 방지) |
| 디코딩 실패 | `onError` → `idle` |
| poster까지 실패 | `aspectRatio`가 상자를 유지하므로 카드 배경만 남고 레이아웃은 안 깨진다 |

## 접힘 (데스크톱만)

Hero가 250px로 고정돼 있던 동안 그 아래 금주 일정이 눌려서 목록이 잘렸다. 그래서 **재생할 때만
펼치고 그 외에는 접는다.**

| 상태 | 카드 높이 | 금주 일정 (1920 기준) |
|---|---|---|
| `playing` | 16:9 그대로 = **300px** (`maxHeight:340`) | 294px |
| `idle` / `ended` | **86px** 로고 띠 | **508px — 목록이 잘리지 않는다** |

하루 1회 정책과 맞물려서, 펼쳐져 있는 시간은 **하루 10초뿐**이고 나머지 방문은 처음부터 접힌
상태로 열린다. 재생 중에는 16:9가 정확히 맞아떨어져 좌우 여백도 0이 된다.

높이 86px은 임의값이 아니라 마지막 화면의 `SEON / 미래사업팀 / 주황 밑줄`이 잘리지 않고 들어가는
최소 높이다. 더 줄이면 글자가 잘린다. 접힌 띠는 전체 그림을 우겨넣는 대신
`object-fit: cover` + `object-position: center 6%`로 **위쪽 로고 부분만** 보여준다 — 폭이 고정이라
전체를 `contain`하면 좌우가 텅 빈다.

`aspect-ratio`가 만든 높이에는 transition이 걸리지 않아, 카드 폭을 `ResizeObserver`로 재서 펼친
높이를 px로 계산한다(측정 전에는 `aspect-ratio`로 그린다). 그래서 420ms 동안 부드럽게 접힌다.

**모바일은 접지 않는다.** 세로로 자연 스크롤되는 화면이라 자리를 아낄 이유가 없고, 기존 배치를
그대로 둔다(`collapsedHeight`를 넘기지 않으면 접힘이 꺼진다).

## 여백(레터박스) 색

`maxHeight:250`이 걸리는 넓은 화면(콘텐츠 폭 ≈1648px 이상, 예: 1920)에서는 상자가 16:9보다
납작해져 `contain` 때문에 좌우에 각 45px 여백이 생긴다. crop을 하지 않기로 한 이상 피할 수
없으므로, 여백 색을 상태에 따라 나눈다.

| 상태 | 배경 | 이유 |
|---|---|---|
| `idle` / `ended` | `#a8a68d` | 마지막 프레임 가장자리(좌 `#a2a088` / 우 `#aeab91`)의 중간값 |
| `playing` | `#22231f` | 영상 중반 `t≈5.96~7.38s`(240프레임 중 34프레임)에 배경이 짙은 초록(`#0c6228`)으로 바뀐다. 올리브 여백을 두면 그 1.4초 동안 띠처럼 도드라진다 |

접힘을 넣은 뒤로는 **실제로 여백이 생기는 경우가 거의 없다** — 재생 중에는 16:9가 정확히 맞고,
접힌 띠는 `cover`라 꽉 찬다. 위 색 구분은 콘텐츠 폭이 아주 넓어 `maxHeight:340`이 걸리는 초광폭
화면(콘텐츠 폭 약 604px 초과)에서만 의미가 있다. 전체 재생 구간에서 가장자리 색과 `#a8a68d`의
차이는 중앙값 Δ9(사실상 무시), 최대 Δ156(초록 장면).

## 관련 파일

| 파일 | 역할 |
|---|---|
| `app/components/FutureTeamHero.tsx` | Hero 컴포넌트 (poster/video/replay 레이어, 상태) |
| `lib/hero/dailyPlayback.ts` | 재생 판정 순수 함수 + page load 스토어 |
| `lib/hero/dailyPlayback.test.ts` | 판정 규칙 단위 테스트 |
| `app/(dashboard)/page.tsx` | 데스크톱·모바일 삽입 지점 |
| `e2e/home-hero.spec.ts` | 자동재생·재방문·다시보기·fallback·레이아웃 검증 |
