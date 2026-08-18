'use client'

import { useEffect, useState, useCallback } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { useIsMobile } from '@/lib/useIsMobile'
import AddressMapPreview from '@/app/components/AddressMapPreview'
import { openDirectionsFromOffice } from '@/lib/kakaoMap'
import { useMenuPermission } from '@/app/components/PermissionsProvider'
import { syncProjectCalendar } from '@/lib/googleCalendar/trigger'
import { WRITTEN_EVALUATION_LABEL } from '@/lib/projectStatus'

type ProjectStatus = '진행중' | '수주' | '탈락' | '취소'
type ProjectType = '면접' | 'SOQ' | '종심제' | 'TP' | 'PQ' | '기타' | ''

interface Project {
  id: string
  project_number: string
  type: ProjectType
  client: string
  name: string
  fee: number | null
  tp_score: string
  duration_days: string
  announce_date: string | null
  submit_date: string | null
  interview_date: string | null
  /** 발표 없이 서면으로만 평가하는 공고 — true면 interview_date는 비어 있다 */
  interview_written: boolean
  bid_date: string | null
  result_score: string
  status: ProjectStatus
  evaluation: string
  award_fee: number | null
  participants: string
  participation_ratio: string
  director: string
  status_override: string | null
  staff_arch: string
  staff_civil: string
  staff_mech: string
  staff_safety: string
  note: string
  created_at: string
}

interface TooltipData {
  project_number?: string
  location?: string
  interview_location?: string
  area?: string
  scale?: string
  est_cost?: string
  designer?: string
  builder?: string
  score_dist?: string
  competitors?: string
  proposal_p?: string
  self_intro_p?: string
  ppt_p?: string
  pq_date?: string
  soq_date?: string
  interview_time?: string
  notify_date?: string
  announcement?: string
}

// 통합 폼 데이터 (프로젝트 + 툴팁)
interface FormData {
  // projects 테이블
  project_number: string
  type: ProjectType
  client: string
  name: string
  fee: number | null
  tp_score: string
  duration_days: string
  announce_date: string | null
  submit_date: string | null
  interview_date: string | null
  interview_written: boolean
  bid_date: string | null
  result_score: string
  evaluation: string
  award_fee: number | null
  participants: string
  participation_ratio: string
  director: string
  status_override: string | null
  staff_arch: string
  staff_civil: string
  staff_mech: string
  staff_safety: string
  note: string
  // project_tooltips 테이블 (추가 정보)
  location: string
  interview_location: string
  area: string
  scale: string
  est_cost: string
  designer: string
  builder: string
  score_dist: string
  competitors: string
  proposal_p: string
  self_intro_p: string
  ppt_p: string
  pq_date: string
  soq_date: string
  interview_time: string
  notify_date: string
  announcement: string
}

const EMPTY_FORM: FormData = {
  project_number: '', type: '면접', client: '', name: '',
  fee: null, tp_score: '', duration_days: '',
  announce_date: null, submit_date: null, interview_date: null, interview_written: false, bid_date: null,
  result_score: '', evaluation: '', award_fee: null,
  participants: '', participation_ratio: '',
  director: '', status_override: null,
  staff_arch: '', staff_civil: '', staff_mech: '', staff_safety: '',
  note: '',
  location: '', interview_location: '', area: '', scale: '', est_cost: '',
  designer: '', builder: '', score_dist: '', competitors: '',
  proposal_p: '', self_intro_p: '', ppt_p: '',
  pq_date: '', soq_date: '', interview_time: '', notify_date: '',
  announcement: '',
}

function computeStatus(result_score: string, evaluation: string, participants = '', override: string | null = null): ProjectStatus {
  if (override) return override as ProjectStatus
  if (participants.includes('드랍') || participants.includes('드롭')) return '취소'
  if (evaluation === '선') return '수주'
  if (!result_score?.trim() || !evaluation?.trim()) return '진행중'
  return '탈락'
}

