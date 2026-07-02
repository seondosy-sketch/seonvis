'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase, PerformingProject, ExpectedProject, WeeklyMeta } from '@/lib/supabase'
import WeeklyCalendar from './components/WeeklyCalendar'

function getCurrentWeek(): string {
  const now = new Date()
  const jan4 = new Date(now.getFullYear(), 0, 4)
  const startOfWeek1 = new Date(jan4)
  startOfWeek1.setDate(jan4.getDate() - jan4.getDay() + 1)
  const diff = now.getTime() - startOfWeek1.getTime()
  const week = Math.ceil((diff / 86400000 + 1) / 7)
  return `${now.getFullYear()}-W${String(week).padStart(2, '0')}`
}

function weekLabel(week: string): string {
  const [year, w] = week.split('-W')
  const jan4 = new Date(parseInt(year), 0, 4)
  const startOfWeek1 = new Date(jan4)
  startOfWeek1.setDate(jan4.getDate() - jan4.getDay() + 1)
  const start = new Date(startOfWeek1)
  start.setDate(start.getDate() + (parseInt(w) - 1) * 7)
  const end = new Date(start)
  end.setDate(end.getDate() + 4)
  const fmt = (d: Date) => `${d.getMonth() + 1}.${d.getDate()}`
  return `${year}.${fmt(start)} ~ ${fmt(end)}.`
}

const EMPTY_PERFORMING = (status: '개찰' | '진행중', order: number, week: string): PerformingProject => ({
  status, name: '', director: '', submit_date: '', interview_date: '',
  result_date: '', fee: null, note: '', sort_order: order, week
})

const EMPTY_EXPECTED = (order: number, week: string): ExpectedProject => ({
  name: '', client: '', director: '', project_cost: '',
  order_month: '', fee: '', note: '', sort_order: order, week
})

