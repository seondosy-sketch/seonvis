'use client'

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { useIsMobile } from '@/lib/useIsMobile'
import { useMenuPermission } from '@/app/components/PermissionsProvider'
import { LodgingHotel, LodgingRecord } from '@/lib/lodging/types'
import { buildGuestDirectory } from '@/lib/lodging/guestDirectory'
import { isDateOccupied, monthOverlapQuery, monthRangeInclusive } from '@/lib/lodging/monthRange'
import { buildFinancialSummary, buildOccupancySummary } from '@/lib/lodging/summary'
import { formatStayPeriod } from '@/lib/lodging/period'
import { LodgingEmployeeRef, LodgingEngineerRef, LodgingProjectRef } from './types'
import LodgingCalendar from './_components/LodgingCalendar'
import LodgingListTable from './_components/LodgingListTable'
import LodgingSummaryPanel from './_components/LodgingSummaryPanel'
import LodgingFormModal from './_components/LodgingFormModal'
import HotelMasterModal from './_components/HotelMasterModal'
import CurrentlyStayingCard from './_components/CurrentlyStayingCard'

const MONTH_NAMES = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월']

function todayKST(): string {
  return new Date()
    .toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' })
    .replace(/\. /g, '-')
    .replace('.', '')
}

export default function LodgingPage() {
  const isMobile = useIsMobile()
  const supabase = createSupabaseBrowserClient()
  const canWrite = useMenuPermission('lodging') === 'write'
  const today = todayKST()

  const now = new Date()
  const [viewYear, setViewYear] = useState(now.getFullYear())
  const [viewMonth, setViewMonth] = useState(now.getMonth() + 1)
  const [tab, setTab] = useState<'calendar' | 'list' | 'summary'>('calendar')

  const [currentUserEmail, setCurrentUserEmail] = useState('')
  const [records, setRecords] = useState<LodgingRecord[]>([])
  const [recordsLoading, setRecordsLoading] = useState(true)
  const [recordsError, setRecordsError] = useState<string | null>(null)
  const recordsRequestRef = useRef(0)

  const [hotels, setHotels] = useState<LodgingHotel[]>([])
  const [projects, setProjects] = useState<LodgingProjectRef[]>([])
  const [engineers, setEngineers] = useState<LodgingEngineerRef[]>([])
  const [employees, setEmployees] = useState<LodgingEmployeeRef[]>([])

  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [formModal, setFormModal] = useState<{ record: LodgingRecord | null } | null>(null)
  const [hotelModalOpen, setHotelModalOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }, [])

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setCurrentUserEmail(data.user?.email ?? ''))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadHotels = useCallback(() => {
    supabase.from('lodging_hotels').select('*').eq('is_active', true).order('name', { ascending: true }).then(({ data }) => {
      setHotels((data ?? []) as LodgingHotel[])
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadProjects = useCallback(() => {
    // 프로젝트 선택 목록도 프로젝트 List와 같은 공사번호 순으로 보여준다(lib/projectOrder.ts).
    // 날짜·상태까지 읽는 건 기술인 출근부와 같은 일정 기준으로 목록을 거르기 위함이다.
    supabase
      .from('projects')
      .select('id,name,project_number,announce_date,interview_date,bid_date,status')
      .order('project_number', { ascending: true })
      .then(({ data }) => {
        setProjects((data ?? []) as LodgingProjectRef[])
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadPeople = useCallback(() => {
    Promise.all([
      supabase.from('engineer_contacts').select('id,name,rank,company').order('name', { ascending: true }).limit(5000),
      supabase.from('overtime_employees').select('id,name,position,is_active').order('name', { ascending: true }),
    ]).then(([engRes, empRes]) => {
      if (engRes.data) setEngineers(engRes.data as LodgingEngineerRef[])
      if (empRes.data) setEmployees(empRes.data as LodgingEmployeeRef[])
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadRecords = useCallback((year: number, month: number) => {
    const requestId = ++recordsRequestRef.current
    const { monthStart, nextMonthStart } = monthOverlapQuery(year, month)
    supabase
      .from('lodging_records')
      .select('*')
      .lt('check_in', nextMonthStart)
      .gt('check_out', monthStart)
      .order('check_in', { ascending: true })
      .then(({ data, error }) => {
        if (requestId !== recordsRequestRef.current) return
        if (error) {
          setRecordsError('숙박 기록을 불러올 수 없습니다. supabase/migration_lodging.sql이 적용되었는지 확인하세요.')
          setRecords([])
        } else {
          setRecordsError(null)
          setRecords((data ?? []) as LodgingRecord[])
        }
        setRecordsLoading(false)
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { loadHotels() }, [loadHotels])
  useEffect(() => { loadProjects() }, [loadProjects])
  useEffect(() => { loadPeople() }, [loadPeople])
  useEffect(() => {
    startTransition(() => setRecordsLoading(true))
    loadRecords(viewYear, viewMonth)
  }, [viewYear, viewMonth, loadRecords])

  const prevMonth = () => {
    if (viewMonth === 1) { setViewYear(y => y - 1); setViewMonth(12) }
    else setViewMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (viewMonth === 12) { setViewYear(y => y + 1); setViewMonth(1) }
    else setViewMonth(m => m + 1)
  }

  const guestDirectory = useMemo(() => buildGuestDirectory(engineers, employees), [engineers, employees])
  const occupancy = useMemo(() => buildOccupancySummary(records, viewYear, viewMonth), [records, viewYear, viewMonth])
  const financial = useMemo(() => buildFinancialSummary(records, viewYear, viewMonth), [records, viewYear, viewMonth])
  const selectedDateRecords = useMemo(
    () => (selectedDate ? records.filter(r => isDateOccupied(r, selectedDate)) : []),
    [records, selectedDate],
  )

  async function handleDelete(record: LodgingRecord) {
    if (!canWrite || !confirm(`${record.guest_name_snapshot}님의 숙박 기록을 삭제하시겠습니까?`)) return
    const { error } = await supabase.from('lodging_records').delete().eq('id', record.id)
    if (error) { showToast('삭제에 실패했습니다.'); return }
    setRecords(prev => prev.filter(r => r.id !== record.id))
    showToast('삭제했습니다.')
  }

  function handleSaved(saved: LodgingRecord) {
    setRecords(prev => {
      const exists = prev.some(r => r.id === saved.id)
      return exists ? prev.map(r => (r.id === saved.id ? saved : r)) : [...prev, saved]
    })
  }

  const loading = recordsLoading

  return (
    <div style={{ minHeight: '100vh', background: '#f8f8f7' }}>
      <header style={{ background: '#fff', borderBottom: '1px solid #e8e8e6' }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', padding: isMobile ? '0 12px' : '0 24px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 14, color: '#555' }}>숙박관리</span>
          <div style={{ display: 'flex', gap: 8 }}>
            {canWrite && (
              <>
                <button onClick={() => setFormModal({ record: null })} style={outlineBtn}>숙박 등록</button>
                <button onClick={() => setHotelModalOpen(true)} style={outlineBtn}>숙소 관리</button>
              </>
            )}
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1400, margin: '0 auto', padding: isMobile ? '12px 12px 60px' : '20px 24px 60px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, marginBottom: 12 }}>
          <button onClick={prevMonth} style={navBtn}>‹</button>
          <span style={{ fontSize: 14, fontWeight: 600, minWidth: 100, textAlign: 'center', color: '#111' }}>
            {viewYear}년 {MONTH_NAMES[viewMonth - 1]}
          </span>
          <button onClick={nextMonth} style={navBtn}>›</button>
        </div>

        <CurrentlyStayingCard records={records} todayStr={today} />

        <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['calendar', 'list', 'summary'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)} style={t === tab ? tabBtnActive : tabBtn}>
                {t === 'calendar' ? '캘린더' : t === 'list' ? '숙박 리스트' : '월별 정산'}
              </button>
            ))}
          </div>
          <ExportMenu year={viewYear} month={viewMonth} />
        </div>

        {recordsError && (
          <div style={{ marginBottom: 12, padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, color: '#b91c1c' }}>
            {recordsError}
          </div>
        )}

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#bbb', fontSize: 13 }}>불러오는 중...</div>
        ) : tab === 'calendar' ? (
          <div>
            <LodgingCalendar
              year={viewYear}
              month={viewMonth}
              records={records}
              todayStr={today}
              selectedDate={selectedDate}
              onSelectDate={d => setSelectedDate(d === selectedDate ? null : d)}
            />
            {selectedDate && (
              <div style={{ marginTop: 12, background: '#fff', border: '1px solid #e8e8e6', borderRadius: 8, padding: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{selectedDate} 숙박자</div>
                {selectedDateRecords.length === 0 ? (
                  <div style={{ fontSize: 12, color: '#999' }}>이 날짜에 숙박자가 없습니다.</div>
                ) : (
                  selectedDateRecords.map(r => (
                    <div key={r.id} style={{ padding: '6px 0', borderBottom: '1px solid #f0f0ee', fontSize: 12 }}>
                      <strong>{r.guest_name_snapshot}</strong>
                      {r.actual_guest_count > 1 && <span style={{ color: '#666' }}> (실제 {r.actual_guest_count}명{r.companion_names ? `, 동반: ${r.companion_names}` : ''})</span>}
                      <span style={{ color: '#999', marginLeft: 8 }}>
                        {r.project_name_snapshot || '(비프로젝트)'} · {r.hotel_name_snapshot} · {r.room_type} · {formatStayPeriod(r.check_in, r.check_out)}
                      </span>
                      {canWrite && (
                        <>
                          <button onClick={() => setFormModal({ record: r })} style={{ ...miniBtn, marginLeft: 8 }}>수정</button>
                          <button onClick={() => handleDelete(r)} style={{ ...miniBtn, marginLeft: 4, color: '#b91c1c' }}>삭제</button>
                        </>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        ) : tab === 'list' ? (
          <LodgingListTable
            records={records}
            canWrite={canWrite}
            onEdit={r => setFormModal({ record: r })}
            onDelete={handleDelete}
          />
        ) : (
          <LodgingSummaryPanel year={viewYear} month={viewMonth} occupancy={occupancy} financial={financial} />
        )}
      </div>

      {formModal && (
        <LodgingFormModal
          record={formModal.record}
          existingRecords={records}
          guestCandidates={guestDirectory}
          projects={projects}
          hotels={hotels}
          fallbackPeriod={monthRangeInclusive(viewYear, viewMonth)}
          currentUserEmail={currentUserEmail}
          onClose={() => setFormModal(null)}
          onSaved={handleSaved}
          onToast={showToast}
        />
      )}

      {hotelModalOpen && (
        <HotelMasterModal hotels={hotels} onClose={() => setHotelModalOpen(false)} onChange={loadHotels} />
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 30, left: '50%', transform: 'translateX(-50%)', background: '#111', color: '#fff', fontSize: 13, padding: '9px 18px', borderRadius: 8, zIndex: 500, boxShadow: '0 8px 24px rgba(0,0,0,0.2)' }}>
          {toast}
        </div>
      )}
    </div>
  )
}

function ExportMenu({ year, month }: { year: number; month: number }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  async function download(kind: 'record-list' | 'monthly-summary', format: 'xlsx' | 'pdf') {
    if (busy) return
    setBusy(true)
    setOpen(false)
    try {
      const res = await fetch('/api/lodging/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, format, year, month }),
      })
      if (!res.ok) throw new Error(await res.text())
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `숙박관리_${kind}_${year}${String(month).padStart(2, '0')}.${format}`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      alert('출력에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen(v => !v)} style={outlineBtn} disabled={busy}>출력 ▾</button>
      {open && (
        <div style={{ position: 'absolute', top: '100%', right: 0, background: '#fff', border: '1px solid #e8e8e6', borderRadius: 6, marginTop: 4, zIndex: 20, boxShadow: '0 4px 12px rgba(0,0,0,0.08)', minWidth: 180 }}>
          {[
            { kind: 'record-list' as const, label: '숙박 내역' },
            { kind: 'monthly-summary' as const, label: '월별 정산서' },
          ].map(({ kind, label }) => (
            <div key={kind} style={{ padding: '6px 10px', borderBottom: '1px solid #f0f0ee' }}>
              <div style={{ fontSize: 11, color: '#999', marginBottom: 2 }}>{label}</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => download(kind, 'xlsx')} style={miniBtn}>Excel</button>
                <button onClick={() => download(kind, 'pdf')} style={miniBtn}>PDF</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const navBtn: React.CSSProperties = { border: 'none', background: 'none', cursor: 'pointer', color: '#888', fontSize: 16, padding: '2px 8px', borderRadius: 4 }
const outlineBtn: React.CSSProperties = { border: '1px solid #e8e8e6', background: '#fff', borderRadius: 6, padding: '8px 14px', fontSize: 12, cursor: 'pointer', color: '#333' }
const tabBtn: React.CSSProperties = { border: '1px solid #e8e8e6', background: '#fff', borderRadius: 6, padding: '7px 14px', fontSize: 12, cursor: 'pointer', color: '#666' }
const tabBtnActive: React.CSSProperties = { ...tabBtn, background: '#111', color: '#fff', borderColor: '#111' }
const miniBtn: React.CSSProperties = { border: '1px solid #e8e8e6', background: '#fff', borderRadius: 4, padding: '3px 8px', fontSize: 11, cursor: 'pointer' }
