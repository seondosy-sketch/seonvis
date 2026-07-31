'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { PerformingProject } from '@/lib/supabase'
import { useIsMobile } from '@/lib/useIsMobile'
// 보이는 주 창(window) 계산 — 계산 규칙과 테스트는 lib/calendarWindow.ts 참고
import {
  HOME_ROW,
  gridWeekStart,
  highlightWeekStart,
  homeWindowTop,
  shiftWindow,
  buildWeekRows,
  weeksBetween,
} from '@/lib/calendarWindow'

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
  // 프로젝트 일정의 "M/D" 표기를 몇 년으로 읽을지는 week prop 기준을 유지한다
  const refYear = weekRange(week)[0].getFullYear()

  // 음영으로 강조할 "이번주"(일~토) 한 줄 — 실제 날짜에 고정이라 스크롤해도 움직이지 않는다
  const highlightStart = useMemo(() => {
    const [ws, we] = weekRange(week)
    return highlightWeekStart(ws, we, new Date())
  }, [week])
  const highlightEnd = useMemo(() => {
    const e = new Date(highlightStart)
    e.setDate(e.getDate() + 6)
    return e
  }, [highlightStart])

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

  // 첫 화면(=이번주 버튼): 이번주 행이 HOME_ROW에 오도록 창의 첫 행을 잡는다
  const homeTop = useMemo(() => homeWindowTop(highlightStart), [highlightStart])

  // 창의 위치는 "첫 화면에서 몇 주 떨어져 있는지"로만 들고 있는다(0 = 첫 화면).
  // 절대 날짜로 들고 있으면 week prop이 바뀔 때 effect로 되맞춰야 하는데,
  // 오프셋으로 두면 homeTop이 바뀌면 창이 알아서 따라와 그 동기화가 필요 없다.
  const [weekOffset, setWeekOffset] = useState(0)
  const topStart = useMemo(() => shiftWindow(homeTop, weekOffset), [homeTop, weekOffset])
  const atHome = weekOffset === 0

  // 마우스 휠로 창을 한 주씩 이동 — 휠 한 번(이벤트 묶음)당 한 주만 움직이도록 쿨다운을 둔다.
  // 모바일은 터치 스크롤로 페이지를 넘겨야 하므로 휠을 가로채지 않는다.
  const lastWheelRef = useRef(0)
  const handleWheel = (e: React.WheelEvent) => {
    if (Math.abs(e.deltaY) < 2) return
    e.preventDefault()
    const now = Date.now()
    if (now - lastWheelRef.current < 300) return
    lastWheelRef.current = now
    setWeekOffset(o => o + (e.deltaY > 0 ? 1 : -1))
  }

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

  const isInWeek = (d: Date) => d >= highlightStart && d <= highlightEnd
  const today = new Date()
  const isToday = (d: Date) =>
    d.getDate() === today.getDate() &&
    d.getMonth() === today.getMonth() &&
    d.getFullYear() === today.getFullYear()

  // topStart부터 VISIBLE_WEEKS주를 그린다 — 달 경계와 무관하게 계속 이어지는 주 목록
  const weeks: Date[][] = useMemo(() => buildWeekRows(topStart), [topStart])

  // 머리글에 쓸 "대표 달" — 가운데 행(HOME_ROW)의 수요일이 속한 달.
  // 다른 달 날짜를 흐리게 표시하는 기준으로도 쓴다.
  const labelDate = weeks[HOME_ROW][3]
  const labelYear = labelDate.getFullYear()
  const labelMonth = labelDate.getMonth()

  const MONTH_NAMES = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월']
  // 행이 일요일에 시작한다(gridWeekStart) — 일=0, 토=6
  const DAY_NAMES = ['일','월','화','수','목','금','토']
  const SUN_INDEX = 0
  const SAT_INDEX = 6

  // ‹ › 는 한 달씩 건너뛴다 — 그 달 1일이 첫 행에 오도록 창을 옮긴다
  const jumpMonth = (delta: number) => {
    const target = gridWeekStart(new Date(labelYear, labelMonth + delta, 1))
    setWeekOffset(weeksBetween(homeTop, target))
  }

  const toDateStr = (d: Date) => {
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${d.getFullYear()}-${mm}-${dd}`
  }

  const maxEvents = isMobile ? 2 : 3

  return (
    <div style={{ position: 'relative', height: '100%' }}>
    <div style={{ background: '#fff', border: '1px solid #e8e8e6', borderRadius: 8, height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: isMobile ? '6px 12px' : '8px 16px', borderBottom: '1px solid #f0f0ee', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6, flexShrink: 0 }}>
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
            <button onClick={() => jumpMonth(-1)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#888', fontSize: 14, padding: '2px 6px', borderRadius: 4 }}>‹</button>
            <span style={{ fontSize: 13, fontWeight: 500, minWidth: isMobile ? 60 : 72, textAlign: 'center', color: '#111' }}>{labelYear}년 {MONTH_NAMES[labelMonth]}</span>
            <button onClick={() => jumpMonth(1)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#888', fontSize: 14, padding: '2px 6px', borderRadius: 4 }}>›</button>
            {/* 스크롤로 이번주 음영이 화면 밖으로 나갔을 때 한 번에 되돌아오는 버튼 */}
            <button
              onClick={() => setWeekOffset(0)}
              style={{
                border: '1px solid #e8e8e6', background: atHome ? '#f4f4f2' : '#fff',
                color: atHome ? '#aaa' : '#333', cursor: atHome ? 'default' : 'pointer',
                fontSize: 11, padding: '2px 8px', borderRadius: 10, whiteSpace: 'nowrap',
              }}
            >이번주</button>
          </div>
        </div>
      </div>

      {/* Calendar grid — 휠 스크롤로 보이는 6주 창을 한 주씩 위아래로 옮긴다(음영은 이번주에 고정).
          모바일에서는 페이지 스크롤을 막지 않도록 휠을 가로채지 않는다. */}
      <div onWheel={isMobile ? undefined : handleWheel} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '4px 8px 6px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, flexShrink: 0 }}>
          {DAY_NAMES.map((d, i) => (
            <div key={d} style={{
              textAlign: 'center', fontSize: 10, fontWeight: 500, padding: '2px 0',
              color: i === SUN_INDEX ? '#ef4444' : i === SAT_INDEX ? '#3b82f6' : '#888'
            }}>{d}</div>
          ))}
        </div>

        <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateRows: `repeat(${weeks.length}, 1fr)`, gap: 1 }}>
          {weeks.map((weekRow, wi) => (
            <div key={wi} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, minHeight: 0 }}>
              {weekRow.map((day, di) => {
                const key = dateKey(day)
                const evs = events[key] || []
                const inWeek = isInWeek(day)
                const tod = isToday(day)
                const isSun = di === SUN_INDEX
                const isSat = di === SAT_INDEX
                const isOtherMonth = day.getMonth() !== labelMonth || day.getFullYear() !== labelYear
                const isMonthFirst = day.getDate() === 1
                const hasHoliday = evs.some(e => e.type === 'holiday')

                return (
                  <div
                    key={di}
                    onClick={() => onDateClick?.(toDateStr(day))}
                    style={{
                      borderRadius: 5,
                      border: inWeek ? '1px solid #d1d5db' : '1px solid transparent',
                      background: inWeek ? '#f9fafb' : 'transparent',
                      padding: '2px 3px',
                      opacity: isOtherMonth && !inWeek ? 0.35 : 1,
                      overflow: 'hidden',
                      minHeight: 0,
                      cursor: onDateClick ? 'pointer' : 'default',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 1 }}>
                      {/* 달이 이어서 흐르는 화면이라, 매달 1일에는 "8/1"처럼 달을 함께 적어 경계를 알린다 */}
                      <div style={{
                        minWidth: 18, height: 18, borderRadius: 9, display: 'flex',
                        alignItems: 'center', justifyContent: 'center',
                        padding: isMonthFirst ? '0 5px' : 0,
                        background: tod ? '#111' : 'transparent',
                        fontSize: 11, fontWeight: tod || isMonthFirst ? 600 : 400,
                        color: tod ? '#fff' : hasHoliday ? '#dc2626' : isSun ? '#ef4444' : isSat ? '#3b82f6' : '#333',
                      }}>
                        {isMonthFirst ? `${day.getMonth() + 1}/1` : day.getDate()}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      {(evs.length > maxEvents ? evs.slice(0, maxEvents) : evs).map((ev, ei) => (
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
                            fontSize: isMobile ? 9 : 10, lineHeight: 1.3,
                            background: ev.bg, color: ev.color,
                            borderRadius: 3, padding: isMobile ? '0 2px' : '1px 4px',
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
                      {evs.length > maxEvents && (
                        <div style={{ fontSize: 9, color: '#888', lineHeight: 1.2 }}>+{evs.length - maxEvents}</div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
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