export default function Dashboard() {
  const [week] = useState(getCurrentWeek)
  const [performing, setPerforming] = useState<PerformingProject[]>([])
  const [expected, setExpected] = useState<ExpectedProject[]>([])
  const [meta, setMeta] = useState<WeeklyMeta>({ week, education_note: '', edu_chief: '', edu_arch: '', edu_civil: '', edu_safety: '', edu_mech: '', other_note: '' })
  const [saving, setSaving] = useState(false)
  const [downloading, setDownloading] = useState<'' | 'weekly' | 'monthly'>('')
  const [saveMsg, setSaveMsg] = useState('')

  const prevWeek = (w: string) => {
    const [y, wn] = w.split('-W').map(Number)
    if (wn > 1) return `${y}-W${String(wn - 1).padStart(2, '0')}`
    const dec28 = new Date(y - 1, 11, 28)
    const jan4 = new Date(y - 1, 0, 4)
    const startOfW1 = new Date(jan4)
    startOfW1.setDate(jan4.getDate() - jan4.getDay() + 1)
    const lastWeek = Math.ceil(((dec28.getTime() - startOfW1.getTime()) / 86400000 + 1) / 7)
    return `${y - 1}-W${String(lastWeek).padStart(2, '0')}`
  }

  const load = useCallback(async () => {
    const [{ data: p }, { data: e }, { data: m }] = await Promise.all([
      supabase.from('performing_projects').select('*').eq('week', week).order('sort_order'),
      supabase.from('expected_projects').select('*').eq('week', week).order('sort_order'),
      supabase.from('weekly_meta').select('*').eq('week', week).maybeSingle(),
    ])
    if (p && p.length > 0) {
      setPerforming(p as PerformingProject[])
    } else {
      setPerforming([
        EMPTY_PERFORMING('개찰', 0, week),
        EMPTY_PERFORMING('개찰', 1, week),
        EMPTY_PERFORMING('개찰', 2, week),
        EMPTY_PERFORMING('진행중', 3, week),
        EMPTY_PERFORMING('진행중', 4, week),
        EMPTY_PERFORMING('진행중', 5, week),
      ])
    }
    if (e && e.length > 0) {
      setExpected(e as ExpectedProject[])
    } else {
      // 현재 주보다 이전 중 가장 최근 주차의 데이터를 가져옴 (주수 제한 없음)
      const { data: latestWeekRow } = await supabase
        .from('expected_projects').select('week').lt('week', week).order('week', { ascending: false }).limit(1).maybeSingle()
      const prev = latestWeekRow ? (await supabase
        .from('expected_projects').select('*').eq('week', latestWeekRow.week).order('sort_order')).data : null
      if (prev && prev.length > 0) {
        // 이번 주 진행중에 올라온 용역명은 발주예상에서 제외
        const performingNames = new Set((p ?? []).map((r: PerformingProject) => r.name).filter(Boolean))
        const carried = (prev as ExpectedProject[])
          .filter((ep: ExpectedProject) => ep.name && !performingNames.has(ep.name))
          .map(({ id, ...r }: ExpectedProject) => ({ ...r, week }))
        setExpected(carried.length > 0 ? carried : [EMPTY_EXPECTED(0, week), EMPTY_EXPECTED(1, week)])
      } else {
        setExpected([EMPTY_EXPECTED(0, week), EMPTY_EXPECTED(1, week)])
      }
    }
    if (m) setMeta(m as WeeklyMeta)
  }, [week])

  useEffect(() => { load() }, [load])

  const save = async () => {
    setSaving(true)
    try {
      await supabase.from('performing_projects').delete().eq('week', week)
      await supabase.from('expected_projects').delete().eq('week', week)
      const perfRows = performing.filter(r => r.name.trim())
      const expRows = expected.filter(r => r.name.trim())
      if (perfRows.length) await supabase.from('performing_projects').insert(perfRows.map(({ id, ...r }) => r))
      if (expRows.length) await supabase.from('expected_projects').insert(expRows.map(({ id, ...r }) => r))
      await supabase.from('weekly_meta').upsert({ ...meta, week }, { onConflict: 'week' })
      setSaveMsg('저장됨')
      setTimeout(() => setSaveMsg(''), 2000)
    } finally {
      setSaving(false)
    }
  }

  const download = async (type: 'weekly' | 'monthly') => {
    setDownloading(type)
    try {
      const res = await fetch('/api/hwpx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, week, performing, expected, meta: { ...meta, ...computedEdu } }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || '생성 실패')
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const today = new Date()
      a.download = type === 'monthly'
        ? `미래사업팀_월간업무_${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}.hwpx`
        : `미래사업팀_주간업무_${week}.hwpx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      alert(`HWPX 생성 중 오류가 발생했습니다.\n${e.message || ''}`)
    } finally {
      setDownloading('')
    }
  }

  const updatePerf = (idx: number, field: keyof PerformingProject, value: string | number | null) => {
    setPerforming(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r))
  }

  const updateExp = (idx: number, field: keyof ExpectedProject, value: string | number | null) => {
    setExpected(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r))
  }

  const addPerf = (status: '개찰' | '진행중') => {
    setPerforming(prev => [...prev, EMPTY_PERFORMING(status, prev.length, week)])
  }

  const removePerf = (idx: number) => {
    setPerforming(prev => prev.filter((_, i) => i !== idx))
  }

  const addExp = () => {
    setExpected(prev => [...prev, EMPTY_EXPECTED(prev.length, week)])
  }

  const removeExp = (idx: number) => {
    setExpected(prev => prev.filter((_, i) => i !== idx))
  }

  const gaeching = performing.filter(r => r.status === '개찰')
  const jinhaeng = performing.filter(r => r.status === '진행중')
  const totalFee = performing.reduce((s, r) => s + (r.fee ?? 0), 0)

  // 교육참가자: 개찰+진행중 전체에서 매 렌더마다 직접 계산
  const computedEdu = (() => {
    console.log('[EDU DEBUG] performing:', performing.length,
      '개찰:', performing.filter(r => r.status === '개찰').length,
      '진행중:', performing.filter(r => r.status === '진행중').length,
      'statuses:', performing.map(r => r.status))
    const allRows = performing.filter(r => r.name?.trim())
    console.log('[EDU DEBUG] allRows:', allRows.length,
      'directors:', allRows.map(r => r.director),
      'notes:', allRows.map(r => r.note))
    const chiefs = [...new Set(allRows.map(r => r.director).filter((d): d is string => !!d?.trim()))]
    const byField: Record<string, string[]> = { 건축: [], 토목: [], 안전: [], 기계: [] }
    const seen: Record<string, Set<string>> = { 건축: new Set(), 토목: new Set(), 안전: new Set(), 기계: new Set() }
    for (const row of allRows) {
      if (!row.note) continue
      for (const m of [...row.note.matchAll(/-([가-힣]+)\s+([가-힣]+)/g)]) {
        const field = m[1], name = m[2]
        if (field in byField && !seen[field].has(name)) { byField[field].push(name); seen[field].add(name) }
      }
    }
    const fmt = (names: string[], label: string) =>
      names.length ? `${names.join(', ')} – ${label} ${names.length}명` : ''
    const total = chiefs.length + Object.values(byField).reduce((s, v) => s + v.length, 0)
    return {
      edu_chief:  chiefs.length ? `${chiefs.join(', ')} - ${chiefs.length}명` : '',
      edu_arch:   fmt(byField.건축, '건축'),
      edu_civil:  fmt(byField.토목, '토목'),
      edu_safety: fmt(byField.안전, '안전'),
      edu_mech:   fmt(byField.기계, '기계'),
      total,
    }
  })()

  return (
    <div className="min-h-screen" style={{ background: '#f8f8f7' }}>
      {/* Header */}
      <header style={{ background: '#fff', borderBottom: '1px solid #e8e8e6' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 14, color: '#555' }}>주간/월간업무보고</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {saveMsg && <span style={{ fontSize: 12, color: '#22c55e' }}>{saveMsg}</span>}
            <button
              onClick={save}
              disabled={saving}
              style={{
                height: 32, padding: '0 14px', borderRadius: 6, border: '1px solid #ddd',
                background: '#fff', fontSize: 13, color: '#333', cursor: 'pointer',
                opacity: saving ? 0.6 : 1
              }}
            >
              {saving ? '저장 중...' : '저장'}
            </button>
            <button
              onClick={() => download('weekly')}
              disabled={downloading !== ''}
              style={{
                height: 32, padding: '0 14px', borderRadius: 6, border: 'none',
                background: '#2563eb', color: '#fff', fontSize: 13, cursor: 'pointer',
                opacity: downloading !== '' ? 0.6 : 1
              }}
            >
              {downloading === 'weekly' ? '생성 중...' : '주간 HWPX'}
            </button>
            <button
              onClick={() => download('monthly')}
              disabled={downloading !== ''}
              style={{
                height: 32, padding: '0 14px', borderRadius: 6, border: 'none',
                background: '#111', color: '#fff', fontSize: 13, cursor: 'pointer',
                opacity: downloading !== '' ? 0.6 : 1
              }}
            >
              {downloading === 'monthly' ? '생성 중...' : '월간 HWPX'}
            </button>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 24px 80px' }}>
        {/* Week label */}
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: '#111', marginBottom: 4 }}>주간업무</h1>
          <p style={{ fontSize: 13, color: '#888' }}>{weekLabel(week)} · {week}</p>
        </div>

        {/* Summary cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 24 }}>
          {[
            { label: '수행 프로젝트', value: performing.filter(r => r.name).length + '건' },
            { label: '총 용역비', value: totalFee.toFixed(1) + '억' },
            { label: '개찰', value: gaeching.filter(r => r.name).length + '건' },
            { label: '진행중', value: jinhaeng.filter(r => r.name).length + '건' },
          ].map(card => (
            <div key={card.label} style={{ background: '#fff', border: '1px solid #e8e8e6', borderRadius: 8, padding: '14px 16px' }}>
              <div style={{ fontSize: 12, color: '#999', marginBottom: 4 }}>{card.label}</div>
              <div style={{ fontSize: 22, fontWeight: 600, color: '#111' }}>{card.value}</div>
            </div>
          ))}
        </div>

        {/* 수행 프로젝트 */}
        <Section title="1) 수행 Project (공동수행)">
          <PerformingTable
            rows={gaeching}
            allRows={performing}
            status="개찰"
            onUpdate={(localIdx, field, val) => {
              const globalIdx = performing.findIndex((r, i) => r.status === '개찰' && performing.filter(x => x.status === '개찰').indexOf(r) === localIdx)
              const actualIdx = performing.map((r, i) => ({ r, i })).filter(({ r }) => r.status === '개찰')[localIdx]?.i
              if (actualIdx !== undefined) updatePerf(actualIdx, field, val)
            }}
            onRemove={(localIdx) => {
              const actualIdx = performing.map((r, i) => ({ r, i })).filter(({ r }) => r.status === '개찰')[localIdx]?.i
              if (actualIdx !== undefined) removePerf(actualIdx)
            }}
            onAdd={() => addPerf('개찰')}
          />
          <div style={{ height: 1, background: '#e8e8e6', margin: '4px 0' }} />
          <PerformingTable
            rows={jinhaeng}
            allRows={performing}
            status="진행중"
            onUpdate={(localIdx, field, val) => {
              const actualIdx = performing.map((r, i) => ({ r, i })).filter(({ r }) => r.status === '진행중')[localIdx]?.i
              if (actualIdx !== undefined) updatePerf(actualIdx, field, val)
            }}
            onRemove={(localIdx) => {
              const actualIdx = performing.map((r, i) => ({ r, i })).filter(({ r }) => r.status === '진행중')[localIdx]?.i
              if (actualIdx !== undefined) removePerf(actualIdx)
            }}
            onAdd={() => addPerf('진행중')}
          />
        </Section>

        {/* 발주예상 프로젝트 */}
        <Section title="2) 발주예상 Project (공동예정)">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f4f4f2' }}>
                  {['연번', 'Project', '발주청', '단장', '사업비(억)', '발주(월)', '용역비(억)', '내용', ''].map(h => (
                    <th key={h} style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 500, color: '#555', fontSize: 12, borderBottom: '1px solid #e8e8e6', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {expected.map((row, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f0f0ee' }}>
                    <td style={tdStyle}>{i + 1}</td>
                    <td style={{ ...tdStyle, minWidth: 160 }}><input className="cell-input" value={row.name} onChange={e => updateExp(i, 'name', e.target.value)} placeholder="Project명" /></td>
                    <td style={{ ...tdStyle, minWidth: 100 }}><input className="cell-input" value={row.client} onChange={e => updateExp(i, 'client', e.target.value)} placeholder="발주청" /></td>
                    <td style={{ ...tdStyle, minWidth: 80 }}><input className="cell-input" value={row.director} onChange={e => updateExp(i, 'director', e.target.value)} placeholder="단장" /></td>
                    <td style={{ ...tdStyle, minWidth: 100 }}><input className="cell-input" value={row.project_cost} onChange={e => updateExp(i, 'project_cost', e.target.value)} placeholder="1,255억(공사비)" /></td>
                    <td style={{ ...tdStyle, minWidth: 70 }}><input className="cell-input" value={row.order_month} onChange={e => updateExp(i, 'order_month', e.target.value)} placeholder="6월" /></td>
                    <td style={{ ...tdStyle, minWidth: 100 }}><input className="cell-input" value={row.fee} onChange={e => updateExp(i, 'fee', e.target.value)} placeholder="150억(예상)" /></td>
                    <td style={{ ...tdStyle, minWidth: 200, verticalAlign: 'top', paddingTop: 8 }}><textarea className="cell-input" value={row.note} onChange={e => updateExp(i, 'note', e.target.value)} placeholder="내용" rows={2} style={{ resize: 'none', lineHeight: 1.5 }} /></td>
                    <td style={tdStyle}><button onClick={() => removeExp(i)} style={removeBtn}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <AddRowButton onClick={addExp} label="행 추가" />
        </Section>

        {/* DEBUG: performing 상태 확인용 임시 출력 */}
        <div style={{ background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 6, padding: '8px 14px', marginBottom: 12, fontSize: 11, color: '#92400e', fontFamily: 'monospace' }}>
          [DEBUG] performing 전체: {performing.length}개
          {' | '}개찰: {performing.filter(r => r.status === '개찰').length}개
          {' | '}진행중: {performing.filter(r => r.status === '진행중').length}개
          {' | '}status 목록: [{performing.map(r => `"${r.status}"`).join(', ')}]
        </div>

        {/* 교육참가자 & 기타 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Section title="3) 교육참가자 (OSG팀)">
            <div style={{ padding: '4px 0' }}>
              {([
                { key: 'edu_chief',  label: '책임' },
                { key: 'edu_arch',   label: '건축' },
                { key: 'edu_civil',  label: '토목' },
                { key: 'edu_safety', label: '안전' },
                { key: 'edu_mech',   label: '기계' },
              ] as { key: keyof typeof computedEdu; label: string }[]).map(({ key, label }) => (
                key === 'total' ? null :
                <div key={key} style={{ display: 'flex', alignItems: 'flex-start', borderBottom: '1px solid #f5f5f3', padding: '6px 16px', gap: 12 }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: '#888', minWidth: 30, paddingTop: 1 }}>{label}</span>
                  <span style={{ flex: 1, fontSize: 13, color: computedEdu[key] ? '#111' : '#bbb', paddingTop: 1 }}>
                    {computedEdu[key] || '–'}
                  </span>
                </div>
              ))}
              {computedEdu.total > 0 && (
                <div style={{ padding: '6px 16px', fontSize: 12, color: '#888', textAlign: 'right' }}>
                  총 {computedEdu.total}명
                </div>
              )}
            </div>
          </Section>
          <Section title="4) 기 타">
            <textarea
              className="cell-input"
              rows={6}
              value={meta.other_note}
              onChange={e => setMeta(m => ({ ...m, other_note: e.target.value }))}
              placeholder="기타 사항 입력"
              style={{ resize: 'vertical', padding: '12px 16px', border: 'none', fontSize: 13, width: '100%', background: '#fff' }}
            />
          </Section>
        </div>

        {/* Calendar */}
        <WeeklyCalendar week={week} performing={performing} />

      </div>
    </div>
  )
}

const tdStyle: React.CSSProperties = { padding: '6px 10px', verticalAlign: 'middle', color: '#111' }
const removeBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: '#ccc', cursor: 'pointer',
  fontSize: 12, padding: '2px 4px', borderRadius: 4
}

function Section({ title, titleRight, children }: { title: string; titleRight?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e8e8e6', borderRadius: 8, marginBottom: 12, overflow: 'hidden' }}>
      <div style={{ padding: '10px 16px', borderBottom: '1px solid #f0f0ee', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: '#333' }}>{title}</span>
        {titleRight}
      </div>
      <div style={{ padding: '0 0 4px' }}>{children}</div>
    </div>
  )
}

function AddRowButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', padding: '7px', background: 'none', border: 'none',
        borderTop: '1px solid #f0f0ee', color: '#aaa', fontSize: 12,
        cursor: 'pointer', textAlign: 'left', paddingLeft: 16
      }}
    >
      + {label}
    </button>
  )
}

interface PerformingTableProps {
  rows: PerformingProject[]
  allRows: PerformingProject[]
  status: '개찰' | '진행중'
  onUpdate: (localIdx: number, field: keyof PerformingProject, value: string | number | null) => void
  onRemove: (localIdx: number) => void
  onAdd: () => void
}

function PerformingTable({ rows, status, onUpdate, onRemove, onAdd }: PerformingTableProps) {
  const statusColor = status === '개찰'
    ? { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe' }
    : { bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0' }

  return (
    <div>
      <div style={{ padding: '6px 16px', display: 'flex', alignItems: 'center', gap: 8, background: status === '개찰' ? '#fafafa' : '#fafafa', borderBottom: '1px solid #f0f0ee' }}>
        <span style={{
          fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 4,
          background: statusColor.bg, color: statusColor.text, border: `1px solid ${statusColor.border}`
        }}>{status}</span>
        <span style={{ fontSize: 12, color: '#aaa' }}>{rows.filter(r => r.name).length}건</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          {rows.length === 0 || true ? (
            <thead>
              <tr style={{ background: '#f9f9f8' }}>
                {['연번', '용역명', '단장', '제출일', '발표/면접', '개찰일', '용역비(억)', '내용', ''].map(h => (
                  <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 500, color: '#888', fontSize: 11, borderBottom: '1px solid #f0f0ee', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
          ) : null}
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #f5f5f3' }}>
                <td style={{ ...tdStyle, color: '#999', width: 36 }}>{i + 1}</td>
                <td style={{ ...tdStyle, minWidth: 200 }}><input className="cell-input" value={row.name} onChange={e => onUpdate(i, 'name', e.target.value)} placeholder="용역명" /></td>
                <td style={{ ...tdStyle, minWidth: 80 }}><input className="cell-input" value={row.director} onChange={e => onUpdate(i, 'director', e.target.value)} placeholder="단장" /></td>
                <td style={{ ...tdStyle, minWidth: 70 }}><input className="cell-input" value={row.submit_date} onChange={e => onUpdate(i, 'submit_date', e.target.value)} placeholder="6/5" /></td>
                <td style={{ ...tdStyle, minWidth: 70 }}><input className="cell-input" value={row.interview_date} onChange={e => onUpdate(i, 'interview_date', e.target.value)} placeholder="6/10" /></td>
                <td style={{ ...tdStyle, minWidth: 70 }}><input className="cell-input" value={row.result_date} onChange={e => onUpdate(i, 'result_date', e.target.value)} placeholder="추후" /></td>
                <td style={{ ...tdStyle, minWidth: 80 }}><input className="cell-input" type="number" value={row.fee ?? ''} onChange={e => onUpdate(i, 'fee', e.target.value ? parseFloat(e.target.value) : null)} placeholder="0.0" /></td>
                <td style={{ ...tdStyle, minWidth: 200 }}><input className="cell-input" value={row.note} onChange={e => onUpdate(i, 'note', e.target.value)} placeholder="내용" /></td>
                <td style={tdStyle}><button onClick={() => onRemove(i)} style={removeBtn}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <AddRowButton onClick={onAdd} label={`${status} 행 추가`} />
    </div>
  )
}
