'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

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
  result_score: string
  status: ProjectStatus
  evaluation: string
  participants: string
  participation_ratio: string
  director: string
  note: string
  created_at: string
}

const STATUS_STYLE: Record<ProjectStatus, React.CSSProperties> = {
  진행중: { background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' },
  수주:   { background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0' },
  탈락:   { background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' },
  취소:   { background: '#f4f4f2', color: '#888',    border: '1px solid #ddd' },
}

const EMPTY: Omit<Project, 'id' | 'created_at'> = {
  project_number: '', type: '면접', client: '', name: '',
  fee: null, tp_score: '', duration_days: '',
  submit_date: null, interview_date: null,
  result_score: '', status: '진행중',
  evaluation: '', participants: '', participation_ratio: '',
  director: '', note: '',
}

const TYPES: ProjectType[] = ['면접', 'SOQ', '종심제', 'TP', 'PQ', '기타']
const STATUSES: ProjectStatus[] = ['진행중', '수주', '탈락', '취소']

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<ProjectStatus | '전체'>('전체')
  const [filterType, setFilterType] = useState<ProjectType | '전체'>('전체')
  const [modal, setModal] = useState<{ open: boolean; data: Omit<Project, 'id' | 'created_at'>; editId: string | null }>({
    open: false, data: { ...EMPTY }, editId: null,
  })
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data } = await supabase.from('projects').select('*').order('project_number', { ascending: true })
    if (data) setProjects(data as Project[])
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = projects.filter(p => {
    const q = search.toLowerCase()
    const matchSearch = !search || p.name.toLowerCase().includes(q) || p.client.toLowerCase().includes(q) || p.director.toLowerCase().includes(q) || p.project_number.includes(q)
    const matchStatus = filterStatus === '전체' || p.status === filterStatus
    const matchType = filterType === '전체' || p.type === filterType
    return matchSearch && matchStatus && matchType
  })

  const openAdd = () => setModal({ open: true, data: { ...EMPTY }, editId: null })
  const openEdit = (p: Project) => setModal({
    open: true,
    data: { project_number: p.project_number, type: p.type, client: p.client, name: p.name, fee: p.fee, tp_score: p.tp_score, duration_days: p.duration_days, submit_date: p.submit_date, interview_date: p.interview_date, result_score: p.result_score, status: p.status, evaluation: p.evaluation, participants: p.participants, participation_ratio: p.participation_ratio, director: p.director, note: p.note },
    editId: p.id,
  })
  const closeModal = () => setModal(m => ({ ...m, open: false }))

  const save = async () => {
    if (!modal.data.name.trim()) return
    setSaving(true)
    try {
      if (modal.editId) {
        await supabase.from('projects').update({ ...modal.data, updated_at: new Date().toISOString() }).eq('id', modal.editId)
      } else {
        await supabase.from('projects').insert(modal.data)
      }
      await load()
      closeModal()
    } finally { setSaving(false) }
  }

  const remove = async (id: string) => {
    if (!confirm('삭제하시겠습니까?')) return
    setDeleting(id)
    await supabase.from('projects').delete().eq('id', id)
    await load()
    setDeleting(null)
  }

  const exportCsv = () => {
    const headers = ['공사번호', '유형', '발주처', '용역명', '용역비(억)', 'T/P', '기간', '제출일', '발표일', '결과', '평가', '참여자', '참여비율', '단장', '상태', '비고']
    const rowsData = filtered.map(p => [
      p.project_number, p.type, p.client, p.name,
      p.fee ?? '', p.tp_score, p.duration_days,
      p.submit_date ?? '', p.interview_date ?? '',
      p.result_score, p.evaluation, p.participants, p.participation_ratio,
      p.director, p.status, p.note,
    ])
    const csv = [headers, ...rowsData].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `프로젝트List_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const set = (field: string, value: unknown) => setModal(m => ({ ...m, data: { ...m.data, [field]: value } }))

  const totalFee = filtered.reduce((s, p) => s + (p.fee ?? 0), 0)

  return (
    <div style={{ minHeight: '100vh', background: '#f8f8f7' }}>
      {/* Header */}
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
        {/* 요약 카드 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
          {([['전체', projects], ['진행중', projects.filter(p => p.status === '진행중')], ['수주', projects.filter(p => p.status === '수주')], ['탈락', projects.filter(p => p.status === '탈락')]] as [string, Project[]][]).map(([label, list]) => (
            <div key={label} style={{ background: '#fff', border: '1px solid #e8e8e6', borderRadius: 8, padding: '12px 16px' }}>
              <div style={{ fontSize: 12, color: '#999', marginBottom: 4 }}>{label === '전체' ? '전체 프로젝트' : label}</div>
              <div style={{ fontSize: 20, fontWeight: 600, color: '#111' }}>{list.length}건</div>
              <div style={{ fontSize: 12, color: '#aaa', marginTop: 2 }}>{list.reduce((s, p) => s + (p.fee ?? 0), 0).toFixed(1)}억</div>
            </div>
          ))}
        </div>

        {/* 검색 + 필터 */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="공사번호, 용역명, 발주처, 단장 검색..."
            style={{ flex: 1, minWidth: 200, height: 34, padding: '0 12px', border: '1px solid #e8e8e6', borderRadius: 6, fontSize: 13, background: '#fff' }}
          />
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

        {/* 테이블 */}
        <div style={{ background: '#fff', border: '1px solid #e8e8e6', borderRadius: 8, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#f4f4f2' }}>
                {['공사번호', '유형', '발주처', '용역명', '용역비(억)', 'T/P', '기간', '제출일', '발표일', '결과', '평가', '단장', '참여자', '상태', ''].map(h => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 500, color: '#555', borderBottom: '1px solid #e8e8e6', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={15} style={{ padding: 40, textAlign: 'center', color: '#bbb' }}>데이터가 없습니다</td></tr>
              ) : filtered.map(p => (
                <tr key={p.id} style={{ borderBottom: '1px solid #f0f0ee' }}>
                  <td style={td}><span style={{ color: '#999' }}>{p.project_number}</span></td>
                  <td style={td}><span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 3, background: '#f0f0ee', color: '#555' }}>{p.type}</span></td>
                  <td style={{ ...td, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.client}</td>
                  <td style={{ ...td, minWidth: 180 }}><span style={{ fontWeight: 500, color: '#111' }}>{p.name}</span></td>
                  <td style={{ ...td, textAlign: 'right' }}>{p.fee != null ? `${p.fee}` : '-'}</td>
                  <td style={td}>{p.tp_score}</td>
                  <td style={td}>{p.duration_days}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{p.submit_date ?? '-'}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{p.interview_date ?? '-'}</td>
                  <td style={td}><span style={{ fontWeight: 600, color: p.result_score ? '#111' : '#ccc' }}>{p.result_score || '-'}</span></td>
                  <td style={td}>{p.evaluation}</td>
                  <td style={td}>{p.director}</td>
                  <td style={td}>{p.participants}</td>
                  <td style={td}>
                    <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 4, ...STATUS_STYLE[p.status] }}>{p.status}</span>
                  </td>
                  <td style={td}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button onClick={() => openEdit(p)} style={editBtn}>수정</button>
                      <button onClick={() => remove(p.id)} disabled={deleting === p.id} style={deleteBtn}>삭제</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: '#f9f9f8', borderTop: '2px solid #e8e8e6' }}>
                <td colSpan={4} style={{ padding: '8px 12px', fontSize: 12, color: '#555', fontWeight: 500 }}>합계 {filtered.length}건</td>
                <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: '#111' }}>{totalFee.toFixed(1)}</td>
                <td colSpan={10} />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* 모달 */}
      {modal.open && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: '28px', width: 560, maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 20 }}>{modal.editId ? '프로젝트 수정' : '프로젝트 추가'}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Row2>
                <Field label="공사번호"><input style={inp} value={modal.data.project_number} onChange={e => set('project_number', e.target.value)} placeholder="2641" /></Field>
                <Field label="유형">
                  <select style={inp} value={modal.data.type} onChange={e => set('type', e.target.value)}>
                    {TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                </Field>
              </Row2>
              <Field label="발주처"><input style={inp} value={modal.data.client} onChange={e => set('client', e.target.value)} placeholder="발주처" /></Field>
              <Field label="용역명 *"><input style={inp} value={modal.data.name} onChange={e => set('name', e.target.value)} placeholder="용역명" /></Field>
              <Row3>
                <Field label="용역비(억)"><input style={inp} type="number" value={modal.data.fee ?? ''} onChange={e => set('fee', e.target.value ? parseFloat(e.target.value) : null)} placeholder="0.0" /></Field>
                <Field label="T/P 배점"><input style={inp} value={modal.data.tp_score} onChange={e => set('tp_score', e.target.value)} placeholder="20p" /></Field>
                <Field label="기간(일)"><input style={inp} value={modal.data.duration_days} onChange={e => set('duration_days', e.target.value)} placeholder="30" /></Field>
              </Row3>
              <Row2>
                <Field label="제출일"><input style={inp} type="date" value={modal.data.submit_date ?? ''} onChange={e => set('submit_date', e.target.value || null)} /></Field>
                <Field label="발표/면접일"><input style={inp} type="date" value={modal.data.interview_date ?? ''} onChange={e => set('interview_date', e.target.value || null)} /></Field>
              </Row2>
              <Row3>
                <Field label="결과(등급)"><input style={inp} value={modal.data.result_score} onChange={e => set('result_score', e.target.value)} placeholder="수/우/1등" /></Field>
                <Field label="평가업체"><input style={inp} value={modal.data.evaluation} onChange={e => set('evaluation', e.target.value)} placeholder="업체명" /></Field>
                <Field label="상태">
                  <select style={inp} value={modal.data.status} onChange={e => set('status', e.target.value)}>
                    {STATUSES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </Field>
              </Row3>
              <Row2>
                <Field label="단장"><input style={inp} value={modal.data.director} onChange={e => set('director', e.target.value)} placeholder="단장" /></Field>
                <Field label="참여자 수"><input style={inp} value={modal.data.participants} onChange={e => set('participants', e.target.value)} placeholder="9개사" /></Field>
              </Row2>
              <Row2>
                <Field label="참여비율"><input style={inp} value={modal.data.participation_ratio} onChange={e => set('participation_ratio', e.target.value)} placeholder="98.13" /></Field>
                <Field label="비고"><input style={inp} value={modal.data.note} onChange={e => set('note', e.target.value)} placeholder="메모" /></Field>
              </Row2>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
              <button onClick={closeModal} style={outlineBtn}>취소</button>
              <button onClick={save} disabled={saving} style={{ ...primaryBtn, opacity: saving ? 0.6 : 1 }}>{saving ? '저장 중...' : '저장'}</button>
            </div>
          </div>
        </div>
      )}
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
const inp: React.CSSProperties = { width: '100%', height: 34, padding: '0 10px', border: '1px solid #e8e8e6', borderRadius: 6, fontSize: 13, background: '#fff', boxSizing: 'border-box' }
const primaryBtn: React.CSSProperties = { height: 34, padding: '0 14px', borderRadius: 6, border: 'none', background: '#111', color: '#fff', fontSize: 13, cursor: 'pointer' }
const outlineBtn: React.CSSProperties = { height: 34, padding: '0 14px', borderRadius: 6, border: '1px solid #ddd', background: '#fff', color: '#333', fontSize: 13, cursor: 'pointer' }
const editBtn: React.CSSProperties = { height: 24, padding: '0 8px', borderRadius: 4, border: '1px solid #e8e8e6', background: '#fff', color: '#333', fontSize: 11, cursor: 'pointer' }
const deleteBtn: React.CSSProperties = { height: 24, padding: '0 8px', borderRadius: 4, border: 'none', background: '#fee2e2', color: '#b91c1c', fontSize: 11, cursor: 'pointer' }
