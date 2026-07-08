'use client'

import { useEffect, useMemo, useState } from 'react'
import { PerformingProject } from '@/lib/supabase'
import { useIsMobile } from '@/lib/useIsMobile'

interface CalEvent {
  label: string
  type: 'submit' | 'interview' | 'result' | 'holiday' | 'team'
  color: string
  bg: string
  note?: string
  id?: string
}

interface DayEvents {
  [dateKey: string]: CalEvent[]
}

export interface Holiday {
  date: string      // YYYY-MM-DD
  localName: string
}

export interface TeamEvent {
  id: string
  title: string
  date: string      // YYYY-MM-DD
  color: string
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

function parseDateISO(iso: string): Date | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]))
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

// hex 색상을 연하게 변환
function lightenHex(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const lr = Math.round(r + (255 - r) * 0.85)
  const lg = Math.round(g + (255 - g) * 0.85)
  const lb = Math.round(b + (255 - b) * 0.85)
  return `rgb(${lr},${lg},${lb})`
}

export default function WeeklyCalendar({
  week,
  performing,
  notes,
  holidays = [],
  teamEvents = [],
  onDateClick,
  onTeamEventClick,
}: {
  week: string
  performing: PerformingProject[]
  notes?: Record<string, Record<string, string>>
  holidays?: Holiday[]
  teamEvents?: TeamEvent[]
  onDateClick?: (dateStr: string) => void
  onTeamEventClick?: (id: string, title: string) => void
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
    const add = (ev: CalEvent, key: string) => {
      if (!map[key]) map[key] = []
      map[key].push(ev)
    }

    // 공휴일
    for (const h of holidays) {
      const d = parseDateISO(h.date)
      if (!d) continue
      add({ label: h.localName, type: 'holiday', color: '#dc2626', bg: '#fff1f2' }, dateKey(d))
    }

    // 팀일정
    for (const t of teamEvents) {
      const d = parseDateISO(t.date)
      if (!d) continue
      add({ label: t.title, type: 'team', color: t.color, bg: lightenHex(t.color), id: t.id }, dateKey(d))
    }

    // 프로젝트 일정
    for (const p of performing) {
      if (!p.name) continue
      const short = p.name.length > 14 ? p.name.slice(0, 14) + '…' : p.name
      const addProj = (raw: string, type: keyof typeof TYPE_META) => {
        const d = parseDate(raw, refYear)
        if (!d) return
        const note = notes?.[p.name]?.[FIELD_MAP[type]]
        add({ ...TYPE_META[type], label: `${TYPE_META[type].label} ${short}`, type, note }, dateKey(d))
      }
      addProj(p.submit_date, 'submit')
      addProj(p.interview_date, 'interview')
      addProj(p.result_date, 'result')
    }
    return map
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [performing, refYear, notes, holidays, teamEvents])

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
  const prevMonthLast = new Date(viewYear, viewMonth, 0).getDate()
  let week_: Date[] = []
  for (let i = startPad - 1; i >= 0; i--) {
    week_.push(new Date(viewYear, viewMonth - 1, prevMonthLast - i))
  }
  for (let d = 1; d <= lastDay.getDate(); d++) {
    week_.push(new Date(viewYear, viewMonth, d))
    if (week_.length === 7) { weeks.push(week_); week_ = [] }
  }
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

  const toDateStr = (d: Date) => {
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${d.getFullYear()}-${mm}-${dd}`
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
              {(Object.entries(TYPE_META) as [keyof typeof TYPE_META, typeof TYPE_META[keyof typeof TYPE_META]][]).map(([k, v]) => (
                <span key={k} style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: v.color, display: 'inline-block' }} />
                  <span style={{ color: '#888' }}>{v.label}</span>
                </span>
              ))}
              <span style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#dc2626', display: 'inline-block' }} />
                <span style={{ color: '#888' }}>공휴일</span>
              </span>
              <span style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#7c3aed', display: 'inline-block' }} />
                <span style={{ color: '#888' }}>팀일정</span>
              </span>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button onClick={prevMonth} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#888', fontSize: 14, padding: '2px 6px', borderRadius: 4 }}>‹</button>
            <span style={{ fontSize: 13, fontWeight: 500, minWidth: isMobile ? 60 : 72, textAlign: 'center', color: '#111' }}>{viewYear}년 {MONTH_NAMES[viewMonth]}</span>
            <button onClick={nextMonth} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#888', fontSize: 14, padding: '2px 6px', borderRadius: 4 }}>›</button>
          </div>
        </div>
      </div>

      {/* Calendar grid */}
      <div style={{ padding: '0 8px 8px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
          {DAY_NAMES.map((d, i) => (
            <div key={d} style={{
              textAlign: 'center', fontSize: 11, fontWeight: 500, padding: '6px 0',
              color: i === 0 ? '#ef4444' : i === 6 ? '#3b82f6' : '#888'
            }}>{d}</div>
          ))}

          {weeks.flat().map((day, idx) => {
            const di = idx % 7
            const key = dateKey(day)
            const evs = events[key] || []
            const inWeek = isInWeek(day)
            const tod = isToday(day)
            const isSun = di === 0
            const isSat = di === 6
            const isOtherMonth = day.getMonth() !== viewMonth
            const hasHoliday = evs.some(e => e.type === 'holiday')

            return (
              <div
                key={idx}
                onClick={() => onDateClick?.(toDateStr(day))}
                style={{
                  borderRadius: 6,
                  border: inWeek ? '1px solid #d1d5db' : '1px solid transparent',
                  background: inWeek ? '#f9fafb' : 'transparent',
                  padding: '4px 5px',
                  opacity: isOtherMonth && !inWeek ? 0.35 : 1,
                  overflow: 'visible',
                  cursor: onDateClick ? 'pointer' : 'default',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 3 }}>
                  <div style={{
                    width: 22, height: 22, borderRadius: '50%', display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                    background: tod ? '#111' : 'transparent',
                    fontSize: 12, fontWeight: tod ? 600 : 400,
                    color: tod ? '#fff' : hasHoliday ? '#dc2626' : isSun ? '#ef4444' : isSat ? '#3b82f6' : '#333',
                  }}>
                    {day.getDate()}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {(isMobile && evs.length > 2 ? evs.slice(0, 2) : evs).map((ev, ei) => (
                    <div
                      key={ei}
                      onClick={ev.type === 'team' && ev.id ? (e) => {
                        e.stopPropagation()
                        onTeamEventClick?.(ev.id!, ev.label)
                      } : undefined}
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
                        cursor: ev.type === 'team' ? 'pointer' : ev.note ? 'default' : undefined,
                        outline: ev.note ? `1px solid ${ev.color}` : undefined,
                      }}
                    >
                      {isMobile
                        ? ev.type === 'submit' ? '제' : ev.type === 'interview' ? '발' : ev.type === 'result' ? '개' : ev.type === 'holiday' ? '휴' : '팀'
                        : ev.label}
                      {ev.note ? '●' : ''}
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
