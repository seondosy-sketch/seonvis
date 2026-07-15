'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { useIsMobile } from '@/lib/useIsMobile'
import {
  AnnualLeaveBalance, Holiday, LeaveEmployee, LeaveRecord, LeaveRecordDate, LeaveType,
} from '@/lib/leave/types'
import { monthlySums, sumDeducted } from '@/lib/leave/calc'
import { useMenuPermission } from '@/app/components/PermissionsProvider'
import LeaveYearTable from './_components/LeaveYearTable'
import LeaveRecordModal from './_components/LeaveRecordModal'
import BalanceManagerModal from './_components/BalanceManagerModal'
import HolidayManagerModal from './_components/HolidayManagerModal'
import LeaveTypeManagerModal from './_components/LeaveTypeManagerModal'
import MonthCellPopover from './_components/MonthCellPopover'
import EmployeeLeaveHistory from './_components/EmployeeLeaveHistory'

export default function LeavePage() {
  const isMobile = useIsMobile()
  const supabase = createSupabaseBrowserClient()
  // 읽기 권한 사용자는 현황 조회만 — 등록/설정 모달 진입과 이력 수정/삭제를 막는다
  const canWrite = useMenuPermission('leave') === 'write'

  const [year, setYear] = useState(new Date().getFullYear())
  const [employees, setEmployees] = useState<LeaveEmployee[]>([])
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([])
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [balances, setBalances] = useState<AnnualLeaveBalance[]>([])
  const [records, setRecords] = useState<LeaveRecord[]>([])
  const [recordDates, setRecordDates] = useState<LeaveRecordDate[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [positionFilter, setPositionFilter] = useState('전체')
  const [activeOnly, setActiveOnly] = useState(true)
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null)

  const [recordModal, setRecordModal] = useState<{ open: boolean; edit: LeaveRecord | null }>({ open: false, edit: null })
  const [showBalanceManager, setShowBalanceManager] = useState(false)
  const [showHolidayManager, setShowHolidayManager] = useState(false)
  const [showTypeManager, setShowTypeManager] = useState(false)
  const [cellPopover, setCellPopover] = useState<{ employeeId: string; month: number; anchor: { x: number; y: number } } | null>(null)

  const loadStatic = useCallback(async () => {
    const [empRes, typeRes, holRes] = await Promise.all([
      supabase.from('overtime_employees').select('*').order('sort_order', { ascending: true }),
      supabase.from('leave_types').select('*').order('sort_order', { ascending: true }),
      supabase.from('holidays').select('*').order('holiday_date', { ascending: true }),
    ])
    if (empRes.error) {
      setLoadError('데이터를 불러올 수 없습니다. supabase/migration_leave.sql이 적용되었는지 확인하세요.')
      return
    }
    setLoadError(null)
    setEmployees(empRes.data as LeaveEmployee[])
    if (typeRes.data) setLeaveTypes(typeRes.data as LeaveType[])
    if (holRes.data) setHolidays(holRes.data as Holiday[])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadYearData = useCallback(async (y: number) => {
    setLoading(true)
    // 연도 걸침 휴가도 포함되도록 "기간이 그 해와 겹치는" 휴가를 가져오고,
    // 날짜별 전개는 record id 기준으로 가져온 뒤 집계 시 그 해 날짜만 쓴다.
    const [balRes, recRes] = await Promise.all([
      supabase.from('annual_leave_balances').select('*').eq('year', y),
      supabase.from('leave_records').select('*')
        .gte('end_date', `${y}-01-01`).lte('start_date', `${y}-12-31`)
        .order('start_date', { ascending: false }),
    ])
    if (balRes.data) setBalances(balRes.data as AnnualLeaveBalance[])
    const recs = (recRes.data ?? []) as LeaveRecord[]
    setRecords(recs)
    if (recs.length > 0) {
      const { data: dates } = await supabase.from('leave_record_dates').select('*')
        .in('leave_record_id', recs.map(r => r.id))
      setRecordDates((dates ?? []) as LeaveRecordDate[])
    } else {
      setRecordDates([])
    }
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { loadStatic() }, [loadStatic])
  useEffect(() => { loadYearData(year) }, [year, loadYearData])

  const reloadAll = useCallback(() => { loadStatic(); loadYearData(year) }, [loadStatic, loadYearData, year])

  // record id → employee_id (dates에는 employee_id를 중복 저장하지 않으므로 join)
  const employeeByRecord = useMemo(() => new Map(records.map(r => [r.id, r.employee_id])), [records])

  // 이 해에 속한 날짜만으로 집계 (연도 걸침 휴가의 타 연도 날짜 제외)
  const yearDates = useMemo(() =>
    recordDates
      .filter(d => d.leave_date.slice(0, 4) === String(year))
      .map(d => ({ ...d, employee_id: employeeByRecord.get(d.leave_record_id) ?? '' })),
  [recordDates, employeeByRecord, year])

  const monthly = useMemo(() => monthlySums(yearDates), [yearDates])
  const usedByEmployee = useMemo(() => {
    const map = new Map<string, number>()
    for (const [empId, arr] of monthly) map.set(empId, sumDeducted(arr.map(v => ({ deducted_days: v }))))
    return map
  }, [monthly])

  const balanceByEmployee = useMemo(() => new Map(balances.map(b => [b.employee_id, b])), [balances])

  const positions = useMemo(() =>
    ['전체', ...Array.from(new Set(employees.map(e => e.position).filter(Boolean)))],
  [employees])

  const visibleEmployees = useMemo(() => employees.filter(e => {
    if (activeOnly && !e.is_active) return false
    if (positionFilter !== '전체' && e.position !== positionFilter) return false
    if (search && !e.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  }), [employees, activeOnly, positionFilter, search])

  const selectedEmployee = employees.find(e => e.id === selectedEmployeeId) ?? null

  return (
    <div style={{ minHeight: '100vh', background: '#f8f8f7' }}>
      <header style={{ background: '#fff', borderBottom: '1px solid #e8e8e6' }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', padding: isMobile ? '0 12px' : '0 24px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 14, color: '#555' }}>휴가관리</span>
          <div style={{ display: 'flex', gap: 8 }}>
            {canWrite && <button onClick={() => setShowHolidayManager(true)} style={outlineBtn}>공휴일 관리</button>}
            {canWrite && <button onClick={() => setShowTypeManager(true)} style={outlineBtn}>휴가 유형</button>}
            {canWrite && <button onClick={() => setShowBalanceManager(true)} style={outlineBtn}>연차 설정</button>}
            {canWrite && <button onClick={() => setRecordModal({ open: true, edit: null })} style={primaryBtn}>+ 휴가 추가</button>}
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1400, margin: '0 auto', padding: isMobile ? '12px 12px 60px' : '20px 24px 60px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button onClick={() => setYear(y => y - 1)} style={navBtn}>‹</button>
            <span style={{ fontSize: 14, fontWeight: 600, minWidth: 90, textAlign: 'center', color: '#111' }}>{year}년 휴가관리</span>
            <button onClick={() => setYear(y => y + 1)} style={navBtn}>›</button>
          </div>
          {loading && <span style={{ fontSize: 11, color: '#bbb' }}>불러오는 중...</span>}
          <div style={{ flex: 1 }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="직원명 검색..."
            style={{ width: 160, height: 32, padding: '0 10px', border: '1px solid #e8e8e6', borderRadius: 6, fontSize: 12, background: '#fff' }} />
          <select value={positionFilter} onChange={e => setPositionFilter(e.target.value)}
            style={{ height: 32, padding: '0 8px', border: '1px solid #e8e8e6', borderRadius: 6, fontSize: 12, background: '#fff' }}>
            {positions.map(p => <option key={p}>{p}</option>)}
          </select>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#555', cursor: 'pointer' }}>
            <input type="checkbox" checked={activeOnly} onChange={e => setActiveOnly(e.target.checked)} />
            재직자만
          </label>
        </div>

        {loadError && (
          <div style={{ marginBottom: 12, padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, color: '#b91c1c' }}>
            {loadError}
          </div>
        )}

        <LeaveYearTable
          employees={visibleEmployees}
          balances={balanceByEmployee}
          monthly={monthly}
          used={usedByEmployee}
          selectedEmployeeId={selectedEmployeeId}
          onRowClick={id => setSelectedEmployeeId(cur => (cur === id ? null : id))}
          onCellClick={(employeeId, month, anchor) => setCellPopover({ employeeId, month, anchor })}
        />

        {selectedEmployee && (
          <EmployeeLeaveHistory
            year={year}
            employee={selectedEmployee}
            balance={balanceByEmployee.get(selectedEmployee.id) ?? null}
            used={usedByEmployee.get(selectedEmployee.id) ?? 0}
            records={records.filter(r => r.employee_id === selectedEmployee.id)}
            leaveTypes={leaveTypes}
            readOnly={!canWrite}
            onEdit={rec => setRecordModal({ open: true, edit: rec })}
            onChanged={() => loadYearData(year)}
          />
        )}
      </div>

      {cellPopover && (() => {
        const emp = employees.find(e => e.id === cellPopover.employeeId)
        if (!emp) return null
        const cellRecordIds = new Set(
          yearDates
            .filter(d => d.employee_id === emp.id && parseInt(d.leave_date.slice(5, 7), 10) === cellPopover.month)
            .map(d => d.leave_record_id)
        )
        return (
          <MonthCellPopover
            employee={emp}
            year={year}
            month={cellPopover.month}
            records={records.filter(r => cellRecordIds.has(r.id))}
            dates={recordDates.filter(d => cellRecordIds.has(d.leave_record_id))}
            leaveTypes={leaveTypes}
            anchor={cellPopover.anchor}
            onClose={() => setCellPopover(null)}
          />
        )
      })()}

      {recordModal.open && (
        <LeaveRecordModal
          employees={employees}
          leaveTypes={leaveTypes}
          holidays={holidays}
          balances={balanceByEmployee}
          used={usedByEmployee}
          edit={recordModal.edit}
          onClose={() => setRecordModal({ open: false, edit: null })}
          onSaved={() => { setRecordModal({ open: false, edit: null }); loadYearData(year) }}
        />
      )}

      {showBalanceManager && (
        <BalanceManagerModal
          year={year}
          employees={employees}
          balances={balances}
          used={usedByEmployee}
          onClose={() => setShowBalanceManager(false)}
          onChange={reloadAll}
        />
      )}

      {showHolidayManager && (
        <HolidayManagerModal
          initialYear={year}
          holidays={holidays}
          onClose={() => setShowHolidayManager(false)}
          onChange={loadStatic}
        />
      )}

      {showTypeManager && (
        <LeaveTypeManagerModal onClose={() => setShowTypeManager(false)} onChange={loadStatic} />
      )}
    </div>
  )
}

const navBtn: React.CSSProperties = { border: 'none', background: 'none', cursor: 'pointer', color: '#888', fontSize: 16, padding: '2px 8px', borderRadius: 4 }
const outlineBtn: React.CSSProperties = { height: 34, padding: '0 14px', borderRadius: 6, border: '1px solid #e8e8e6', background: '#fff', color: '#333', fontSize: 13, cursor: 'pointer' }
const primaryBtn: React.CSSProperties = { height: 34, padding: '0 14px', borderRadius: 6, border: 'none', background: '#111', color: '#fff', fontSize: 13, cursor: 'pointer' }
