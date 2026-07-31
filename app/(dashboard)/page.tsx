'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import WeeklyCalendar, { Holiday, TeamEvent } from '../components/WeeklyCalendar'
import { PerformingProject } from '@/lib/supabase'
import { useIsMobile } from '@/lib/useIsMobile'
// 주차·일정 계산은 홈화면 위젯(app/api/widget/summary)과 공유한다 — lib/weekSchedule.ts 참고.
import { getCurrentWeek, getWeekBounds, buildSchedule } from '@/lib/weekSchedule'

interface PendingAction { name: string; args: Record<string, unknown> }
interface Message {
  id: number; role: 'user' | 'assistant'; text: string
  relatedProjects?: Record<string, unknown>[]
  pendingAction?: PendingAction; preview?: string
  actionResult?: { success: boolean; message: string }
}

export default function DashboardPage() {
  const isMobile = useIsMobile()
  const supabase = createSupabaseBrowserClient()
  const week = getCurrentWeek()
  const { start: weekStart, end: weekEnd } = getWeekBounds(week)

  // Calendar
  const [performing, setPerforming] = useState<PerformingProject[]>([])
  const [calNotes, setCalNotes] = useState<Record<string, Record<string, string>>>({})
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [teamEvents, setTeamEvents] = useState<TeamEvent[]>([])
  const [addEventPopup, setAddEventPopup] = useState<{ date: string } | null>(null)
  const [newEventTitle, setNewEventTitle] = useState('')
  const [newEventColor, setNewEventColor] = useState('#7c3aed')
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; title: string } | null>(null)
  const [cmakNews, setCmakNews] = useState<{ idx: string; title: string; date: string }[]>([])
  const [cmakLoading, setCmakLoading] = useState(true)

  const loadPerforming = useCallback(async () => {
    const { data: perf } = await supabase.from('performing_projects').select('*').eq('week', week).order('sort_order')

    // projects 테이블에서 bid_date 등 날짜 정보 항상 로드
    const { data: projs } = await supabase
      .from('projects')
      .select('name, submit_date, interview_date, bid_date, participants, status_override, evaluation, result_score')
      .order('project_number', { ascending: false })
    const projByName: Record<string, any> = {}
    if (projs) for (const p of projs) projByName[p.name] = p

    // 달력과 금주 일정에는 연도가 살아 있는 ISO 날짜(YYYY-MM-DD)를 그대로 넘긴다.
    // 예전에는 fmtDate로 "M/D"까지 줄여서 넘겼는데, 그러면 연도가 사라지고 받는 쪽
    // (WeeklyCalendar / buildSchedule)이 현재 주의 연도를 다시 붙여버려서 2025년 일정이
    // 2026년 같은 월·일에 찍혔다(예: 2025-11-25 잠실5단지 → 2026-11-25).
    // 화면에 보여줄 "M/D" 변환은 표시하는 쪽에서 한다.
    const keepYear = (raw: string | null | undefined): string => (raw?.trim() ? raw : '추후')

    if (perf && perf.length > 0) {
      // 날짜는 Project List(projects)를 우선한다 — 주간보고 화면(app/dashboard.tsx)도 같은 규칙이다.
      // Project List에 없는 수동 추가 행만 저장된 "M/D"를 그대로 쓴다(애초에 연도 정보가 없다).
      const merged = (perf as PerformingProject[]).map(p => ({
        ...p,
        submit_date: keepYear(projByName[p.name]?.submit_date ?? p.submit_date),
        interview_date: keepYear(projByName[p.name]?.interview_date ?? p.interview_date),
        result_date: keepYear(projByName[p.name]?.bid_date ?? p.result_date),
      }))
      setPerforming(merged)
    } else {
      // 저장된 주간 데이터가 없으면 projects 테이블에서 직접 불러오기
      if (projs) {
        const rows: PerformingProject[] = projs
          .filter((p: any) => {
            if (p.status_override === '취소') return false
            if (p.participants?.includes('드랍') || p.participants?.includes('드롭')) return false
            if (p.evaluation === '선') return false
            return true
          })
          .map((p: any, i: number) => ({
            status: '진행중' as const,
            name: p.name,
            director: '',
            submit_date: keepYear(p.submit_date),
            interview_date: keepYear(p.interview_date),
            result_date: keepYear(p.bid_date),
            fee: null,
            note: '',
            sort_order: i,
            week,
          }))
        setPerforming(rows)
      }
    }

    const [{ data: projsForNotes }, { data: notesData }] = await Promise.all([
      supabase.from('projects').select('project_number, name'),
      supabase.from('project_notes').select('*'),
    ])
    if (projsForNotes && notesData) {
      const numToName: Record<string, string> = Object.fromEntries(projsForNotes.map((p: {project_number: string; name: string}) => [p.project_number, p.name]))
      const map: Record<string, Record<string, string>> = {}
      for (const n of notesData) {
        const name = numToName[n.project_number]
        if (name) { if (!map[name]) map[name] = {}; map[name][n.field] = n.note }
      }
      setCalNotes(map)
    }
  }, [week])
  useEffect(() => {
    loadPerforming()
    const onVisible = () => { if (document.visibilityState === 'visible') loadPerforming() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [loadPerforming])

  // 공휴일 로드 (현재 연도 + 다음 연도)
  useEffect(() => {
    const year = new Date().getFullYear()
    Promise.all([
      fetch(`/api/holidays?year=${year}`).then(r => r.json()).catch(() => []),
      fetch(`/api/holidays?year=${year + 1}`).then(r => r.json()).catch(() => []),
    ]).then(([cur, next]) => {
      setHolidays([...(cur as Holiday[]), ...(next as Holiday[])])
    })
  }, [])

  // 팀일정 로드
  const loadTeamEvents = useCallback(async () => {
    const { data } = await supabase.from('team_events').select('*').order('date')
    if (data) setTeamEvents(data as TeamEvent[])
  }, [])

  useEffect(() => { loadTeamEvents() }, [loadTeamEvents])

  const addTeamEvent = async () => {
    if (!addEventPopup || !newEventTitle.trim()) return
    await supabase.from('team_events').insert({ title: newEventTitle.trim(), date: addEventPopup.date, color: newEventColor })
    await loadTeamEvents()
    setAddEventPopup(null)
    setNewEventTitle('')
    setNewEventColor('#7c3aed')
  }

  const deleteTeamEvent = async (id: string) => {
    await supabase.from('team_events').delete().eq('id', id)
    await loadTeamEvents()
    setDeleteConfirm(null)
  }

  useEffect(() => {
    fetch('/api/cmak-news')
      .then(r => r.json())
      .then(d => setCmakNews(d.items ?? []))
      .catch(() => {})
      .finally(() => setCmakLoading(false))
  }, [])
  const schedule = buildSchedule(performing, weekStart, weekEnd)

  // Chat
  const [messages, setMessages] = useState<Message[]>([{
    id: 0, role: 'assistant',
    text: '안녕하세요! 미래사업팀 전용 AI 어시스턴트 미래봇입니다 🌟\n\n프로젝트 현황 조회, 수주 분석, 새 프로젝트 등록이나 기존 프로젝트 수정도 도와드릴 수 있어요!\n\n무엇이든 편하게 말씀해 주세요 😊',
  }])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [activeRef, setActiveRef] = useState<Record<string, unknown>[] | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const send = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim()
    if (!text || loading) return
    const userMsg: Message = { id: Date.now(), role: 'user', text }
    const history = [...messages, userMsg]
    setMessages(history); setInput(''); setLoading(true)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history.filter(m => !m.pendingAction && !m.actionResult).map(m => ({ role: m.role, text: m.text })) }),
      })
      let data: { type: 'text' | 'confirm'; text?: string; relatedProjects?: Record<string, unknown>[]; action?: PendingAction; preview?: string }
      try { data = await res.json() } catch { const raw = await res.text().catch(() => `HTTP ${res.status}`); throw new Error(`응답 파싱 실패 (${res.status}): ${raw.slice(0, 200)}`) }
      if (data.type === 'confirm' && data.action) {
        setMessages(prev => [...prev, { id: Date.now() + 1, role: 'assistant', text: '', pendingAction: data.action, preview: data.preview }])
      } else {
        const aiMsg: Message = { id: Date.now() + 1, role: 'assistant', text: data.text ?? '', relatedProjects: data.relatedProjects ?? [] }
        setMessages(prev => [...prev, aiMsg])
        if ((data.relatedProjects ?? []).length > 0) setActiveRef(data.relatedProjects!)
      }
    } catch (err) {
      setMessages(prev => [...prev, { id: Date.now() + 1, role: 'assistant', text: `앗, 오류가 발생했어요 😢\n${String(err)}` }])
    } finally { setLoading(false) }
  }

  const executeAction = async (msgId: number, action: PendingAction, confirmed: boolean) => {
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, pendingAction: undefined, preview: undefined } : m))
    if (!confirmed) { setMessages(prev => [...prev, { id: Date.now(), role: 'assistant', text: '알겠어요! 취소했습니다 😊 다른 작업이 필요하시면 말씀해 주세요.' }]); return }
    setLoading(true)
    try {
      const res = await fetch('/api/chat/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) })
      const result = await res.json() as { success: boolean; message: string }
      setMessages(prev => [...prev, { id: Date.now(), role: 'assistant', text: result.message }])
    } finally { setLoading(false) }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  const refProjects = activeRef ?? messages.filter(m => (m.relatedProjects?.length ?? 0) > 0).flatMap(m => m.relatedProjects ?? [])
  const uniqueRefs = Array.from(new Map(refProjects.map(p => [p.project_number, p])).values())

  const SCHEDULE_SECTIONS = [
    { key: 'submit' as const, label: '제출', color: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe' },
    { key: 'interview' as const, label: '발표 / 면접', color: '#b45309', bg: '#fffbeb', border: '#fde68a' },
    { key: 'result' as const, label: '개찰', color: '#15803d', bg: '#f0fdf4', border: '#bbf7d0' },
  ]

  if (isMobile) {
    return (
      <div style={{ background: '#f8f8f7', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        {/* 금주 일정 */}
        <div style={{ margin: '12px 12px 0', background: '#fff', border: '1px solid #e8e8e6', borderRadius: 8 }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid #f0f0ee' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>금주 일정</div>
            <div style={{ fontSize: 11, color: '#aaa', marginTop: 1 }}>{weekStart.getMonth()+1}/{weekStart.getDate()} ~ {weekEnd.getMonth()+1}/{weekEnd.getDate()}</div>
          </div>
          <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {SCHEDULE_SECTIONS.map(sec => (
              <div key={sec.key}>
                <div style={{ fontSize: 11, fontWeight: 600, color: sec.color, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: sec.color, display: 'inline-block' }} />
                  {sec.label} <span style={{ fontWeight: 400, color: '#aaa' }}>({schedule[sec.key].length}건)</span>
                </div>
                {schedule[sec.key].length === 0 ? (
                  <div style={{ fontSize: 11, color: '#ccc', paddingLeft: 11 }}>없음</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {schedule[sec.key].map((item, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 11 }}>
                        <span style={{ fontSize: 11, fontWeight: 600, color: sec.color, background: sec.bg, border: `1px solid ${sec.border}`, borderRadius: 4, padding: '1px 6px', whiteSpace: 'nowrap' }}>{item.date}</span>
                        <span style={{ fontSize: 12, color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* 달력 */}
        <div style={{ margin: '10px 12px 0' }}>
          <WeeklyCalendar week={week} performing={performing} notes={calNotes} holidays={holidays} teamEvents={teamEvents} onDateClick={d => { setAddEventPopup({ date: d }); setNewEventTitle(''); setNewEventColor('#7c3aed') }} onTeamEventClick={(id, title) => setDeleteConfirm({ id, title })} />
        </div>

        {/* 미래봇 */}
        <div style={{ margin: '10px 12px 0', display: 'flex', flexDirection: 'column', background: '#fff', border: '1px solid #e8e8e6', borderRadius: 8, overflow: 'hidden', minHeight: 400 }}>
          <div style={{ padding: '10px 14px', background: '#fff', borderBottom: '1px solid #e8e8e6', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg, #f59e0b, #f97316)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>🌟</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>미래봇</div>
              <div style={{ fontSize: 10, color: '#22c55e' }}>● 온라인</div>
            </div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px', display: 'flex', flexDirection: 'column', gap: 12, minHeight: 240 }}>
            {messages.map(m => (
              <div key={m.id}>
                {m.pendingAction && m.preview && (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'linear-gradient(135deg, #f59e0b, #f97316)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0, marginTop: 2 }}>🌟</div>
                    <div style={{ background: '#fff', border: '1px solid #f59e0b', borderRadius: '16px 16px 16px 4px', padding: '12px 14px', maxWidth: '85%' }}>
                      <div style={{ fontSize: 11, color: '#f59e0b', fontWeight: 600, marginBottom: 6 }}>⚡ 다음 작업을 실행할까요?</div>
                      <pre style={{ fontSize: 12, color: '#333', margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.6, fontFamily: 'inherit' }}>{m.preview}</pre>
                      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                        <button onClick={() => executeAction(m.id, m.pendingAction!, true)} style={{ padding: '5px 14px', borderRadius: 7, border: 'none', background: '#111', color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>✓ 확인</button>
                        <button onClick={() => executeAction(m.id, m.pendingAction!, false)} style={{ padding: '5px 14px', borderRadius: 7, border: '1px solid #e8e8e6', background: '#fff', color: '#555', fontSize: 11, cursor: 'pointer' }}>✕ 취소</button>
                      </div>
                    </div>
                  </div>
                )}
                {!m.pendingAction && m.text && (
                  <div style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', gap: 8, alignItems: 'flex-start' }}>
                    {m.role === 'assistant' && (
                      <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'linear-gradient(135deg, #f59e0b, #f97316)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0, marginTop: 2 }}>🌟</div>
                    )}
                    <div style={{ maxWidth: '80%', padding: '10px 14px', borderRadius: m.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px', background: m.role === 'user' ? '#111' : '#fff', color: m.role === 'user' ? '#fff' : '#111', fontSize: 13, lineHeight: 1.6, border: m.role === 'assistant' ? '1px solid #e8e8e6' : 'none', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {m.text}
                      {(m.relatedProjects?.length ?? 0) > 0 && (
                        <div style={{ marginTop: 6, fontSize: 10, color: '#f59e0b', borderTop: '1px solid #f0ead0', paddingTop: 5 }}>📎 관련 프로젝트 {m.relatedProjects!.length}건</div>
                      )}
                    </div>
                    {m.role === 'user' && (
                      <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#e8e8e6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0, marginTop: 2 }}>👤</div>
                    )}
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'linear-gradient(135deg, #f59e0b, #f97316)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>🌟</div>
                <div style={{ padding: '10px 14px', borderRadius: '16px 16px 16px 4px', background: '#fff', border: '1px solid #e8e8e6', display: 'flex', gap: 4, alignItems: 'center' }}>
                  {[0, 1, 2].map(i => (
                    <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: '#f59e0b', animation: 'bounce 1.2s infinite', animationDelay: `${i * 0.2}s` }} />
                  ))}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
          <div style={{ padding: '10px 12px', background: '#fff', borderTop: '1px solid #e8e8e6', flexShrink: 0 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', background: '#f4f4f2', borderRadius: 14, padding: '8px 12px' }}>
              <textarea
                value={input} onChange={e => setInput(e.target.value)} onKeyDown={onKeyDown}
                placeholder="미래봇에게 물어보세요..."
                rows={1}
                style={{ flex: 1, border: 'none', background: 'transparent', resize: 'none', fontSize: 13, outline: 'none', lineHeight: 1.5, maxHeight: 80, overflowY: 'auto', color: '#111' }}
              />
              <button onClick={() => send()} disabled={!input.trim() || loading}
                style={{ width: 30, height: 30, borderRadius: '50%', border: 'none', background: input.trim() && !loading ? '#111' : '#ddd', color: '#fff', cursor: input.trim() && !loading ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 15, transition: 'background 0.15s' }}>↑</button>
            </div>
          </div>
        </div>

        {/* CM업계소식 (모바일) */}
        <div style={{ margin: '10px 12px 0', background: '#fff', border: '1px solid #e8e8e6', borderRadius: 8 }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid #f0f0ee', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>📰 CM업계소식</div>
            <a href="https://www.cmak.or.kr/html/notice/news.asp" target="_blank" rel="noreferrer"
              style={{ fontSize: 11, color: '#aaa', textDecoration: 'none' }}>CMAK →</a>
          </div>
          <div style={{ padding: '4px 0' }}>
            {cmakLoading ? (
              <div style={{ padding: '16px', textAlign: 'center', color: '#ccc', fontSize: 12 }}>불러오는 중...</div>
            ) : cmakNews.length === 0 ? (
              <div style={{ padding: '16px', textAlign: 'center', color: '#ccc', fontSize: 12 }}>소식을 불러오지 못했습니다</div>
            ) : cmakNews.map((item, i) => (
              <a key={item.idx} href={`https://www.cmak.or.kr/html/notice/news_r.asp?code=0&search=&searchString=&no=${item.idx}`} target="_blank" rel="noreferrer"
                style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '6px 14px', textDecoration: 'none', borderBottom: i < cmakNews.length - 1 ? '1px solid #f8f8f7' : 'none' }}>
                <span style={{ fontSize: 11, color: '#999', flexShrink: 0, minWidth: 44 }}>{item.date.slice(5)}</span>
                <span style={{ fontSize: 12, color: '#222', lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical' as const }}>{item.title}</span>
              </a>
            ))}
          </div>
        </div>

        <div style={{ height: 16 }} />
        <style>{`@keyframes bounce { 0%,80%,100%{transform:scale(0.7);opacity:0.5} 40%{transform:scale(1);opacity:1} }`}</style>

        {addEventPopup && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }} onClick={() => setAddEventPopup(null)}>
            <div style={{ background: '#fff', borderRadius: 12, width: 320, padding: 20, boxShadow: '0 20px 60px rgba(0,0,0,0.2)', margin: '0 16px' }} onClick={e => e.stopPropagation()}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#111', marginBottom: 4 }}>팀일정 추가</div>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 14 }}>{addEventPopup.date}</div>
              <input autoFocus value={newEventTitle} onChange={e => setNewEventTitle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addTeamEvent() }} placeholder="일정 제목" style={{ width: '100%', height: 36, padding: '0 10px', border: '1px solid #e8e8e6', borderRadius: 6, fontSize: 13, boxSizing: 'border-box', marginBottom: 12, outline: 'none' }} />
              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                {['#7c3aed','#2563eb','#16a34a','#ea580c','#db2777','#0891b2'].map(c => (
                  <div key={c} onClick={() => setNewEventColor(c)} style={{ width: 24, height: 24, borderRadius: '50%', background: c, cursor: 'pointer', outline: newEventColor === c ? `3px solid ${c}` : 'none', outlineOffset: 2 }} />
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => setAddEventPopup(null)} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #e8e8e6', background: '#fff', fontSize: 13, cursor: 'pointer', color: '#555' }}>취소</button>
                <button onClick={addTeamEvent} disabled={!newEventTitle.trim()} style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: '#111', fontSize: 13, cursor: 'pointer', color: '#fff', opacity: newEventTitle.trim() ? 1 : 0.4 }}>추가</button>
              </div>
            </div>
          </div>
        )}
        {deleteConfirm && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }} onClick={() => setDeleteConfirm(null)}>
            <div style={{ background: '#fff', borderRadius: 12, width: 280, padding: 20, boxShadow: '0 20px 60px rgba(0,0,0,0.2)', margin: '0 16px' }} onClick={e => e.stopPropagation()}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#111', marginBottom: 6 }}>일정 삭제</div>
              <div style={{ fontSize: 13, color: '#555', marginBottom: 16 }}>"{deleteConfirm.title}" 일정을 삭제할까요?</div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => setDeleteConfirm(null)} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #e8e8e6', background: '#fff', fontSize: 13, cursor: 'pointer', color: '#555' }}>취소</button>
                <button onClick={() => deleteTeamEvent(deleteConfirm.id)} style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: '#b91c1c', fontSize: 13, cursor: 'pointer', color: '#fff' }}>삭제</button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gridTemplateRows: '58vh 42vh', height: '100vh', overflow: 'hidden', background: '#f8f8f7', gap: 0 }}>

      {/* 상단 좌 — 달력 (스크롤 없이 한 박스에 표시, 휠로 강조 주 이동) */}
      <div style={{ overflow: 'hidden', padding: '16px 16px 8px 24px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <WeeklyCalendar week={week} performing={performing} notes={calNotes} holidays={holidays} teamEvents={teamEvents} onDateClick={d => { setAddEventPopup({ date: d }); setNewEventTitle(''); setNewEventColor('#7c3aed') }} onTeamEventClick={(id, title) => setDeleteConfirm({ id, title })} />
        </div>
      </div>

      {/* 상단 우 — 금주 일정 */}
      <div style={{ padding: '16px 24px 8px 8px', display: 'flex', flexDirection: 'column', gap: 8, overflow: 'hidden' }}>
        <div style={{ flex: 1, background: '#fff', border: '1px solid #e8e8e6', borderRadius: 8, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0ee', flexShrink: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>금주 일정</div>
            <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>{weekStart.getMonth()+1}/{weekStart.getDate()} ~ {weekEnd.getMonth()+1}/{weekEnd.getDate()}</div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {SCHEDULE_SECTIONS.map(sec => (
              <div key={sec.key}>
                <div style={{ fontSize: 11, fontWeight: 600, color: sec.color, marginBottom: 5, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: sec.color, display: 'inline-block' }} />
                  {sec.label}
                  <span style={{ fontWeight: 400, color: '#aaa' }}>({schedule[sec.key].length}건)</span>
                </div>
                {schedule[sec.key].length === 0 ? (
                  <div style={{ fontSize: 11, color: '#ccc', paddingLeft: 13 }}>없음</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {schedule[sec.key].map((item, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 6, paddingLeft: 13 }}>
                        <span style={{ fontSize: 11, fontWeight: 600, color: sec.color, background: sec.bg, border: `1px solid ${sec.border}`, borderRadius: 4, padding: '1px 6px', whiteSpace: 'nowrap' }}>{item.date}</span>
                        <span style={{ fontSize: 12, color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.name}>{item.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 하단 좌 — 미래봇 대화창 */}
      <div style={{ overflow: 'hidden', padding: '8px 16px 16px 24px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#fff', border: '1px solid #e8e8e6', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '10px 16px', background: '#fff', borderBottom: '1px solid #e8e8e6', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg, #f59e0b, #f97316)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>🌟</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>미래봇</div>
              <div style={{ fontSize: 10, color: '#22c55e' }}>● 온라인</div>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {messages.map(m => (
              <div key={m.id}>
                {m.pendingAction && m.preview && (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'linear-gradient(135deg, #f59e0b, #f97316)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0, marginTop: 2 }}>🌟</div>
                    <div style={{ background: '#fff', border: '1px solid #f59e0b', borderRadius: '16px 16px 16px 4px', padding: '12px 14px', maxWidth: '75%' }}>
                      <div style={{ fontSize: 11, color: '#f59e0b', fontWeight: 600, marginBottom: 6 }}>⚡ 다음 작업을 실행할까요?</div>
                      <pre style={{ fontSize: 12, color: '#333', margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.6, fontFamily: 'inherit' }}>{m.preview}</pre>
                      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                        <button onClick={() => executeAction(m.id, m.pendingAction!, true)} style={{ padding: '5px 14px', borderRadius: 7, border: 'none', background: '#111', color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>✓ 확인</button>
                        <button onClick={() => executeAction(m.id, m.pendingAction!, false)} style={{ padding: '5px 14px', borderRadius: 7, border: '1px solid #e8e8e6', background: '#fff', color: '#555', fontSize: 11, cursor: 'pointer' }}>✕ 취소</button>
                      </div>
                    </div>
                  </div>
                )}
                {!m.pendingAction && m.text && (
                  <div style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', gap: 8, alignItems: 'flex-start' }}>
                    {m.role === 'assistant' && (
                      <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'linear-gradient(135deg, #f59e0b, #f97316)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0, marginTop: 2 }}>🌟</div>
                    )}
                    <div
                      style={{ maxWidth: '75%', padding: '10px 14px', borderRadius: m.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px', background: m.role === 'user' ? '#111' : '#fff', color: m.role === 'user' ? '#fff' : '#111', fontSize: 13, lineHeight: 1.6, border: m.role === 'assistant' ? '1px solid #e8e8e6' : 'none', whiteSpace: 'pre-wrap', wordBreak: 'break-word', cursor: (m.relatedProjects?.length ?? 0) > 0 ? 'pointer' : 'default' }}
                      onClick={() => (m.relatedProjects?.length ?? 0) > 0 && setActiveRef(m.relatedProjects!)}
                    >
                      {m.text}
                      {(m.relatedProjects?.length ?? 0) > 0 && (
                        <div style={{ marginTop: 6, fontSize: 10, color: '#f59e0b', borderTop: '1px solid #f0ead0', paddingTop: 5 }}>📎 관련 프로젝트 {m.relatedProjects!.length}건 →</div>
                      )}
                    </div>
                    {m.role === 'user' && (
                      <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#e8e8e6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0, marginTop: 2 }}>👤</div>
                    )}
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'linear-gradient(135deg, #f59e0b, #f97316)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>🌟</div>
                <div style={{ padding: '10px 14px', borderRadius: '16px 16px 16px 4px', background: '#fff', border: '1px solid #e8e8e6', display: 'flex', gap: 4, alignItems: 'center' }}>
                  {[0, 1, 2].map(i => (
                    <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: '#f59e0b', animation: 'bounce 1.2s infinite', animationDelay: `${i * 0.2}s` }} />
                  ))}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div style={{ padding: '10px 14px', background: '#fff', borderTop: '1px solid #e8e8e6', flexShrink: 0 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', background: '#f4f4f2', borderRadius: 14, padding: '8px 12px' }}>
              <textarea
                value={input} onChange={e => setInput(e.target.value)} onKeyDown={onKeyDown}
                placeholder="미래봇에게 물어보세요... (Enter 전송)"
                rows={1}
                style={{ flex: 1, border: 'none', background: 'transparent', resize: 'none', fontSize: 13, outline: 'none', lineHeight: 1.5, maxHeight: 80, overflowY: 'auto', color: '#111' }}
              />
              <button onClick={() => send()} disabled={!input.trim() || loading}
                style={{ width: 30, height: 30, borderRadius: '50%', border: 'none', background: input.trim() && !loading ? '#111' : '#ddd', color: '#fff', cursor: input.trim() && !loading ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 15, transition: 'background 0.15s' }}>↑</button>
            </div>
          </div>
        </div>
      </div>

      {/* 하단 우 — CM업계소식 + 참고자료 */}
      <div style={{ padding: '8px 24px 16px 8px', display: 'flex', flexDirection: 'column', gap: 8, overflow: 'hidden' }}>

        {/* CM업계소식 */}
        <div style={{ flex: '0 0 56%', background: '#fff', border: '1px solid #e8e8e6', borderRadius: 8, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid #e8e8e6', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>📰 CM업계소식</div>
            <a href="https://www.cmak.or.kr/html/notice/news.asp" target="_blank" rel="noreferrer"
              style={{ fontSize: 11, color: '#aaa', textDecoration: 'none' }}>CMAK →</a>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
            {cmakLoading ? (
              <div style={{ padding: '20px 16px', textAlign: 'center', color: '#ccc', fontSize: 12 }}>불러오는 중...</div>
            ) : cmakNews.length === 0 ? (
              <div style={{ padding: '20px 16px', textAlign: 'center', color: '#ccc', fontSize: 12 }}>소식을 불러오지 못했습니다</div>
            ) : cmakNews.map((item, i) => (
              <a key={item.idx} href={`https://www.cmak.or.kr/html/notice/news_r.asp?code=0&search=&searchString=&no=${item.idx}`} target="_blank" rel="noreferrer"
                style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '5px 14px', textDecoration: 'none', borderBottom: i < cmakNews.length - 1 ? '1px solid #f8f8f7' : 'none' }}>
                <span style={{ fontSize: 11, color: '#999', flexShrink: 0, minWidth: 44 }}>{item.date.slice(5)}</span>
                <span style={{ fontSize: 12, color: '#222', lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical' as const }}>{item.title}</span>
              </a>
            ))}
          </div>
        </div>

        {/* 참고자료 */}
        <div style={{ flex: 1, background: '#fff', border: '1px solid #e8e8e6', borderRadius: 8, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid #e8e8e6', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>📋 참고 자료</div>
            {uniqueRefs.length > 0 && (
              <button onClick={() => setActiveRef(null)} style={{ fontSize: 11, color: '#aaa', border: 'none', background: 'none', cursor: 'pointer' }}>초기화</button>
            )}
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>
            {uniqueRefs.length === 0 ? (
              <div style={{ padding: '16px', textAlign: 'center', color: '#bbb' }}>
                <div style={{ fontSize: 11 }}>대화하면 관련 프로젝트가<br />여기 표시됩니다</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {uniqueRefs.map((p, i) => (
                  <div key={i} style={{ padding: '10px', background: '#f8f8f7', borderRadius: 7, border: '1px solid #e8e8e6' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                      <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: '#f0f0ee', color: '#555' }}>{String(p.type)}</span>
                      <span style={{ fontSize: 10, color: '#999' }}>#{String(p.project_number)}</span>
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 500, color: '#111', marginBottom: 3, lineHeight: 1.4 }}>{String(p.name)}</div>
                    <div style={{ fontSize: 11, color: '#777' }}>{String(p.client)}</div>
                    <div style={{ display: 'flex', gap: 5, marginTop: 4, flexWrap: 'wrap' }}>
                      {!!p.director && <span style={{ fontSize: 10, color: '#888' }}>단장 {String(p.director)}</span>}
                      {!!p.evaluation && <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: String(p.evaluation) === '선' ? '#f0fdf4' : '#fef2f2', color: String(p.evaluation) === '선' ? '#15803d' : '#b91c1c' }}>낙찰사 {String(p.evaluation)}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes bounce {
          0%, 80%, 100% { transform: scale(0.7); opacity: 0.5; }
          40% { transform: scale(1); opacity: 1; }
        }
      `}</style>

      {/* 팀일정 추가 팝업 */}
      {addEventPopup && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }} onClick={() => setAddEventPopup(null)}>
          <div style={{ background: '#fff', borderRadius: 12, width: 320, padding: 20, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#111', marginBottom: 4 }}>팀일정 추가</div>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 14 }}>{addEventPopup.date}</div>
            <input
              autoFocus
              value={newEventTitle}
              onChange={e => setNewEventTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addTeamEvent() }}
              placeholder="일정 제목"
              style={{ width: '100%', height: 36, padding: '0 10px', border: '1px solid #e8e8e6', borderRadius: 6, fontSize: 13, boxSizing: 'border-box', marginBottom: 12, outline: 'none' }}
            />
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              {['#7c3aed','#2563eb','#16a34a','#ea580c','#db2777','#0891b2'].map(c => (
                <div key={c} onClick={() => setNewEventColor(c)} style={{ width: 24, height: 24, borderRadius: '50%', background: c, cursor: 'pointer', outline: newEventColor === c ? `3px solid ${c}` : 'none', outlineOffset: 2 }} />
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setAddEventPopup(null)} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #e8e8e6', background: '#fff', fontSize: 13, cursor: 'pointer', color: '#555' }}>취소</button>
              <button onClick={addTeamEvent} disabled={!newEventTitle.trim()} style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: '#111', fontSize: 13, cursor: 'pointer', color: '#fff', opacity: newEventTitle.trim() ? 1 : 0.4 }}>추가</button>
            </div>
          </div>
        </div>
      )}

      {/* 팀일정 삭제 확인 팝업 */}
      {deleteConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }} onClick={() => setDeleteConfirm(null)}>
          <div style={{ background: '#fff', borderRadius: 12, width: 280, padding: 20, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#111', marginBottom: 6 }}>일정 삭제</div>
            <div style={{ fontSize: 13, color: '#555', marginBottom: 16 }}>"{deleteConfirm.title}" 일정을 삭제할까요?</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setDeleteConfirm(null)} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #e8e8e6', background: '#fff', fontSize: 13, cursor: 'pointer', color: '#555' }}>취소</button>
              <button onClick={() => deleteTeamEvent(deleteConfirm.id)} style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: '#b91c1c', fontSize: 13, cursor: 'pointer', color: '#fff' }}>삭제</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
