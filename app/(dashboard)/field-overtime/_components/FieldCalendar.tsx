'use client'

import { FieldOvertimeRecord } from '@/lib/field-overtime/types'
import { Employee } from '@/lib/overtime/types'
import { MonthWeek } from '@/lib/field-overtime/calc'
import { formatHours } from '@/lib/overtime/summary'
import { employeeColor } from './employeeColor'

const DAY_NAMES = ['월', '화', '수', '목', '금', '토', '일']

interface Props {
  weeks: MonthWeek[]
  employees: Employee[]
  records: FieldOvertimeRecord[]
  todayStr: string
  /** 휴가관리 holidays(법정공휴일·회사휴무) — holiday_date → 이름. 날짜를 빨갛게 + 이름 표시 */
  holidays: Map<string, string>
  isMobile: boolean
  /** 쓰기 권한이 없으면 undefined — 칸/칩 클릭이 막힌다 */
  onDayClick?: (date: string) => void
  onRecordClick?: (record: FieldOvertimeRecord) => void
}

/**
 * 월요일 시작 달력. 한 줄 = 한 주차(monthWeeks)라 오른쪽 끝에 그 주 합계를 붙여
 * 주차별 집계 탭과 숫자가 그대로 맞물리게 했다. 날짜 칸에는 그날 입력된 직원 이름 + 인정시간이
 * 직원별 색 칩으로 쌓인다.
 */
export default function FieldCalendar({ weeks, employees, records, todayStr, holidays, isMobile, onDayClick, onRecordClick }: Props) {
  const byDate = new Map<string, FieldOvertimeRecord[]>()
  for (const r of records) {
    const list = byDate.get(r.work_date) ?? []
    list.push(r)
    byDate.set(r.work_date, list)
  }
  const orderOf = new Map(employees.map((e, i) => [e.id, i]))
  const nameOf = new Map(employees.map(e => [e.id, e.name]))
  for (const list of byDate.values()) list.sort((a, b) => (orderOf.get(a.employee_id) ?? 999) - (orderOf.get(b.employee_id) ?? 999))

  const cols = isMobile ? 'repeat(7, minmax(0, 1fr))' : 'repeat(7, minmax(0, 1fr)) 64px'

  return (
    <div style={{ background: '#fff', border: '1px solid #e8e8e6', borderRadius: 8, padding: isMobile ? '0 4px 4px' : '0 8px 8px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: cols, gap: isMobile ? 2 : 4, paddingTop: 8 }}>
        {DAY_NAMES.map((d, i) => (
          <div key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: 500, padding: '6px 0', color: i === 6 ? '#ef4444' : i === 5 ? '#3b82f6' : '#888' }}>{d}</div>
        ))}
        {!isMobile && <div style={{ textAlign: 'center', fontSize: 11, fontWeight: 500, padding: '6px 0', color: '#888' }}>주 합계</div>}

        {weeks.map(week => {
          const weekTotal = week.dates.reduce((sum, d) => sum + (byDate.get(d) ?? []).reduce((s, r) => s + Number(r.hours), 0), 0)
          return [
            ...week.cells.map((dateStr, di) => {
              if (!dateStr) return <div key={`${week.index}-${di}`} style={{ background: '#fafaf9', borderRadius: 6 }} />
              const day = parseInt(dateStr.slice(8), 10)
              const dayRecords = byDate.get(dateStr) ?? []
              const isToday = dateStr === todayStr
              const holidayName = holidays.get(dateStr)
              const red = di === 6 || !!holidayName
              return (
                <div
                  key={dateStr}
                  onClick={onDayClick ? () => onDayClick(dateStr) : undefined}
                  style={{
                    borderRadius: 6, border: '1px solid #e8e8e6', background: '#fff',
                    padding: isMobile ? '4px 2px' : '6px 5px', minHeight: isMobile ? 64 : 96,
                    cursor: onDayClick ? 'pointer' : 'default', minWidth: 0,
                  }}
                >
                  <div style={{
                    width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: isToday ? '#111' : 'transparent', fontSize: 12, fontWeight: isToday ? 600 : 400,
                    color: isToday ? '#fff' : red ? '#ef4444' : di === 5 ? '#3b82f6' : '#333',
                  }}>{day}</div>
                  {holidayName && (
                    <div title={holidayName} style={{ fontSize: 10, color: '#ef4444', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{holidayName}</div>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>
                    {dayRecords.map(r => {
                      const color = employeeColor(orderOf.get(r.employee_id) ?? 0)
                      return (
                        <div
                          key={r.id}
                          onClick={onRecordClick ? e => { e.stopPropagation(); onRecordClick(r) } : undefined}
                          title={`${nameOf.get(r.employee_id) ?? ''} · ${r.start_time ? `${r.start_time}~${r.end_time}` : `~${r.end_time}`} · 인정 ${formatHours(Number(r.hours))}${r.note ? ` · ${r.note}` : ''}`}
                          style={{
                            display: 'flex', justifyContent: 'space-between', gap: 2,
                            fontSize: isMobile ? 10 : 11, lineHeight: 1.4, padding: '1px 4px',
                            borderRadius: 3, background: color.bg, borderLeft: `3px solid ${color.fg}`, color: '#222',
                            whiteSpace: 'nowrap', overflow: 'hidden',
                          }}
                        >
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{nameOf.get(r.employee_id) ?? '(알 수 없음)'}</span>
                          {!isMobile && <span style={{ fontWeight: 600, flexShrink: 0 }}>{formatHours(Number(r.hours))}</span>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            }),
            !isMobile && (
              <div key={`total-${week.index}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderRadius: 6, background: '#f8f8f7', fontSize: 11, color: '#888' }}>
                <span>{week.index}주차</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: weekTotal ? '#111' : '#ccc', marginTop: 2 }}>{formatHours(weekTotal)}</span>
              </div>
            ),
          ]
        })}
      </div>
    </div>
  )
}
