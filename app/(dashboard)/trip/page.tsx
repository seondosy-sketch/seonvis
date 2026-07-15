'use client'

import { useEffect, useState, useCallback } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import AddressMapPreview from '@/app/components/AddressMapPreview'
import { openDirectionsFromOffice } from '@/lib/kakaoMap'
import { type ProjectRef, getCurrentWeek, getWeekRange, categorizeProject } from '@/lib/projectStatus'
import { useMenuPermission } from '@/app/components/PermissionsProvider'

interface Project extends ProjectRef {
  id: string
  project_number: string
}

interface TooltipData {
  project_number?: string
  location?: string
  interview_location?: string
}

type TripItem = { project: Project; location: string; interviewLocation: string }

export default function TripSupportPage() {
  const supabase = createSupabaseBrowserClient()
  // 읽기 권한 사용자는 지도/길찾기 조회만 — 주소 입력·저장을 막는다
  const canWrite = useMenuPermission('trip') === 'write'
  const [items, setItems] = useState<TripItem[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: projects }, { data: tooltips }] = await Promise.all([
      supabase.from('projects').select('id, project_number, client, name, director, fee, submit_date, interview_date, bid_date, result_score, evaluation, participants, status_override, staff_arch, staff_civil, staff_mech, staff_safety'),
      supabase.from('project_tooltips').select('project_number, location, interview_location'),
    ])
    const tipMap: Record<string, TooltipData> = {}
    for (const row of tooltips ?? []) tipMap[row.project_number] = row
    const { start: weekStart } = getWeekRange(getCurrentWeek())
    const list: TripItem[] = (projects ?? [])
      .filter((p: Project) => categorizeProject(p, weekStart) === '진행중')
      .map((p: Project) => {
        const tip = tipMap[p.project_number]
        return { project: p, location: tip?.location ?? '', interviewLocation: tip?.interview_location ?? '' }
      })
      .sort((a, b) => (a.project.interview_date ?? '9999').localeCompare(b.project.interview_date ?? '9999'))
    setItems(list)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const updateField = (projectId: string, field: 'location' | 'interviewLocation', value: string) => {
    setItems(prev => prev.map(it => it.project.id === projectId ? { ...it, [field]: value } : it))
  }

  return (
    <div style={{ padding: '32px', maxWidth: 900, margin: '0 auto' }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#1a7fa8', marginBottom: 6 }}>출장지원</h2>
      <p style={{ fontSize: 13, color: '#888', marginBottom: 24 }}>
        주간/월간보고 기준 진행중 프로젝트의 면접장소·현장위치를 입력하면 지도와 사무실 기준 길찾기를 제공합니다.
      </p>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#bbb', fontSize: 13 }}>불러오는 중...</div>
      ) : items.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#bbb', fontSize: 13, background: '#fff', border: '1px solid #e8e8e6', borderRadius: 8 }}>
          진행중인 프로젝트가 없습니다.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {items.map(({ project: p, location, interviewLocation }) => (
            <div key={p.id} style={{ background: '#fff', border: '1px solid #e8e8e6', borderRadius: 10, padding: '16px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, gap: 12 }}>
                <div>
                  <div style={{ fontSize: 11, color: '#999', marginBottom: 2 }}>#{p.project_number} · {p.client}</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#111' }}>{p.name}</div>
                </div>
                {p.interview_date && (
                  <div style={{ fontSize: 11, color: '#2563eb', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 5, padding: '3px 8px', whiteSpace: 'nowrap' }}>
                    발표/면접 {p.interview_date}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <LocationEditor
                  projectNumber={p.project_number}
                  label="면접장소"
                  dbField="interview_location"
                  value={interviewLocation}
                  readOnly={!canWrite}
                  onSaved={v => updateField(p.id, 'interviewLocation', v)}
                />
                <LocationEditor
                  projectNumber={p.project_number}
                  label="현장위치"
                  dbField="location"
                  value={location}
                  readOnly={!canWrite}
                  onSaved={v => updateField(p.id, 'location', v)}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function LocationEditor({
  projectNumber, label, dbField, value, readOnly = false, onSaved,
}: {
  projectNumber: string
  label: string
  dbField: 'location' | 'interview_location'
  value: string
  readOnly?: boolean // 읽기 권한 — 주소 편집·저장 숨김, 지도/길찾기는 그대로
  onSaved: (value: string) => void
}) {
  const supabase = createSupabaseBrowserClient()
  const [draft, setDraft] = useState(value)
  const [committed, setCommitted] = useState(value)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [dirMsg, setDirMsg] = useState<string | null>(null)
  const [dirLoading, setDirLoading] = useState(false)

  useEffect(() => { setDraft(value); setCommitted(value) }, [value])

  const dirty = draft.trim() !== committed.trim()

  const save = async () => {
    setSaving(true)
    setSaveError(null)
    const trimmed = draft.trim()
    const { error } = await supabase
      .from('project_tooltips')
      .upsert({ project_number: projectNumber, [dbField]: trimmed, updated_at: new Date().toISOString() }, { onConflict: 'project_number' })
    setSaving(false)
    if (error) { setSaveError(`저장 실패: ${error.message}`); return }
    setCommitted(trimmed)
    onSaved(trimmed)
  }

  const openDirections = async () => {
    if (!committed.trim()) return
    setDirMsg(null)
    setDirLoading(true)
    const res = await openDirectionsFromOffice(label, committed)
    if (!res.ok) setDirMsg(res.message ?? '길찾기를 열 수 없습니다.')
    setDirLoading(false)
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#333', minWidth: 52, flexShrink: 0 }}>{label}</span>
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          readOnly={readOnly}
          placeholder={readOnly ? `${label} 미입력` : `${label} 주소 입력 (지도 자동검색)`}
          style={{ flex: 1, height: 30, padding: '0 8px', border: '1px solid #e8e8e6', borderRadius: 6, fontSize: 12, boxSizing: 'border-box', background: readOnly ? '#f8f8f7' : '#fff' }}
        />
        {!readOnly && (
          <button onClick={save} disabled={!dirty || saving} style={{ ...outlineBtn, opacity: (!dirty || saving) ? 0.5 : 1, flexShrink: 0 }}>
            {saving ? '저장 중...' : '저장'}
          </button>
        )}
        <button onClick={openDirections} disabled={!committed.trim() || dirLoading} style={{ ...outlineBtn, opacity: (!committed.trim() || dirLoading) ? 0.5 : 1, flexShrink: 0, whiteSpace: 'nowrap' }}>
          {dirLoading ? '조회 중...' : '카카오맵으로 길찾기 열기'}
        </button>
      </div>
      {saveError && <div style={{ fontSize: 11, color: '#b91c1c', padding: '6px 10px', background: '#fef2f2', borderRadius: 6, marginBottom: 6 }}>{saveError}</div>}
      {dirMsg && <div style={{ fontSize: 11, color: '#b91c1c', padding: '6px 10px', background: '#fef2f2', borderRadius: 6, marginBottom: 6 }}>{dirMsg}</div>}
      {committed.trim() && <AddressMapPreview address={committed} />}
    </div>
  )
}

const outlineBtn: React.CSSProperties = { height: 26, padding: '0 10px', borderRadius: 6, border: '1px solid #ddd', background: '#fff', color: '#333', fontSize: 11, cursor: 'pointer' }
