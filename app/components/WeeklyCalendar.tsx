'use client'

import { useEffect, useMemo, useState } from 'react'
import { PerformingProject } from '@/lib/supabase'
import { useIsMobile } from '@/lib/useIsMobile'

interface CalEvent {
  label: string
  type: 'submit' | 'interview' | 'result'
  color: string
  bg: string
  note?: string
}

interface DayEvents {
  [dateKey: string]: CalEvent[]
}

const TYPE_META = {
  submit:    { label: '제출', color: '#1d4ed8', bg: '#eff6ff' },
  interview: { label: '발표', color: '#b45309', bg: '#fffbeb' },
  result:    { label: '개찰', color: '#15803d', bg: '#f0fdf4' },
}

function parseDate(raw: string, refYear: number): Date | null {
  if (!raw || raw === '추후' || raw === '-') return null
  const m1 = raw.match(/^(\d{1,2})\/(\d{1,2})$/)
  if (m1) return new Date(refYear, parseInt(m1[1]) - 1, parseInt(m1[2]))
  const m2 = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m2) return new Date(parseInt(m2[1]), parseInt(m2[2]) - 1, parseInt(m2[3]))
  return null
}

function dateKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function weekRange(week: string): [Date, Date] {
  const [year, w] = week.split('-W')
  const jan4 = new Date(parseInt(year), 0, 4)
  const startOfW1 = new Date(jan4)
  startOfW1.setDate(jan4.getDate() - jan4.getDay() + 1)
  const start = new Date(startOfW1)
  start.setDate(start.getDate() + (parseInt(w) - 1) * 7)
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  return [start, end]
}

