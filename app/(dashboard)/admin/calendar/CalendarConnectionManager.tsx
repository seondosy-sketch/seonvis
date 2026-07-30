'use client'

/**
 * Google Calendar 연동 관리 UI.
 *
 * 화면에서 하는 일: 연결 상태 확인 → (필요하면 Calendar ID로) 캘린더 목록 조회 → 대상 선택 →
 * 오늘 이후 일정 최초 동기화 / 실패 건 재시도 / 연결 해제.
 *
 * 비밀 값은 다루지 않는다 — 서비스 계정 개인키는 서버 환경변수에만 있고 이 화면에 오지 않는다.
 */

import { useCallback, useEffect, useState } from 'react'

type ActionKey = 'announce' | 'pq' | 'soq' | 'submit' | 'interview' | 'bid' | 'notify'

interface Connection {
  calendar_id: string | null
  calendar_summary: string | null
  calendar_time_zone: string | null
  status: string
  color_map: Partial<Record<ActionKey, string>>
  last_ok_at: string | null
  last_synced_at: string | null
  last_error: string | null
  google_account_email: string | null
  connected_by_email: string | null
}

interface ConnectionResponse {
  configured: boolean
  serviceAccountEmail: string | null
  connection: Connection | null
  stats: { total: number; failed: number }
  actionLabels: Record<ActionKey, string>
}

interface CalendarItem {
  id: string
  summary: string
  timeZone: string | null
  accessRole: string | null
  writable: boolean
}

interface SyncResult {
  created: number
  updated: number
  deleted: number
  unchanged: number
  failed: number
  deferred: number
  skipped: { projectName: string; action: string; raw: string }[]
  excludedProjects: number
  callsUsed: number
  errors: { key: string; message: string }[]
}

/** Google 이벤트 팔레트 배경색 — 색 견본을 그리려고 화면에도 둔다(매칭은 서버가 한다). */
const PALETTE: Record<string, string> = {
  '1': '#a4bdfc', '2': '#7ae7bf', '3': '#dbadff', '4': '#ff887c', '5': '#fbd75b',
  '6': '#ffb878', '7': '#46d6db', '8': '#e1e1e1', '9': '#5484ed', '10': '#51b749', '11': '#dc2127',
}

const card: React.CSSProperties = { background: '#fff', border: '1px solid #e8e8e6', borderRadius: 8, padding: 16, marginBottom: 12 }
const btn: React.CSSProperties = { height: 32, padding: '0 12px', border: '1px solid #e8e8e6', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 12, color: '#333' }
const primaryBtn: React.CSSProperties = { ...btn, border: '1px solid #2563eb', background: '#2563eb', color: '#fff', fontWeight: 600 }
const label: React.CSSProperties = { fontSize: 11, color: '#999', marginBottom: 4 }

function when(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short' })
}

