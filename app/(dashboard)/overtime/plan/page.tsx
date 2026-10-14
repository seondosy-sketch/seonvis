'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { useIsMobile } from '@/lib/useIsMobile'
import { useIsAdmin, useMenuPermission } from '@/app/components/PermissionsProvider'
import { currentPayPeriod, payPeriodDays, payPeriodRange } from '@/lib/overtime/summary'
import { requestProjectSync, type SyncAttention } from '@/lib/overtime/sync'
import { koreaToday } from '@/lib/overtime/eligibility'
import { runAssignment } from '@/lib/overtime/assign/engine'
import type { AssignmentResult } from '@/lib/overtime/assign/types'
import { buildAssignmentInput, lockedRange, supersededBy, toPeriodLabel, type PlanningRaw, type PlanningScope } from '@/lib/overtime/planning/input'
import { createPeriodLoader, periodDataOwned, periodDataReady, runPeriodAction, type ActionToken, type LoadTicket, type PeriodLoader } from '@/lib/overtime/planning/loadGate'
import { friendlyOvertimeError } from '@/lib/overtime/planning/errors'
import { canSavePreview, makePreview, type StoredPreview } from '@/lib/overtime/planning/fingerprint'
import { splitPartialPlan, type PartialPlan } from '@/lib/overtime/planning/partial'
import { canDiscardRun } from '@/lib/overtime/planning/runs'
import type { AssignmentDraft, AssignmentRun, MemberTask } from '@/lib/overtime/planningTypes'
import type { Employee, EmployeeTask, Project, ProjectMember, WorkRecord } from '@/lib/overtime/types'
import AssignmentGrid, { projectColor, type GridCell, type GridRow } from './_components/AssignmentGrid'
import PlanSettings, { type CandidateProject } from './_components/PlanSettings'

/**
 * 연장근무 자동배정 — 설정(월 목표·참여 프로젝트·업무) → 자동배정 미리보기 → 초안 저장 → 확정.
 * 엔진(lib/overtime/assign)은 브라우저에서 돌리고, 저장·확정은 DB RPC가 다시 검증한다
 * (overtime_save_assignment_run / overtime_confirm_run — docs/overtime-planning-db.md).
 * DB 오류 원문은 화면에 내보내지 않고 friendlyOvertimeError로 바꿔 보여준다.
 */

type Tab = 'settings' | 'run' | 'drafts'
type RecordRow = Pick<WorkRecord, 'id' | 'employee_id' | 'project_id' | 'work_date' | 'hours' | 'task_description' | 'source'>
type SourceRow = { id: string; name: string; project_number: string | null; submit_date: string | null }
// 엔진 잠금 입력용 초안 — 실행·급여기간과 상관없이 잠금 범위(첫 주 월요일~마지막 주 일요일)의 status='draft' 전부
type LockDraftRow = Pick<AssignmentDraft, 'id' | 'employee_id' | 'project_id' | 'work_date' | 'hours' | 'task_name' | 'status' | 'locked' | 'manually_edited'>

const MONTH_NAMES = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월']
const RUN_STATUS: Record<string, string> = { draft: '초안', partially_confirmed: '일부 확정', confirmed: '확정', superseded: '대체됨', discarded: '폐기' }
const ATTENTION_KIND: Record<string, string> = { needs_review: '확인 필요', blocked: '배정 불가' }

const newSeed = () => Math.floor(Math.random() * 2_000_000_000) + 1

