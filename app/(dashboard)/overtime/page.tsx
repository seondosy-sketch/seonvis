'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { useIsMobile } from '@/lib/useIsMobile'
import { DailySummary, Employee, EmployeeTask, Project, ProjectMember, WorkRecord } from '@/lib/overtime/types'
import { currentPayPeriod, payPeriodDays, payPeriodRange, summarizeByEmployeeAndDate, summaryKey } from '@/lib/overtime/summary'
import MonthGrid from './_components/MonthGrid'
import ProjectGrid from './_components/ProjectGrid'
import OvertimeEntryPopover from './_components/OvertimeEntryPopover'
import WorkRecordModal from './_components/WorkRecordModal'
import BulkWorkRecordModal from './_components/BulkWorkRecordModal'
import ProjectManagerModal from './_components/ProjectManagerModal'
import EmployeeManagerModal from './_components/EmployeeManagerModal'

const MONTH_NAMES = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월']

export default function OvertimePage() {
  const isMobile = useIsMobile()
  const supabase = createSupabaseBrowserClient()

  const initialPeriod = currentPayPeriod()
  const [viewYear, setViewYear] = useState(initialPeriod.year)
  const [viewMonth, setViewMonth] = useState(initialPeriod.month)

  const [employees, setEmployees] = useState<Employee[]>([])
  const [employeesLoading, setEmployeesLoading] = useState(true)
  const [employeesError, setEmployeesError] = useState<string | null>(null)

  const [summaries, setSummaries] = useState<Map<string, DailySummary>>(new Map())
  const [records, setRecords] = useState<WorkRecord[]>([])
  const [recordsLoading, setRecordsLoading] = useState(true)
  const [recordsError, setRecordsError] = useState<string | null>(null)

  const [projects, setProjects] = useState<Project[]>([])
  const [members, setMembers] = useState<ProjectMember[]>([])
  // 기본은 프로젝트별 보기 — "프로젝트별 담당직원을 나열해 기간 내 근무시간을 입력"하는 흐름이 주 사용처.
  // 직원별 총합 보기(MonthGrid)도 토글로 유지한다.
  const [view, setView] = useState<'project' | 'employee'>('project')
  // 직원별 보기(MonthGrid) 셀 클릭 → 기존 WorkRecordModal (그 날짜의 전체 프로젝트 기록)
  const [selectedCell, setSelectedCell] = useState<{ employeeId: string; date: string; projectId?: string } | null>(null)
  // 프로젝트별 보기(ProjectGrid) 셀 클릭 → 팝오버 입력창 (셀 근처에 뜨는 작은 창)
  const [popoverCell, setPopoverCell] = useState<{ employeeId: string; projectId: string; date: string; anchor: { x: number; y: number } } | null>(null)
  const [employeeTasks, setEmployeeTasks] = useState<EmployeeTask[]>([])
  const [showProjectManager, setShowProjectManager] = useState(false)
  const [showEmployeeManager, setShowEmployeeManager] = useState(false)
  const [showBulkEntry, setShowBulkEntry] = useState(false)

  const loadEmployees = useCallback(async () => {
    setEmployeesLoading(true)
    // 기본업무내용(employeeTasks)은 팝오버 입력창의 업무내용 드롭다운 선택지 — 직원과 함께 불러온다
    const [empRes, taskRes] = await Promise.all([
      supabase.from('overtime_employees').select('*').eq('is_active', true).order('sort_order', { ascending: true }),
      supabase.from('overtime_employee_tasks').select('*').order('sort_order', { ascending: true }),
    ])

    if (empRes.error) {
      setEmployeesError('직원 목록을 불러올 수 없습니다. supabase/migration_overtime.sql이 적용되었는지 확인하세요.')
      setEmployees([])
    } else {
      setEmployeesError(null)
      setEmployees(empRes.data as Employee[])
    }
    if (taskRes.data) setEmployeeTasks(taskRes.data as EmployeeTask[])
    setEmployeesLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadRecords = useCallback(async (year: number, month: number) => {
    setRecordsLoading(true)
    const { start, end } = payPeriodRange(year, month)
    const { data, error } = await supabase
      .from('overtime_work_records')
      .select('*')
      .gte('work_date', start)
      .lte('work_date', end)

    if (error) {
      setRecordsError('연장근무 기록을 불러올 수 없습니다. supabase/migration_overtime.sql이 적용되었는지 확인하세요.')
      setRecords([])
      setSummaries(new Map())
    } else {
      setRecordsError(null)
      setRecords(data as WorkRecord[])
      setSummaries(summarizeByEmployeeAndDate(data as WorkRecord[]))
    }
    setRecordsLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadProjects = useCallback(async () => {
    // 종료된 프로젝트도 과거 기록에서 이름을 보여줘야 하므로 status로 거르지 않고 전체를 가져온다.
    // 담당직원 배정(members)은 프로젝트별 그리드의 행 구성에 쓰이므로 함께 불러온다.
    const [projRes, memRes] = await Promise.all([
      supabase.from('overtime_projects').select('*').order('sort_order', { ascending: true }),
      supabase.from('overtime_project_members').select('*'),
    ])
    if (projRes.data) setProjects(projRes.data as Project[])
    if (memRes.data) setMembers(memRes.data as ProjectMember[])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { loadEmployees() }, [loadEmployees])
  useEffect(() => { loadRecords(viewYear, viewMonth) }, [viewYear, viewMonth, loadRecords])
  useEffect(() => { loadProjects() }, [loadProjects])

  const days = payPeriodDays(viewYear, viewMonth)
  const periodLabel = `${days[0].month + 1}/${days[0].day} ~ ${days[days.length - 1].month + 1}/${days[days.length - 1].day}`

  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11) }
    else setViewMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0) }
    else setViewMonth(m => m + 1)
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f8f8f7' }}>
      <header style={{ background: '#fff', borderBottom: '1px solid #e8e8e6' }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', padding: isMobile ? '0 12px' : '0 24px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 14, color: '#555' }}>연장근무</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <Link href="/overtime/dashboard" style={{ textDecoration: 'none' }}>
              <span style={{ ...outlineBtn, display: 'inline-flex', alignItems: 'center' }}>대시보드</span>
            </Link>
            <Link href="/overtime/print" style={{ textDecoration: 'none' }}>
              <span style={{ ...outlineBtn, display: 'inline-flex', alignItems: 'center' }}>출력</span>
            </Link>
            <button onClick={() => setShowBulkEntry(true)} style={outlineBtn}>일괄 입력</button>
            <button onClick={() => setShowEmployeeManager(true)} style={outlineBtn}>직원 관리</button>
            <button onClick={() => setShowProjectManager(true)} style={outlineBtn}>프로젝트 관리</button>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1400, margin: '0 auto', padding: isMobile ? '12px 12px 60px' : '20px 24px 60px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, marginBottom: 12, position: 'relative' }}>
          <button onClick={prevMonth} style={navBtn}>‹</button>
          <span style={{ fontSize: 14, fontWeight: 600, minWidth: 100, textAlign: 'center', color: '#111' }}>
            {viewYear}년 {MONTH_NAMES[viewMonth]}
          </span>
          <button onClick={nextMonth} style={navBtn}>›</button>
          <span style={{ fontSize: 12, color: '#999' }}>({periodLabel})</span>
          {recordsLoading && !employeesLoading && (
            <span style={{ fontSize: 11, color: '#bbb', marginLeft: 8 }}>집계 불러오는 중...</span>
          )}
          <div style={{ position: 'absolute', right: 0, display: 'flex', border: '1px solid #e8e8e6', borderRadius: 6, overflow: 'hidden' }}>
            <button onClick={() => setView('project')} style={view === 'project' ? viewBtnActive : viewBtn}>프로젝트별</button>
            <button onClick={() => setView('employee')} style={view === 'employee' ? viewBtnActive : viewBtn}>직원별</button>
          </div>
        </div>

        {(employeesError || recordsError) && (
          <div style={{ marginBottom: 12, padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, color: '#b91c1c' }}>
            {employeesError || recordsError}
          </div>
        )}

        {employeesLoading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#bbb', fontSize: 13 }}>불러오는 중...</div>
        ) : view === 'project' ? (
          <ProjectGrid
            days={days}
            projects={projects}
            employees={employees}
            members={members}
            records={records}
            onCellClick={(employeeId, projectId, date, anchor) => setPopoverCell({ employeeId, projectId, date, anchor })}
          />
        ) : (
          <MonthGrid
            days={days}
            employees={employees}
            summaries={summaries}
            onCellClick={(employeeId, date) => setSelectedCell({ employeeId, date })}
          />
        )}
      </div>

      {popoverCell && (() => {
        const popProject = projects.find(p => p.id === popoverCell.projectId)
        const popEmployee = employees.find(e => e.id === popoverCell.employeeId)
        if (!popProject || !popEmployee) return null
        return (
          <OvertimeEntryPopover
            project={popProject}
            employee={popEmployee}
            date={popoverCell.date}
            records={records.filter(r =>
              r.employee_id === popoverCell.employeeId &&
              r.project_id === popoverCell.projectId &&
              r.work_date === popoverCell.date
            )}
            tasks={employeeTasks.filter(t => t.employee_id === popoverCell.employeeId)}
            anchor={popoverCell.anchor}
            onClose={() => setPopoverCell(null)}
            onSaved={() => loadRecords(viewYear, viewMonth)}
          />
        )
      })()}

      {selectedCell && (
        <WorkRecordModal
          employeeId={selectedCell.employeeId}
          date={selectedCell.date}
          employeeName={employees.find(e => e.id === selectedCell.employeeId)?.name ?? ''}
          summary={summaries.get(summaryKey(selectedCell.employeeId, selectedCell.date))}
          projects={projects}
          defaultProjectId={selectedCell.projectId}
          onClose={() => setSelectedCell(null)}
          onSaved={() => loadRecords(viewYear, viewMonth)}
        />
      )}

      {showBulkEntry && (
        <BulkWorkRecordModal
          employees={employees}
          projects={projects.filter(p => p.status === '진행중')}
          days={days}
          onClose={() => setShowBulkEntry(false)}
          onSaved={() => loadRecords(viewYear, viewMonth)}
        />
      )}

      {showEmployeeManager && (
        <EmployeeManagerModal onClose={() => setShowEmployeeManager(false)} onChange={loadEmployees} />
      )}

      {showProjectManager && (
        <ProjectManagerModal onClose={() => setShowProjectManager(false)} onChange={loadProjects} />
      )}
    </div>
  )
}

const navBtn: React.CSSProperties = { border: 'none', background: 'none', cursor: 'pointer', color: '#888', fontSize: 16, padding: '2px 8px', borderRadius: 4 }
const outlineBtn: React.CSSProperties = { height: 34, padding: '0 14px', borderRadius: 6, border: '1px solid #e8e8e6', background: '#fff', color: '#333', fontSize: 13, cursor: 'pointer' }
const viewBtn: React.CSSProperties = { height: 30, padding: '0 12px', border: 'none', background: '#fff', color: '#555', fontSize: 12, cursor: 'pointer' }
const viewBtnActive: React.CSSProperties = { ...viewBtn, background: '#111', color: '#fff' }
