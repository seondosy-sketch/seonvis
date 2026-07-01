# 코드 컨벤션

## 스타일 작성 방식

**전체 inline style 사용** — CSS 파일이나 Tailwind 클래스로 레이아웃을 잡지 않는다.

```tsx
// ✅ 올바른 방식
<div style={{ display: 'flex', gap: 8, background: '#fff', borderRadius: 8 }}>

// ❌ 사용하지 않음
<div className="flex gap-2 bg-white rounded-lg">
```

**예외**: `globals.css`의 `.cell-input` 클래스는 테이블 셀 인풋 공통 스타일로 사용.

---

## 색상 팔레트 (자주 쓰는 값)

| 용도 | 값 |
|---|---|
| 배경 | `#f8f8f7` |
| 카드/패널 배경 | `#fff` |
| 테두리 | `#e8e8e6` |
| 연한 테두리 | `#f0f0ee` |
| 본문 텍스트 | `#111` |
| 보조 텍스트 | `#555`, `#888`, `#999`, `#aaa` |
| 포인트 (앰버) | `#f59e0b` |
| 포인트 (오렌지) | `#f97316` |
| 제출일 블루 | `#1d4ed8` (bg: `#eff6ff`, border: `#bfdbfe`) |
| 발표일 앰버 | `#b45309` (bg: `#fffbeb`, border: `#fde68a`) |
| 개찰일 그린 | `#15803d` (bg: `#f0fdf4`, border: `#bbf7d0`) |
| 진행중 그린 | `#22c55e` |
| 위험/삭제 | `#ef4444` |

---

## 컴포넌트 작성 패턴

### 모바일 분기
```tsx
const isMobile = useIsMobile()

return isMobile ? (
  <모바일레이아웃 />
) : (
  <데스크톱레이아웃 />
)
```

### 날짜 파싱 — **반드시 parseLocalDate 사용**
```typescript
// ❌ UTC 버그 발생
new Date("2026-06-30")  // 한국에서 6월 29일로 파싱됨

// ✅ 로컬 타임존 사용
function parseLocalDate(d: string | null | undefined): Date | null {
  if (!d) return null
  const iso = d.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) return new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]))
  const md = d.match(/^(\d{1,2})\/(\d{1,2})$/)
  if (md) return new Date(new Date().getFullYear(), parseInt(md[1]) - 1, parseInt(md[2]))
  return null
}
```

### Supabase 클라이언트 선택
```typescript
// Client Component (브라우저)
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
const supabase = createSupabaseBrowserClient()

// Server Component / API Route
import { createSupabaseServerClient } from '@/lib/supabase-server'
const supabase = await createSupabaseServerClient()

// API Route에서 RLS 우회 필요 시 (관리자 기능만)
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
const admin = createSupabaseAdminClient()
```

### project_notes upsert
```typescript
await supabase.from('project_notes').upsert(
  { project_number, field, note, updated_at: new Date().toISOString() },
  { onConflict: 'project_number,field' }
)
```

---

## 파일 네이밍

| 종류 | 규칙 | 예시 |
|---|---|---|
| 페이지 | `page.tsx` | `app/(dashboard)/page.tsx` |
| 레이아웃 | `layout.tsx` | `app/(dashboard)/layout.tsx` |
| 공용 컴포넌트 | PascalCase | `WeeklyCalendar.tsx` |
| 훅 | camelCase, `use` 접두사 | `useIsMobile.ts` |
| API Route | `route.ts` | `app/api/chat/route.ts` |

---

## 주의사항

1. **주석 최소화**: 자명한 코드에 주석 달지 않음. WHY가 불명확할 때만 짧게.
2. **에러 핸들링**: `Promise.all` 내 여러 쿼리 중 하나가 실패하면 전체가 실패함 → 핵심 쿼리는 분리.
3. **날짜 형식 혼재**: DB에는 `YYYY-MM-DD`, 화면 표시는 `M/D` 형식. 변환 시 `fmtDate()` 함수 사용.
4. **ISO 주차**: `2026-W26` 형식. `getCurrentWeek()`와 `getWeekRange()` 함수로 일관 처리.
5. **메모 필드명**: `project_notes.field` 값은 반드시 `client`, `submit_date`, `interview_date`, `bid_date`, `competitors` 중 하나.
