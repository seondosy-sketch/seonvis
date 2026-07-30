'use client'

/**
 * 홈화면 위젯 설정 — 내 위젯 주소(토큰) 발급/재발급/해지 + 미리보기 + 설치 안내.
 * 자세한 설치 방법은 docs/widget/README.md.
 *
 * 이 페이지는 사이드바 메뉴가 아니라 푸터 링크로 들어온다(사람별 권한 대상이 아닌
 * "내 계정 설정" 성격이라 lib/menuConfig.ts의 권한 키를 만들지 않았다).
 */

import { useCallback, useEffect, useState } from 'react'
import { useIsMobile } from '@/lib/useIsMobile'

type SizeName = 'small' | 'medium' | 'large'
type ThemeName = 'light' | 'dark'

const SIZE_LABEL: Record<SizeName, string> = {
  small: '작게 (정사각형)',
  medium: '보통 (가로형)',
  large: '크게 (세로형)',
}

const card: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e8e8e6',
  borderRadius: 8,
  padding: 16,
}

const btn: React.CSSProperties = {
  height: 32,
  padding: '0 12px',
  border: '1px solid #e8e8e6',
  borderRadius: 6,
  background: '#fff',
  cursor: 'pointer',
  fontSize: 12,
  color: '#333',
}

const primaryBtn: React.CSSProperties = {
  ...btn,
  border: '1px solid #2563eb',
  background: '#2563eb',
  color: '#fff',
  fontWeight: 600,
}

