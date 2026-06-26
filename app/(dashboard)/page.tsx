'use client'

import { useState, useRef, useEffect } from 'react'

interface PendingAction {
  name: string
  args: Record<string, unknown>
}

interface Message {
  id: number
  role: 'user' | 'assistant'
  text: string
  relatedProjects?: Record<string, unknown>[]
  pendingAction?: PendingAction
  preview?: string
  actionResult?: { success: boolean; message: string }
}

export default function DashboardPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 0,
      role: 'assistant',
      text: '안녕하세요! 미래사업팀 전용 AI 어시스턴트 미래봇입니다 🌟\n\n프로젝트 현황 조회, 수주 분석은 물론 새 프로젝트 등록이나 기존 프로젝트 수정도 도와드릴 수 있어요!\n\n무엇이든 편하게 말씀해 주세요 😊',
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [activeRef, setActiveRef] = useState<Record<string, unknown>[] | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim()
    if (!text || loading) return

    const userMsg: Message = { id: Date.now(), role: 'user', text }
    const history = [...messages, userMsg]
    setMessages(history)
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: history
            .filter(m => !m.pendingAction && !m.actionResult)
            .map(m => ({ role: m.role, text: m.text })),
        }),
      })
      const data = await res.json() as {
        type: 'text' | 'confirm'
        text?: string
        relatedProjects?: Record<string, unknown>[]
        action?: PendingAction
        preview?: string
      }

      if (data.type === 'confirm' && data.action) {
        setMessages(prev => [...prev, {
          id: Date.now() + 1,
          role: 'assistant',
          text: '',
          pendingAction: data.action,
          preview: data.preview,
        }])
      } else {
        const aiMsg: Message = {
          id: Date.now() + 1,
          role: 'assistant',
          text: data.text ?? '',
          relatedProjects: data.relatedProjects ?? [],
        }
        setMessages(prev => [...prev, aiMsg])
        if ((data.relatedProjects ?? []).length > 0) setActiveRef(data.relatedProjects!)
      }
    } catch {
      setMessages(prev => [...prev, { id: Date.now() + 1, role: 'assistant', text: '앗, 오류가 발생했어요 😢 잠시 후 다시 시도해 주세요!' }])
    } finally {
      setLoading(false)
    }
  }

  const executeAction = async (msgId: number, action: PendingAction, confirmed: boolean) => {
    // Replace the confirm card with result
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, pendingAction: undefined, preview: undefined } : m))

    if (!confirmed) {
      setMessages(prev => [...prev, { id: Date.now(), role: 'assistant', text: '알겠어요! 취소했습니다 😊 다른 작업이 필요하시면 말씀해 주세요.' }])
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/chat/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const result = await res.json() as { success: boolean; message: string }
      setMessages(prev => [...prev, {
        id: Date.now(),
        role: 'assistant',
        text: result.message,
      }])
    } finally {
      setLoading(false)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  const refProjects = activeRef ?? messages.filter(m => (m.relatedProjects?.length ?? 0) > 0).flatMap(m => m.relatedProjects ?? [])
  const uniqueRefs = Array.from(new Map(refProjects.map(p => [p.project_number, p])).values())

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#f8f8f7' }}>
      {/* Chat area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{ padding: '16px 24px', background: '#fff', borderBottom: '1px solid #e8e8e6', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg, #f59e0b, #f97316)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>🌟</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>미래봇</div>
            <div style={{ fontSize: 11, color: '#22c55e' }}>● 온라인</div>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {messages.map(m => (
            <div key={m.id}>
              {/* Confirm action card */}
              {m.pendingAction && m.preview && (
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg, #f59e0b, #f97316)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0, marginTop: 2 }}>🌟</div>
                  <div style={{ background: '#fff', border: '1px solid #f59e0b', borderRadius: '18px 18px 18px 4px', padding: '14px 16px', maxWidth: '70%' }}>
                    <div style={{ fontSize: 12, color: '#f59e0b', fontWeight: 600, marginBottom: 8 }}>⚡ 다음 작업을 실행할까요?</div>
                    <pre style={{ fontSize: 12.5, color: '#333', margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.7, fontFamily: 'inherit' }}>{m.preview}</pre>
                    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                      <button
                        onClick={() => executeAction(m.id, m.pendingAction!, true)}
                        style={{ padding: '6px 16px', borderRadius: 8, border: 'none', background: '#111', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                      >✓ 확인</button>
                      <button
                        onClick={() => executeAction(m.id, m.pendingAction!, false)}
                        style={{ padding: '6px 16px', borderRadius: 8, border: '1px solid #e8e8e6', background: '#fff', color: '#555', fontSize: 12, cursor: 'pointer' }}
                      >✕ 취소</button>
                    </div>
                  </div>
                </div>
              )}

              {/* Normal message */}
              {!m.pendingAction && m.text && (
                <div style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', gap: 10, alignItems: 'flex-start' }}>
                  {m.role === 'assistant' && (
                    <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg, #f59e0b, #f97316)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0, marginTop: 2 }}>🌟</div>
                  )}
                  <div
                    style={{
                      maxWidth: '70%', padding: '12px 16px',
                      borderRadius: m.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                      background: m.role === 'user' ? '#111' : '#fff',
                      color: m.role === 'user' ? '#fff' : '#111',
                      fontSize: 13.5, lineHeight: 1.6,
                      border: m.role === 'assistant' ? '1px solid #e8e8e6' : 'none',
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                      cursor: (m.relatedProjects?.length ?? 0) > 0 ? 'pointer' : 'default',
                    }}
                    onClick={() => (m.relatedProjects?.length ?? 0) > 0 && setActiveRef(m.relatedProjects!)}
                  >
                    {m.text}
                    {(m.relatedProjects?.length ?? 0) > 0 && (
                      <div style={{ marginTop: 8, fontSize: 11, color: '#f59e0b', borderTop: '1px solid #f0ead0', paddingTop: 6 }}>
                        📎 관련 프로젝트 {m.relatedProjects!.length}건 →
                      </div>
                    )}
                  </div>
                  {m.role === 'user' && (
                    <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#e8e8e6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0, marginTop: 2 }}>👤</div>
                  )}
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg, #f59e0b, #f97316)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>🌟</div>
              <div style={{ padding: '12px 16px', borderRadius: '18px 18px 18px 4px', background: '#fff', border: '1px solid #e8e8e6', display: 'flex', gap: 4, alignItems: 'center' }}>
                {[0, 1, 2].map(i => (
                  <div key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: '#f59e0b', animation: 'bounce 1.2s infinite', animationDelay: `${i * 0.2}s` }} />
                ))}
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div style={{ padding: '16px 24px', background: '#fff', borderTop: '1px solid #e8e8e6' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', background: '#f4f4f2', borderRadius: 16, padding: '10px 14px' }}>
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="미래봇에게 무엇이든 물어보세요... (Enter 전송, Shift+Enter 줄바꿈)"
              rows={1}
              style={{ flex: 1, border: 'none', background: 'transparent', resize: 'none', fontSize: 13.5, outline: 'none', lineHeight: 1.5, maxHeight: 120, overflowY: 'auto', color: '#111' }}
            />
            <button
              onClick={() => send()}
              disabled={!input.trim() || loading}
              style={{ width: 34, height: 34, borderRadius: '50%', border: 'none', background: input.trim() && !loading ? '#111' : '#ddd', color: '#fff', cursor: input.trim() && !loading ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 16, transition: 'background 0.15s' }}
            >↑</button>
          </div>
          <div style={{ fontSize: 11, color: '#bbb', textAlign: 'center', marginTop: 6 }}>미래사업팀 전용 AI · 프로젝트 조회 및 데이터 입력 지원</div>
        </div>
      </div>

      {/* Reference panel */}
      <div style={{ width: 300, borderLeft: '1px solid #e8e8e6', background: '#fff', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <div style={{ padding: '16px 18px', borderBottom: '1px solid #e8e8e6', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>📋 참고 자료</div>
          {uniqueRefs.length > 0 && (
            <button onClick={() => setActiveRef(null)} style={{ fontSize: 11, color: '#aaa', border: 'none', background: 'none', cursor: 'pointer' }}>초기화</button>
          )}
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
          {uniqueRefs.length === 0 ? (
            <div style={{ padding: '40px 16px', textAlign: 'center', color: '#bbb' }}>
              <div style={{ fontSize: 28, marginBottom: 10 }}>📂</div>
              <div style={{ fontSize: 12 }}>대화하면 관련 프로젝트나<br />참고 자료가 여기 표시됩니다</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {uniqueRefs.map((p, i) => (
                <div key={i} style={{ padding: '12px', background: '#f8f8f7', borderRadius: 8, border: '1px solid #e8e8e6' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: '#f0f0ee', color: '#555' }}>{String(p.type)}</span>
                    <span style={{ fontSize: 11, color: '#999' }}>#{String(p.project_number)}</span>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 500, color: '#111', marginBottom: 4, lineHeight: 1.4 }}>{String(p.name)}</div>
                  <div style={{ fontSize: 11, color: '#777' }}>{String(p.client)}</div>
                  {p.fee && <div style={{ fontSize: 11, color: '#2563eb', marginTop: 4 }}>용역비 {String(p.fee)}억</div>}
                  <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                    {p.director && <span style={{ fontSize: 10, color: '#888' }}>단장 {String(p.director)}</span>}
                    {p.evaluation && <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: p.evaluation === '선' ? '#f0fdf4' : '#fef2f2', color: p.evaluation === '선' ? '#15803d' : '#b91c1c' }}>낙찰사 {String(p.evaluation)}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
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