export default function WeeklyCalendar({
  week,
  performing,
  notes,
}: {
  week: string
  performing: PerformingProject[]
  notes?: Record<string, Record<string, string>>
}) {
  const [weekStart] = weekRange(week)
  const refYear = weekStart.getFullYear()

  const [viewMonth, setViewMonth] = useState(() => weekStart.getMonth())
  const [viewYear, setViewYear] = useState(() => weekStart.getFullYear())
  const isMobile = useIsMobile()
  const [tooltip, setTooltip] = useState<{ note: string; x: number; y: number } | null>(null)

  useEffect(() => {
    if (!tooltip) return
    const dismiss = () => setTooltip(null)
    document.addEventListener('touchstart', dismiss)
    document.addEventListener('click', dismiss)
    return () => {
      document.removeEventListener('touchstart', dismiss)
      document.removeEventListener('click', dismiss)
    }
  }, [tooltip])

  // week prop이 바뀌면 달력도 해당 주차 월로 이동
  useEffect(() => {
    const [ws] = weekRange(week)
    setViewMonth(ws.getMonth())
    setViewYear(ws.getFullYear())
  }, [week])

  const FIELD_MAP: Record<keyof typeof TYPE_META, string> = {
    submit: 'submit_date', interview: 'interview_date', result: 'bid_date',
  }

  const events: DayEvents = useMemo(() => {
    const map: DayEvents = {}
    const add = (raw: string, type: keyof typeof TYPE_META, name: string, fullName: string) => {
      const d = parseDate(raw, refYear)
      if (!d) return
      const key = dateKey(d)
      if (!map[key]) map[key] = []
      const note = notes?.[fullName]?.[FIELD_MAP[type]]
      map[key].push({ ...TYPE_META[type], label: `${TYPE_META[type].label} ${name}`, type, note })
    }
    for (const p of performing) {
      if (!p.name) continue
      const short = p.name.length > 14 ? p.name.slice(0, 14) + '…' : p.name
      add(p.submit_date,    'submit',    short, p.name)
      add(p.interview_date, 'interview', short, p.name)
      add(p.result_date,    'result',    short, p.name)
    }
    return map
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [performing, refYear, notes])

  const [wStart, wEnd] = weekRange(week)
  const isInWeek = (d: Date) => d >= wStart && d <= wEnd
  const today = new Date()
  const isToday = (d: Date) =>
    d.getDate() === today.getDate() &&
    d.getMonth() === today.getMonth() &&
    d.getFullYear() === today.getFullYear()

  const firstDay = new Date(viewYear, viewMonth, 1)
  const lastDay = new Date(viewYear, viewMonth + 1, 0)
  const startPad = firstDay.getDay()

  const weeks: Date[][] = []
  // 앞 패딩: 이전 달 날짜로 채움
  const prevMonthLast = new Date(viewYear, viewMonth, 0).getDate()
  let week_: Date[] = []
  for (let i = startPad - 1; i >= 0; i--) {
    week_.push(new Date(viewYear, viewMonth - 1, prevMonthLast - i))
  }
  for (let d = 1; d <= lastDay.getDate(); d++) {
    week_.push(new Date(viewYear, viewMonth, d))
    if (week_.length === 7) { weeks.push(week_); week_ = [] }
  }
  // 뒤 패딩: 다음 달 날짜로 채움
  if (week_.length) {
    let nextD = 1
    while (week_.length < 7) week_.push(new Date(viewYear, viewMonth + 1, nextD++))
    weeks.push(week_)
  }

  const MONTH_NAMES = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월']
  const DAY_NAMES = ['일','월','화','수','목','금','토']

  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11) }
    else setViewMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0) }
    else setViewMonth(m => m + 1)
  }

  return (
    <div style={{ position: 'relative' }}>
    <div style={{ background: '#fff', border: '1px solid #e8e8e6', borderRadius: 8, marginBottom: 12 }}>
      {/* Header */}
      <div style={{ padding: isMobile ? '8px 12px' : '10px 16px', borderBottom: '1px solid #f0f0ee', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>일정 캘린더</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {!isMobile && (
            <div style={{ display: 'flex', gap: 10 }}>
              {Object.entries(TYPE_META).map(([k, v]) => (
                <span key={k} style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: v.color, display: 'inline-block' }} />
                  <span style={{ color: '#888' }}>{v.label}</span>
                </span>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button onClick={prevMonth} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#888', fontSize: 14, padding: '2px 6px', borderRadius: 4 }}>‹</button>
            <span style={{ fontSize: 13, fontWeight: 500, minWidth: isMobile ? 60 : 72, textAlign: 'center', color: '#111' }}>{viewYear}년 {MONTH_NAMES[viewMonth]}</span>
            <button onClick={nextMonth} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#888', fontSize: 14, padding: '2px 6px', borderRadius: 4 }}>›</button>
          </div>
        </div>
      </div>

      {/* Calendar grid — 헤더 + 날짜 셀을 단일 그리드로 통합해 열 정렬 보장 */}
      <div style={{ padding: '0 8px 8px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
          {/* Day headers */}
          {DAY_NAMES.map((d, i) => (
            <div key={d} style={{
              textAlign: 'center', fontSize: 11, fontWeight: 500, padding: '6px 0',
              color: i === 0 ? '#ef4444' : i === 6 ? '#3b82f6' : '#888'
            }}>{d}</div>
          ))}

          {/* 날짜 셀 전체 */}
          {weeks.flat().map((day, idx) => {
            const di = idx % 7
              const key = dateKey(day)
              const evs = events[key] || []
              const inWeek = isInWeek(day)
              const tod = isToday(day)
              const isSun = di === 0
              const isSat = di === 6
              const isOtherMonth = day.getMonth() !== viewMonth

              return (
                <div key={idx} style={{
                  borderRadius: 6,
                  border: inWeek ? '1px solid #d1d5db' : '1px solid transparent',
                  background: inWeek ? '#f9fafb' : 'transparent',
                  padding: '4px 5px',
                  opacity: isOtherMonth && !inWeek ? 0.35 : 1,
                  overflow: 'visible',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 3 }}>
                    <div style={{
                      width: 22, height: 22, borderRadius: '50%', display: 'flex',
                      alignItems: 'center', justifyContent: 'center',
                      background: tod ? '#111' : 'transparent',
                      fontSize: 12, fontWeight: tod ? 600 : 400,
                      color: tod ? '#fff' : isSun ? '#ef4444' : isSat ? '#3b82f6' : '#333',
                    }}>
                      {day.getDate()}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {(isMobile && evs.length > 2 ? evs.slice(0, 2) : evs).map((ev, ei) => (
                      <div
                        key={ei}
                        onMouseEnter={ev.note ? (e) => {
                          const r = e.currentTarget.getBoundingClientRect()
                          setTooltip({ note: ev.note!, x: r.left, y: r.bottom + 6 })
                        } : undefined}
                        onMouseLeave={ev.note ? () => setTooltip(null) : undefined}
                        onTouchStart={ev.note ? (e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          const r = e.currentTarget.getBoundingClientRect()
                          setTooltip(prev => prev?.note === ev.note ? null : { note: ev.note!, x: Math.min(r.left, window.innerWidth - 280), y: r.bottom + 6 })
                        } : undefined}
                        style={{
                          fontSize: isMobile ? 10 : 11, lineHeight: 1.4,
                          background: ev.bg, color: ev.color,
                          borderRadius: 3, padding: isMobile ? '1px 3px' : '2px 5px',
                          overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                          maxWidth: '100%', fontWeight: 500,
                          cursor: ev.note ? 'default' : undefined,
                          outline: ev.note ? `1px solid ${ev.color}` : undefined,
                        }}
                      >
                        {isMobile ? `${ev.type === 'submit' ? '제' : ev.type === 'interview' ? '발' : '개'}` : ev.label}{ev.note ? '●' : ''}
                      </div>
                    ))}
                    {isMobile && evs.length > 2 && (
                      <div style={{ fontSize: 9, color: '#888', lineHeight: 1.2 }}>+{evs.length - 2}</div>
                    )}
                  </div>
                </div>
              )
            })}
        </div>
      </div>
    </div>

    {/* 메모 hover 툴팁 */}
    {tooltip && (
      <div style={{
        position: 'fixed', zIndex: 999,
        left: tooltip.x, top: tooltip.y,
        background: '#111', color: '#fff',
        fontSize: 12, borderRadius: 6, padding: '8px 12px',
        maxWidth: 260, lineHeight: 1.6,
        boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
        pointerEvents: 'none', whiteSpace: 'pre-wrap',
      }}>
        {tooltip.note}
      </div>
    )}
    </div>
  )
}