export default function WidgetSettingsPage() {
  const isMobile = useIsMobile()
  const [token, setToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [size, setSize] = useState<SizeName>('medium')
  const [theme, setTheme] = useState<ThemeName>('light')
  const [previewKey, setPreviewKey] = useState(0)

  // 위젯 주소는 사용자가 실제로 접속한 호스트를 기준으로 만들어야 한다(서버가 보는 호스트와
  // 다를 수 있음). token은 마운트 후 fetch로 채워지므로, token이 있는 렌더는 항상 브라우저다 —
  // 그래서 상태/이펙트 없이 여기서 바로 읽어도 SSR·하이드레이션과 어긋나지 않는다.
  const origin = token && typeof window !== 'undefined' ? window.location.origin : ''

  // loading의 초기값이 true라 여기서 다시 켜지 않는다(마운트 직후 1회만 호출).
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/widget/token')
      if (!res.ok) throw new Error('위젯 주소를 불러올 수 없습니다')
      const data = await res.json()
      setToken(data.token ?? null)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '불러오기 실패')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function issue() {
    if (token && !confirm('새 주소를 발급하면 지금 쓰던 위젯 주소는 즉시 무효가 됩니다. 계속할까요?')) return
    setBusy(true)
    try {
      const res = await fetch('/api/widget/token', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? '발급 실패')
      setToken(data.token)
      setPreviewKey(k => k + 1)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '발급 실패')
    } finally {
      setBusy(false)
    }
  }

  async function revoke() {
    if (!confirm('위젯 주소를 해지하면 등록해 둔 위젯이 더 이상 갱신되지 않습니다. 계속할까요?')) return
    setBusy(true)
    try {
      const res = await fetch('/api/widget/token', { method: 'DELETE' })
      if (!res.ok) throw new Error('해지 실패')
      setToken(null)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '해지 실패')
    } finally {
      setBusy(false)
    }
  }

  const widgetUrl = token ? `${origin}/api/widget/summary?token=${token}&size=${size}&theme=${theme}` : ''
  // 서버가 모든 응답을 no-store로 내리므로 주소는 하나면 되고, 미리보기에는 브라우저가 확실히
  // 다시 받도록 무의미한 값(t)만 바꿔 붙인다. 서버는 이 값을 쓰지 않는다.
  const previewUrl = widgetUrl ? `${widgetUrl}&t=${previewKey}` : ''

  const scriptableCode = widgetUrl
    ? `// 미래Hub 홈화면 위젯 (Scriptable)
const url = "${widgetUrl}"

if (config.runsInWidget) {
  // 홈화면에 그리는 경로 — 자동 갱신은 2시간 이후로 요청한다(iOS가 더 늦출 수는 있다)
  const w = new ListWidget()
  w.setPadding(0, 0, 0, 0)
  w.addImage(await new Request(url).loadImage()).applyFillingContentMode()
  w.refreshAfterDate = new Date(Date.now() + 2 * 60 * 60 * 1000)
  // w.url을 지정하면 탭 동작이 "URL 열기"로 덮어써져 스크립트가 실행되지 않는다 — 그래서 비워둔다.
  // 탭할 때 최신 일정 확인 대신 미래Hub를 열고 싶으면 다음 줄의 주석을 해제:
  // w.url = "${origin}"
  Script.setWidget(w)
} else {
  // 위젯을 탭했을 때(앱에서 실행되는 경로) — 최신 일정을 받아 전체화면으로 보여준다.
  // 이 동작은 "지금 일정 확인"이고, 홈화면 위젯 그림 자체를 바꾸지는 못한다
  // (Scriptable에는 위젯을 강제로 다시 그리게 하는 API가 없다).
  // t는 혹시 OS가 헤더를 무시하고 캐시할 때를 대비한 값이다 — 서버는 쓰지 않는다.
  const latest = await new Request(url + "&t=" + Date.now()).loadImage()
  QuickLook.present(latest, true)
}
Script.complete()`
    : ''

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied(null), 1500)
    } catch {
      setError('복사에 실패했습니다. 주소를 직접 선택해 복사해 주세요.')
    }
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: isMobile ? '12px 12px 60px' : '20px 24px 60px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>홈화면 위젯</span>
        <span style={{ fontSize: 11, color: '#999' }}>아이폰 · 안드로이드 공용</span>
        {loading && <span style={{ fontSize: 11, color: '#bbb' }}>불러오는 중...</span>}
      </div>

      {error && (
        <div style={{ ...card, borderColor: '#fecaca', background: '#fef2f2', color: '#b91c1c', fontSize: 12, marginBottom: 12 }}>
          {error}
        </div>
      )}

      <div style={{ ...card, marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: '#666', lineHeight: 1.6, marginBottom: 12 }}>
          이번 주 <b>제출 · 발표 · 개찰</b> 일정과 <b>팀 일정 · 공휴일</b>을 그린 이미지를 주소 하나로 제공합니다.
          휴대폰의 위젯 앱이 이 주소를 가져가 홈화면에 띄웁니다. 자동 갱신은 <b>2시간 간격</b>으로 낮게 잡았고,
          최신 정보가 필요할 때 쓰는 방법은 <b>기종에 따라 다릅니다</b> — 아래 안내를 확인하세요.
        </div>
        <div style={{ fontSize: 12, color: '#555', lineHeight: 1.7, marginBottom: 12, background: '#f8f8f7', border: '1px solid #e8e8e6', borderRadius: 6, padding: '9px 11px' }}>
          <div>🤖 <b>안드로이드</b>: 위젯을 <b>더블탭</b>하면 홈화면 위젯 이미지가 <b>강제로 갱신</b>됩니다.</div>
          <div style={{ marginTop: 3 }}>📱 <b>아이폰</b>: 위젯을 <b>탭</b>하면 Scriptable에서 <b>최신 일정을 즉시 확인</b>할 수 있습니다.
            {' '}<b style={{ color: '#b45309' }}>홈화면 위젯 이미지 자체는 그 즉시 바뀌지 않고</b>, iOS가 다음 타임라인 갱신을 허용할 때 바뀝니다.</div>
          <div style={{ marginTop: 3, color: '#666' }}>이미지 왼쪽 아래 <b>업데이트 HH:MM</b>은 <b>그 그림을 서버에서 만든 시각</b>(=일정을 조회한 시각)입니다.
            지금 보이는 그림이 언제 것인지 이 시각으로 판단하세요.</div>
        </div>
        <div style={{ fontSize: 12, color: '#666', lineHeight: 1.6, marginBottom: 12 }}>
          <b style={{ color: '#b45309' }}>주소 자체가 열쇠</b>이므로 외부에 공유하지 마세요 — 유출이 의심되면 아래에서 재발급하면 즉시 무효가 됩니다.
        </div>

        {!token ? (
          <button onClick={issue} disabled={busy} style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }}>
            내 위젯 주소 발급
          </button>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
              <select value={size} onChange={e => setSize(e.target.value as SizeName)} style={{ ...btn, paddingRight: 6 }}>
                {(Object.keys(SIZE_LABEL) as SizeName[]).map(s => (
                  <option key={s} value={s}>{SIZE_LABEL[s]}</option>
                ))}
              </select>
              <select value={theme} onChange={e => setTheme(e.target.value as ThemeName)} style={{ ...btn, paddingRight: 6 }}>
                <option value="light">밝은 배경</option>
                <option value="dark">어두운 배경</option>
              </select>
              <button onClick={() => setPreviewKey(k => k + 1)} style={btn}>미리보기 새로고침</button>
              <div style={{ flex: 1 }} />
              <button onClick={issue} disabled={busy} style={btn}>주소 재발급</button>
              <button onClick={revoke} disabled={busy} style={{ ...btn, color: '#b91c1c' }}>해지</button>
            </div>

            <div style={{ display: 'flex', gap: 6, alignItems: 'stretch', flexWrap: 'wrap' }}>
              <input
                readOnly
                value={widgetUrl}
                onFocus={e => e.currentTarget.select()}
                style={{
                  flex: 1, minWidth: 240, height: 32, padding: '0 10px',
                  border: '1px solid #e8e8e6', borderRadius: 6, fontSize: 11, color: '#444', background: '#f8f8f7',
                }}
              />
              <button onClick={() => copy(widgetUrl, 'url')} style={primaryBtn}>
                {copied === 'url' ? '복사됨 ✓' : '주소 복사'}
              </button>
            </div>

            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 11, color: '#999', marginBottom: 6 }}>미리보기</div>
              {/* 위젯 이미지는 PNG API 응답이라 next/image 최적화 대상이 아니다 — img 그대로 쓴다. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                key={previewKey}
                src={previewUrl}
                alt="위젯 미리보기"
                style={{
                  width: size === 'small' ? 200 : size === 'medium' ? 340 : 300,
                  border: '1px solid #e8e8e6',
                  borderRadius: 10,
                  display: 'block',
                }}
              />
            </div>
          </>
        )}
      </div>

      {token && (
        <>
          <div style={{ ...card, marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#111', marginBottom: 8 }}>📱 아이폰 (Scriptable)</div>
            <ol style={{ fontSize: 12, color: '#555', lineHeight: 1.8, paddingLeft: 18, margin: 0 }}>
              <li>App Store에서 <b>Scriptable</b>(무료) 설치</li>
              <li>앱을 열고 <b>+</b> → 아래 코드를 붙여넣기 → 스크립트 이름을 <b>미래Hub</b>로 저장</li>
              <li>홈화면 빈 곳을 길게 눌러 <b>+</b> → Scriptable → 원하는 크기의 위젯 추가</li>
              <li>위젯을 길게 눌러 <b>위젯 편집</b> → Script를 <b>미래Hub</b>로, <b>When Interacting(상호작용)</b>을 <b>Run Script(스크립트 실행)</b>로 지정</li>
            </ol>
            <div style={{ fontSize: 11.5, color: '#555', marginTop: 8, lineHeight: 1.7, background: '#f8f8f7', border: '1px solid #e8e8e6', borderRadius: 6, padding: '8px 10px' }}>
              <b>탭 = 최신 일정 즉시 확인</b>: 위젯을 탭하면 스크립트가 Scriptable에서 실행돼 방금 만든 이미지를 전체화면으로 보여줍니다.
              {' '}<b style={{ color: '#b45309' }}>홈화면 위젯 이미지는 이때 바뀌지 않습니다</b> — iOS가 다음 타임라인 갱신을 허용하는 시점에 바뀝니다
              (Scriptable에는 위젯을 강제로 다시 그리게 하는 기능이 없습니다). 즉 아이폰에서 탭은 &ldquo;강제 갱신&rdquo;이 아니라 &ldquo;지금 일정 보기&rdquo;입니다.
              <div style={{ marginTop: 4 }}>
                <b>자동 갱신</b>: 2시간 이후로 요청하며, iOS가 배터리·사용 빈도를 보고 더 늦출 수 있습니다(정확한 시각은 보장되지 않음).
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 10, alignItems: 'center' }}>
              <button onClick={() => copy(scriptableCode, 'script')} style={primaryBtn}>
                {copied === 'script' ? '복사됨 ✓' : 'Scriptable 코드 복사'}
              </button>
              <span style={{ fontSize: 11, color: '#999' }}>선택한 크기·배경이 코드에 반영됩니다</span>
            </div>
            <pre style={{
              marginTop: 10, marginBottom: 0, padding: 10, background: '#f8f8f7', border: '1px solid #e8e8e6',
              borderRadius: 6, fontSize: 10.5, color: '#444', overflowX: 'auto', lineHeight: 1.5,
            }}>{scriptableCode}</pre>
          </div>

          <div style={{ ...card }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#111', marginBottom: 8 }}>🤖 안드로이드</div>
            <ol style={{ fontSize: 12, color: '#555', lineHeight: 1.8, paddingLeft: 18, margin: 0 }}>
              <li>Play 스토어에서 <b>URL 이미지를 위젯으로 띄우는 앱</b> 설치 — <b>Web Image Widget</b>, <b>Better URL Image Widget</b>, <b>Live Image Widget</b> 중 하나</li>
              <li>앱에서 새 위젯을 만들고 <b>이미지 주소</b>에 위에서 복사한 주소를 붙여넣기</li>
              <li>갱신 주기를 <b>1~3시간</b>으로 설정 (Android는 위젯 갱신 최소 주기가 30분으로 제한돼 있어 그보다 짧게는 못 넣습니다)</li>
              <li>홈화면 빈 곳을 길게 눌러 위젯 → 해당 앱의 위젯을 추가</li>
            </ol>
            <div style={{ fontSize: 11.5, color: '#555', marginTop: 8, lineHeight: 1.7, background: '#f8f8f7', border: '1px solid #e8e8e6', borderRadius: 6, padding: '8px 10px' }}>
              <b>더블탭 = 홈화면 위젯 이미지 강제 갱신</b>: Web Image Widget은 위젯을 더블탭하면 이미지를 다시 받아 홈화면 그림까지 바뀝니다
              (앱마다 이름이 다르니 &ldquo;force update&rdquo;/&ldquo;강제 갱신&rdquo; 항목을 확인하세요).
              서버가 이미지를 <b>어디에도 캐시하지 않으므로</b> 갱신하면 항상 방금 조회한 일정이 옵니다.
            </div>
            <div style={{ fontSize: 11, color: '#999', marginTop: 8, lineHeight: 1.6 }}>
              앱마다 항목 이름이 조금씩 다릅니다. 가로형 위젯에는 <b>보통(가로형)</b>, 정사각형에는 <b>작게</b>를 쓰면 글자가 가장 잘 읽힙니다.
              탭 동작을 지정할 수 있는 앱이라면 <b>{origin}</b> 열기로 설정해 두면 편합니다.
            </div>
          </div>
        </>
      )}
    </div>
  )
}
