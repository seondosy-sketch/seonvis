'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { useIsMobile } from '@/lib/useIsMobile'
import { useMenuPermission } from '@/app/components/PermissionsProvider'
import { FieldOvertimeRecord } from '@/lib/field-overtime/types'
import { Employee } from '@/lib/overtime/types'
import { syncTeamEmployees } from '@/lib/overtime/teamSync'
import { monthRange, monthWeeks, sumByEmployeeMonth, sumByEmployeeWeek, toDateStr } from '@/lib/field-overtime/calc'
import { formatHours } from '@/lib/overtime/summary'
import FieldCalendar from './_components/FieldCalendar'
import FieldEntryModal from './_components/FieldEntryModal'
import SummaryTable from './_components/SummaryTable'

type Tab = 'calendar' | 'weekly' | 'monthly'
const MONTH_COLUMNS = Array.from({ length: 12 }, (_, i) => ({ title: `${i + 1}월` }))
const MIGRATION_HINT = 'supabase/migration_team_roster_sync.sql, migration_field_overtime.sql이 적용되었는지 확인하세요.'

/**
 * 연장근무 (실무자) — 제안서팀 연장근무(/overtime)와 별개. 한 달은 달력 월(1일~말일),
 * 주차는 월요일 시작(lib/field-overtime/calc.ts의 monthWeeks).
 *   달력 탭: 날짜 칸에 직원 이름 + 인정시간. 칸 클릭 = 그 날짜로 신규 입력, 이름 칩 클릭 = 수정
 *   주차별 탭: 선택한 달의 직원 × 주차 합계
 *   월별 탭: 선택한 해의 직원 × 1~12월 합계
 * 직원 명단은 기술인 주소록의 소속 '미래사업팀' — 열 때마다 overtime_employees로 동기화한 뒤 읽는다.
 */