export default function CalendarConnectionManager() {
  const [info, setInfo] = useState<ConnectionResponse | null>(null)
  const [calendars, setCalendars] = useState<CalendarItem[] | null>(null)
  const [calendarId, setCalendarId] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [result, setResult] = useState<SyncResult | null>(null)
  // 지난 일정 소급 기간(일). 기본 21일 = 최근 3주 — 지난 공고일을 채워 넣을 때 쓴다.
  const [backfillDays, setBackfillDays] = useState('21')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/calendar/connection')
      if (!res.ok) throw new Error('연결 정보를 불러올 수 없습니다')
      setInfo(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : '불러오기 실패')
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function fetchCalendars(add?: string) {
    setBusy('calendars'); setError(null); setNotice(null)
    try {
      const q = add ? `?add=${encodeURIComponent(add)}` : ''
      const res = await fetch(`/api/calendar/calendars${q}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? '목록 조회 실패')
      setCalendars(data.calendars)
      if (data.addError) {
        setError(`Calendar ID 등록에 실패했습니다 — 캘린더를 서비스 계정(${data.serviceAccountEmail})에 "일정 변경" 권한으로 공유했는지 확인하세요. (${data.addError})`)
      } else if (data.calendars.length === 0) {
        setNotice('접근 가능한 캘린더가 없습니다. 아래에 Calendar ID를 넣고 "ID로 등록 후 조회"를 눌러 주세요.')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '목록 조회 실패')
    } finally { setBusy(null) }
  }

  async function connect(id: string) {
    setBusy('connect'); setError(null); setNotice(null)
    try {
      const res = await fetch('/api/calendar/connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ calendarId: id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? '연결 실패')
      setNotice(`"${data.calendar.summary}" 캘린더에 연결했습니다.`)
      setCalendars(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : '연결 실패')
    } finally { setBusy(null) }
  }

  async function sync(mode: 'all' | 'retry' | 'backfill') {
    setBusy(mode); setError(null); setNotice(null); setResult(null)
    try {
      const body =
        mode === 'retry' ? { failedOnly: true }
        : mode === 'backfill' ? { backfillDays: Number(backfillDays) || 0 }
        : {}
      const res = await fetch('/api/calendar/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? '동기화 실패')
      if (data.notConnected) throw new Error('먼저 캘린더를 연결해 주세요')
      setResult(data)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : '동기화 실패')
    } finally { setBusy(null) }
  }

  async function disconnect(purge: boolean) {
    const msg = purge
      ? '연결을 해제하고 지금까지 만든 캘린더 일정도 모두 삭제합니다. 계속할까요?'
      : '연결을 해제합니다. 이미 만들어진 캘린더 일정은 그대로 남습니다. 계속할까요?'
    if (!confirm(msg)) return
    setBusy('disconnect'); setError(null); setNotice(null)
    try {
      const res = await fetch(`/api/calendar/connection${purge ? '?purge=1' : ''}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? '해제 실패')
      setNotice(purge ? `연결을 해제하고 일정 ${data.purged}건을 삭제했습니다.` : '연결을 해제했습니다.')
      setResult(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : '해제 실패')
    } finally { setBusy(null) }
  }

  if (!info) {
    return <div style={{ fontSize: 12, color: '#999' }}>{error ?? '불러오는 중...'}</div>
  }

  const conn = info.connection
  const connected = conn?.status === 'connected' && !!conn.calendar_id
  const statusText = !info.configured ? '환경변수 미설정'
    : conn?.status === 'connected' ? '연결됨'
    : conn?.status === 'error' ? '오류'
    : '미연결'
  const statusColor = statusText === '연결됨' ? '#15803d' : statusText === '오류' ? '#b91c1c' : '#b45309'

  return (
    <>
      {error && <div style={{ ...card, borderColor: '#fecaca', background: '#fef2f2', color: '#b91c1c', fontSize: 12 }}>{error}</div>}
      {notice && <div style={{ ...card, borderColor: '#bbf7d0', background: '#f0fdf4', color: '#15803d', fontSize: 12 }}>{notice}</div>}

      {/* 상태 */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>연결 상태</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: statusColor }}>{statusText}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 12, color: '#333' }}>
          <div><div style={label}>Google 계정 (서비스 계정)</div>{info.serviceAccountEmail ?? '—'}</div>
          <div><div style={label}>대상 캘린더</div>{conn?.calendar_summary ?? '—'}{conn?.calendar_time_zone ? ` (${conn.calendar_time_zone})` : ''}</div>
          <div><div style={label}>Calendar ID</div><span style={{ fontSize: 11, color: '#666', wordBreak: 'break-all' }}>{conn?.calendar_id ?? '—'}</span></div>
          <div><div style={label}>연결한 관리자</div>{conn?.connected_by_email ?? '—'}</div>
          <div><div style={label}>마지막 정상 연결</div>{when(conn?.last_ok_at ?? null)}</div>
          <div><div style={label}>마지막 동기화</div>{when(conn?.last_synced_at ?? null)}</div>
          <div><div style={label}>동기화된 일정</div>{info.stats.total}건</div>
          <div><div style={label}>동기화 실패</div><span style={{ color: info.stats.failed > 0 ? '#b91c1c' : '#333', fontWeight: info.stats.failed > 0 ? 600 : 400 }}>{info.stats.failed}건</span></div>
        </div>
        {conn?.last_error && (
          <div style={{ marginTop: 12, fontSize: 11, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '8px 10px' }}>
            <b>마지막 오류</b> — {conn.last_error}
          </div>
        )}
        {!info.configured && (
          <div style={{ marginTop: 12, fontSize: 11, color: '#b45309' }}>
            서버에 <b>GOOGLE_SA_CLIENT_EMAIL</b>·<b>GOOGLE_SA_PRIVATE_KEY</b> 환경변수가 필요합니다.
          </div>
        )}
      </div>

      {/* 캘린더 선택 */}
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#111', marginBottom: 8 }}>캘린더 선택</div>
        <div style={{ fontSize: 11.5, color: '#666', lineHeight: 1.7, marginBottom: 10 }}>
          새 캘린더를 만들지 않고 이미 있는 <b>미래사업팀</b> 캘린더를 씁니다.
          Google Calendar에서 그 캘린더를 <b>{info.serviceAccountEmail}</b> 에게 <b>&ldquo;일정 변경&rdquo;</b> 권한으로 공유해 두어야 합니다.
          서비스 계정은 공유를 자동으로 수락하지 않으므로, 목록이 비어 있으면 <b>캘린더 통합 → 캘린더 ID</b>를 아래에 넣어 등록하세요.
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
          <button onClick={() => fetchCalendars()} disabled={!!busy} style={btn}>
            {busy === 'calendars' ? '조회 중...' : '접근 가능한 캘린더 목록 조회'}
          </button>
          <input
            value={calendarId}
            onChange={e => setCalendarId(e.target.value)}
            placeholder="...@group.calendar.google.com"
            style={{ flex: 1, minWidth: 260, height: 32, padding: '0 10px', border: '1px solid #e8e8e6', borderRadius: 6, fontSize: 11 }}
          />
          <button onClick={() => fetchCalendars(calendarId.trim())} disabled={!!busy || !calendarId.trim()} style={btn}>
            ID로 등록 후 조회
          </button>
        </div>

        {calendars && calendars.length > 0 && (
          <div style={{ border: '1px solid #e8e8e6', borderRadius: 6, overflow: 'hidden' }}>
            {calendars.map(c => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderBottom: '1px solid #f0f0ee', fontSize: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ color: '#111', fontWeight: c.summary === '미래사업팀' ? 600 : 400 }}>{c.summary}</div>
                  <div style={{ fontSize: 10.5, color: '#999', wordBreak: 'break-all' }}>{c.id}</div>
                </div>
                <div style={{ fontSize: 11, color: c.writable ? '#15803d' : '#b91c1c' }}>{c.accessRole ?? '?'}</div>
                <button onClick={() => connect(c.id)} disabled={!!busy || !c.writable} style={c.summary === '미래사업팀' ? primaryBtn : btn}>
                  {conn?.calendar_id === c.id ? '다시 연결' : '이 캘린더로 연결'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 색상 매핑 */}
      {connected && conn && Object.keys(conn.color_map ?? {}).length > 0 && (
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#111', marginBottom: 4 }}>색상 매핑</div>
          <div style={{ fontSize: 11.5, color: '#666', marginBottom: 10 }}>
            연결 시점에 Google의 실제 색상 목록을 조회해 가장 가까운 색으로 배정한 결과입니다.
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {(Object.keys(info.actionLabels) as ActionKey[]).map(action => {
              const id = conn.color_map?.[action]
              return (
                <div key={action} style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid #e8e8e6', borderRadius: 6, padding: '4px 8px', fontSize: 12 }}>
                  <span style={{ width: 14, height: 14, borderRadius: 4, background: id ? PALETTE[id] ?? '#eee' : 'transparent', border: '1px solid #ddd', display: 'inline-block' }} />
                  <span style={{ color: '#333' }}>{info.actionLabels[action]}</span>
                  <span style={{ color: '#aaa', fontSize: 10.5 }}>{id ? `#${id}` : '기본색'}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 동기화 */}
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#111', marginBottom: 8 }}>동기화</div>
        <div style={{ fontSize: 11.5, color: '#666', lineHeight: 1.7, marginBottom: 10 }}>
          KST 기준 <b>오늘 이후</b> 일정만 만듭니다(오늘 포함). 날짜가 없거나 <b>연도 없는 표기(2/25)·&ldquo;추후&rdquo;</b> 같은 값은 건너뜁니다.
          이미 만든 일정은 반복 실행해도 중복되지 않습니다.
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button onClick={() => sync('all')} disabled={!!busy || !connected} style={primaryBtn}>
            {busy === 'all' ? '동기화 중...' : '오늘 이후 일정 동기화'}
          </button>
          <button onClick={() => sync('retry')} disabled={!!busy || !connected || info.stats.failed === 0} style={btn}>
            {busy === 'retry' ? '재시도 중...' : `실패 일정 다시 동기화 (${info.stats.failed})`}
          </button>
          <div style={{ flex: 1 }} />
          <button onClick={() => disconnect(false)} disabled={!!busy} style={{ ...btn, color: '#b91c1c' }}>연결 해제</button>
          <button onClick={() => disconnect(true)} disabled={!!busy} style={{ ...btn, color: '#b91c1c' }}>해제 + 일정 삭제</button>
        </div>

        {/* 지난 일정 소급 — 지난 공고일처럼 이미 지나간 일정을 한 번 채워 넣을 때 쓴다. */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 10, paddingTop: 10, borderTop: '1px solid #f0f0ee' }}>
          <span style={{ fontSize: 11.5, color: '#666' }}>지난</span>
          <input
            value={backfillDays}
            onChange={e => setBackfillDays(e.target.value.replace(/[^0-9]/g, ''))}
            style={{ width: 56, height: 30, padding: '0 8px', border: '1px solid #e8e8e6', borderRadius: 6, fontSize: 12, textAlign: 'right' }}
          />
          <span style={{ fontSize: 11.5, color: '#666' }}>일 전 일정까지 소급해서 추가</span>
          <button onClick={() => sync('backfill')} disabled={!!busy || !connected || !backfillDays} style={btn}>
            {busy === 'backfill' ? '추가 중...' : '소급 동기화'}
          </button>
          <span style={{ fontSize: 11, color: '#999' }}>한 번 만든 일정은 이후 일반 동기화에서 유지됩니다</span>
        </div>

        {result && (
          <div style={{ marginTop: 12, fontSize: 12, color: '#333', background: '#f8f8f7', border: '1px solid #e8e8e6', borderRadius: 6, padding: '10px 12px' }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>
              생성 {result.created} · 수정 {result.updated} · 삭제 {result.deleted} · 변화없음 {result.unchanged} · 실패 {result.failed}
            </div>
            <div style={{ fontSize: 11, color: '#666', lineHeight: 1.7 }}>
              Google 호출 {result.callsUsed}회
              {result.deferred > 0 && ` · 호출 상한으로 다음 회차로 미룸 ${result.deferred}건`}
              {result.excludedProjects > 0 && ` · 취소·드랍·수주로 제외한 프로젝트 ${result.excludedProjects}건`}
              {result.skipped.length > 0 && ` · 날짜 형식이 아니어서 건너뛴 항목 ${result.skipped.length}건`}
            </div>
            {result.errors.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 11, color: '#b91c1c' }}>
                {result.errors.slice(0, 3).map((e, i) => <div key={i}>{e.key}: {e.message}</div>)}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}
