'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import WeeklyCalendar from '../components/WeeklyCalendar'
import { PerformingProject } from '@/lib/supabase'
import { useIsMobile } from '@/lib/useIsMobile'

interface PendingAction { name: string; args: Record<string, unknown> }
interface Message {
  id: number; role: 'user' | 'assistant'; text: string
  relatedProjects?: Record<string, unknown>[]
  pendingAction?: PendingAction; preview?: string
  actionResult?: { success: boolean; message: string }
}

function getCurrentWeek(): string {
  const now = new Date()
  const jan4 = new Date(now.getFullYear(), 0, 4)
  const startOfWeek1 = new Date(jan4)
  startOfWeek1.setDate(jan4.getDate() - jan4.getDay() + 1)
  const diff = now.getTime() - startOfWeek1.getTime()
  const week = Math.ceil((diff / 86400000 + 1) / 7)
  return `${now.getFullYear()}-W${String(week).padStart(2, '0')}`
}

function getWeekBounds(week: string): { start: Date; end: Date } {
  const [year, w] = week.split('-W')
  const jan4 = new Date(parseInt(year), 0, 4)
  const startOfW1 = new Date(jan4)
  startOfW1.setDate(jan4.getDate() - jan4.getDay() + 1)
  const start = new Date(startOfW1)
  start.setDate(start.getDate() + (parseInt(w) - 1) * 7)
  const end = new Date(start); end.setDate(end.getDate() + 6)
  return { start, end }
}

function parseDate(raw: string | null | undefined, refYear: number): Date | null {
  if (!raw || raw === '추후' || raw === '-') return null
  const m1 = raw.match(/^(\d{1,2})\/(\d{1,2})$/)
  if (m1) return new Date(refYear, parseInt(m1[1]) - 1, parseInt(m1[2]))
  const m2 = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m2) return new Date(parseInt(m2[1]), parseInt(m2[2]) - 1, parseInt(m2[3]))
  return null
}

function fmtDate(raw: string | null | undefined): string {
  if (!raw || raw === '추후' || raw === '-') return '추후'
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) return `${parseInt(m[2])}/${parseInt(m[3])}`
  return raw
}

interface ScheduleItem { name: string; date: string }
interface WeekSchedule { submit: ScheduleItem[]; interview: ScheduleItem[]; result: ScheduleItem[] }

function buildSchedule(performing: PerformingProject[], start: Date, end: Date): WeekSchedule {
  const refYear = start.getFullYear()
  const submit: ScheduleItem[] = []
  const interview: ScheduleItem[] = []
  const result: ScheduleItem[] = []
  for (const p of performing) {
    if (!p.name) continue
    const sd = parseDate(p.submit_date, refYear)
    const id = parseDate(p.interview_date, refYear)
    const rd = parseDate(p.result_date, refYear)
    if (sd && sd >= start && sd <= end) submit.push({ name: p.name, date: fmtDate(p.submit_date) })
    if (id && id >= start && id <= end) interview.push({ name: p.name, date: fmtDate(p.interview_date) })
    if (rd && rd >= start && rd <= end) result.push({ name: p.name, date: fmtDate(p.result_date) })
  }
  return { submit, interview, result }
}

export default function DashboardPage() {
  const isMobile = useIsMobile()
  const supabase = createSupabaseBrowserClient()
  const week = getCurrentWeek()
  const { start: weekStart, end: weekEnd } = getWeekBounds(week)

  // Calendar
  const [performing, setPerforming] = useState<PerformingProject[]>([])
  const [calNotes, setCalNotes] = useState<Record<string, Record<string, string>>>({})
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

    if (perf && perf.length > 0) {
      // performing_projects 날짜가 비어 있으면 projects.bid_date로 보완
      const merged = (perf as PerformingProject[]).map(p => ({
        ...p,
        result_date: p.result_date?.trim() ? p.result_date : fmtDate(projByName[p.name]?.bid_date ?? null),
        submit_date: p.submit_date?.trim() ? p.submit_date : fmtDate(projByName[p.name]?.submit_date ?? null),
        interview_date: p.interview_date?.trim() ? p.interview_date : fmtDate(projByName[p.name]?.interview_date ?? null),
      }))
      setPerforming(merged)
    } else {
      // 저장된 주간 데이터가 없으면 projects 테이블에서 직접 불러오기
      if (projs) {
        const { start: weekStart } = getWeekBounds(week)
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
            submit_date: fmtDate(p.submit_date),
            interview_date: fmtDate(p.interview_date),
            result_date: fmtDate(p.bid_date),
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
        <div style={{ margin: '10px 12px 0', border: '1px solid #e8e8e6', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
          <WeeklyCalendar week={week} performing={performing} notes={calNotes} />
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
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gridTemplateRows: '58vh 42vh', height: '100vh', overflow: 'hidden', background: '#f8f8f7', gap: 0 }}>

      {/* 상단 좌 — 달력 */}
      <div style={{ overflow: 'hidden', padding: '16px 16px 8px 24px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, overflow: 'hidden', borderRadius: 8, border: '1px solid #e8e8e6', background: '#fff' }}>
          <div style={{ height: '100%', overflow: 'auto' }}>
            <WeeklyCalendar week={week} performing={performing} notes={calNotes} />
          </div>
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
    </div>
  )
}
