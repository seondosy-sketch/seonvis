'use client'

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { useIsMobile } from '@/lib/useIsMobile'
import { useMenuPermission } from '@/app/components/PermissionsProvider'
import {
  currentPayPeriodLabel,
  getPayPeriodForLabel,
  getPayPeriodRangeForLabel,
} from '@/lib/attendance/period'
import type { AttendanceRecord, ProjectParticipant } from '@/lib/attendance/types'
import { findRecord, presentCountByParticipant } from '@/lib/attendance/summary'
import { attendanceRecordErrorMessage, filterParticipantRows, filterVisibleProjects } from '@/lib/attendance/gridFilters'
import type { EngineerContact, EngineerSpecialty } from '@/lib/engineers/types'
import type { AttendanceProjectRow } from './types'
import AttendanceGrid from './_components/AttendanceGrid'
import ParticipantManagerModal from './_components/ParticipantManagerModal'

const MONTH_NAMES = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월']
const STATUS_OPTIONS = ['전체', '진행중', '수주', '탈락', '취소']

const PROJECT_COLUMNS =
  'id,project_number,name,announce_date,interview_date,status,director,staff_arch,staff_civil,staff_mech,staff_safety'

export default function AttendancePage() {
  const isMobile = useIsMobile()
  const supabase = createSupabaseBrowserClient()
  // 읽기 권한 사용자는 조회만 — 출근 체크·참여기술인 관리를 막는다(기존 페이지들과 동일한 규칙)
  const canWrite = useMenuPermission('attendance') === 'write'

  const initialPeriod = currentPayPeriodLabel()
  const [viewYear, setViewYear] = useState(initialPeriod.year)
  const [viewPeriodMonth, setViewPeriodMonth] = useState(initialPeriod.periodMonth)

  const [currentUserEmail, setCurrentUserEmail] = useState('')

  const [projects, setProjects] = useState<AttendanceProjectRow[]>([])
  const [projectsLoading, setProjectsLoading] = useState(true)
  const [projectsError, setProjectsError] = useState<string | null>(null)

  const [participants, setParticipants] = useState<ProjectParticipant[]>([])
  const [participantsLoading, setParticipantsLoading] = useState(true)

  const [engineers, setEngineers] = useState<EngineerContact[]>([])
  const [specialties, setSpecialties] = useState<EngineerSpecialty[]>([])

  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [recordsLoading, setRecordsLoading] = useState(true)
  const [recordsError, setRecordsError] = useState<string | null>(null)
  // 월을 빠르게 여러 번 넘겼을 때 늦게 도착한 이전 요청이 최신 월 데이터를 덮어쓰지 않도록,
  // 매 요청마다 증가시키는 순번으로 "지금 보고 있는 월의 응답이 맞는지"를 확인한다.
  const recordsRequestRef = useRef(0)

  const [pendingCells, setPendingCells] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState<string | null>(null)

  const [projectSearch, setProjectSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('전체')
  const [specialtyFilter, setSpecialtyFilter] = useState('전체')
  const [engineerSearch, setEngineerSearch] = useState('')

  const [managingProject, setManagingProject] = useState<AttendanceProjectRow | null>(null)

  // 입력자/수정자는 클라이언트 입력값이 아니라 현재 로그인 세션에서만 가져온다(서비스 키 사용 안 함)
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setCurrentUserEmail(data.user?.email ?? ''))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadProjects = useCallback(() => {
    supabase
      .from('projects')
      .select(PROJECT_COLUMNS)
      .order('project_number', { ascending: false })
      .then(({ data, error }) => {
        if (error) {
          setProjectsError('프로젝트 목록을 불러올 수 없습니다.')
          setProjects([])
        } else {
          setProjectsError(null)
          setProjects((data ?? []) as AttendanceProjectRow[])
        }
        setProjectsLoading(false)
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadParticipants = useCallback(() => {
    supabase.from('project_participants').select('*').order('sort_order', { ascending: true }).then(({ data }) => {
      setParticipants((data ?? []) as ProjectParticipant[])
      setParticipantsLoading(false)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadEngineersAndSpecialties = useCallback(() => {
    Promise.all([
      supabase.from('engineer_contacts').select('*').order('name', { ascending: true }).limit(5000),
      supabase.from('engineer_specialties').select('*').order('sort_order', { ascending: true }),
    ]).then(([engRes, specRes]) => {
      if (engRes.data) setEngineers(engRes.data as EngineerContact[])
      if (specRes.data) setSpecialties(specRes.data as EngineerSpecialty[])
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadRecords = useCallback((year: number, periodMonth: number) => {
    const requestId = ++recordsRequestRef.current
    const { start, end } = getPayPeriodRangeForLabel(year, periodMonth)
    supabase
      .from('attendance_records')
      .select('*')
      .gte('work_date', start)
      .lte('work_date', end)
      .then(({ data, error }) => {
        if (requestId !== recordsRequestRef.current) return // 이 응답이 온 사이 다른 월 요청이 또 발생함 — 늦게 온 응답은 버린다
        if (error) {
          setRecordsError('출근기록을 불러올 수 없습니다.')
          setRecords([])
        } else {
          setRecordsError(null)
          setRecords((data ?? []) as AttendanceRecord[])
        }
        setRecordsLoading(false)
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { loadProjects() }, [loadProjects])
  useEffect(() => { loadParticipants() }, [loadParticipants])
  useEffect(() => { loadEngineersAndSpecialties() }, [loadEngineersAndSpecialties])
  useEffect(() => {
    // 월이 바뀐 순간 즉시 "불러오는 중" 상태로 전환 — 새 응답이 오기 전까지 이전 달 표를 감춘다.
    startTransition(() => setRecordsLoading(true))
    loadRecords(viewYear, viewPeriodMonth)
  }, [viewYear, viewPeriodMonth, loadRecords])

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2000)
  }, [])

  const days = useMemo(() => getPayPeriodForLabel(viewYear, viewPeriodMonth), [viewYear, viewPeriodMonth])
  const { start: periodStart, end: periodEnd } = useMemo(
    () => getPayPeriodRangeForLabel(viewYear, viewPeriodMonth),
    [viewYear, viewPeriodMonth],
  )

  const prevMonth = () => {
    if (viewPeriodMonth === 1) { setViewYear(y => y - 1); setViewPeriodMonth(12) }
    else setViewPeriodMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (viewPeriodMonth === 12) { setViewYear(y => y + 1); setViewPeriodMonth(1) }
    else setViewPeriodMonth(m => m + 1)
  }

  const engineersById = useMemo(() => new Map(engineers.map(e => [e.id, e])), [engineers])
  const specialtiesById = useMemo(() => new Map(specialties.map(s => [s.id, s])), [specialties])
  const presentCounts = useMemo(() => presentCountByParticipant(records), [records])

  // 표시할 프로젝트: (공고일~면접일이 이 기간과 겹침) + (이 기간에 참여기술인 또는 출근기록이 있음).
  // 겹침 조건만 쓰면 이미 끝난 프로젝트의 과거 마감(추후 단계) 기록이 화면에서 사라져 보인다.
  const projectIdsWithActiveParticipants = useMemo(
    () => new Set(participants.filter(p => p.status === '진행중').map(p => p.project_id)),
    [participants],
  )
  const projectIdsWithRecords = useMemo(() => new Set(records.map(r => r.project_id)), [records])

  const specialtyNameById = useMemo(() => new Map(specialties.map(s => [s.id, s.name])), [specialties])
  const engineerNameById = useMemo(() => new Map(engineers.map(e => [e.id, e.name])), [engineers])
  const hasParticipantFilter = specialtyFilter !== '전체' || !!engineerSearch.trim()

  function rowParticipants(projectId: string): ProjectParticipant[] {
    const recordedParticipantIds = new Set(records.filter(r => r.project_id === projectId).map(r => r.participant_id))
    return filterParticipantRows({
      participants, projectId, recordedParticipantIds,
      specialtyFilter, specialtyNameById, engineerSearch, engineerNameById,
    })
  }

  const visibleProjects = useMemo(() => filterVisibleProjects({
    projects,
    periodStart,
    periodEnd,
    statusFilter,
    search: projectSearch,
    projectIdsWithActiveParticipants,
    projectIdsWithRecords,
    rowParticipantCount: projectId => rowParticipants(projectId).length,
    hasParticipantFilter,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [projects, participants, records, projectSearch, statusFilter, specialtyFilter, engineerSearch, periodStart, periodEnd])

  async function toggleCell(participant: ProjectParticipant, project: AttendanceProjectRow, dateStr: string) {
    if (!canWrite) return
    const key = `${participant.id}__${dateStr}`
    if (pendingCells.has(key)) return // 중복 클릭/빠른 연속 클릭 방지
    setPendingCells(prev => new Set(prev).add(key))

    const existing = findRecord(records, participant.id, dateStr)
    if (existing) {
      const { error } = await supabase.from('attendance_records').delete().eq('id', existing.id)
      if (error) {
        showToast(attendanceRecordErrorMessage('delete', error.code))
      } else {
        setRecords(prev => prev.filter(r => r.id !== existing.id))
      }
    } else {
      const { data, error } = await supabase
        .from('attendance_records')
        .insert({
          project_id: project.id,
          engineer_id: participant.engineer_id,
          participant_id: participant.id,
          work_date: dateStr,
          created_by: currentUserEmail,
          updated_by: currentUserEmail,
        })
        .select()
        .single()
      if (error) {
        showToast(attendanceRecordErrorMessage('insert', error.code))
      } else if (data) {
        setRecords(prev => [...prev, data as AttendanceRecord])
      }
    }

    setPendingCells(prev => {
      const next = new Set(prev)
      next.delete(key)
      return next
    })
  }

  const periodLabel = `${days[0].month + 1}/${days[0].day} ~ ${days[days.length - 1].month + 1}/${days[days.length - 1].day}`
  // recordsLoading도 이 게이트에 포함시켜, 월을 바꾼 직후 이전 달의 records가 새 달의 날짜 열과
  // 함께 잠깐이라도 보이는 일이 없게 한다(표를 아예 숨기고 로딩 표시로 대체).
  const loading = projectsLoading || participantsLoading || recordsLoading

  return (
    <div style={{ minHeight: '100vh', background: '#f8f8f7' }}>
      <header style={{ background: '#fff', borderBottom: '1px solid #e8e8e6' }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', padding: isMobile ? '0 12px' : '0 24px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 14, color: '#555' }}>기술인 출근부</span>
        </div>
      </header>

      <div style={{ maxWidth: 1400, margin: '0 auto', padding: isMobile ? '12px 12px 60px' : '20px 24px 60px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, marginBottom: 12 }}>
          <button onClick={prevMonth} style={navBtn}>‹</button>
          <span style={{ fontSize: 14, fontWeight: 600, minWidth: 100, textAlign: 'center', color: '#111' }}>
            {viewYear}년 {MONTH_NAMES[viewPeriodMonth - 1]}
          </span>
          <button onClick={nextMonth} style={navBtn}>›</button>
          <span style={{ fontSize: 12, color: '#999' }}>({periodLabel})</span>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12, alignItems: 'center' }}>
          <input
            value={projectSearch}
            onChange={e => setProjectSearch(e.target.value)}
            placeholder="프로젝트 검색"
            style={{ ...inp, width: 180 }}
          />
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={sel}>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={specialtyFilter} onChange={e => setSpecialtyFilter(e.target.value)} style={sel}>
            <option value="전체">분야 전체</option>
            {specialties.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
          </select>
          <input
            value={engineerSearch}
            onChange={e => setEngineerSearch(e.target.value)}
            placeholder="기술인 검색"
            style={{ ...inp, width: 140 }}
          />
        </div>

        {(projectsError || recordsError) && (
          <div style={{ marginBottom: 12, padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, color: '#b91c1c' }}>
            {projectsError || recordsError}
          </div>
        )}

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#bbb', fontSize: 13 }}>불러오는 중...</div>
        ) : (
          <AttendanceGrid
            days={days}
            projects={visibleProjects}
            getRowParticipants={rowParticipants}
            engineersById={engineersById}
            specialtiesById={specialtiesById}
            records={records}
            presentCounts={presentCounts}
            pendingCells={pendingCells}
            editable={canWrite}
            onToggleCell={toggleCell}
            onManageProject={project => setManagingProject(project)}
          />
        )}
      </div>

      {managingProject && (
        <ParticipantManagerModal
          project={managingProject}
          participants={participants.filter(p => p.project_id === managingProject.id)}
          engineers={engineers}
          specialties={specialties}
          onClose={() => setManagingProject(null)}
          onChange={loadParticipants}
          onToast={showToast}
        />
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 30, left: '50%', transform: 'translateX(-50%)', background: '#111', color: '#fff', fontSize: 13, padding: '9px 18px', borderRadius: 8, zIndex: 500, boxShadow: '0 8px 24px rgba(0,0,0,0.2)' }}>
          {toast}
        </div>
      )}
    </div>
  )
}

const navBtn: React.CSSProperties = { border: 'none', background: 'none', cursor: 'pointer', color: '#888', fontSize: 16, padding: '2px 8px', borderRadius: 4 }
const inp: React.CSSProperties = { height: 34, padding: '0 10px', border: '1px solid #e8e8e6', borderRadius: 6, fontSize: 13, background: '#fff', boxSizing: 'border-box' }
const sel: React.CSSProperties = { height: 34, padding: '0 10px', border: '1px solid #e8e8e6', borderRadius: 6, fontSize: 12, background: '#fff', color: '#555' }
