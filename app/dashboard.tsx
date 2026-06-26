'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase, PerformingProject, ExpectedProject, WeeklyMeta } from '@/lib/supabase'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
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

interface ProjectRef {
  name: string
  director: string
  client: string
  fee: number | null
  submit_date: string | null
  interview_date: string | null
  bid_date: string | null
  result_score: string
  evaluation: string
  participants: string
  status_override: string | null
  staff_arch: string
  staff_civil: string
  staff_mech: string
  staff_safety: string
}

function categorizeProject(r: ProjectRef, weekStart: Date): '진행중' | '개찰' | '제외' {
  if (computeProjectStatus(r) === '취소') return '제외'

  // 1. 제출일이 이번주 이전이 아니면 → 진행중
  const submit = parseLocalDate(r.submit_date)
  if (!submit || submit >= weekStart) return '진행중'

  // 2. 발표/면접일: 공란·추후 → 진행중 / 서면 → 개찰로 / 날짜가 이번주 이후 → 진행중
  const ivRaw = r.interview_date?.trim() ?? ''
  if (ivRaw !== '서면') {
    const interview = parseLocalDate(ivRaw)
    if (!interview || interview >= weekStart) return '진행중'
  }

  // 3. 개찰일: 공란·추후 → 개찰 / 이번주 이전 → 제외 / 이번주 이후 → 개찰
  const bid = parseLocalDate(r.bid_date)
  if (bid && bid < weekStart) return '제외'
  return '개찰'
}

function parseLocalDate(d: string | null | undefined): Date | null {
  if (!d) return null
  const iso = d.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) return new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]))
  const md = d.match(/^(\d{1,2})\/(\d{1,2})$/)
  if (md) return new Date(new Date().getFullYear(), parseInt(md[1]) - 1, parseInt(md[2]))
  return null
}

function isEmpty(v: string | null | undefined) {
  return !v || v.trim() === '' || v.trim().toLowerCase() === 'nan'
}

function computeProjectStatus(p: ProjectRef): string {
  if (p.status_override) return p.status_override
  if (p.participants?.includes('드랍') || p.participants?.includes('드롭')) return '취소'
  if (p.evaluation === '선') return '수주'
  if (isEmpty(p.result_score) || isEmpty(p.evaluation)) return '진행중'
  return '탈락'
}

function getWeekRange(week: string): { start: Date; end: Date } {
  const [year, w] = week.split('-W')
  const jan4 = new Date(parseInt(year), 0, 4)
  const startOfW1 = new Date(jan4)
  startOfW1.setDate(jan4.getDate() - jan4.getDay() + 1)
  const start = new Date(startOfW1)
  start.setDate(start.getDate() + (parseInt(w) - 1) * 7)
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  return { start, end }
}

function shiftWeek(week: string, delta: number): string {
  const [year, w] = week.split('-W')
  const jan4 = new Date(parseInt(year), 0, 4)
  const startOfW1 = new Date(jan4)
  startOfW1.setDate(jan4.getDate() - jan4.getDay() + 1)
  const start = new Date(startOfW1)
  start.setDate(start.getDate() + (parseInt(w) - 1) * 7 + delta * 7)
  const newJan4 = new Date(start.getFullYear(), 0, 4)
  const newW1 = new Date(newJan4)
  newW1.setDate(newJan4.getDate() - newJan4.getDay() + 1)
  const diff = Math.round((start.getTime() - newW1.getTime()) / 86400000)
  const newW = Math.ceil((diff + 1) / 7)
  return `${start.getFullYear()}-W${String(newW).padStart(2, '0')}`
}