const STATUS_STYLE: Record<ProjectStatus, React.CSSProperties> = {
  진행중: { background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' },
  수주:   { background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0' },
  탈락:   { background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' },
  취소:   { background: '#f4f4f2', color: '#888',    border: '1px solid #ddd' },
}

/**
 * 행 전체 음영 — xlsx 출력(lib/projects/export/projectLedgerWorkbook.ts)에서 수주는 노랑,
 * 취소(드랍)는 회색으로 칠하는 것과 같은 규칙. 다만 엑셀 원본 값(FFFF00·808080)을 화면에
 * 그대로 쓰면 글자가 묻히므로 같은 색 계열의 옅은 톤으로 낮춰 잡았다.
 */
const ROW_FILL: Partial<Record<ProjectStatus, string>> = {
  수주: '#fff8c4',
  취소: '#dedede',
}

const TYPES: ProjectType[] = ['면접', 'SOQ', '종심제', 'TP', 'PQ', '기타']
const STATUSES: ProjectStatus[] = ['진행중', '수주', '탈락', '취소']

// 표 본문 열 순서. 수정/삭제 버튼 열(관리)은 canWrite일 때만 이 뒤에 붙는다.
//
// 번호·용역명이 맨 앞에 붙어 있는 건 이 둘을 가로 스크롤에서 고정하기 때문이다(아래 STICKY_*).
// 열이 21개라 오른쪽 일정·인력 칸을 보려면 반드시 가로로 스크롤해야 하는데, 예전 순서
// (번호·유형·발주처·용역명)에서는 용역명이 화면 밖으로 밀려나 "이 날짜가 어느 프로젝트 것인지"를
// 알 수 없었다. sticky는 인접한 앞쪽 열에만 걸 수 있어 용역명을 번호 옆으로 옮겼다.
// 열은 키로 다룬다 — 보기 모드가 일부만 보여주므로 머리글과 본문 칸이 같은 키를 보고 켜지고
// 꺼져야 한다(둘을 따로 나열하면 순서가 어긋나도 알아채기 어렵다).
const COLUMNS = [
  { key: 'number', label: '번호' },
  { key: 'name', label: '용역명' },
  { key: 'type', label: '유형' },
  { key: 'client', label: '발주처' },
  { key: 'fee', label: '용역비(억)' },
  { key: 'tp_score', label: '제안서' },
  { key: 'score', label: '점수' },
  { key: 'announce', label: '공고일' },
  { key: 'submit', label: '제출일' },
  { key: 'interview', label: '발표일' },
  { key: 'bid', label: '개찰일' },
  { key: 'result', label: '결과' },
  { key: 'evaluation', label: '낙찰사' },
  { key: 'award', label: '낙찰액' },
  { key: 'participants', label: '참여사' },
  { key: 'director', label: '단장' },
  { key: 'arch', label: '건축' },
  { key: 'civil', label: '토목' },
  { key: 'mech', label: '기계' },
  { key: 'safety', label: '안전' },
  { key: 'status', label: '상태' },
] as const

/**
 * 보기 모드 — 21개 열을 한 번에 다 보려니 가로 스크롤이 길어져서, 목적별로 필요한 열만 남긴다.
 * 번호·용역명은 왼쪽 고정 열이라 어느 모드에서나 항상 보이고, 상태는 어느 모드에서든 판단에
 * 필요해 공통으로 넣는다. '전체'는 지금까지와 똑같이 전부 보여준다.
 */
const VIEW_MODES = ['일정', '결과', '인력', '전체'] as const
type ViewMode = (typeof VIEW_MODES)[number]

const ALWAYS_VISIBLE = ['number', 'name'] as const

const VIEW_MODE_COLUMNS: Record<Exclude<ViewMode, '전체'>, readonly string[]> = {
  일정: ['type', 'client', 'announce', 'submit', 'interview', 'bid', 'status'],
  결과: ['client', 'fee', 'result', 'evaluation', 'award', 'participants', 'status'],
  인력: ['client', 'director', 'arch', 'civil', 'mech', 'safety', 'status'],
}

function visibleColumnKeys(mode: ViewMode): Set<string> {
  if (mode === '전체') return new Set(COLUMNS.map(c => c.key))
  return new Set([...ALWAYS_VISIBLE, ...VIEW_MODE_COLUMNS[mode]])
}

// 고정 열 너비 — boxSizing: border-box와 함께 써서 padding까지 포함한 실제 렌더 폭이 이 값이 되게
// 한다. 용역명의 left 오프셋이 번호 열 폭과 정확히 같아야 경계에 빈틈이 생기지 않는다.
const STICKY_NUM_WIDTH = 72
const STICKY_NAME_WIDTH = 220

/**
 * 가로 스크롤 시 왼쪽에 고정되는 칸의 공통 스타일.
 * borderCollapse: 'collapse' 표에서는 sticky 셀의 오른쪽 테두리가 스크롤 중 사라지므로,
 * 경계선은 border 대신 boxShadow로 그린다(그림자를 함께 줘서 접힌 면이 보이게).
 *
 * 겹침 순서(z-index)를 값으로 못 박아 둔 이유: 같은 z-index면 DOM에서 나중에 나온 쪽이 위로
 * 올라오는데, tbody가 thead보다 뒤에 있어 본문 고정 칸이 머리글을 가려버린다. 아래 세 단계를
 * 반드시 지켜야 세로·가로 고정이 동시에 성립한다.
 *   1 = 본문·합계의 고정 칸 (가로 스크롤되는 일반 칸 위)
 *   2 = 머리글의 일반 칸      (본문 고정 칸 위)
 *   3 = 머리글의 고정 칸      (세로·가로 양쪽 고정이라 가장 위)
 */
const STICKY_Z_BODY = 1
const STICKY_Z_HEADER = 2
const STICKY_Z_HEADER_FROZEN = 3

function stickyCol(
  offset: number,
  width: number,
  background: string,
  isLast = false,
  zIndex: number = STICKY_Z_BODY,
): React.CSSProperties {
  return {
    position: 'sticky',
    left: offset,
    zIndex,
    width,
    minWidth: width,
    maxWidth: width,
    boxSizing: 'border-box',
    background,
    boxShadow: isLast ? '1px 0 0 #e8e8e6, 3px 0 6px rgba(0,0,0,0.05)' : undefined,
  }
}

/** 발표일 칸에 보일 값 — 서면평가 건은 날짜 대신 "서면평가"로 적는다. */
function interviewText(p: { interview_written?: boolean | null; interview_date: string | null }): string {
  if (p.interview_written) return WRITTEN_EVALUATION_LABEL
  return p.interview_date ?? '-'
}

export default function ProjectsPage() {
  const isMobile = useIsMobile()
  const supabase = createSupabaseBrowserClient()
  // 읽기 권한 사용자는 조회만 — 추가/수정/삭제/메모 편집 UI를 숨긴다 (관리자 화면에서 설정)
  const canWrite = useMenuPermission('projects') === 'write'
  const [projects, setProjects] = useState<Project[]>([])
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<ProjectStatus | '전체'>('전체')
  const [filterType, setFilterType] = useState<ProjectType | '전체'>('전체')
  // 보기 모드는 필터가 아니라 "어떤 열을 볼지"만 정한다 — 행 집합과 합계는 영향받지 않는다.
  const [viewMode, setViewMode] = useState<ViewMode>('일정')
  const [tooltipAll, setTooltipAll] = useState<Record<string, TooltipData>>({})
  const [tooltipView, setTooltipView] = useState<{ project: Project; data: TooltipData } | null>(null)
  const [dirMsg, setDirMsg] = useState<string | null>(null)
  const [dirLoading, setDirLoading] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, Record<string, string>>>({})
  const [notePopup, setNotePopup] = useState<{ projectNumber: string; field: string; draft: string; rect: DOMRect } | null>(null)
  const [noteSaving, setNoteSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  // 통합 편집 모달
  const [modal, setModal] = useState<{ open: boolean; form: FormData; editId: string | null }>({
    open: false, form: { ...EMPTY_FORM }, editId: null,
  })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const loadNotes = useCallback(async () => {
    const { data } = await supabase.from('project_notes').select('*')
    if (data) {
      const map: Record<string, Record<string, string>> = {}
      for (const row of data) {
        if (!map[row.project_number]) map[row.project_number] = {}
        map[row.project_number][row.field] = row.note
      }
      setNotes(map)
    }
  }, [])

  const openNote = (e: React.MouseEvent, projectNumber: string, field: string) => {
    e.stopPropagation()
    if (!canWrite) return
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const draft = notes[projectNumber]?.[field] ?? ''
    setNotePopup({ projectNumber, field, draft, rect })
  }

  const saveNote = async () => {
    if (!notePopup) return
    setNoteSaving(true)
    const { projectNumber, field, draft } = notePopup
    if (draft.trim()) {
      await supabase.from('project_notes').upsert({ project_number: projectNumber, field, note: draft, updated_at: new Date().toISOString() }, { onConflict: 'project_number,field' })
    } else {
      await supabase.from('project_notes').delete().eq('project_number', projectNumber).eq('field', field)
    }
    await loadNotes()
    setNotePopup(null)
    setNoteSaving(false)
  }

  const loadTooltips = useCallback(async () => {
    const { data } = await supabase.from('project_tooltips').select('*')
    if (data) {
      const map: Record<string, TooltipData> = {}
      for (const row of data) map[row.project_number] = row as TooltipData
      setTooltipAll(map)
    }
  }, [])

  const load = useCallback(async () => {
    const { data } = await supabase.from('projects').select('*').order('project_number', { ascending: true })
    if (data) setProjects(data as Project[])
  }, [])

  useEffect(() => { load(); loadTooltips(); loadNotes() }, [load, loadTooltips, loadNotes])

  const filtered = projects.filter(p => {
    const q = search.toLowerCase()
    const matchSearch = !search || p.name.toLowerCase().includes(q) || p.client.toLowerCase().includes(q) || p.director.toLowerCase().includes(q) || p.project_number.includes(q)
    const matchStatus = filterStatus === '전체' || computeStatus(p.result_score, p.evaluation, p.participants, p.status_override) === filterStatus
    const matchType = filterType === '전체' || p.type === filterType
    return matchSearch && matchStatus && matchType
  })

  const openAdd = () => setModal({ open: true, form: { ...EMPTY_FORM }, editId: null })

  const openEdit = (p: Project) => {
    const tip = tooltipAll[p.project_number] ?? {}
    setModal({
      open: true,
      editId: p.id,
      form: {
        project_number: p.project_number, type: p.type, client: p.client, name: p.name,
        fee: p.fee, tp_score: p.tp_score, duration_days: p.duration_days,
        announce_date: p.announce_date, submit_date: p.submit_date, interview_date: p.interview_date,
        interview_written: !!p.interview_written, bid_date: p.bid_date,
        result_score: p.result_score, evaluation: p.evaluation, award_fee: p.award_fee,
        participants: p.participants, participation_ratio: p.participation_ratio,
        director: p.director, status_override: p.status_override,
        staff_arch: p.staff_arch, staff_civil: p.staff_civil, staff_mech: p.staff_mech, staff_safety: p.staff_safety,
        note: p.note,
        location: tip.location ?? '', interview_location: tip.interview_location ?? '', area: tip.area ?? '', scale: tip.scale ?? '',
        est_cost: tip.est_cost ?? '', designer: tip.designer ?? '', builder: tip.builder ?? '',
        score_dist: tip.score_dist ?? '', competitors: tip.competitors ?? '',
        proposal_p: tip.proposal_p ?? '', self_intro_p: tip.self_intro_p ?? '', ppt_p: tip.ppt_p ?? '',
        pq_date: tip.pq_date ?? '', soq_date: tip.soq_date ?? '',
        interview_time: tip.interview_time ?? '', notify_date: tip.notify_date ?? '',
        announcement: tip.announcement ?? '',
      },
    })
  }

  const closeTooltipView = () => { setTooltipView(null); setDirMsg(null) }

  const openDirections = async (label: string, address: string) => {
    setDirMsg(null)
    setDirLoading(label)
    const res = await openDirectionsFromOffice(label, address)
    if (!res.ok) setDirMsg(res.message ?? '길찾기를 열 수 없습니다.')
    setDirLoading(null)
  }

  const closeModal = () => setModal(m => ({ ...m, open: false }))
  const set = (field: keyof FormData, value: unknown) => setModal(m => ({ ...m, form: { ...m.form, [field]: value } }))

  const save = async () => {
    if (!modal.form.name.trim()) return
    setSaving(true)
    setSaveError(null)
    try {
      const f = modal.form
      const projectPayload = {
        project_number: f.project_number, type: f.type, client: f.client, name: f.name,
        fee: f.fee, tp_score: f.tp_score, duration_days: f.duration_days,
        announce_date: f.announce_date || null, submit_date: f.submit_date || null,
        // 서면평가는 기다릴 발표가 없다 — 날짜와 동시에 성립할 수 없으므로 날짜는 비워 저장한다.
        interview_date: f.interview_written ? null : (f.interview_date || null),
        interview_written: f.interview_written,
        bid_date: f.bid_date || null,
        result_score: f.result_score, evaluation: f.evaluation, award_fee: f.award_fee,
        participants: f.participants, participation_ratio: f.participation_ratio,
        director: f.director, status_override: f.status_override || null,
        staff_arch: f.staff_arch, staff_civil: f.staff_civil, staff_mech: f.staff_mech, staff_safety: f.staff_safety,
        note: f.note,
        status: computeStatus(f.result_score, f.evaluation, f.participants, f.status_override),
      }

      const tooltipPayload = {
        project_number: f.project_number,
        location: f.location, interview_location: f.interview_location, area: f.area, scale: f.scale, est_cost: f.est_cost,
        designer: f.designer, builder: f.builder, score_dist: f.score_dist, competitors: f.competitors,
        proposal_p: f.proposal_p, self_intro_p: f.self_intro_p, ppt_p: f.ppt_p,
        pq_date: f.pq_date, soq_date: f.soq_date, interview_time: f.interview_time,
        notify_date: f.notify_date, announcement: f.announcement,
      }

      const hasTooltipData = Object.entries(tooltipPayload)
        .filter(([k]) => k !== 'project_number')
        .some(([, v]) => v && String(v).trim() !== '')
      // 이미 상세정보 행이 있으면 전부 비워도 반드시 써야 한다 — 값이 하나만 남은 상태에서 그걸
      // 지우면 payload가 전부 비어 hasTooltipData가 false가 되고, 예전에는 그대로 저장을 건너뛰어
      // DB에 옛 값이 남았다(지운 게 반영되지 않음). PQ 제출일/평가통보일의 "달력으로" 버튼이
      // 값을 비우는 동작이라 이 경로를 실제로 밟게 된다.
      const hasExistingTooltip = !!tooltipAll[f.project_number]

      // 캘린더 동기화에 넘길 프로젝트 id — 신규 등록이면 방금 만들어진 행의 id를 받아온다.
      let savedProjectId: string | null = null

      if (modal.editId) {
        const { error: projErr } = await supabase.from('projects').update({ ...projectPayload, updated_at: new Date().toISOString() }).eq('id', modal.editId)
        if (projErr) { setSaveError(`저장 실패: ${projErr.message}`); return }
        savedProjectId = modal.editId
        if (hasTooltipData || hasExistingTooltip) {
          const { error: tipErr } = await supabase.from('project_tooltips').upsert({ ...tooltipPayload, updated_at: new Date().toISOString() }, { onConflict: 'project_number' })
          if (tipErr) { setSaveError(`상세정보 저장 실패: ${tipErr.message}`); return }
        }
        // 사업명이 변경된 경우 performing_projects의 이름도 동기화
        const oldProject = projects.find(p => p.id === modal.editId)
        if (oldProject && oldProject.name !== f.name) {
          await supabase.from('performing_projects').update({ name: f.name }).eq('name', oldProject.name)
        }
      } else {
        const { data: inserted, error: projErr } = await supabase.from('projects').insert(projectPayload).select('id').single()
        if (projErr) { setSaveError(`저장 실패: ${projErr.message}`); return }
        savedProjectId = inserted?.id ?? null
        if (hasTooltipData) {
          const { error: tipErr } = await supabase.from('project_tooltips').insert(tooltipPayload)
          if (tipErr) { setSaveError(`상세정보 저장 실패: ${tipErr.message}`); return }
        }
      }

      // Google Calendar 동기화 — 저장이 끝난 뒤 별도 요청으로 보낸다(기다리지 않고, 실패해도
      // 저장에는 영향 없음). lib/googleCalendar/trigger.ts 참고.
      if (savedProjectId) syncProjectCalendar(savedProjectId)

      await Promise.all([load(), loadTooltips()])
      closeModal()
    } finally { setSaving(false) }
  }

  const remove = async (id: string, projectNumber: string) => {
    if (!confirm('삭제하시겠습니까?')) return
    setDeleting(id)
    await Promise.all([
      supabase.from('projects').delete().eq('id', id),
      supabase.from('project_tooltips').delete().eq('project_number', projectNumber),
    ])
    // 프로젝트가 사라졌으므로 연결된 캘린더 일정도 지워야 한다 — 서버가 고아 행을 보고 삭제한다.
    syncProjectCalendar(id)
    await load()
    setDeleting(null)
  }

  /**
   * 기존 관리대장 서식(2시트: 프로젝트 대장 + 참여기술자 집계) 그대로 xlsx를 받는다.
   * 시트 조립은 서버가 DB를 다시 읽어서 한다(app/api/projects/export/route.ts) — 화면이 만든 행을
   * 올려보내지 않고, 화면과 같은 검색·상태·유형 필터만 넘겨 "보이는 그대로"를 맞춘다.
   */
  const exportExcel = async () => {
    if (exporting) return
    setExporting(true)
    setExportError(null)
    try {
      const res = await fetch('/api/projects/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters: { search, status: filterStatus, type: filterType } }),
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.error ?? '출력 생성에 실패했습니다.')
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      // 파일명은 서버가 헤더로 알려준 값을 그대로 쓴다(출근명부 다운로드와 같은 방식).
      const disposition = res.headers.get('content-disposition') ?? ''
      const match = /filename\*=UTF-8''([^;]+)/.exec(disposition)
      a.download = match ? decodeURIComponent(match[1]) : '참여프로젝트 관리.xlsx'
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: unknown) {
      setExportError(e instanceof Error ? e.message : '출력 생성에 실패했습니다.')
    } finally {
      setExporting(false)
    }
  }

  const totalFee = filtered.reduce((s, p) => s + (p.fee ?? 0), 0)
  // 보기 모드가 고른 열만 남긴다. 수정/삭제 버튼은 표 맨 오른쪽 "관리" 열에 모으고, 읽기 권한이면
  // 빈 열이 남지 않게 아예 뺀다.
  const visibleKeys = visibleColumnKeys(viewMode)
  const shownColumns = COLUMNS.filter(c => visibleKeys.has(c.key))
  const headers = canWrite ? [...shownColumns, { key: 'manage', label: '관리' }] : shownColumns
  /** 본문 칸을 그릴지 — 머리글과 같은 키를 본다. */
  const show = (key: string) => visibleKeys.has(key)

  /**
   * 모바일 카드에 넣을 항목 — 표의 본문 칸과 같은 값을, 같은 열 키로 고른다.
   * 번호·용역명·유형·상태는 카드 머리에 따로 그리므로 여기서 빠진다.
   */
  const mobileFields = (p: Project, scoreDist: string) => {
    const note = (field: string) => notes[p.project_number]?.[field]
    const fields: { key: string; label: string; node: React.ReactNode }[] = [
      { key: 'client', label: '발주처', node: <NoteCell value={p.client} note={note('client')} onNote={e => openNote(e, p.project_number, 'client')} /> },
      { key: 'fee', label: '용역비(억)', node: p.fee != null ? p.fee : '-' },
      { key: 'tp_score', label: '제안서', node: p.tp_score || '-' },
      { key: 'score', label: '점수', node: scoreDist.match(/^[\d.]+/)?.[0] ?? '-' },
      { key: 'announce', label: '공고일', node: p.announce_date ?? '-' },
      { key: 'submit', label: '제출일', node: <NoteCell value={p.submit_date ?? '-'} note={note('submit_date')} onNote={e => openNote(e, p.project_number, 'submit_date')} /> },
      { key: 'interview', label: '발표일', node: <NoteCell value={interviewText(p)} note={note('interview_date')} onNote={e => openNote(e, p.project_number, 'interview_date')} /> },
      { key: 'bid', label: '개찰일', node: <NoteCell value={p.bid_date ?? '-'} note={note('bid_date')} onNote={e => openNote(e, p.project_number, 'bid_date')} /> },
      { key: 'result', label: '결과', node: p.result_score || '-' },
      { key: 'evaluation', label: '낙찰사', node: p.evaluation || '-' },
      { key: 'award', label: '낙찰액', node: p.award_fee != null ? p.award_fee : '-' },
      { key: 'participants', label: '참여사', node: <NoteCell value={(p.participants.match(/\d+개사/) ?? [''])[0] || p.participants} note={note('competitors')} onNote={e => openNote(e, p.project_number, 'competitors')} /> },
      { key: 'director', label: '단장', node: p.director || '-' },
      { key: 'arch', label: '건축', node: p.staff_arch || '-' },
      { key: 'civil', label: '토목', node: p.staff_civil || '-' },
      { key: 'mech', label: '기계', node: p.staff_mech || '-' },
      { key: 'safety', label: '안전', node: p.staff_safety || '-' },
    ]
    return fields.filter(f => show(f.key))
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f8f8f7' }}>
      <header style={{ background: '#fff', borderBottom: '1px solid #e8e8e6' }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', padding: isMobile ? '0 12px' : '0 24px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 14, color: '#555' }}>프로젝트 List</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={exportExcel} disabled={exporting} style={{ ...outlineBtn, opacity: exporting ? 0.6 : 1 }}>
              {exporting ? '만드는 중...' : '엑셀 내보내기'}
            </button>
            {canWrite && <button onClick={openAdd} style={primaryBtn}>+ 추가</button>}
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1400, margin: '0 auto', padding: isMobile ? '12px 12px 60px' : '20px 24px 60px' }}>
        {exportError && (
          <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 6, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 12 }}>
            {exportError}
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
          {([['전체', projects], ['진행중', projects.filter(p => computeStatus(p.result_score, p.evaluation, p.participants, p.status_override) === '진행중')], ['수주', projects.filter(p => computeStatus(p.result_score, p.evaluation, p.participants, p.status_override) === '수주')]] as [string, Project[]][]).map(([label, list]) => (
            <div key={label} style={{ background: '#fff', border: '1px solid #e8e8e6', borderRadius: 8, padding: '12px 16px' }}>
              <div style={{ fontSize: 12, color: '#999', marginBottom: 4 }}>{label === '전체' ? '전체 프로젝트' : label}</div>
              <div style={{ fontSize: 20, fontWeight: 600, color: '#111' }}>{list.length}건</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="공사번호, 용역명, 발주처, 단장 검색..."
            style={{ flex: 1, minWidth: 200, height: 34, padding: '0 12px', border: '1px solid #e8e8e6', borderRadius: 6, fontSize: 13, background: '#fff' }} />
          <div style={{ display: 'flex', gap: 4 }}>
            {(['전체', '진행중', '수주', '탈락', '취소'] as const).map(s => (
              <button key={s} onClick={() => setFilterStatus(s)} style={{ height: 34, padding: '0 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer', border: filterStatus === s ? 'none' : '1px solid #e8e8e6', background: filterStatus === s ? '#111' : '#fff', color: filterStatus === s ? '#fff' : '#555' }}>{s}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['전체', '면접', 'SOQ', '종심제', 'TP', 'PQ'] as const).map(t => (
              <button key={t} onClick={() => setFilterType(t)} style={{ height: 34, padding: '0 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer', border: filterType === t ? 'none' : '1px solid #e8e8e6', background: filterType === t ? '#2563eb' : '#fff', color: filterType === t ? '#fff' : '#555' }}>{t}</button>
            ))}
          </div>
        </div>

        {/* 보기 모드 — 행을 거르는 위 필터들과 하는 일이 달라(열만 고른다) 줄을 나누고 라벨을 붙인다 */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: '#999' }}>보기</span>
          <div style={{ display: 'flex', gap: 4 }}>
            {VIEW_MODES.map(m => (
              <button
                key={m}
                onClick={() => setViewMode(m)}
                title={m === '전체' ? '모든 열 보기' : `용역명과 ${m} 관련 열만 보기`}
                style={{
                  height: 30, padding: '0 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                  border: viewMode === m ? 'none' : '1px solid #e8e8e6',
                  background: viewMode === m ? '#0f766e' : '#fff',
                  color: viewMode === m ? '#fff' : '#555',
                }}
              >{m}</button>
            ))}
          </div>
          <span style={{ fontSize: 11, color: '#bbb' }}>
            {isMobile ? '카드에 표시할 항목을 고릅니다' : `${headers.length}개 열 표시 중 · 번호·용역명은 항상 왼쪽에 고정`}
          </span>
        </div>

        {isMobile ? (
          /* 모바일 — 21열 표를 폰 화면에 넣으면 고정 열(번호+용역명)만으로 폭을 거의 다 써서
             나머지 칸을 볼 자리가 남지 않는다. 같은 데이터를 카드로 세로로 쌓고, 보기 모드가
             고른 항목만 카드 안에 넣는다(표와 같은 열 키를 본다). */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#bbb', fontSize: 13, background: '#fff', border: '1px solid #e8e8e6', borderRadius: 8 }}>데이터가 없습니다</div>
            ) : filtered.map(p => {
              const hasTooltip = !!tooltipAll[p.project_number]
              const scoreDist = tooltipAll[p.project_number]?.score_dist ?? ''
              const status = computeStatus(p.result_score, p.evaluation, p.participants, p.status_override)
              const fields = mobileFields(p, scoreDist)
              return (
                <div key={p.id} style={{ background: ROW_FILL[status] ?? '#fff', border: '1px solid #e8e8e6', borderRadius: 10, padding: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                      <span style={{ fontSize: 11, color: '#999' }}>{p.project_number}</span>
                      <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 3, background: 'rgba(0,0,0,0.06)', color: '#555' }}>{p.type}</span>
                    </div>
                    <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 4, flexShrink: 0, ...STATUS_STYLE[status] }}>{status}</span>
                  </div>
                  <div
                    onClick={() => { const d = tooltipAll[p.project_number]; if (d) setTooltipView({ project: p, data: d }) }}
                    style={{
                      fontSize: 14, fontWeight: 600, lineHeight: 1.4, marginBottom: fields.length ? 10 : 0,
                      color: hasTooltip ? '#1d4ed8' : '#111',
                      textDecoration: hasTooltip ? 'underline dotted' : 'none',
                    }}
                  >{p.name}</div>
                  {fields.length > 0 && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px 10px', fontSize: 13, color: '#333' }}>
                      {fields.map(f => (
                        <div key={f.key} style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 11, color: '#999', marginBottom: 2 }}>{f.label}</div>
                          <div style={{ minWidth: 0, overflow: 'hidden' }}>{f.node}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {canWrite && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                      <button onClick={() => openEdit(p)} style={{ ...editBtn, height: 30, flex: 1 }}>수정</button>
                      <button onClick={() => remove(p.id, p.project_number)} disabled={deleting === p.id} style={{ ...deleteBtn, height: 30, flex: 1 }}>삭제</button>
                    </div>
                  )}
                </div>
              )
            })}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 12px', background: '#f9f9f8', border: '1px solid #e8e8e6', borderRadius: 8, fontSize: 12, color: '#555' }}>
              <span>합계 {filtered.length}건</span>
              <span style={{ fontWeight: 600, color: '#111' }}>{totalFee.toFixed(1)}억</span>
            </div>
          </div>
        ) : (
        <div style={{ background: '#fff', border: '1px solid #e8e8e6', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 280px)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#f4f4f2' }}>
                {headers.map((h, i) => {
                  // 앞 두 열(번호·용역명)은 세로(top)와 가로(left) 양쪽으로 고정되므로, 나머지
                  // 머리글보다 위에 떠 있어야 스크롤된 셀에 가려지지 않는다.
                  const frozen = i === 0
                    ? stickyCol(0, STICKY_NUM_WIDTH, '#f4f4f2', false, STICKY_Z_HEADER_FROZEN)
                    : i === 1
                      ? stickyCol(STICKY_NUM_WIDTH, STICKY_NAME_WIDTH, '#f4f4f2', true, STICKY_Z_HEADER_FROZEN)
                      : null
                  return (
                    <th
                      key={h.key}
                      style={{
                        padding: '8px 12px', textAlign: 'left', fontWeight: 500, color: '#555',
                        borderBottom: '1px solid #e8e8e6', whiteSpace: 'nowrap',
                        position: 'sticky', top: 0, background: '#f4f4f2', zIndex: STICKY_Z_HEADER,
                        ...frozen,
                      }}
                    >{h.label}</th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={headers.length} style={{ padding: 40, textAlign: 'center', color: '#bbb' }}>데이터가 없습니다</td></tr>
              ) : filtered.map(p => {
                const hasTooltip = !!tooltipAll[p.project_number]
                const scoreDist = tooltipAll[p.project_number]?.score_dist ?? ''
                const status = computeStatus(p.result_score, p.evaluation, p.participants, p.status_override)
                // 고정 열은 가로 스크롤 시 뒤 칸을 가려야 하므로 배경이 투명하면 안 된다 — 행 음영을 그대로 넘긴다.
                const rowBg = ROW_FILL[status] ?? '#fff'
                return (
                  <tr key={p.id} style={{ borderBottom: '1px solid #f0f0ee', background: rowBg }}>
                    <td style={{ ...tdnw, ...stickyCol(0, STICKY_NUM_WIDTH, rowBg) }}>
                      <span style={{ color: '#999' }}>{p.project_number}</span>
                    </td>
                    <td style={{ ...tdnw, ...stickyCol(STICKY_NUM_WIDTH, STICKY_NAME_WIDTH, rowBg, true), overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      <span
                        style={{ fontWeight: 500, color: hasTooltip ? '#1d4ed8' : '#111', cursor: hasTooltip ? 'pointer' : 'default', textDecoration: hasTooltip ? 'underline dotted' : 'none' }}
                        onClick={() => { const d = tooltipAll[p.project_number]; if (d) setTooltipView({ project: p, data: d }) }}
                      >{p.name}</span>
                    </td>
                    {show('type') && <td style={tdnw}><span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 3, background: '#f0f0ee', color: '#555' }}>{p.type}</span></td>}
                    {show('client') && <td style={{ ...tdnw, maxWidth: 120 }}><NoteCell value={p.client} note={notes[p.project_number]?.['client']} onNote={e => openNote(e, p.project_number, 'client')} /></td>}
                    {show('fee') && <td style={{ ...tdnw, textAlign: 'right' }}>{p.fee != null ? p.fee : '-'}</td>}
                    {show('tp_score') && <td style={tdnw}>{p.tp_score}</td>}
                    {show('score') && <td style={tdnw}>{scoreDist.match(/^[\d.]+/)?.[0] ?? ''}</td>}
                    {show('announce') && <td style={tdnw}>{p.announce_date ?? '-'}</td>}
                    {show('submit') && <td style={tdnw}><NoteCell value={p.submit_date ?? '-'} note={notes[p.project_number]?.['submit_date']} onNote={e => openNote(e, p.project_number, 'submit_date')} /></td>}
                    {show('interview') && <td style={tdnw}><NoteCell value={interviewText(p)} note={notes[p.project_number]?.['interview_date']} onNote={e => openNote(e, p.project_number, 'interview_date')} /></td>}
                    {show('bid') && <td style={tdnw}><NoteCell value={p.bid_date ?? '-'} note={notes[p.project_number]?.['bid_date']} onNote={e => openNote(e, p.project_number, 'bid_date')} /></td>}
                    {show('result') && <td style={tdnw}><span style={{ fontWeight: 600, color: p.result_score ? '#111' : '#ccc' }}>{p.result_score || '-'}</span></td>}
                    {show('evaluation') && <td style={{ ...tdnw, maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.evaluation}</td>}
                    {show('award') && <td style={{ ...tdnw, textAlign: 'right' }}>{p.award_fee != null ? p.award_fee : '-'}</td>}
                    {show('participants') && <td style={tdnw}><NoteCell value={(p.participants.match(/\d+개사/) ?? [''])[0] || p.participants} note={notes[p.project_number]?.['competitors']} onNote={e => openNote(e, p.project_number, 'competitors')} /></td>}
                    {show('director') && <td style={tdnw}>{p.director}</td>}
                    {show('arch') && <td style={tdnw}>{p.staff_arch}</td>}
                    {show('civil') && <td style={tdnw}>{p.staff_civil}</td>}
                    {show('mech') && <td style={tdnw}>{p.staff_mech}</td>}
                    {show('safety') && <td style={tdnw}>{p.staff_safety}</td>}
                    {show('status') && <td style={tdnw}><span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 4, ...STATUS_STYLE[status] }}>{status}</span></td>}
                    {canWrite && (
                      <td style={td}>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button onClick={() => openEdit(p)} style={editBtn}>수정</button>
                          <button onClick={() => remove(p.id, p.project_number)} disabled={deleting === p.id} style={deleteBtn}>삭제</button>
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: '#f9f9f8', borderTop: '2px solid #e8e8e6' }}>
                {/* 라벨은 고정 영역(번호+용역명) 안에서만 병합한다 — 그보다 넓게 잡으면 가로로
                    스크롤했을 때 고정 경계 바깥의 셀까지 덮어버린다. 나머지는 보이는 열을 그대로
                    따라가며 빈 칸을 만들고 용역비 자리에만 합계를 넣는다 — 보기 모드에 따라 열이
                    빠져도 합계가 엉뚱한 열 아래로 밀리지 않게. */}
                <td
                  colSpan={2}
                  style={{
                    padding: '8px 12px', fontSize: 12, color: '#555', fontWeight: 500,
                    ...stickyCol(0, STICKY_NUM_WIDTH + STICKY_NAME_WIDTH, '#f9f9f8', true),
                  }}
                >합계 {filtered.length}건</td>
                {headers.slice(2).map(c => (
                  c.key === 'fee'
                    ? <td key={c.key} style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: '#111' }}>{totalFee.toFixed(1)}</td>
                    : <td key={c.key} />
                ))}
              </tr>
            </tfoot>
          </table>
          </div>
        </div>
        )}
      </div>

      {/* 툴팁 보기 모달 */}
      {tooltipView && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }} onClick={closeTooltipView}>
          <div style={{ background: '#fff', borderRadius: 12, width: 620, maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #e8e8e6', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, background: '#111', borderRadius: '12px 12px 0 0' }}>
              <div>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>#{tooltipView.project.project_number} · {tooltipView.project.type}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#fff', lineHeight: 1.4 }}>{tooltipView.project.name}</div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                {canWrite && <button onClick={() => { openEdit(tooltipView.project); closeTooltipView() }} style={{ border: 'none', background: '#2563eb', color: '#fff', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12 }}>편집</button>}
                <button onClick={closeTooltipView} style={{ border: 'none', background: 'rgba(255,255,255,0.15)', color: '#fff', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 13 }}>✕</button>
              </div>
            </div>
            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 0 }}>
              {(() => {
                const d = tooltipView.data
                const p = tooltipView.project
                const rows: { label: string; value: string }[][] = [
                  [{ label: '발주청', value: p.client }, { label: '현장위치', value: d.location || '' }],
                  [{ label: '단장(PM)', value: p.director }, { label: '용역기간', value: p.duration_days || '' }],
                  [{ label: '분야기술자', value: [p.staff_arch && `건축:${p.staff_arch}`, p.staff_civil && `토목:${p.staff_civil}`, p.staff_mech && `기계:${p.staff_mech}`, p.staff_safety && `안전:${p.staff_safety}`].filter(Boolean).join(' / ') || '' }, { label: '용역비', value: p.fee ? `${p.fee}억원` : '' }],
                  [{ label: '연면적', value: d.area || '' }, { label: '규모', value: d.scale || '' }],
                  [{ label: '추정공사비', value: d.est_cost || '' }, { label: '참여업체', value: d.competitors || p.participants || '' }],
                  [{ label: '배점', value: d.score_dist || '' }, { label: '설계사', value: d.designer || '' }],
                  [{ label: '시공사', value: d.builder || '' }, { label: '', value: '' }],
                ]
                return rows.filter(r => r.some(c => c.value)).map((row, ri) => (
                  <div key={ri} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '1px solid #f5f5f3' }}>
                    {row.map((cell, ci) => (
                      <div key={ci} style={{ padding: '8px 10px', display: 'flex', gap: 8, alignItems: 'baseline' }}>
                        {cell.label && <span style={{ fontSize: 11, color: '#888', minWidth: 60, flexShrink: 0 }}>{cell.label}</span>}
                        {cell.label && <span style={{ fontSize: 13, color: '#111' }}>{cell.value || '-'}</span>}
                      </div>
                    ))}
                  </div>
                ))
              })()}
              {(tooltipView.data.location || tooltipView.data.interview_location) && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#555', padding: '6px 10px', background: '#f8f8f7', borderRadius: 6, marginBottom: 4 }}>위치 정보</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {tooltipView.data.location && (
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <span style={{ fontSize: 12, color: '#333' }}><b>현장위치</b> · {tooltipView.data.location}</span>
                          <button
                            onClick={() => openDirections('현장', tooltipView.data.location!)}
                            disabled={dirLoading === '현장'}
                            style={{ ...outlineBtn, height: 26, padding: '0 10px', fontSize: 11, opacity: dirLoading === '현장' ? 0.6 : 1 }}
                          >{dirLoading === '현장' ? '조회 중...' : '카카오맵으로 길찾기 열기'}</button>
                        </div>
                        <AddressMapPreview address={tooltipView.data.location} />
                      </div>
                    )}
                    {tooltipView.data.interview_location && (
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <span style={{ fontSize: 12, color: '#333' }}><b>면접장소</b> · {tooltipView.data.interview_location}</span>
                          <button
                            onClick={() => openDirections('면접장소', tooltipView.data.interview_location!)}
                            disabled={dirLoading === '면접장소'}
                            style={{ ...outlineBtn, height: 26, padding: '0 10px', fontSize: 11, opacity: dirLoading === '면접장소' ? 0.6 : 1 }}
                          >{dirLoading === '면접장소' ? '조회 중...' : '카카오맵으로 길찾기 열기'}</button>
                        </div>
                        <AddressMapPreview address={tooltipView.data.interview_location} />
                      </div>
                    )}
                    {dirMsg && <div style={{ fontSize: 11, color: '#b91c1c', padding: '6px 10px', background: '#fef2f2', borderRadius: 6 }}>{dirMsg}</div>}
                  </div>
                </div>
              )}
              {(tooltipView.data.pq_date || tooltipView.data.soq_date || tooltipView.project.interview_date || tooltipView.project.interview_written || tooltipView.project.bid_date) && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#555', padding: '6px 10px', background: '#f8f8f7', borderRadius: 6, marginBottom: 4 }}>입찰 일정</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '1px solid #f5f5f3' }}>
                    {[
                      { label: 'PQ 제출일', value: tooltipView.data.pq_date || '' },
                      { label: 'SOQ 제출일', value: tooltipView.data.soq_date || '' },
                      { label: '발표/면접일', value: tooltipView.project.interview_written ? WRITTEN_EVALUATION_LABEL : (tooltipView.project.interview_date || '') },
                      { label: '면접시간', value: tooltipView.data.interview_time || '' },
                      { label: '개찰일', value: tooltipView.project.bid_date || '' },
                      { label: '평가통보일', value: tooltipView.data.notify_date || '' },
                    ].filter(c => c.value).map((cell, ci) => (
                      <div key={ci} style={{ padding: '7px 10px', display: 'flex', gap: 8, alignItems: 'baseline' }}>
                        <span style={{ fontSize: 11, color: '#888', minWidth: 64, flexShrink: 0 }}>{cell.label}</span>
                        <span style={{ fontSize: 13, color: '#111' }}>{cell.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {(tooltipView.data.proposal_p || tooltipView.data.self_intro_p || tooltipView.data.ppt_p) && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#555', padding: '6px 10px', background: '#f8f8f7', borderRadius: 6, marginBottom: 4 }}>점수 배분</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', borderBottom: '1px solid #f5f5f3' }}>
                    {[
                      { label: '제안서(P)', value: tooltipView.data.proposal_p || '' },
                      { label: '자기소개서(P)', value: tooltipView.data.self_intro_p || '' },
                      { label: '파워포인트(P)', value: tooltipView.data.ppt_p || '' },
                    ].map((cell, ci) => (
                      <div key={ci} style={{ padding: '7px 10px', display: 'flex', gap: 8, alignItems: 'baseline' }}>
                        <span style={{ fontSize: 11, color: '#888', minWidth: 60, flexShrink: 0 }}>{cell.label}</span>
                        <span style={{ fontSize: 13, color: '#111' }}>{cell.value || '-'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {tooltipView.data.announcement && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#555', padding: '6px 10px', background: '#f8f8f7', borderRadius: 6, marginBottom: 6 }}>공고 내용</div>
                  <pre style={{ fontSize: 12, color: '#333', lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: '#fafafa', border: '1px solid #f0f0ee', borderRadius: 6, padding: '10px 12px', margin: 0 }}>{tooltipView.data.announcement}</pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 메모 팝업 */}
      {notePopup && (() => {
        const popupH = 200
        const spaceBelow = window.innerHeight - notePopup.rect.bottom
        const top = spaceBelow >= popupH + 8
          ? notePopup.rect.bottom + 4
          : notePopup.rect.top - popupH - 4
        const left = Math.min(Math.max(notePopup.rect.left, 8), window.innerWidth - 296)
        return (
          <div style={{ position: 'fixed', inset: 0, zIndex: 300 }} onClick={() => setNotePopup(null)}>
            <div
              style={{ position: 'fixed', top, left, width: 280, background: '#fff', border: '1px solid #e8e8e6', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', padding: 12 }}
              onClick={e => e.stopPropagation()}
            >
              <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>
                {{ client: '발주처', submit_date: '제출일', interview_date: '발표일', bid_date: '개찰일', competitors: '참여사' }[notePopup.field]} 메모
              </div>
              <textarea
                autoFocus
                value={notePopup.draft}
                onChange={e => setNotePopup(p => p ? { ...p, draft: e.target.value } : p)}
                placeholder="특이사항, 메모를 입력하세요"
                rows={4}
                style={{ width: '100%', fontSize: 12, border: '1px solid #e8e8e6', borderRadius: 6, padding: '8px 10px', resize: 'none', outline: 'none', boxSizing: 'border-box', lineHeight: 1.5 }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 8 }}>
                <button onClick={() => setNotePopup(null)} style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid #e8e8e6', background: '#fff', fontSize: 12, cursor: 'pointer', color: '#555' }}>취소</button>
                {notes[notePopup.projectNumber]?.[notePopup.field] && (
                  <button onClick={async () => {
                    await supabase.from('project_notes').delete().eq('project_number', notePopup.projectNumber).eq('field', notePopup.field)
                    await loadNotes(); setNotePopup(null)
                  }} style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid #fecaca', background: '#fef2f2', fontSize: 12, cursor: 'pointer', color: '#b91c1c' }}>삭제</button>
                )}
                <button onClick={saveNote} disabled={noteSaving} style={{ padding: '5px 12px', borderRadius: 6, border: 'none', background: '#111', fontSize: 12, cursor: 'pointer', color: '#fff', opacity: noteSaving ? 0.6 : 1 }}>저장</button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* 통합 추가/수정 모달 */}
      {modal.open && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: '#fff', borderRadius: 12, width: 680, maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '16px 24px', borderBottom: '1px solid #e8e8e6', background: '#111', borderRadius: '12px 12px 0 0', flexShrink: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>{modal.editId ? '프로젝트 수정' : '프로젝트 추가'}</div>
              <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>기본 정보와 상세 내용을 함께 입력합니다</div>
            </div>

            <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 0, overflowY: 'auto' }}>

              {/* 섹션 1: 기본 정보 */}
              <SectionTitle>기본 정보</SectionTitle>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
                <Row2>
                  <Field label="공사번호"><input style={inp} value={modal.form.project_number} onChange={e => set('project_number', e.target.value)} placeholder="2647" /></Field>
                  <Field label="유형"><select style={inp} value={modal.form.type} onChange={e => set('type', e.target.value)}>{TYPES.map(t => <option key={t}>{t}</option>)}</select></Field>
                </Row2>
                <Field label="발주처"><input style={inp} value={modal.form.client} onChange={e => set('client', e.target.value)} placeholder="발주처명" /></Field>
                <Field label="용역명 *"><input style={inp} value={modal.form.name} onChange={e => set('name', e.target.value)} placeholder="용역명" /></Field>
                <Row2>
                  <Field label="현장위치"><input style={inp} value={modal.form.location} onChange={e => set('location', e.target.value)} placeholder="시/도 군/구 동/면 (지도 자동검색)" /></Field>
                  <Field label="단장(PM)"><input style={inp} value={modal.form.director} onChange={e => set('director', e.target.value)} placeholder="담당자명" /></Field>
                </Row2>
                <Field label="면접장소"><input style={inp} value={modal.form.interview_location} onChange={e => set('interview_location', e.target.value)} placeholder="시/도 군/구 동/면 (지도 자동검색)" /></Field>
              </div>

              {/* 섹션 2: 용역 상세 */}
              <SectionTitle>용역 상세</SectionTitle>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
                <Row3>
                  <Field label="용역비(억)"><input style={inp} type="number" value={modal.form.fee ?? ''} onChange={e => set('fee', e.target.value ? parseFloat(e.target.value) : null)} placeholder="0.0" /></Field>
                  <Field label="용역기간"><input style={inp} value={modal.form.duration_days} onChange={e => set('duration_days', e.target.value)} placeholder="24개월" /></Field>
                  <Field label="추정공사비"><input style={inp} value={modal.form.est_cost} onChange={e => set('est_cost', e.target.value)} placeholder="500억원" /></Field>
                </Row3>
                <Row2>
                  <Field label="연면적"><input style={inp} value={modal.form.area} onChange={e => set('area', e.target.value)} placeholder="12,000㎡" /></Field>
                  <Field label="규모"><input style={inp} value={modal.form.scale} onChange={e => set('scale', e.target.value)} placeholder="B2/15F" /></Field>
                </Row2>
                <Row2>
                  <Field label="설계사"><input style={inp} value={modal.form.designer} onChange={e => set('designer', e.target.value)} placeholder="설계사명" /></Field>
                  <Field label="시공사"><input style={inp} value={modal.form.builder} onChange={e => set('builder', e.target.value)} placeholder="시공사명" /></Field>
                </Row2>
              </div>

              {/* 섹션 3: 인력 배치 */}
              <SectionTitle>인력 배치</SectionTitle>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
                <Row2>
                  <Field label="건축"><input style={inp} value={modal.form.staff_arch} onChange={e => set('staff_arch', e.target.value)} placeholder="담당자명" /></Field>
                  <Field label="토목"><input style={inp} value={modal.form.staff_civil} onChange={e => set('staff_civil', e.target.value)} placeholder="담당자명" /></Field>
                </Row2>
                <Row2>
                  <Field label="기계"><input style={inp} value={modal.form.staff_mech} onChange={e => set('staff_mech', e.target.value)} placeholder="담당자명" /></Field>
                  <Field label="안전"><input style={inp} value={modal.form.staff_safety} onChange={e => set('staff_safety', e.target.value)} placeholder="담당자명" /></Field>
                </Row2>
              </div>

              {/* 섹션 4: 제안/평가 배점 */}
              <SectionTitle>제안 / 평가 배점</SectionTitle>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
                <Row3>
                  <Field label="제안서(P)"><input style={inp} value={modal.form.tp_score} onChange={e => set('tp_score', e.target.value)} placeholder="20p" /></Field>
                  <Field label="배점 기준"><input style={inp} value={modal.form.score_dist} onChange={e => set('score_dist', e.target.value)} placeholder="4.5(책임3+분야1.5)" /></Field>
                  <Field label="참여업체 수"><input style={inp} value={modal.form.participants} onChange={e => set('participants', e.target.value)} placeholder="9개사" /></Field>
                </Row3>
                <Row2>
                  <Field label="자기소개서(P)"><input style={inp} value={modal.form.self_intro_p} onChange={e => set('self_intro_p', e.target.value)} placeholder="각 2p" /></Field>
                </Row2>
              </div>

              {/* 섹션 5: 일정 */}
              <SectionTitle>일정</SectionTitle>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
                {/* projects의 date 컬럼 3형제 — 그냥 달력만 있으면 된다. PQ 제출일·평가통보일은
                    "추후" 선택이 붙어 폭이 더 필요하므로 아래 2열 줄에 따로 놓는다. */}
                <Row3>
                  <Field label="공고일"><input style={inp} type="date" value={modal.form.announce_date ?? ''} onChange={e => set('announce_date', e.target.value || null)} /></Field>
                  <Field label="제출일"><input style={inp} type="date" value={modal.form.submit_date ?? ''} onChange={e => set('submit_date', e.target.value || null)} /></Field>
                  <Field label="개찰일"><input style={inp} type="date" value={modal.form.bid_date ?? ''} onChange={e => set('bid_date', e.target.value || null)} /></Field>
                </Row3>
                <Row2>
                  {/* 발표(면접) 없이 서면으로만 평가하는 공고가 있어 날짜/서면평가를 골라 입력한다.
                      서면평가를 고르면 날짜는 비워 저장하고, 주간/월간보고는 제출일이 지나는 즉시
                      이 건을 개찰로 내린다(lib/projectStatus.ts의 categorizeProject). */}
                  <Field label="발표/면접일">
                    <div style={{ display: 'flex', gap: 6 }}>
                      <select
                        style={{ ...inp, width: 104, flexShrink: 0 }}
                        value={modal.form.interview_written ? 'written' : 'date'}
                        onChange={e => {
                          const written = e.target.value === 'written'
                          setModal(m => ({ ...m, form: { ...m.form, interview_written: written, interview_date: written ? null : m.form.interview_date } }))
                        }}
                      >
                        <option value="date">날짜 지정</option>
                        <option value="written">{WRITTEN_EVALUATION_LABEL}</option>
                      </select>
                      {modal.form.interview_written ? (
                        <div style={{ ...inp, display: 'flex', alignItems: 'center', color: '#888', background: '#f8f8f7' }}>발표 없이 서면으로 평가</div>
                      ) : (
                        <input style={inp} type="date" value={modal.form.interview_date ?? ''} onChange={e => set('interview_date', e.target.value || null)} />
                      )}
                    </div>
                  </Field>
                  <Field label="면접시간"><input style={inp} value={modal.form.interview_time} onChange={e => set('interview_time', e.target.value)} placeholder="5분/4분" /></Field>
                </Row2>
                <Row2>
                  <Field label="PQ 제출일"><TextDateInput value={modal.form.pq_date} onChange={v => set('pq_date', v)} /></Field>
                  <Field label="평가통보일"><TextDateInput value={modal.form.notify_date} onChange={v => set('notify_date', v)} /></Field>
                </Row2>
              </div>

              {/* 섹션 6: 결과 */}
              <SectionTitle>결과</SectionTitle>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
                <Row3>
                  <Field label="결과(등급)"><input style={inp} value={modal.form.result_score} onChange={e => set('result_score', e.target.value)} placeholder="선/수/우/1등" /></Field>
                  <Field label="낙찰사"><input style={inp} value={modal.form.evaluation} onChange={e => set('evaluation', e.target.value)} placeholder="업체명" /></Field>
                  <Field label="낙찰액(억)"><input style={inp} type="number" value={modal.form.award_fee ?? ''} onChange={e => set('award_fee', e.target.value ? parseFloat(e.target.value) : null)} placeholder="0.0" /></Field>
                </Row3>
                <Row2>
                  <Field label="참여비율"><input style={inp} value={modal.form.participation_ratio} onChange={e => set('participation_ratio', e.target.value)} placeholder="98.13" /></Field>
                  <Field label="경쟁사"><input style={inp} value={modal.form.competitors} onChange={e => set('competitors', e.target.value)} placeholder="참여 업체명" /></Field>
                </Row2>
                <Field label="상태 강제지정">
                  <select style={inp} value={modal.form.status_override ?? ''} onChange={e => set('status_override', e.target.value || null)}>
                    <option value="">자동 (낙찰사 기준)</option>
                    {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Field>
              </div>

              {/* 섹션 7: 공고 내용 */}
              <SectionTitle>공고 내용 / 비고</SectionTitle>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 8 }}>
                <Field label="공고 내용">
                  <textarea
                    value={modal.form.announcement}
                    onChange={e => set('announcement', e.target.value)}
                    rows={6}
                    placeholder="공고문 주요 내용 붙여넣기..."
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #e8e8e6', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', lineHeight: 1.6, resize: 'vertical', boxSizing: 'border-box' }}
                  />
                </Field>
                <Field label="비고"><input style={inp} value={modal.form.note} onChange={e => set('note', e.target.value)} placeholder="메모" /></Field>
              </div>
            </div>

            <div style={{ padding: '12px 24px 20px', borderTop: '1px solid #f0f0ee', flexShrink: 0 }}>
              {saveError && <div style={{ marginBottom: 8, padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, color: '#b91c1c' }}>{saveError}</div>}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={closeModal} style={outlineBtn}>취소</button>
                <button onClick={save} disabled={saving} style={{ ...primaryBtn, opacity: saving ? 0.6 : 1 }}>{saving ? '저장 중...' : '저장'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 600, color: '#555', letterSpacing: '0.05em', textTransform: 'uppercase', padding: '6px 10px', background: '#f4f4f2', borderRadius: 6, marginBottom: 10 }}>
      {children}
    </div>
  )
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>{label}</div>{children}</div>
}
function Row2({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>{children}</div>
}
function Row3({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>{children}</div>
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
/** 날짜가 아직 안 잡힌 일정. 월간보고가 이 글자를 그대로 읽는다(lib/hwpx/monthlyFormat.ts). */
const UNDECIDED = '추후'

/**
 * PQ 제출일·평가통보일처럼 **text 컬럼**(project_tooltips)에 들어가는 날짜 입력.
 *
 * 공고일·제출일·개찰일은 projects의 date 컬럼이라 곧장 <input type="date">를 쓰지만, 이 두 칸은
 * 예전부터 자유 텍스트라 "3/6"(연도 없는 M/D)이나 "추후" 같은 값이 실제로 저장돼 있다. 그대로
 * type="date"로 바꾸면 그런 프로젝트를 열었을 때 칸이 비어 보이고, 저장하는 순간 값이 지워진다.
 *
 * 그래서 세 갈래로 나눈다.
 *   · 비었거나 날짜(YYYY-MM-DD)  → 달력
 *   · "추후"                     → 날짜가 아직 안 잡힌 상태. 달력만 두면 이 값을 새로 넣을 방법이
 *                                  없어져 월간보고 표기가 막히므로 선택지로 남긴다.
 *   · 그 밖의 옛 표기("3/6" 등)  → 값을 그대로 보여주고, "달력으로"를 눌러 사용자가 직접 비웠을
 *                                  때만 달력으로 바꾼다. M/D는 어느 해인지 알 수 없어 연도를
 *                                  지어내지 않는다.
 */
function TextDateInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const isLegacyText = !!value && value !== UNDECIDED && !ISO_DATE.test(value)
  if (isLegacyText) {
    return (
      <div style={{ display: 'flex', gap: 6 }}>
        <input readOnly value={value} style={{ ...inp, background: '#f8f8f7', color: '#666' }} title="예전에 자유 텍스트로 적어둔 값입니다" />
        <button
          type="button"
          onClick={() => onChange('')}
          title="이 값을 지우고 달력에서 날짜를 고릅니다"
          style={{ flexShrink: 0, height: 34, padding: '0 10px', border: '1px solid #e8e8e6', background: '#fff', borderRadius: 6, fontSize: 11, cursor: 'pointer', color: '#555', whiteSpace: 'nowrap' }}
        >달력으로</button>
      </div>
    )
  }

  const undecided = value === UNDECIDED
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <select
        style={{ ...inp, width: 88, flexShrink: 0 }}
        value={undecided ? 'undecided' : 'date'}
        onChange={e => onChange(e.target.value === 'undecided' ? UNDECIDED : '')}
      >
        <option value="date">날짜</option>
        <option value="undecided">{UNDECIDED}</option>
      </select>
      {undecided ? (
        <div style={{ ...inp, display: 'flex', alignItems: 'center', color: '#888', background: '#f8f8f7' }}>날짜 미정</div>
      ) : (
        <input style={inp} type="date" value={value} onChange={e => onChange(e.target.value)} />
      )}
    </div>
  )
}

function NoteCell({ value, note, onNote }: { value: string; note?: string; onNote: (e: React.MouseEvent) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden' }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
      <button
        onClick={onNote}
        title={note || '메모 추가'}
        style={{ flexShrink: 0, width: 14, height: 14, borderRadius: '50%', border: 'none', cursor: 'pointer', padding: 0,
          background: note ? '#f59e0b' : '#e8e8e6',
          opacity: note ? 1 : 0.5,
        }}
      />
    </div>
  )
}

const td: React.CSSProperties = { padding: '8px 12px', verticalAlign: 'middle', color: '#333' }
const tdnw: React.CSSProperties = { padding: '8px 12px', verticalAlign: 'middle', color: '#333', whiteSpace: 'nowrap' }
const inp: React.CSSProperties = { width: '100%', height: 34, padding: '0 10px', border: '1px solid #e8e8e6', borderRadius: 6, fontSize: 13, background: '#fff', boxSizing: 'border-box' }
const primaryBtn: React.CSSProperties = { height: 34, padding: '0 14px', borderRadius: 6, border: 'none', background: '#111', color: '#fff', fontSize: 13, cursor: 'pointer' }
const outlineBtn: React.CSSProperties = { height: 34, padding: '0 14px', borderRadius: 6, border: '1px solid #ddd', background: '#fff', color: '#333', fontSize: 13, cursor: 'pointer' }
const editBtn: React.CSSProperties = { height: 24, padding: '0 8px', borderRadius: 4, border: '1px solid #e8e8e6', background: '#fff', color: '#333', fontSize: 11, cursor: 'pointer' }
const deleteBtn: React.CSSProperties = { height: 24, padding: '0 8px', borderRadius: 4, border: 'none', background: '#fee2e2', color: '#b91c1c', fontSize: 11, cursor: 'pointer' }