export default function OvertimePlanPage() {
  const isMobile = useIsMobile()
  const supabase = createSupabaseBrowserClient()
  const canWrite = useMenuPermission('overtime') === 'write'
  const isAdmin = useIsAdmin()

  const initial = currentPayPeriod()
  const [year, setYear] = useState(initial.year)
  const [month0, setMonth0] = useState(initial.month)
  const [tab, setTab] = useState<Tab>('settings')

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  // 화면에 반영된 자료의 급여기간 라벨·세대 — 지금 보는 기간(label·viewEpoch)과 다르면 아직 불러오는 중으로 본다
  const [dataKey, setDataKey] = useState<{ label: string; epoch: number } | null>(null)
  // 화면이 그린 기간 세대(PeriodLoader.changePeriod가 돌려준 값) — A→B→A로 돌아와도 이전 A와 구분한다
  const [viewEpoch, setViewEpoch] = useState(0)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [tasks, setTasks] = useState<EmployeeTask[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [sources, setSources] = useState<SourceRow[]>([])
  const [members, setMembers] = useState<ProjectMember[]>([])
  const [memberTasks, setMemberTasks] = useState<Pick<MemberTask, 'id' | 'member_id' | 'task_id'>[]>([])
  const [targets, setTargets] = useState<Array<{ employee_id: string; target_hours: number }>>([])
  const [holidays, setHolidays] = useState<Array<{ holiday_date: string; name: string }>>([])
  const [records, setRecords] = useState<RecordRow[]>([])
  const [runs, setRuns] = useState<AssignmentRun[]>([])
  const [drafts, setDrafts] = useState<AssignmentDraft[]>([])
  const [lockDrafts, setLockDrafts] = useState<LockDraftRow[]>([])
  const [attention, setAttention] = useState<SyncAttention>([])
  const [syncFailed, setSyncFailed] = useState(false)

  const [scope, setScope] = useState<PlanningScope>({ kind: 'all' })
  // 미리보기 = 결과 + 그 결과를 만든 입력·범위·지문(lib/overtime/planning/fingerprint.ts). 저장은 이 입력 기준
  const [preview, setPreview] = useState<StoredPreview | null>(null)
  const [previewCleared, setPreviewCleared] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [editing, setEditing] = useState<AssignmentDraft | null>(null)

  const label = toPeriodLabel(year, month0)
  const days = useMemo(() => payPeriodDays(year, month0), [year, month0])

  // 첫 setState가 await 뒤에 오도록 둔다 — 화면 상태 초기화(loading 등)는 호출하는 쪽(changePeriod·reload)이 한다
  // 한 기간 자료 불러오기(동기화는 loader가 먼저 끝낸다). await마다 isCurrent()를 확인하고, 아니면 아무 상태도 바꾸지 않고 끝낸다
  async function loadPeriod(y: number, m: number, ticket: LoadTicket) {
    const { periodLabel, isCurrent } = ticket
    const range = lockedRange(y, m)
    const [empRes, taskRes, projRes, srcRes, memRes, mtRes, tgRes, holRes, recRes, runRes, lockDraftRes] = await Promise.all([
      supabase.from('overtime_employees').select('*').eq('is_active', true).order('sort_order', { ascending: true }),
      supabase.from('overtime_employee_tasks').select('*').order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
      supabase.from('overtime_projects').select('*'),
      supabase.from('projects').select('id, name, project_number, submit_date'),
      supabase.from('overtime_project_members').select('*'),
      supabase.from('overtime_member_tasks').select('id, member_id, task_id'),
      supabase.from('overtime_monthly_targets').select('employee_id, target_hours').eq('period_label', periodLabel),
      supabase.from('holidays').select('holiday_date, name').gte('holiday_date', `${range.from.slice(0, 4)}-01-01`).lte('holiday_date', `${range.to.slice(0, 4)}-12-31`),
      supabase.from('overtime_work_records').select('id, employee_id, project_id, work_date, hours, task_description, source').gte('work_date', range.from).lte('work_date', range.to),
      supabase.from('overtime_assignment_runs').select('*').eq('period_label', periodLabel).order('created_at', { ascending: false }),
      // 주 12시간 잠금용 — 실행(run)·급여기간 라벨로 거르지 않는다. 앞·뒤 급여기간 실행의 같은 주 초안도 DB가 함께 센다
      supabase.from('overtime_assignment_drafts')
        .select('id, employee_id, project_id, work_date, hours, task_name, status, locked, manually_edited')
        .eq('status', 'draft').gte('work_date', range.from).lte('work_date', range.to),
    ])
    if (!isCurrent()) return
    setLoadError(null)
    const failed = [empRes, taskRes, projRes, srcRes, memRes, mtRes, tgRes, holRes, recRes, runRes, lockDraftRes].find(r => r.error)
    if (failed) {
      setLoadError('자료를 불러오지 못했습니다. 자동배정용 DB 변경(migration)이 적용되었는지, 연장근무 권한이 있는지 확인하세요.')
      setLoading(false)
      return
    }
    const runRows = runRes.data as AssignmentRun[]
    const activeRunIds = runRows.filter(r => r.status === 'draft' || r.status === 'partially_confirmed' || r.status === 'confirmed').map(r => r.id)
    let draftRows: AssignmentDraft[] = []
    if (activeRunIds.length > 0) {
      const dRes = await supabase.from('overtime_assignment_drafts').select('*').in('run_id', activeRunIds).in('status', ['draft', 'confirmed'])
      if (!isCurrent()) return
      if (dRes.error) { setLoadError('초안을 불러오지 못했습니다.'); setLoading(false); return }
      draftRows = dRes.data as AssignmentDraft[]
    }
    setEmployees(empRes.data as Employee[])
    setTasks(taskRes.data as EmployeeTask[])
    setProjects(projRes.data as Project[])
    setSources(srcRes.data as SourceRow[])
    setMembers(memRes.data as ProjectMember[])
    setMemberTasks(mtRes.data as Pick<MemberTask, 'id' | 'member_id' | 'task_id'>[])
    setTargets((tgRes.data as Array<{ employee_id: string; target_hours: number }>).map(t => ({ ...t, target_hours: Number(t.target_hours) })))
    setHolidays(holRes.data as Array<{ holiday_date: string; name: string }>)
    setRecords(recRes.data as RecordRow[])
    setRuns(runRows)
    setDrafts(draftRows)
    setLockDrafts(lockDraftRes.data as LockDraftRow[])
    setDataKey({ label: periodLabel, epoch: ticket.epoch })
    setLoading(false)
  }

  // 지금 보는 기간과 불러오기(lib/overtime/planning/loadGate.ts) — 가장 최근 요청의 응답·오류만 반영하고
  // (늦게 온 이전 기간 응답, 화면이 사라진 뒤의 응답은 버림), reload는 호출 시점의 최신 기간을 읽는다.
  // 동기화는 기간 세대마다 하나 — 끝나기 전의 reload는 그 동기화에 합류해 안내를 반영하고 동기화 뒤의 자료를 읽는다
  const loaderRef = useRef<PeriodLoader<{ year: number; month0: number }> | null>(null)
  if (loaderRef.current === null) {
    loaderRef.current = createPeriodLoader({
      initial: { year: initial.year, month0: initial.month },
      label: p => toPeriodLabel(p.year, p.month0),
      sync: p => { const { start, end } = payPeriodRange(p.year, p.month0); return requestProjectSync(start, end) },
      // 실패해도 기존 목록으로 계속 진행하되, 화면에 안내한다(원문 오류는 보여주지 않는다)
      onSync: res => { setAttention(res.attention); setSyncFailed(!res.ok) },
      run: (p, ticket) => loadPeriod(p.year, p.month0, ticket),
      onReloadStart: () => setLoading(true),
      // 기간 전환 순간 이전 기간의 동기화 안내·오류를 지운다(새 기간 요청의 안내·오류는 그 요청이 다시 채운다)
      onPeriodChange: () => { setAttention([]); setSyncFailed(false); setLoadError(null) },
      // 네트워크 오류 등 예외 — 최신 요청일 때만 안내한다(원문 오류는 보여주지 않는다)
      onError: () => { setLoadError('자료를 불러오지 못했습니다. 잠시 뒤 다시 시도하세요.'); setLoading(false) },
    })
  }
  useEffect(() => {
    const loader = loaderRef.current!
    loader.activate()
    return () => loader.dispose()
  }, [])

  // 급여기간이 바뀌면 프로젝트 동기화 후 다시 읽는다 — interviews 화면처럼 async 함수 안에서 불러
  // effect 본문에서 곧바로 setState하지 않는다(react-hooks/set-state-in-effect)
  useEffect(() => {
    void (async () => { await loaderRef.current!.load({ year, month0 }, true) })()
  }, [year, month0])

  // 저장·수정 RPC 뒤 다시 읽기 — 만들어질 때가 아니라 호출 시점의 최신 기간으로(RPC를 기다리는 동안 기간이 바뀌어도
  // 이전 기간을 다시 불러와 최신 기간 요청을 무효로 만들지 않는다)
  const reload = useCallback(() => loaderRef.current!.reload(), [])

  // ── 파생값 ──
  const sourceById = useMemo(() => new Map(sources.map(s => [s.id, s])), [sources])
  const { start: periodStart, end: periodEnd } = payPeriodRange(year, month0)
  const holidayMap = useMemo(() => new Map(holidays.map(h => [h.holiday_date, h.name])), [holidays])
  const projectById = useMemo(() => new Map(projects.map(p => [p.id, p])), [projects])
  const taskById = useMemo(() => new Map(tasks.map(t => [t.id, t])), [tasks])
  const targetMap = useMemo(() => new Map(targets.map(t => [t.employee_id, t.target_hours])), [targets])

  // 이 급여기간에 배정할 수 있는 프로젝트 — 진행중 + 대상기간이 급여기간과 겹침, 제출일 → 종료일 순
  const candidates: CandidateProject[] = useMemo(() => projects
    .filter(p => p.status === '진행중' && p.start_date && p.end_date && p.start_date <= periodEnd && p.end_date >= periodStart)
    .map(p => ({ project: p, submitDate: p.source_project_id ? sourceById.get(p.source_project_id)?.submit_date ?? null : null }))
    .sort((a, b) => (a.submitDate ?? '9999').localeCompare(b.submitDate ?? '9999') || (a.project.end_date ?? '').localeCompare(b.project.end_date ?? '') || a.project.name.localeCompare(b.project.name, 'ko')),
  [projects, sourceById, periodStart, periodEnd])
  const projectOrder = useMemo(() => {
    const ids = candidates.map(c => c.project.id)
    for (const d of drafts) if (!ids.includes(d.project_id)) ids.push(d.project_id)
    return ids
  }, [candidates, drafts])

  const inPeriod = (d: string) => d >= periodStart && d <= periodEnd
  const lockedHours = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of records) if (inPeriod(r.work_date)) m.set(r.employee_id, (m.get(r.employee_id) ?? 0) + Number(r.hours))
    return m
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, periodStart, periodEnd])

  function buildRaw(s: number): PlanningRaw {
    return {
      year, month0, asOf: koreaToday(), seed: s, scope,
      employees, targets,
      overtimeProjects: projects,
      sourceProjects: sources,
      members, memberTasks, tasks, holidays, records,
      drafts: lockDrafts.map(d => ({ ...d })),
    }
  }

  // 불러오기가 끝났고, 화면에 반영된 자료가 지금 보는 급여기간·세대의 것일 때만 실행·저장·확정·폐기·확정 취소한다.
  // 설정(월 목표·참여 프로젝트·업무)은 자료가 지금 기간·세대의 것이면(같은 기간 reload 중이어도) 고칠 수 있다
  const periodData = { label, viewEpoch, data: dataKey, loading }
  const dataReady = periodDataReady(periodData)
  const dataOwned = periodDataOwned(periodData)

  // 기간 종속 작업의 소유권 — 이 렌더의 자료가 준비됐고 그 사이 기간이 바뀌지 않았을 때만(버튼 disabled와 별도로 handler에서 다시 확인)
  function beginPeriodAction(): ActionToken | null {
    return dataReady ? loaderRef.current!.beginAction(viewEpoch) : null
  }

  function runEngine(s: number) {
    if (!dataReady) return
    setMessage(null)
    setPreviewCleared(false)
    const input = buildAssignmentInput(buildRaw(s))
    setPreview(makePreview(input, scope, runAssignment(input)))
  }

  // 미리보기를 만든 뒤 설정·기존 기록·공휴일이 바뀌었는지 — 지금 상태로 같은 seed의 입력을 다시 만들어 지문을 비교한다.
  // 탭 이동은 입력을 바꾸지 않으므로 미리보기가 그대로 남는다.
  const previewFresh = useMemo(
    () => preview !== null && canSavePreview(preview, buildAssignmentInput(buildRaw(preview.input.seed)), scope),
  // eslint-disable-next-line react-hooks/exhaustive-deps
    [preview, scope, year, month0, employees, targets, projects, sources, members, memberTasks, tasks, holidays, records, lockDrafts])
  // 서버에서 다시 읽은 값이 미리보기 입력과 다르면 미리보기를 지운다(렌더 중 이전 값 비교 — effect 없이)
  if (preview && !previewFresh && dataReady) {
    setPreview(null)
    setPreviewCleared(true)
  }

  // 설정(월 목표·참여 프로젝트·업무)을 바꾸면 미리보기를 지우고 다시 읽는다. 설정 화면은 기간 세대마다 새로 그리므로(key)
  // 이 콜백이 받은 viewEpoch가 지금 세대와 다르면 이전 기간 설정의 늦은 완료 — 화면 상태는 두고 최신 기간만 다시 읽는다
  const onSettingsChanged = () => {
    if (loaderRef.current!.beginAction(viewEpoch) && preview) { setPreview(null); setPreviewCleared(true) }
    void reload()
  }

  // 부분 자동배정 — 문제 있는 직원만 제외하고 정상 직원 초안은 저장한다(lib/overtime/planning/partial.ts)
  const partial: PartialPlan | null = useMemo(() => (preview ? splitPartialPlan(preview.result) : null), [preview])

  async function saveDraft() {
    if (!preview || !partial || !partial.canSave) return
    const token = beginPeriodAction()
    if (!token) return
    // 저장 직전 다시 확인 — 미리보기 뒤 입력이 바뀌었으면 저장하지 않는다
    if (!canSavePreview(preview, buildAssignmentInput(buildRaw(preview.input.seed)), scope)) {
      setMessage({ kind: 'error', text: '미리보기 뒤에 설정이나 기존 기록이 바뀌었습니다. 자동배정을 다시 실행한 뒤 저장하세요.' })
      return
    }
    setBusy(true)
    setMessage(null)
    // 저장 기록·실행 정보는 미리보기를 만든 입력 그대로 쓴다(지금 상태로 다시 만들지 않는다)
    const { input, scope: runScope, result } = preview
    // 실행 기록 — 내부 ID·기간·목표·프로젝트 날짜·업무 관계만 남긴다(이름 등 개인정보 없음)
    const inputSnapshot = {
      period: input.period, as_of: input.as_of, seed: input.seed, rule_version: input.rule_version,
      employees: input.employees.map(e => ({ employee_id: e.employee_id, target_hours: e.target_hours, projects: e.projects })),
      projects: input.projects.map(p => ({ project_id: p.project_id, period_start: p.period_start, period_end: p.period_end, submit_date: p.submit_date, auto_assignable: p.auto_assignable })),
      locked_count: input.locked_records.length,
    }
    const resultSummary = {
      assignment_count: result.assignments.length,
      employees: result.employees.map(e => ({ employee_id: e.employee_id, target_hours: e.target_hours, locked_hours: e.locked_hours, assigned_hours: e.assigned_hours, unassigned_hours: e.unassigned_hours })),
      issues: result.issues.map(i => ({ code: i.code, severity: i.severity, employee_id: i.employee_id ?? null, project_id: i.project_id ?? null })),
      // 부분 저장 결과 — 배정 직원 수와 제외 직원 수(사유 코드)
      included_employee_count: partial.included.length,
      assigned_employee_count: new Set(partial.drafts.map(a => a.employee_id)).size,
      excluded_employee_count: partial.excluded.length,
      excluded: partial.excluded.map(x => ({ employee_id: x.employee_id, code: x.code })),
    }
    const saveArgs = {
      p_run: {
        period_label: input.period.label, seed: input.seed, scope: runScope.kind,
        scope_employee_id: runScope.kind === 'employee' ? runScope.employee_id : null,
        scope_project_id: runScope.kind === 'project' ? runScope.project_id : null,
        rule_version: input.rule_version, input_snapshot: inputSnapshot, result_summary: resultSummary,
      },
      // is_holiday — 엔진이 본 공휴일 여부. 저장 함수가 DB 공휴일과 다르면 OVERTIME_HOLIDAY_CHANGED로 거부한다
      p_drafts: partial.drafts.map(a => ({
        employee_id: a.employee_id, project_id: a.project_id, work_date: a.work_date,
        task_id: a.task_id, time_type: a.time_type, exception_reason: a.exception_reason,
        is_holiday: a.is_holiday,
      })),
    }
    const savedText = `초안 ${partial.drafts.length}건을 저장했습니다(직원 ${partial.included.length}명${partial.excluded.length > 0 ? `, 제외 ${partial.excluded.length}명` : ''}). '초안·확정' 탭에서 확인 후 확정하세요.`
    // 끝났을 때 기간이 바뀌었으면(token) busy·메시지·미리보기·탭을 건드리지 않는다 — 그 사이 새 기간에서 만든 미리보기를 지우지 않게
    await runPeriodAction({
      token,
      work: () => supabase.rpc('overtime_save_assignment_run', saveArgs),
      onDone: ({ error }) => {
        setBusy(false)
        if (error) { setMessage({ kind: 'error', text: friendlyOvertimeError(error.message) }); return }
        setPreview(null)
        setMessage({ kind: 'ok', text: savedText })
      },
      reload,
      afterReload: () => setTab('drafts'),
    })
  }

  // 확정·폐기·확정 취소 RPC — 시작 기간을 소유할 때만 시작하고, 끝났을 때도 소유할 때만 busy·메시지를 바꾼다.
  // 돌려주는 값: reload 뒤까지 지금 기간을 소유한 채로 성공했는지(편집창 닫기 등)
  async function callRpc(fn: string, args: Record<string, unknown>, okText: string) {
    const token = beginPeriodAction()
    if (!token) return false
    setBusy(true)
    setMessage(null)
    return runPeriodAction({
      token,
      work: () => supabase.rpc(fn, args),
      onDone: ({ error }) => {
        setBusy(false)
        setMessage(error ? { kind: 'error', text: friendlyOvertimeError(error.message) } : { kind: 'ok', text: okText })
      },
      reload,
    })
  }

  async function updateDraft(d: AssignmentDraft, patch: Partial<Pick<AssignmentDraft, 'time_type' | 'task_id' | 'status'>>) {
    const token = beginPeriodAction()
    if (!token) return
    setBusy(true)
    setMessage(null)
    await runPeriodAction({
      token,
      work: () => supabase.from('overtime_assignment_drafts').update(patch).eq('id', d.id),
      onDone: ({ error }) => {
        setBusy(false)
        if (error) { setMessage({ kind: 'error', text: friendlyOvertimeError(error.message) }); return }
        setEditing(null)
      },
      reload,
    })
  }

  // ── 그리드 행 ──
  const empName = (id: string) => employees.find(e => e.id === id)?.name ?? '(퇴사·비활성 직원)'
  const projName = (id: string) => projectById.get(id)?.name ?? '(알 수 없는 프로젝트)'

  function existingCells(employeeId: string): Map<string, GridCell> {
    const cells = new Map<string, GridCell>()
    for (const r of records) {
      if (r.employee_id !== employeeId || !inPeriod(r.work_date)) continue
      const prev = cells.get(r.work_date)
      cells.set(r.work_date, {
        projectId: r.project_id,
        hours: (prev?.hours ?? 0) + Number(r.hours),
        reason: null,
        status: r.source === 'auto' ? 'confirmed' : 'existing',
        title: `${r.source === 'auto' ? '자동배정 확정' : '기존 입력'} · ${projName(r.project_id)} · ${r.task_description}`,
      })
    }
    return cells
  }

  const previewRows: GridRow[] = useMemo(() => {
    if (!preview) return []
    const result = preview.result
    const period = { start: preview.input.period.start, end: preview.input.period.end }
    return result.employees.map(s => {
      const cells = existingCells(s.employee_id)
      for (const d of lockDrafts) {
        if (d.employee_id !== s.employee_id || !inPeriod(d.work_date)) continue
        if (result.assignments.some(a => a.employee_id === d.employee_id && a.work_date === d.work_date)) continue
        // 이번 실행이 대체하지 않는 초안(잠김·수동 수정·범위 밖)은 잠금으로 보인다 — 대체될 초안은 엔진 입력에서도 빠졌다
        if (!supersededBy(preview.scope, period, d)) {
          cells.set(d.work_date, { projectId: d.project_id, hours: Number(d.hours), reason: null, status: 'locked', title: `기존 초안(유지) · ${projName(d.project_id)}` })
        }
      }
      for (const a of result.assignments) {
        if (a.employee_id !== s.employee_id) continue
        cells.set(a.work_date, { projectId: a.project_id, hours: a.hours, reason: a.exception_reason, status: 'draft', title: `${projName(a.project_id)} · ${a.task_name} · ${a.hours}시간${a.exception_reason ? ` · ${a.exception_reason}` : ''}` })
      }
      const emp = employees.find(e => e.id === s.employee_id)
      return { id: s.employee_id, name: emp?.name ?? '-', sub: s.target_hours === null ? '목표 미입력' : `목표 ${s.target_hours}h`, cells }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, lockDrafts, records, employees])

  const draftRows: GridRow[] = useMemo(() => {
    const ids = [...new Set(drafts.map(d => d.employee_id))]
    return employees.filter(e => ids.includes(e.id)).map(e => {
      const cells = new Map<string, GridCell>()
      for (const [date, c] of existingCells(e.id)) if (c.status === 'existing') cells.set(date, c)
      for (const d of drafts) {
        if (d.employee_id !== e.id) continue
        cells.set(d.work_date, {
          projectId: d.project_id, hours: Number(d.hours), reason: d.exception_reason,
          status: d.status === 'confirmed' ? 'confirmed' : 'draft',
          title: `${projName(d.project_id)} · ${d.task_name} · ${d.hours}시간${d.manually_edited ? ' · 직접 수정' : ''}${d.exception_reason ? ` · ${d.exception_reason}` : ''}`,
        })
      }
      const draftH = drafts.filter(d => d.employee_id === e.id && d.status === 'draft').reduce((s, d) => s + Number(d.hours), 0)
      return { id: e.id, name: e.name, sub: `초안 ${draftH}h`, cells }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drafts, records, employees])

  // 초안·확정 탭에 보이는 실행 — 확정된 실행도 관리자 확정 취소를 위해 보여준다
  const activeRuns = runs.filter(r => r.status === 'draft' || r.status === 'partially_confirmed' || r.status === 'confirmed')
  const draftCountByRun = (runId: string, status: 'draft' | 'confirmed') => drafts.filter(d => d.run_id === runId && d.status === status).length

  const changePeriod = (delta: number) => {
    const n = year * 12 + month0 + delta
    const next = { year: Math.floor(n / 12), month0: n % 12 }
    // 새 기간 요청이 시작되기 전이라도 지금까지의 요청 응답은 모두 버리고, 이전 기간의 안내·오류를 지운다.
    // 이전 기간 작업의 busy도 푼다 — 그 작업은 끝나도 소유권(세대)이 없어 화면 상태를 바꾸지 않는다
    setViewEpoch(loaderRef.current!.changePeriod(next))
    setLoading(true)
    setBusy(false)
    setPreview(null)
    setPreviewCleared(false)
    setMessage(null)
    setEditing(null)
    setScope({ kind: 'all' })
    setYear(next.year)
    setMonth0(next.month0)
  }
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`

  return (
    <div style={{ minHeight: '100vh', background: '#f8f8f7' }}>
      <header style={{ background: '#fff', borderBottom: '1px solid #e8e8e6' }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', padding: isMobile ? '0 12px' : '0 24px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 14, color: '#555' }}>
            <Link href="/overtime" style={{ color: '#999', textDecoration: 'none' }}>연장근무</Link> › 자동배정
          </span>
          <div style={{ display: 'flex', border: '1px solid #e8e8e6', borderRadius: 6, overflow: 'hidden' }}>
            {(['settings', 'run', 'drafts'] as Tab[]).map(t => (
              <button key={t} onClick={() => { setTab(t); setMessage(null) }} style={tab === t ? tabBtnActive : tabBtn}>
                {t === 'settings' ? '1. 설정' : t === 'run' ? '2. 자동배정' : '3. 초안·확정'}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1400, margin: '0 auto', padding: isMobile ? '12px 12px 60px' : '20px 24px 60px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, marginBottom: 12 }}>
          <button onClick={() => changePeriod(-1)} style={navBtn}>‹</button>
          <span style={{ fontSize: 14, fontWeight: 600, minWidth: 100, textAlign: 'center', color: '#111' }}>{year}년 {MONTH_NAMES[month0]}</span>
          <button onClick={() => changePeriod(1)} style={navBtn}>›</button>
          <span style={{ fontSize: 12, color: '#999' }}>({md(periodStart)} ~ {md(periodEnd)})</span>
          {!dataReady && !loadError && <span style={{ fontSize: 11, color: '#bbb', marginLeft: 8 }}>불러오는 중...</span>}
        </div>

        {!canWrite && <Notice kind="info" text="읽기 권한이라 보기만 할 수 있습니다." />}
        {loadError && <Notice kind="error" text={loadError} />}
        {message && <Notice kind={message.kind} text={message.text} />}
        {syncFailed && !loadError && (
          <Notice kind="error" text="프로젝트 List 동기화에 실패해 마지막으로 맞춘 프로젝트 목록으로 보여줍니다. 프로젝트 기간·상태가 최신이 아닐 수 있으니 잠시 후 새로고침하고, 계속되면 관리자에게 알려주세요." />
        )}

        {!loadError && tab === 'settings' && (
          <>
            {attention.length > 0 && (
              <div style={{ marginBottom: 12, padding: '10px 14px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, fontSize: 12, color: '#92400e' }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>자동배정에서 빠진 프로젝트 {attention.length}건 — 프로젝트 List의 날짜를 확인하세요</div>
                {attention.map(a => (
                  <div key={a.sourceProjectId}>· {sourceById.get(a.sourceProjectId)?.name ?? '(이름 없음)'} — {ATTENTION_KIND[a.kind] ?? a.kind}{a.reason ? `: ${a.reason}` : ''}</div>
                ))}
              </div>
            )}
            <div style={{ fontSize: 12, color: '#777', marginBottom: 8 }}>
              월 목표시간은 이 급여기간의 직원별 총 연장근무 한도입니다(수동 입력·자동배정 합산). 비워 두면 그 직원은 자동배정·수동 입력이 모두 막히고, 0이면 0시간입니다. 직원별로 참여 프로젝트와 업무를 고르세요.
            </div>
            {/* 기간 세대마다 새로 그린다 — 이전 기간 설정의 진행 중 작업은 이전 세대의 onChanged로 끝난다. 자료가 지금 기간 것일 때만 수정 */}
            <PlanSettings
              key={viewEpoch}
              periodLabel={label}
              employees={employees}
              targets={targetMap}
              lockedHours={lockedHours}
              candidates={candidates}
              allProjects={projects}
              members={members}
              memberTasks={memberTasks}
              tasks={tasks}
              canWrite={canWrite && dataOwned}
              onChanged={onSettingsChanged}
            />
          </>
        )}

        {!loadError && tab === 'run' && (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <select
                value={scope.kind === 'all' ? 'all' : `${scope.kind}:${scope.kind === 'employee' ? scope.employee_id : scope.project_id}`}
                onChange={e => {
                  const v = e.target.value
                  setPreview(null)
                  setPreviewCleared(false)
                  if (v === 'all') setScope({ kind: 'all' })
                  else if (v.startsWith('employee:')) setScope({ kind: 'employee', employee_id: v.slice(9) })
                  else setScope({ kind: 'project', project_id: v.slice(8) })
                }}
                style={selectStyle}
              >
                <option value="all">전체 직원</option>
                <optgroup label="직원 한 명만 다시">
                  {employees.map(e => <option key={e.id} value={`employee:${e.id}`}>{e.name}</option>)}
                </optgroup>
                <optgroup label="프로젝트 하나만 다시">
                  {candidates.map(c => <option key={c.project.id} value={`project:${c.project.id}`}>{c.project.name}</option>)}
                </optgroup>
              </select>
              <button onClick={() => runEngine(newSeed())} disabled={!dataReady} style={primaryBtn}>{preview ? '다시 섞기' : '자동배정 실행'}</button>
              {preview && canWrite && (
                <button data-testid="plan-save" onClick={saveDraft} disabled={busy || !partial?.canSave || !previewFresh} style={{ ...darkBtn, opacity: busy || !partial?.canSave || !previewFresh ? 0.5 : 1 }}>
                  {busy ? '저장 중...' : `초안 저장 (${partial?.drafts.length ?? 0}건)`}
                </button>
              )}
              {preview && <span data-testid="plan-seed" style={{ fontSize: 11, color: '#999' }}>배정번호(seed) {preview.input.seed}</span>}
              <span style={{ fontSize: 11, color: '#999' }}>저장 전까지는 미리보기입니다. 기존 입력 기록은 바뀌지 않습니다.</span>
            </div>

            {preview && !previewFresh && (
              <Notice kind="error" text="미리보기 뒤에 설정이나 기존 기록이 바뀌어 이 결과는 저장할 수 없습니다. 자동배정을 다시 실행하세요." />
            )}
            {!preview && previewCleared && (
              <Notice kind="info" text="설정이나 기존 기록·공휴일이 바뀌어 이전 미리보기를 지웠습니다. 자동배정을 다시 실행하세요." />
            )}

            {!preview ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#999', background: '#fff', border: '1px solid #e8e8e6', borderRadius: 8, fontSize: 13 }}>
                ‘자동배정 실행’을 누르면 결과를 미리 볼 수 있습니다.
              </div>
            ) : (
              <>
                {partial && <PartialBox plan={partial} ok={preview.result.ok} empName={empName} />}
                <IssueList result={preview.result} empName={empName} projName={projName} hideEmployees={partial?.excluded.map(x => x.employee_id) ?? []} />
                <AssignmentGrid days={days} holidays={holidayMap} rows={previewRows} projectOrder={projectOrder} />
                <Legend projectOrder={projectOrder} projName={projName} />
                <SummaryTable result={preview.result} empName={empName} />
              </>
            )}
          </>
        )}

        {!loadError && tab === 'drafts' && (
          <>
            {activeRuns.length === 0 && drafts.filter(d => d.status === 'confirmed').length === 0 && (
              <div style={{ padding: 40, textAlign: 'center', color: '#999', background: '#fff', border: '1px solid #e8e8e6', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>
                저장된 초안이 없습니다. ‘2. 자동배정’에서 실행 후 초안을 저장하세요.
              </div>
            )}
            {activeRuns.map(run => (
              <div key={run.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 8, padding: '10px 14px', background: '#fff', border: '1px solid #e8e8e6', borderRadius: 8, fontSize: 12 }}>
                <span style={{ fontWeight: 600 }}>{new Date(run.created_at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 실행</span>
                <span style={{ color: '#777' }}>
                  {run.scope === 'all' ? '전체' : run.scope === 'employee' ? `직원: ${empName(run.scope_employee_id ?? '')}` : `프로젝트: ${projName(run.scope_project_id ?? '')}`}
                  {' · '}{RUN_STATUS[run.status] ?? run.status} · 초안 {draftCountByRun(run.id, 'draft')}건 · 확정 {draftCountByRun(run.id, 'confirmed')}건
                </span>
                <span style={{ flex: 1 }} />
                {canWrite && draftCountByRun(run.id, 'draft') > 0 && (
                  <>
                    <ConfirmByEmployee
                      employees={employees.filter(e => drafts.some(d => d.run_id === run.id && d.status === 'draft' && d.employee_id === e.id))}
                      disabled={busy || !dataReady}
                      label="이 직원만 확정"
                      onConfirm={ids => callRpc('overtime_confirm_run', { p_run_id: run.id, p_employee_ids: ids }, '선택한 직원의 초안을 확정했습니다. 연장근무 기록에 반영되었습니다.')}
                    />
                    <button disabled={busy || !dataReady} onClick={() => { if (confirm('이 실행의 초안을 모두 확정할까요? 확정하면 연장근무 기록에 들어갑니다.')) callRpc('overtime_confirm_run', { p_run_id: run.id, p_employee_ids: null }, '초안을 모두 확정했습니다. 연장근무 기록에 반영되었습니다.') }} style={darkBtn}>전체 확정</button>
                  </>
                )}
                {/* 폐기는 남은 초안 수가 아니라 실행 상태로 보인다 — 칸을 모두 빼서 초안이 0건이어도 실행을 정리할 수 있게 */}
                {canWrite && canDiscardRun(run) && (
                  draftCountByRun(run.id, 'draft') > 0
                    ? <button disabled={busy || !dataReady} onClick={() => { if (confirm('남은 초안을 모두 버릴까요? (이미 확정된 기록은 그대로입니다)')) callRpc('overtime_discard_run', { p_run_id: run.id }, '남은 초안을 버렸습니다.') }} style={dangerBtn}>초안 버리기</button>
                    : <button disabled={busy || !dataReady} onClick={() => { if (confirm('남은 초안이 없는 실행입니다. 이 실행을 폐기할까요? (이미 확정된 기록은 그대로입니다)')) callRpc('overtime_discard_run', { p_run_id: run.id }, '실행을 정리했습니다.') }} style={dangerBtn}>실행 폐기</button>
                )}
                {/* 관리자 확정 취소 — 자동확정 기록을 지우고 초안(draft)으로 되돌린다. DB도 관리자만 허용 */}
                {isAdmin && draftCountByRun(run.id, 'confirmed') > 0 && (
                  <>
                    <ConfirmByEmployee
                      employees={employees.filter(e => drafts.some(d => d.run_id === run.id && d.status === 'confirmed' && d.employee_id === e.id))}
                      disabled={busy || !dataReady}
                      label="이 직원 확정 취소"
                      minCount={1}
                      onConfirm={ids => callRpc('overtime_unconfirm_drafts', { p_draft_ids: drafts.filter(d => d.run_id === run.id && d.status === 'confirmed' && ids.includes(d.employee_id)).map(d => d.id) }, '선택한 직원의 확정을 취소했습니다. 연장근무 기록에서 빠지고 초안으로 돌아갔습니다.')}
                    />
                    <button disabled={busy || !dataReady} onClick={() => { if (confirm('이 실행의 확정을 모두 취소할까요? 자동배정 기록이 연장근무 기록에서 빠지고 초안으로 돌아갑니다.')) callRpc('overtime_unconfirm_drafts', { p_draft_ids: drafts.filter(d => d.run_id === run.id && d.status === 'confirmed').map(d => d.id) }, '확정을 모두 취소했습니다. 연장근무 기록에서 빠지고 초안으로 돌아갔습니다.') }} style={dangerBtn}>전체 확정 취소</button>
                  </>
                )}
              </div>
            ))}
            {draftRows.length > 0 && (
              <>
                <div style={{ fontSize: 11, color: '#999', margin: '8px 0' }}>
                  칸을 누르면 초안을 고칠 수 있습니다(고친 칸은 다시 섞어도 유지됩니다).{isAdmin ? ' 확정된 칸은 관리자가 확정 취소할 수 있습니다.' : ''}
                </div>
                <AssignmentGrid
                  days={days}
                  holidays={holidayMap}
                  rows={draftRows}
                  projectOrder={projectOrder}
                  onCellClick={(rowId, date) => {
                    const d = drafts.find(x => x.employee_id === rowId && x.work_date === date)
                    if (!d) return
                    if (d.status === 'draft' && canWrite) setEditing(d)
                    if (d.status === 'confirmed' && isAdmin) setEditing(d)
                  }}
                />
                <Legend projectOrder={projectOrder} projName={projName} />
              </>
            )}
          </>
        )}
      </div>

      {editing && (
        <DraftEditor
          draft={editing}
          employeeName={empName(editing.employee_id)}
          projectName={projName(editing.project_id)}
          tasks={tasks.filter(t => t.employee_id === editing.employee_id)}
          currentTaskName={editing.task_id ? taskById.get(editing.task_id)?.task_name ?? editing.task_name : editing.task_name}
          isAdmin={isAdmin}
          busy={busy || !dataReady}
          onClose={() => setEditing(null)}
          onSave={patch => updateDraft(editing, patch)}
          onUnconfirm={async () => { if (await callRpc('overtime_unconfirm_drafts', { p_draft_ids: [editing.id] }, '확정을 취소했습니다. 연장근무 기록에서 빠지고 초안으로 돌아갔습니다.')) setEditing(null) }}
        />
      )}
    </div>
  )
}

// ── 작은 부품들 ──

function Notice({ kind, text }: { kind: 'ok' | 'error' | 'info'; text: string }) {
  const c = kind === 'ok' ? { bg: '#f0fdf4', bd: '#bbf7d0', fg: '#15803d' } : kind === 'error' ? { bg: '#fef2f2', bd: '#fecaca', fg: '#b91c1c' } : { bg: '#f4f4f2', bd: '#e8e8e6', fg: '#555' }
  return <div style={{ marginBottom: 12, padding: '10px 14px', background: c.bg, border: `1px solid ${c.bd}`, borderRadius: 6, fontSize: 12, color: c.fg }}>{text}</div>
}

// 저장 가능한 직원 / 제외되는 직원(사유)을 나눠 보여준다 — 빨간 안내가 있어도 정상 직원은 저장된다는 점을 분명히
function PartialBox({ plan, ok, empName }: { plan: PartialPlan; ok: boolean; empName: (id: string) => string }) {
  if (!ok) return null
  return (
    <div data-testid="plan-partial" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 8, marginBottom: 12, fontSize: 12 }}>
      <div style={{ padding: '10px 14px', background: plan.included.length > 0 ? '#f0fdf4' : '#f4f4f2', border: `1px solid ${plan.included.length > 0 ? '#bbf7d0' : '#e8e8e6'}`, borderRadius: 8, color: plan.included.length > 0 ? '#15803d' : '#777' }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>저장 가능 {plan.included.length}명</div>
        {plan.included.length > 0 ? plan.included.map(empName).join(', ') : '저장할 수 있는 직원이 없어 초안을 저장할 수 없습니다.'}
      </div>
      {plan.excluded.length > 0 && (
        <div style={{ padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#b91c1c' }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>제외 {plan.excluded.length}명 — 이 직원들의 초안은 만들지 않습니다</div>
          {plan.excluded.map(x => <div key={x.employee_id}>· {empName(x.employee_id)}: {x.message}</div>)}
        </div>
      )}
    </div>
  )
}

function IssueList({ result, empName, projName, hideEmployees = [] }: { result: AssignmentResult; empName: (id: string) => string; projName: (id: string) => string; hideEmployees?: string[] }) {
  // 제외 직원의 사유는 PartialBox에 이미 보이므로 여기서는 뺀다
  const shown = result.issues
    .filter(i => !(i.employee_id && hideEmployees.includes(i.employee_id) && (i.severity === 'error' || i.code === 'TARGET_BELOW_LOCKED_HOURS' || i.code === 'EMPLOYEE_INACTIVE')))
    .filter(i => i.severity !== 'info' || i.code === 'WEEKEND_OR_HOLIDAY_USED' || i.code === 'PROJECT_UNASSIGNED')
  if (result.ok && shown.length === 0) return null
  const color = { error: '#b91c1c', warning: '#b45309', info: '#555' }
  return (
    <div style={{ marginBottom: 12, padding: '10px 14px', background: '#fff', border: `1px solid ${result.ok ? '#e8e8e6' : '#fecaca'}`, borderRadius: 8, fontSize: 12 }}>
      {!result.ok && <div style={{ fontWeight: 600, color: '#b91c1c', marginBottom: 4 }}>이 결과는 저장할 수 없습니다 — 아래 문제를 먼저 해결하세요</div>}
      {shown.map((i, n) => (
        <div key={n} style={{ color: color[i.severity], lineHeight: 1.6 }}>
          · {i.employee_id ? `${empName(i.employee_id)}: ` : ''}{i.project_id ? `[${projName(i.project_id)}] ` : ''}{i.message}
        </div>
      ))}
    </div>
  )
}

function Legend({ projectOrder, projName }: { projectOrder: string[]; projName: (id: string) => string }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, margin: '8px 0 16px', fontSize: 11, color: '#555' }}>
      {projectOrder.map((id, i) => (
        <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: projectColor(i) }} />{projName(id)}
        </span>
      ))}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <span style={{ width: 10, height: 10, borderRadius: 2, outline: '2px solid #ef4444', outlineOffset: -2 }} />주말·공휴일 배정
      </span>
    </div>
  )
}

function SummaryTable({ result, empName }: { result: AssignmentResult; empName: (id: string) => string }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e8e8e6', borderRadius: 8, overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: '#f4f4f2', color: '#555' }}>
            <th style={{ ...sth, textAlign: 'left' }}>직원</th>
            <th style={sth}>월 목표</th><th style={sth}>이미 입력</th><th style={sth}>새로 배정</th><th style={sth}>못 채운 시간</th>
            <th style={sth}>주별 합계 (한도 12)</th><th style={sth}>주말·공휴일</th>
          </tr>
        </thead>
        <tbody>
          {result.employees.map(e => (
            <tr key={e.employee_id} style={{ borderTop: '1px solid #f0f0ee' }}>
              <td style={{ ...std, textAlign: 'left', fontWeight: 600 }}>{empName(e.employee_id)}</td>
              <td style={std}>{e.target_hours === null ? <span style={{ color: '#b91c1c' }}>미입력</span> : `${e.target_hours}h`}</td>
              <td style={std}>{e.locked_hours}h</td>
              <td style={{ ...std, fontWeight: 700 }}>{e.assigned_hours}h</td>
              <td style={{ ...std, color: e.unassigned_hours > 0 ? '#b45309' : '#999' }}>{e.unassigned_hours}h</td>
              <td style={std}>
                {e.weekly.map(w => (
                  <span key={w.week_start} title={`${w.week_start} 주`} style={{ display: 'inline-block', margin: '0 2px', padding: '1px 5px', borderRadius: 3, background: w.total_hours >= 12 ? '#fef3c7' : '#f4f4f2', color: '#555' }}>
                    {w.total_hours}
                  </span>
                ))}
              </td>
              <td style={std}>{e.weekend_holiday_count || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ConfirmByEmployee({ employees, disabled, label, minCount = 2, onConfirm }: { employees: Employee[]; disabled: boolean; label: string; minCount?: number; onConfirm: (ids: string[]) => void }) {
  const [pick, setPick] = useState('')
  if (employees.length < minCount) return null
  return (
    <span style={{ display: 'inline-flex', gap: 4 }}>
      <select value={pick} onChange={e => setPick(e.target.value)} style={selectStyle}>
        <option value="">직원 선택</option>
        {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
      </select>
      <button disabled={disabled || !pick} onClick={() => { onConfirm([pick]); setPick('') }} style={{ ...outlineBtn, opacity: disabled || !pick ? 0.5 : 1 }}>{label}</button>
    </span>
  )
}

function DraftEditor({ draft, employeeName, projectName, tasks, currentTaskName, isAdmin, busy, onClose, onSave, onUnconfirm }: {
  draft: AssignmentDraft
  employeeName: string
  projectName: string
  tasks: EmployeeTask[]
  currentTaskName: string
  isAdmin: boolean
  busy: boolean
  onClose: () => void
  onSave: (patch: Partial<Pick<AssignmentDraft, 'time_type' | 'task_id' | 'status'>>) => void
  onUnconfirm: () => void
}) {
  const [timeType, setTimeType] = useState(draft.time_type)
  const [taskId, setTaskId] = useState(draft.task_id ?? '')
  const confirmed = draft.status === 'confirmed'
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 360, maxWidth: 'calc(100vw - 32px)', background: '#fff', borderRadius: 10, padding: 20, fontSize: 13 }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>{employeeName} · {Number(draft.work_date.slice(5, 7))}/{Number(draft.work_date.slice(8, 10))}</div>
        <div style={{ fontSize: 12, color: '#777', marginBottom: 14 }}>{projectName}{draft.exception_reason ? ` · ${draft.exception_reason}` : ''}</div>
        {confirmed ? (
          <>
            <div style={{ fontSize: 12, color: '#555', marginBottom: 14 }}>확정된 배정입니다({currentTaskName} · {draft.hours}시간). 확정을 취소하면 연장근무 기록에서 빠지고 초안으로 돌아갑니다.</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
              <button onClick={onClose} style={outlineBtn}>닫기</button>
              {isAdmin && <button disabled={busy} onClick={onUnconfirm} style={dangerBtn}>확정 취소</button>}
            </div>
          </>
        ) : (
          <>
            <label style={{ display: 'block', fontSize: 12, color: '#555', marginBottom: 4 }}>시간</label>
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              {(['2h', '3h'] as const).map(t => (
                <button key={t} onClick={() => setTimeType(t)} style={timeType === t ? tabBtnActive : { ...tabBtn, border: '1px solid #e8e8e6', borderRadius: 4 }}>
                  {t === '2h' ? '2시간 (18~21시)' : '3시간 (18~22시)'}
                </button>
              ))}
            </div>
            <label style={{ display: 'block', fontSize: 12, color: '#555', marginBottom: 4 }}>업무</label>
            <select value={taskId} onChange={e => setTaskId(e.target.value)} style={{ ...selectStyle, width: '100%', marginBottom: 16 }}>
              {!draft.task_id && <option value="">{draft.task_name} (지워진 업무)</option>}
              {tasks.map(t => <option key={t.id} value={t.id}>{t.task_name}</option>)}
            </select>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
              <button disabled={busy} onClick={() => onSave({ status: 'discarded' })} style={dangerBtn}>이 칸 빼기</button>
              <span style={{ display: 'flex', gap: 6 }}>
                <button onClick={onClose} style={outlineBtn}>취소</button>
                <button
                  disabled={busy || !taskId || (timeType === draft.time_type && taskId === draft.task_id)}
                  onClick={() => onSave({ ...(timeType !== draft.time_type ? { time_type: timeType } : {}), ...(taskId !== draft.task_id ? { task_id: taskId } : {}) })}
                  style={darkBtn}
                >저장</button>
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const navBtn: React.CSSProperties = { width: 28, height: 28, borderRadius: 4, border: '1px solid #e8e8e6', background: '#fff', cursor: 'pointer', fontSize: 14, color: '#555' }
const tabBtn: React.CSSProperties = { height: 30, padding: '0 12px', border: 'none', background: '#fff', color: '#555', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }
const tabBtnActive: React.CSSProperties = { ...tabBtn, background: '#111', color: '#fff', borderRadius: 4 }
const outlineBtn: React.CSSProperties = { height: 30, padding: '0 12px', borderRadius: 5, border: '1px solid #e8e8e6', background: '#fff', color: '#333', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }
const primaryBtn: React.CSSProperties = { ...outlineBtn, borderColor: '#3b82f6', color: '#1d4ed8', fontWeight: 600 }
const darkBtn: React.CSSProperties = { ...outlineBtn, background: '#111', borderColor: '#111', color: '#fff' }
const dangerBtn: React.CSSProperties = { ...outlineBtn, background: '#fee2e2', borderColor: '#fecaca', color: '#b91c1c' }
const selectStyle: React.CSSProperties = { height: 30, padding: '0 8px', border: '1px solid #e8e8e6', borderRadius: 5, fontSize: 12, background: '#fff' }
const sth: React.CSSProperties = { padding: '8px 10px', fontWeight: 500, textAlign: 'center', whiteSpace: 'nowrap' }
const std: React.CSSProperties = { padding: '7px 10px', textAlign: 'center' }