export default function Dashboard() {
  const currentWeek = getCurrentWeek()
  const [week, setWeek] = useState(currentWeek)
  const [performing, setPerforming] = useState<PerformingProject[]>([])
  const [expected, setExpected] = useState<ExpectedProject[]>([])
  const [meta, setMeta] = useState<WeeklyMeta>({ week, education_note: '', edu_chief: '', edu_arch: '', edu_civil: '', edu_safety: '', edu_mech: '', other_note: '' })
  const [saving, setSaving] = useState(false)
  const [downloading, setDownloading] = useState<'' | 'weekly' | 'monthly'>('')
  const [saveMsg, setSaveMsg] = useState('')
  const [projectRefs, setProjectRefs] = useState<ProjectRef[]>([])
  const [copying, setCopying] = useState(false)
  const [calNotes, setCalNotes] = useState<Record<string, Record<string, string>>>({})

  const loadRefs = useCallback(async () => {
    const { data } = await createSupabaseBrowserClient()
      .from('projects')
      .select('name,director,client,fee,submit_date,interview_date,bid_date,result_score,evaluation,participants,status_override,staff_arch,staff_civil,staff_mech,staff_safety')
      .order('project_number', { ascending: false })
    if (data) setProjectRefs(data as ProjectRef[])
  }, [])

  useEffect(() => {
    const onFocus = () => loadRefs()
    document.addEventListener('visibilitychange', onFocus)
    return () => document.removeEventListener('visibilitychange', onFocus)
  }, [loadRefs])

  const load = useCallback(async () => {
    const [{ data: p }, { data: e }, { data: m }, { data: refs }, { data: notesData }] = await Promise.all([
      supabase.from('performing_projects').select('*').eq('week', week).order('sort_order'),
      supabase.from('expected_projects').select('*').eq('week', week).order('sort_order'),
      supabase.from('weekly_meta').select('*').eq('week', week).maybeSingle(),
      createSupabaseBrowserClient().from('projects').select('name,project_number,director,client,fee,submit_date,interview_date,bid_date,result_score,evaluation,participants,status_override,staff_arch,staff_civil,staff_mech,staff_safety').order('project_number', { ascending: false }),
      createSupabaseBrowserClient().from('project_notes').select('*'),
    ])
    const allRefs = (refs ?? []) as (ProjectRef & { project_number: string })[]
    setProjectRefs(allRefs)

    if (notesData) {
      const map: Record<string, Record<string, string>> = {}
      for (const n of notesData) {
        const ref = allRefs.find(r => r.project_number === n.project_number)
        if (ref) { if (!map[ref.name]) map[ref.name] = {}; map[ref.name][n.field] = n.note }
      }
      setCalNotes(map)
    }

    const { start: weekStart } = getWeekRange(week)
    const jinhaengRefs = allRefs.filter(r => categorizeProject(r, weekStart) === '진행중')

    const fmtDate = (d: string | null | undefined): string => {
      if (!d) return ''
      // YYYY-MM-DD → M/D
      const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/)
      if (m) return `${parseInt(m[2])}/${parseInt(m[3])}`
      return d
    }

    const makeNote = (r: ProjectRef) => [
      r.staff_arch  ? `-건축 ${r.staff_arch}`  : '',
      r.staff_civil ? `-토목 ${r.staff_civil}` : '',
      r.staff_mech  ? `-기계 ${r.staff_mech}`  : '',
      r.staff_safety? `-안전 ${r.staff_safety}`: '',
    ].filter(Boolean).join(' ')

    const toPerf = (r: ProjectRef, status: '개찰' | '진행중', i: number): PerformingProject => ({
      status, week,
      name: r.name,
      director: r.director ?? '',
      submit_date: fmtDate(r.submit_date),
      interview_date: fmtDate(r.interview_date),
      result_date: fmtDate(r.bid_date),
      fee: r.fee ?? null,
      note: makeNote(r),
      sort_order: i,
    })

    if (p && p.length > 0) {
      const refMap = new Map(allRefs.map(r => [r.name, r]))

      // 저장된 행: 분류 재검토 (프로젝트 List 기준 우선, 없으면 저장된 날짜로 판단)
      const recategorized = (p as PerformingProject[]).flatMap(row => {
        const ref = refMap.get(row.name)
        if (ref) {
          const cat = categorizeProject(ref, weekStart)
          if (cat === '제외') return []
          return [{ ...row, status: cat }]
        }
        // 수동 추가 행: performing_projects 날짜로 직접 판단
        const submit    = parseLocalDate(row.submit_date)
        const ivRaw     = row.interview_date?.trim() ?? ''
        const interview = parseLocalDate(ivRaw)
        const bid       = parseLocalDate(row.result_date)
        if (!submit || submit >= weekStart) return [row]
        if (ivRaw !== '서면' && (!interview || interview >= weekStart)) return [row]
        if (bid && bid < weekStart) return [] // 제외
        return [row]
      })

      // 새로 추가된 프로젝트 병합
      const savedNames = new Set(recategorized.map(r => r.name))
      const newRows: PerformingProject[] = []
      for (const r of allRefs) {
        if (savedNames.has(r.name)) continue
        const cat = categorizeProject(r, weekStart)
        if (cat === '제외') continue
        newRows.push(toPerf(r, cat, recategorized.length + newRows.length))
      }
      setPerforming([...recategorized, ...newRows])
    } else {
      // 저장된 데이터 없으면 프로젝트 List에서 자동 채우기
      const gaechalRows: PerformingProject[] = []
      const jinhaengRows: PerformingProject[] = []
      for (const r of allRefs) {
        const cat = categorizeProject(r, weekStart)
        if (cat === '개찰') gaechalRows.push(toPerf(r, '개찰', gaechalRows.length))
        else if (cat === '진행중') jinhaengRows.push(toPerf(r, '진행중', jinhaengRows.length))
      }
      gaechalRows.forEach((r, i) => { r.sort_order = i })
      jinhaengRows.forEach((r, i) => { r.sort_order = gaechalRows.length + i })
      const autoRows = [...gaechalRows, ...jinhaengRows]
      setPerforming(autoRows.length > 0 ? autoRows : [
        EMPTY_PERFORMING('개찰', 0, week),
        EMPTY_PERFORMING('진행중', 1, week),
      ])
    }

    if (e && e.length > 0) {
      setExpected(e as ExpectedProject[])
    } else {
      // 이전 주차 발주예상 중 이번 주 진행중에 없는 것은 이월
      const prevWeek = shiftWeek(week, -1)
      const { data: prevExpected } = await supabase
        .from('expected_projects').select('*').eq('week', prevWeek).order('sort_order')
      const jinhaengNames = new Set(jinhaengRefs.map(r => r.name))
      const carried = ((prevExpected ?? []) as ExpectedProject[])
        .filter(ep => ep.name && !jinhaengNames.has(ep.name))
        .map((ep, i) => ({ ...ep, id: undefined, week, sort_order: i }))
      setExpected(carried.length > 0 ? carried : [EMPTY_EXPECTED(0, week), EMPTY_EXPECTED(1, week)])
    }

    // 교육참가자: 주차 기준 진행중 프로젝트에서만 취합 (빈 경우만 자동 채우기)
    const activeRefs = jinhaengRefs
    const uniq = (field: keyof ProjectRef) => {
      const names = activeRefs.map(r => (r[field] as string) ?? '').filter(Boolean)
      return [...new Set(names)].join(', ')
    }
    const baseMeta: WeeklyMeta = m ? m as WeeklyMeta : { week, education_note: '', edu_chief: '', edu_arch: '', edu_civil: '', edu_safety: '', edu_mech: '', other_note: '' }
    setMeta({
      ...baseMeta,
      edu_chief:  uniq('director'),
      edu_arch:   uniq('staff_arch'),
      edu_civil:  uniq('staff_civil'),
      edu_mech:   uniq('staff_mech'),
      edu_safety: uniq('staff_safety'),
    })
  }, [week])

  const copyFromPrevWeek = async () => {
    const prevWeek = shiftWeek(week, -1)
    const [{ data: p }, { data: e }] = await Promise.all([
      supabase.from('performing_projects').select('*').eq('week', prevWeek).order('sort_order'),
      supabase.from('expected_projects').select('*').eq('week', prevWeek).order('sort_order'),
    ])
    if (p && p.length > 0) {
      setPerforming((p as PerformingProject[]).map(({ id, ...r }) => ({ ...r, week })))
    }
    if (e && e.length > 0) {
      setExpected((e as ExpectedProject[]).map(({ id, ...r }) => ({ ...r, week })))
    }
    setCopying(false)
    setSaveMsg('지난주 데이터를 불러왔어요. 저장 버튼을 눌러주세요.')
    setTimeout(() => setSaveMsg(''), 4000)
  }

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
        body: JSON.stringify({ type, week, performing, expected, meta }),
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

  return (
    <div className="min-h-screen" style={{ background: '#f8f8f7' }}>
      {/* Header */}
      <header style={{ background: '#fff', borderBottom: '1px solid #e8e8e6' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 14, color: '#555' }}>주간/월간업무보고</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button onClick={() => setWeek(w => shiftWeek(w, -1))} style={{ height: 28, padding: '0 8px', borderRadius: 5, border: '1px solid #e8e8e6', background: '#fff', fontSize: 13, cursor: 'pointer', color: '#555' }}>‹</button>
              <span style={{ fontSize: 13, fontWeight: 500, color: '#111', minWidth: 160, textAlign: 'center' }}>{weekLabel(week)} ({week})</span>
              <button onClick={() => setWeek(w => shiftWeek(w, 1))} style={{ height: 28, padding: '0 8px', borderRadius: 5, border: '1px solid #e8e8e6', background: '#fff', fontSize: 13, cursor: 'pointer', color: '#555' }}>›</button>
              {week !== currentWeek && (
                <button onClick={() => setWeek(currentWeek)} style={{ height: 28, padding: '0 10px', borderRadius: 5, border: '1px solid #e8e8e6', background: '#f4f4f2', fontSize: 12, cursor: 'pointer', color: '#555' }}>이번주</button>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {saveMsg && <span style={{ fontSize: 12, color: '#22c55e' }}>{saveMsg}</span>}
            {performing.every(r => !r.name) && (
              <button
                onClick={copyFromPrevWeek}
                style={{ height: 32, padding: '0 14px', borderRadius: 6, border: '1px solid #f59e0b', background: '#fffbeb', fontSize: 13, color: '#b45309', cursor: 'pointer' }}
              >↩ 지난주 불러오기</button>
            )}
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
          <p style={{ fontSize: 13, color: '#888' }}>{weekLabel(week)} · {week}{week !== currentWeek && <span style={{ marginLeft: 8, color: '#f59e0b', fontWeight: 500 }}>· 과거 데이터</span>}</p>
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
            projectRefs={projectRefs}
            onUpdate={(localIdx, field, val) => {
              const actualIdx = performing.map((r, i) => ({ r, i })).filter(({ r }) => r.status === '개찰')[localIdx]?.i
              if (actualIdx !== undefined) updatePerf(actualIdx, field, val)
            }}
            onFill={(localIdx, ref) => {
              const actualIdx = performing.map((r, i) => ({ r, i })).filter(({ r }) => r.status === '개찰')[localIdx]?.i
              if (actualIdx !== undefined) {
                setPerforming(prev => prev.map((r, i) => i === actualIdx ? {
                  ...r,
                  name: ref.name,
                  director: ref.director || r.director,
                  submit_date: ref.submit_date || r.submit_date,
                  interview_date: ref.interview_date || r.interview_date,
                  result_date: ref.bid_date || r.result_date,
                } : r))
              }
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
            projectRefs={projectRefs}
            onUpdate={(localIdx, field, val) => {
              const actualIdx = performing.map((r, i) => ({ r, i })).filter(({ r }) => r.status === '진행중')[localIdx]?.i
              if (actualIdx !== undefined) updatePerf(actualIdx, field, val)
            }}
            onFill={(localIdx, ref) => {
              const actualIdx = performing.map((r, i) => ({ r, i })).filter(({ r }) => r.status === '진행중')[localIdx]?.i
              if (actualIdx !== undefined) {
                setPerforming(prev => prev.map((r, i) => i === actualIdx ? {
                  ...r,
                  name: ref.name,
                  director: ref.director || r.director,
                  submit_date: ref.submit_date || r.submit_date,
                  interview_date: ref.interview_date || r.interview_date,
                  result_date: ref.bid_date || r.result_date,
                } : r))
              }
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

        {/* 교육참가자 & 기타 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Section title="3) 교육참가자 (OSG팀)">
            <div style={{ padding: '4px 0' }}>
              {([
                { key: 'edu_chief', label: '책임' },
                { key: 'edu_arch',  label: '건축' },
                { key: 'edu_civil', label: '토목' },
                { key: 'edu_safety',label: '안전' },
                { key: 'edu_mech',  label: '기계' },
              ] as { key: keyof WeeklyMeta; label: string }[]).map(({ key, label }) => {
                const names = ((meta[key] as string) ?? '').split(',').map((n: string) => n.trim()).filter(Boolean)
                return (
                  <div key={key} style={{ display: 'flex', alignItems: 'flex-start', borderBottom: '1px solid #f5f5f3', padding: '6px 16px', gap: 12 }}>
                    <span style={{ fontSize: 12, fontWeight: 500, color: '#888', minWidth: 30, paddingTop: 1 }}>{label}</span>
                    <input
                      className="cell-input"
                      value={meta[key] as string}
                      onChange={e => setMeta(m => ({ ...m, [key]: e.target.value }))}
                      placeholder="이름, 이름"
                      style={{ flex: 1 }}
                    />
                    {names.length > 0 && (
                      <span style={{ fontSize: 12, color: '#2563eb', fontWeight: 600, whiteSpace: 'nowrap', paddingTop: 1 }}>– {names.length}명</span>
                    )}
                  </div>
                )
              })}
              {/* 총 인원 */}
              {(() => {
                const eduKeys = ['edu_chief','edu_arch','edu_civil','edu_safety','edu_mech'] as (keyof WeeklyMeta)[]
                const allNames = eduKeys.flatMap(k => ((meta[k] as string) ?? '').split(',').map((n: string) => n.trim()).filter(Boolean))
                const uniqNames = [...new Set(allNames)]
                if (uniqNames.length === 0) return null
                // 마지막으로 값이 있는 필드
                const lastFilledKey = [...eduKeys].reverse().find(k => ((meta[k] as string) ?? '').trim())
                const lastFieldNames = lastFilledKey
                  ? ((meta[lastFilledKey] as string) ?? '').split(',').map((n: string) => n.trim()).filter(Boolean)
                  : []
                const lastPerson = lastFieldNames[lastFieldNames.length - 1] ?? uniqNames[uniqNames.length - 1]
                return (
                  <div style={{ display: 'flex', alignItems: 'center', padding: '6px 16px', borderTop: '1px solid #e8e8e6', background: '#f8f8f7' }}>
                    <span style={{ fontSize: 12, color: '#555', fontWeight: 600 }}>총 {uniqNames.length}명</span>
                  </div>
                )
              })()}
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

      </div>
    </div>
  )
}

const tdStyle: React.CSSProperties = { padding: '6px 10px', verticalAlign: 'middle', color: '#111' }
const removeBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: '#ccc', cursor: 'pointer',
  fontSize: 12, padding: '2px 4px', borderRadius: 4
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e8e8e6', borderRadius: 8, marginBottom: 12, overflow: 'hidden' }}>
      <div style={{ padding: '10px 16px', borderBottom: '1px solid #f0f0ee' }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: '#333' }}>{title}</span>
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
  projectRefs: ProjectRef[]
  onUpdate: (localIdx: number, field: keyof PerformingProject, value: string | number | null) => void
  onFill: (localIdx: number, ref: ProjectRef) => void
  onRemove: (localIdx: number) => void
  onAdd: () => void
}

function PerformingTable({ rows, status, projectRefs, onUpdate, onFill, onRemove, onAdd }: PerformingTableProps) {
  const statusColor = status === '개찰'
    ? { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe' }
    : { bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0' }

  return (
    <div>
      <div style={{ padding: '6px 16px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid #f0f0ee' }}>
        <span style={{
          fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 4,
          background: statusColor.bg, color: statusColor.text, border: `1px solid ${statusColor.border}`
        }}>{status}</span>
        <span style={{ fontSize: 12, color: '#aaa' }}>{rows.filter(r => r.name).length}건</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f9f9f8' }}>
              {['연번', '용역명', '단장', '제출일', '발표/면접', '개찰일', '용역비(억)', '내용', ''].map(h => (
                <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 500, color: '#888', fontSize: 11, borderBottom: '1px solid #f0f0ee', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #f5f5f3' }}>
                <td style={{ ...tdStyle, color: '#999', width: 36 }}>{i + 1}</td>
                <td style={{ ...tdStyle, minWidth: 200, position: 'relative' }}>
                  <ProjectNameInput
                    value={row.name}
                    projectRefs={projectRefs}
                    onChange={val => onUpdate(i, 'name', val)}
                    onSelect={ref => onFill(i, ref)}
                  />
                </td>
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

function WeeklyProjectSummary({ week, projectRefs }: { week: string; projectRefs: ProjectRef[] }) {
  const { start, end } = getWeekRange(week)

  const bidThisWeek = projectRefs.filter(p => {
    if (!p.bid_date) return false
    const parts = p.bid_date.replace(/\./g, '-').split('-').map(Number)
    if (parts.length < 2) return false
    const year = parts.length === 3 ? parts[0] : start.getFullYear()
    const month = parts.length === 3 ? parts[1] - 1 : parts[0] - 1
    const day = parts.length === 3 ? parts[2] : parts[1]
    const d = new Date(year, month, day)
    return d >= start && d <= end
  })

  const inProgress = projectRefs.filter(p => computeProjectStatus(p) === '진행중')

  if (bidThisWeek.length === 0 && inProgress.length === 0) return null

  const cardStyle: React.CSSProperties = {
    background: '#fff', border: '1px solid #e8e8e6', borderRadius: 8, marginBottom: 16, overflow: 'hidden',
  }
  const tagStyle = (color: string, bg: string): React.CSSProperties => ({
    fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 10, background: bg, color,
  })

  return (
    <div style={{ display: 'grid', gridTemplateColumns: bidThisWeek.length > 0 && inProgress.length > 0 ? '1fr 1fr' : '1fr', gap: 12, marginBottom: 16 }}>
      {bidThisWeek.length > 0 && (
        <div style={cardStyle}>
          <div style={{ padding: '10px 16px', borderBottom: '1px solid #f0f0ee', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={tagStyle('#1d4ed8', '#eff6ff')}>개찰 예정</span>
            <span style={{ fontSize: 12, color: '#999' }}>이번 주 개찰일 {bidThisWeek.length}건</span>
          </div>
          <div style={{ padding: '8px 0' }}>
            {bidThisWeek.map((p, i) => (
              <div key={i} style={{ padding: '6px 16px', borderBottom: '1px solid #f8f8f7', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>
                    {p.client && <span style={{ marginRight: 8 }}>{p.client}</span>}
                    {p.director && <span style={{ marginRight: 8 }}>단장 {p.director}</span>}
                    {p.fee != null && <span style={{ color: '#2563eb' }}>{p.fee}억</span>}
                  </div>
                </div>
                <div style={{ fontSize: 11, color: '#1d4ed8', whiteSpace: 'nowrap' }}>개찰 {p.bid_date}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {inProgress.length > 0 && (
        <div style={cardStyle}>
          <div style={{ padding: '10px 16px', borderBottom: '1px solid #f0f0ee', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={tagStyle('#15803d', '#f0fdf4')}>진행중</span>
            <span style={{ fontSize: 12, color: '#999' }}>총 {inProgress.length}건</span>
          </div>
          <div style={{ padding: '8px 0', maxHeight: 200, overflowY: 'auto' }}>
            {inProgress.map((p, i) => (
              <div key={i} style={{ padding: '6px 16px', borderBottom: '1px solid #f8f8f7', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>
                    {p.client && <span style={{ marginRight: 8 }}>{p.client}</span>}
                    {p.director && <span style={{ marginRight: 8 }}>단장 {p.director}</span>}
                    {p.fee != null && <span style={{ color: '#2563eb' }}>{p.fee}억</span>}
                  </div>
                </div>
                {p.bid_date && <div style={{ fontSize: 11, color: '#999', whiteSpace: 'nowrap' }}>개찰 {p.bid_date}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ProjectNameInput({
  value, projectRefs, onChange, onSelect,
}: {
  value: string
  projectRefs: ProjectRef[]
  onChange: (v: string) => void
  onSelect: (ref: ProjectRef) => void
}) {
  const [open, setOpen] = useState(false)

  const filtered = value.trim().length > 0
    ? projectRefs.filter(p => p.name.toLowerCase().includes(value.toLowerCase())).slice(0, 8)
    : []

  return (
    <div style={{ position: 'relative' }}>
      <input
        className="cell-input"
        value={value}
        placeholder="용역명 입력 또는 검색"
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && filtered.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 100,
          background: '#fff', border: '1px solid #e8e8e6', borderRadius: 6,
          boxShadow: '0 4px 12px rgba(0,0,0,0.08)', minWidth: 260, maxHeight: 220, overflowY: 'auto',
        }}>
          {filtered.map((p, i) => (
            <div
              key={i}
              onMouseDown={() => { onSelect(p); setOpen(false) }}
              style={{
                padding: '8px 12px', cursor: 'pointer', fontSize: 12,
                borderBottom: '1px solid #f5f5f3',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = '#f8f8f7')}
              onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
            >
              <div style={{ fontWeight: 500, color: '#111', marginBottom: 2 }}>{p.name}</div>
              <div style={{ color: '#999', fontSize: 11, display: 'flex', gap: 8 }}>
                {p.submit_date && <span>제출 {p.submit_date}</span>}
                {p.interview_date && <span>발표 {p.interview_date}</span>}
                {p.bid_date && <span>개찰 {p.bid_date}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