export default function FieldOvertimePage() {
  const isMobile = useIsMobile()
  const supabase = createSupabaseBrowserClient()
  const canWrite = useMenuPermission('field_overtime') === 'write'

  const now = new Date()
  const todayStr = toDateStr(now.getFullYear(), now.getMonth(), now.getDate())
  const [tab, setTab] = useState<Tab>('calendar')
  const [viewYear, setViewYear] = useState(now.getFullYear())
  const [viewMonth, setViewMonth] = useState(now.getMonth())

  const [employees, setEmployees] = useState<Employee[]>([])
  const [employeesLoading, setEmployeesLoading] = useState(true)
  // 휴가관리의 공휴일·회사휴무(holidays) — 달력 표시와 휴일 근무(시작시간 입력) 판단에 쓴다
  const [holidays, setHolidays] = useState<Map<string, string>>(new Map())
  const [records, setRecords] = useState<FieldOvertimeRecord[]>([])
  const [yearRecords, setYearRecords] = useState<FieldOvertimeRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [entry, setEntry] = useState<{ record: FieldOvertimeRecord | null; date: string } | null>(null)

  // 퇴사자도 함께 불러온다 — 과거 기록의 이름 표시와 집계 행에 필요하다. 입력 선택지만 재직자로 거른다.
  const loadEmployees = useCallback(async () => {
    setEmployeesLoading(true)
    await syncTeamEmployees(supabase)
    const { data, error: empError } = await supabase.from('overtime_employees').select('*').order('sort_order', { ascending: true })
    if (empError) setError(`직원 목록을 불러올 수 없습니다. ${MIGRATION_HINT}`)
    else setEmployees(data as Employee[])
    setEmployeesLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadRecords = useCallback(async (year: number, month0: number, wholeYear: boolean) => {
    setLoading(true)
    const { start, end } = wholeYear
      ? { start: toDateStr(year, 0, 1), end: toDateStr(year, 11, 31) }
      : monthRange(year, month0)
    const { data, error: recError } = await supabase
      .from('field_overtime_records')
      .select('*')
      .gte('work_date', start)
      .lte('work_date', end)
    if (recError) {
      setError(`연장근무 기록을 불러올 수 없습니다. ${MIGRATION_HINT}`)
    } else {
      setError(null)
      if (wholeYear) setYearRecords(data as FieldOvertimeRecord[])
      else setRecords(data as FieldOvertimeRecord[])
    }
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const reload = useCallback(() => {
    loadRecords(viewYear, viewMonth, tab === 'monthly')
  }, [loadRecords, viewYear, viewMonth, tab])

  // 테이블이 작아(연 20건 남짓) 전부 한 번에 읽는다. 실패해도(권한 등) 주말만 휴일로 보고 화면은 그대로 뜬다.
  const loadHolidays = useCallback(async () => {
    const { data, error: holError } = await supabase.from('holidays').select('holiday_date, name')
    if (holError) { console.warn('[holidays]', holError.message); return }
    setHolidays(new Map((data as { holiday_date: string; name: string }[]).map(h => [h.holiday_date, h.name])))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { loadEmployees() }, [loadEmployees])
  useEffect(() => { loadHolidays() }, [loadHolidays])
  useEffect(() => { reload() }, [reload])

  const weeks = monthWeeks(viewYear, viewMonth)
  const activeEmployees = employees.filter(e => e.is_active)
  const monthTotal = records.reduce((s, r) => s + Number(r.hours), 0)

  const prev = () => {
    if (tab === 'monthly') { setViewYear(y => y - 1); return }
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11) } else setViewMonth(m => m - 1)
  }
  const next = () => {
    if (tab === 'monthly') { setViewYear(y => y + 1); return }
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0) } else setViewMonth(m => m + 1)
  }

  // 신규 입력 기본 날짜: 보고 있는 달이 이번 달이면 오늘, 아니면 그 달 1일
  const defaultEntryDate = todayStr.slice(0, 7) === toDateStr(viewYear, viewMonth, 1).slice(0, 7) ? todayStr : toDateStr(viewYear, viewMonth, 1)

  // 수정 중인 기록의 직원이 퇴사자면 선택지에 함께 넣어야 드롭다운이 빈 값으로 보이지 않는다
  const entryEmployees = entry?.record && !activeEmployees.some(e => e.id === entry.record!.employee_id)
    ? [...activeEmployees, ...employees.filter(e => e.id === entry.record!.employee_id)]
    : activeEmployees

  return (
    <div style={{ minHeight: '100vh', background: '#f8f8f7' }}>
      <header style={{ background: '#fff', borderBottom: '1px solid #e8e8e6' }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', padding: isMobile ? '0 12px' : '0 24px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 14, color: '#555', whiteSpace: 'nowrap' }}>연장근무 (실무자)</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <Link href="/engineers" title="직원 명단은 기술인 주소록의 소속 '미래사업팀'과 연동됩니다" style={{ ...outlineBtn, display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>명단: 기술인 주소록</Link>
            {canWrite && <button onClick={() => setEntry({ record: null, date: defaultEntryDate })} style={primaryBtn}>+ 신규 입력</button>}
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1400, margin: '0 auto', padding: isMobile ? '12px 12px 60px' : '20px 24px 60px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
          <div style={{ display: 'flex', border: '1px solid #e8e8e6', borderRadius: 6, overflow: 'hidden' }}>
            <button onClick={() => setTab('calendar')} style={tab === 'calendar' ? tabBtnActive : tabBtn}>달력</button>
            <button onClick={() => setTab('weekly')} style={tab === 'weekly' ? tabBtnActive : tabBtn}>주차별 집계</button>
            <button onClick={() => setTab('monthly')} style={tab === 'monthly' ? tabBtnActive : tabBtn}>월별 집계</button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button onClick={prev} style={navBtn}>‹</button>
            <span style={{ fontSize: 14, fontWeight: 600, minWidth: 100, textAlign: 'center', color: '#111' }}>
              {tab === 'monthly' ? `${viewYear}년` : `${viewYear}년 ${viewMonth + 1}월`}
            </span>
            <button onClick={next} style={navBtn}>›</button>
            {loading && !employeesLoading && <span style={{ fontSize: 11, color: '#bbb', marginLeft: 8 }}>불러오는 중...</span>}
          </div>

          <div style={{ fontSize: 12, color: '#888' }}>
            {tab !== 'monthly' && <>이번 달 합계 <b style={{ color: '#111', fontSize: 14 }}>{formatHours(monthTotal)}</b></>}
          </div>
        </div>

        {error && (
          <div style={{ marginBottom: 12, padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, color: '#b91c1c' }}>{error}</div>
        )}

        {tab === 'calendar' && !employeesLoading && activeEmployees.length === 0 && (
          <div style={{ marginBottom: 12, padding: '10px 14px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, fontSize: 12, color: '#92400e' }}>
            직원이 없습니다. 기술인 주소록에서 소속을 &quot;미래사업팀&quot;으로 등록하면 자동으로 명단에 들어옵니다.
          </div>
        )}

        {employeesLoading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#bbb', fontSize: 13 }}>불러오는 중...</div>
        ) : tab === 'calendar' ? (
          <>
            <FieldCalendar
              weeks={weeks}
              employees={employees}
              records={records}
              todayStr={todayStr}
              holidays={holidays}
              isMobile={isMobile}
              onDayClick={canWrite ? date => setEntry({ record: null, date }) : undefined}
              onRecordClick={canWrite ? record => setEntry({ record, date: record.work_date }) : undefined}
            />
            <div style={{ fontSize: 11, color: '#aaa', marginTop: 8 }}>
              인정시간 = 종료시간 − 18:00 − 휴게 1시간, 1시간 단위 절삭 (휴일은 입력한 시작시간부터 · 공휴일·회사휴무는 휴가관리 일정 기준){canWrite && ' · 날짜 칸을 누르면 그 날짜로 입력, 이름을 누르면 수정'}
            </div>
          </>
        ) : tab === 'weekly' ? (
          <SummaryTable
            columns={weeks.map(w => ({ title: `${w.index}주차`, sub: w.label }))}
            employees={employees}
            totals={sumByEmployeeWeek(records, weeks)}
          />
        ) : (
          <SummaryTable columns={MONTH_COLUMNS} employees={employees} totals={sumByEmployeeMonth(yearRecords)} />
        )}
      </div>

      {entry && (
        <FieldEntryModal
          record={entry.record}
          defaultDate={entry.date}
          employees={entryEmployees}
          records={records}
          holidays={holidays}
          onClose={() => setEntry(null)}
          onSaved={reload}
        />
      )}
    </div>
  )
}

const navBtn: React.CSSProperties = { border: 'none', background: 'none', cursor: 'pointer', color: '#888', fontSize: 16, padding: '2px 8px', borderRadius: 4 }
const outlineBtn: React.CSSProperties = { height: 34, padding: '0 14px', borderRadius: 6, border: '1px solid #e8e8e6', background: '#fff', color: '#333', fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }
const primaryBtn: React.CSSProperties = { height: 34, padding: '0 14px', borderRadius: 6, border: 'none', background: '#111', color: '#fff', fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }
const tabBtn: React.CSSProperties = { height: 32, padding: '0 14px', border: 'none', background: '#fff', color: '#555', fontSize: 13, cursor: 'pointer' }
const tabBtnActive: React.CSSProperties = { ...tabBtn, background: '#111', color: '#fff' }
