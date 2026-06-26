'use client'

import { useEffect, useState, useCallback } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'

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
  submit_date: string | null
  interview_date: string | null
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
  submit_date: string | null
  interview_date: string | null
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
  submit_date: null, interview_date: null, bid_date: null,
  result_score: '', evaluation: '', award_fee: null,
  participants: '', participation_ratio: '',
  director: '', status_override: null,
  staff_arch: '', staff_civil: '', staff_mech: '', staff_safety: '',
  note: '',
  location: '', area: '', scale: '', est_cost: '',
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

const TYPES: ProjectType[] = ['면접', 'SOQ', '종심제', 'TP', 'PQ', '기타']
const STATUSES: ProjectStatus[] = ['진행중', '수주', '탈락', '취소']

export default function ProjectsPage() {
  const supabase = createSupabaseBrowserClient()
  const [projects, setProjects] = useState<Project[]>([])
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<ProjectStatus | '전체'>('전체')
  const [filterType, setFilterType] = useState<ProjectType | '전체'>('전체')
  const [tooltipAll, setTooltipAll] = useState<Record<string, TooltipData>>({})
  const [tooltipView, setTooltipView] = useState<{ project: Project; data: TooltipData } | null>(null)

  // 통합 편집 모달
  const [modal, setModal] = useState<{ open: boolean; form: FormData; editId: string | null }>({
    open: false, form: { ...EMPTY_FORM }, editId: null,
  })
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

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

  useEffect(() => { load(); loadTooltips() }, [load, loadTooltips])

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
        submit_date: p.submit_date, interview_date: p.interview_date, bid_date: p.bid_date,
        result_score: p.result_score, evaluation: p.evaluation, award_fee: p.award_fee,
        participants: p.participants, participation_ratio: p.participation_ratio,
        director: p.director, status_override: p.status_override,
        staff_arch: p.staff_arch, staff_civil: p.staff_civil, staff_mech: p.staff_mech, staff_safety: p.staff_safety,
        note: p.note,
        location: tip.location ?? '', area: tip.area ?? '', scale: tip.scale ?? '',
        est_cost: tip.est_cost ?? '', designer: tip.designer ?? '', builder: tip.builder ?? '',
        score_dist: tip.score_dist ?? '', competitors: tip.competitors ?? '',
        proposal_p: tip.proposal_p ?? '', self_intro_p: tip.self_intro_p ?? '', ppt_p: tip.ppt_p ?? '',
        pq_date: tip.pq_date ?? '', soq_date: tip.soq_date ?? '',
        interview_time: tip.interview_time ?? '', notify_date: tip.notify_date ?? '',
        announcement: tip.announcement ?? '',
      },
    })
  }

  const closeModal = () => setModal(m => ({ ...m, open: false }))
  const set = (field: keyof FormData, value: unknown) => setModal(m => ({ ...m, form: { ...m.form, [field]: value } }))

  const save = async () => {
    if (!modal.form.name.trim()) return
    setSaving(true)
    try {
      const f = modal.form
      const projectPayload = {
        project_number: f.project_number, type: f.type, client: f.client, name: f.name,
        fee: f.fee, tp_score: f.tp_score, duration_days: f.duration_days,
        submit_date: f.submit_date || null, interview_date: f.interview_date || null, bid_date: f.bid_date || null,
        result_score: f.result_score, evaluation: f.evaluation, award_fee: f.award_fee,
        participants: f.participants, participation_ratio: f.participation_ratio,
        director: f.director, status_override: f.status_override || null,
        staff_arch: f.staff_arch, staff_civil: f.staff_civil, staff_mech: f.staff_mech, staff_safety: f.staff_safety,
        note: f.note,
        status: computeStatus(f.result_score, f.evaluation, f.participants, f.status_override),
      }

      const tooltipPayload = {
        project_number: f.project_number,
        location: f.location, area: f.area, scale: f.scale, est_cost: f.est_cost,
        designer: f.designer, builder: f.builder, score_dist: f.score_dist, competitors: f.competitors,
        proposal_p: f.proposal_p, self_intro_p: f.self_intro_p, ppt_p: f.ppt_p,
        pq_date: f.pq_date, soq_date: f.soq_date, interview_time: f.interview_time,
        notify_date: f.notify_date, announcement: f.announcement,
      }

      const hasTooltipData = Object.entries(tooltipPayload)
        .filter(([k]) => k !== 'project_number')
        .some(([, v]) => v && String(v).trim() !== '')

      if (modal.editId) {
        await supabase.from('projects').update({ ...projectPayload, updated_at: new Date().toISOString() }).eq('id', modal.editId)
        if (hasTooltipData) {
          await supabase.from('project_tooltips').upsert({ ...tooltipPayload, updated_at: new Date().toISOString() }, { onConflict: 'project_number' })
        }
      } else {
        await supabase.from('projects').insert(projectPayload)
        if (hasTooltipData) {
          await supabase.from('project_tooltips').insert(tooltipPayload)
        }
      }

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
    await load()
    setDeleting(null)
  }

  const exportCsv = () => {
    const headers = ['번호', '유형', '발주처', '용역명', '용역비(억)', '제안서', '점수', '제출일', '발표일', '개찰일', '결과', '낙찰사', '참여사', '단장', '건축', '토목', '기계', '안전', '상태', '비고']
    const rowsData = filtered.map(p => [
      p.project_number, p.type, p.client, p.name,
      p.fee ?? '', p.tp_score, p.duration_days,
      p.submit_date ?? '', p.interview_date ?? '', p.bid_date ?? '',
      p.result_score, p.evaluation, p.participants, p.director,
      p.staff_arch, p.staff_civil, p.staff_mech, p.staff_safety,
      computeStatus(p.result_score, p.evaluation, p.participants, p.status_override), p.note,
    ])
    const csv = [headers, ...rowsData].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `프로젝트List_${new Date().toISOString().slice(0, 10)}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  const totalFee = filtered.reduce((s, p) => s + (p.fee ?? 0), 0)

  return (
    <div style={{ minHeight: '100vh', background: '#f8f8f7' }}>
      <header style={{ background: '#fff', borderBottom: '1px solid #e8e8e6' }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', padding: '0 24px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 14, color: '#555' }}>프로젝트 List</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={exportCsv} style={outlineBtn}>CSV 내보내기</button>
            <button onClick={openAdd} style={primaryBtn}>+ 추가</button>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '20px 24px 60px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
          {([['전체', projects], ['진행중', projects.filter(p => computeStatus(p.result_score, p.evaluation, p.participants, p.status_override) === '진행중')], ['수주', projects.filter(p => computeStatus(p.result_score, p.evaluation, p.participants, p.status_override) === '수주')], ['탈락', projects.filter(p => computeStatus(p.result_score, p.evaluation, p.participants, p.status_override) === '탈락')]] as [string, Project[]][]).map(([label, list]) => (
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

        <div style={{ background: '#fff', border: '1px solid #e8e8e6', borderRadius: 8, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#f4f4f2' }}>
                {['', '번호', '유형', '발주처', '용역명', '제안서', '점수', '제출일', '발표일', '개찰일', '결과', '낙찰사', '참여사', '단장', '건축', '토목', '기계', '안전', '상태'].map(h => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 500, color: '#555', borderBottom: '1px solid #e8e8e6', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={21} style={{ padding: 40, textAlign: 'center', color: '#bbb' }}>데이터가 없습니다</td></tr>
              ) : filtered.map(p => {
                const hasTooltip = !!tooltipAll[p.project_number]
                return (
                  <tr key={p.id} style={{ borderBottom: '1px solid #f0f0ee' }}>
                    <td style={td}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button onClick={() => openEdit(p)} style={editBtn}>수정</button>
                        <button onClick={() => remove(p.id, p.project_number)} disabled={deleting === p.id} style={deleteBtn}>삭제</button>
                      </div>
                    </td>
                    <td style={tdnw}><span style={{ color: '#999' }}>{p.project_number}</span></td>
                    <td style={tdnw}><span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 3, background: '#f0f0ee', color: '#555' }}>{p.type}</span></td>
                    <td style={{ ...tdnw, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.client}</td>
                    <td style={{ ...tdnw, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      <span
                        style={{ fontWeight: 500, color: hasTooltip ? '#1d4ed8' : '#111', cursor: hasTooltip ? 'pointer' : 'default', textDecoration: hasTooltip ? 'underline dotted' : 'none' }}
                        onClick={() => { const d = tooltipAll[p.project_number]; if (d) setTooltipView({ project: p, data: d }) }}
                      >{p.name}</span>
                    </td>
                    <td style={tdnw}>{p.tp_score}</td>
                    <td style={tdnw}>{p.duration_days}</td>
                    <td style={tdnw}>{p.submit_date ?? '-'}</td>
                    <td style={tdnw}>{p.interview_date ?? '-'}</td>
                    <td style={tdnw}>{p.bid_date ?? '-'}</td>
                    <td style={tdnw}><span style={{ fontWeight: 600, color: p.result_score ? '#111' : '#ccc' }}>{p.result_score || '-'}</span></td>
                    <td style={{ ...tdnw, maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.evaluation}</td>
                    <td style={tdnw}>{(p.participants.match(/\d+개사/) ?? [''])[0] || p.participants}</td>
                    <td style={tdnw}>{p.director}</td>
                    <td style={tdnw}>{p.staff_arch}</td>
                    <td style={tdnw}>{p.staff_civil}</td>
                    <td style={tdnw}>{p.staff_mech}</td>
                    <td style={tdnw}>{p.staff_safety}</td>
                    <td style={tdnw}><span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 4, ...STATUS_STYLE[computeStatus(p.result_score, p.evaluation, p.participants, p.status_override)] }}>{computeStatus(p.result_score, p.evaluation, p.participants, p.status_override)}</span></td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: '#f9f9f8', borderTop: '2px solid #e8e8e6' }}>
                <td colSpan={19} style={{ padding: '8px 12px', fontSize: 12, color: '#555', fontWeight: 500 }}>합계 {filtered.length}건</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* 툴팁 보기 모달 */}
      {tooltipView && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }} onClick={() => setTooltipView(null)}>
          <div style={{ background: '#fff', borderRadius: 12, width: 620, maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #e8e8e6', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, background: '#111', borderRadius: '12px 12px 0 0' }}>
              <div>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>#{tooltipView.project.project_number} · {tooltipView.project.type}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#fff', lineHeight: 1.4 }}>{tooltipView.project.name}</div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button onClick={() => { openEdit(tooltipView.project); setTooltipView(null) }} style={{ border: 'none', background: '#2563eb', color: '#fff', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12 }}>편집</button>
                <button onClick={() => setTooltipView(null)} style={{ border: 'none', background: 'rgba(255,255,255,0.15)', color: '#fff', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 13 }}>✕</button>
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
              {(tooltipView.data.pq_date || tooltipView.data.soq_date || tooltipView.project.interview_date || tooltipView.project.bid_date) && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#555', padding: '6px 10px', background: '#f8f8f7', borderRadius: 6, marginBottom: 4 }}>입찰 일정</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '1px solid #f5f5f3' }}>
                    {[
                      { label: 'PQ 제출일', value: tooltipView.data.pq_date || '' },
                      { label: 'SOQ 제출일', value: tooltipView.data.soq_date || '' },
                      { label: '발표/면접일', value: tooltipView.project.interview_date || '' },
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
                  <Field label="현장위치"><input style={inp} value={modal.form.location} onChange={e => set('location', e.target.value)} placeholder="시/도 군/구 동/면" /></Field>
                  <Field label="단장(PM)"><input style={inp} value={modal.form.director} onChange={e => set('director', e.target.value)} placeholder="담당자명" /></Field>
                </Row2>
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
                  <Field label="T/P 배점"><input style={inp} value={modal.form.tp_score} onChange={e => set('tp_score', e.target.value)} placeholder="20p" /></Field>
                  <Field label="배점 기준"><input style={inp} value={modal.form.score_dist} onChange={e => set('score_dist', e.target.value)} placeholder="4.5(책임3+분야1.5)" /></Field>
                  <Field label="참여업체 수"><input style={inp} value={modal.form.participants} onChange={e => set('participants', e.target.value)} placeholder="9개사" /></Field>
                </Row3>
                <Row3>
                  <Field label="제안서(P)"><input style={inp} value={modal.form.proposal_p} onChange={e => set('proposal_p', e.target.value)} placeholder="8p" /></Field>
                  <Field label="자기소개서(P)"><input style={inp} value={modal.form.self_intro_p} onChange={e => set('self_intro_p', e.target.value)} placeholder="각 2p" /></Field>
                  <Field label="파워포인트(P)"><input style={inp} value={modal.form.ppt_p} onChange={e => set('ppt_p', e.target.value)} placeholder="20p" /></Field>
                </Row3>
              </div>

              {/* 섹션 5: 일정 */}
              <SectionTitle>일정</SectionTitle>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
                <Row3>
                  <Field label="제출일"><input style={inp} type="date" value={modal.form.submit_date ?? ''} onChange={e => set('submit_date', e.target.value || null)} /></Field>
                  <Field label="PQ 제출일"><input style={inp} value={modal.form.pq_date} onChange={e => set('pq_date', e.target.value)} placeholder="2026-07-01" /></Field>
                  <Field label="SOQ 제출일"><input style={inp} value={modal.form.soq_date} onChange={e => set('soq_date', e.target.value)} placeholder="2026-07-01" /></Field>
                </Row3>
                <Row3>
                  <Field label="발표/면접일"><input style={inp} type="date" value={modal.form.interview_date ?? ''} onChange={e => set('interview_date', e.target.value || null)} /></Field>
                  <Field label="면접시간"><input style={inp} value={modal.form.interview_time} onChange={e => set('interview_time', e.target.value)} placeholder="5분/4분" /></Field>
                  <Field label="평가통보일"><input style={inp} value={modal.form.notify_date} onChange={e => set('notify_date', e.target.value)} placeholder="2026-07-10" /></Field>
                </Row3>
                <Field label="개찰일"><input style={inp} type="date" value={modal.form.bid_date ?? ''} onChange={e => set('bid_date', e.target.value || null)} /></Field>
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

            <div style={{ padding: '12px 24px 20px', display: 'flex', gap: 8, justifyContent: 'flex-end', borderTop: '1px solid #f0f0ee', flexShrink: 0 }}>
              <button onClick={closeModal} style={outlineBtn}>취소</button>
              <button onClick={save} disabled={saving} style={{ ...primaryBtn, opacity: saving ? 0.6 : 1 }}>{saving ? '저장 중...' : '저장'}</button>
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

const td: React.CSSProperties = { padding: '8px 12px', verticalAlign: 'middle', color: '#333' }
const tdnw: React.CSSProperties = { padding: '8px 12px', verticalAlign: 'middle', color: '#333', whiteSpace: 'nowrap' }
const inp: React.CSSProperties = { width: '100%', height: 34, padding: '0 10px', border: '1px solid #e8e8e6', borderRadius: 6, fontSize: 13, background: '#fff', boxSizing: 'border-box' }
const primaryBtn: React.CSSProperties = { height: 34, padding: '0 14px', borderRadius: 6, border: 'none', background: '#111', color: '#fff', fontSize: 13, cursor: 'pointer' }
const outlineBtn: React.CSSProperties = { height: 34, padding: '0 14px', borderRadius: 6, border: '1px solid #ddd', background: '#fff', color: '#333', fontSize: 13, cursor: 'pointer' }
const editBtn: React.CSSProperties = { height: 24, padding: '0 8px', borderRadius: 4, border: '1px solid #e8e8e6', background: '#fff', color: '#333', fontSize: 11, cursor: 'pointer' }
const deleteBtn: React.CSSProperties = { height: 24, padding: '0 8px', borderRadius: 4, border: 'none', background: '#fee2e2', color: '#b91c1c', fontSize: 11, cursor: 'pointer' }
