'use client'

import { useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { LEGAL_CATEGORY_BY_SOURCE, MANUAL_STATUS_OPTIONS, REGIONS, Site, SourceCategory } from '@/lib/sites/types'
import { extractRegion, formatPhone } from '@/lib/engineers/format'

const SOURCE_CATEGORIES: { value: SourceCategory; label: string }[] = [
  { value: '건진법', label: '건설기술진흥법 (건진법)' },
  { value: '주택법', label: '주택법' },
  { value: '건축법', label: '건축법' },
  { value: '전통소', label: '분리발주(전기·통신·소방) (전통소)' },
]

/**
 * 현장 추가/수정 모달. 필수: 현장명 · 법 구분만 (요구 9 — 나머지는 엑셀 데이터를
 * 그대로 이관할 수 있도록 전부 선택 입력).
 */
export default function SiteFormModal({
  edit,
  onClose,
  onSaved,
}: {
  edit: Site | null
  onClose: () => void
  onSaved: () => void
}) {
  const supabase = createSupabaseBrowserClient()
  const [form, setForm] = useState({
    site_name: edit?.site_name ?? '',
    source_category: (edit?.source_category ?? '건진법') as SourceCategory,
    manager_name: edit?.manager_name ?? '',
    contractor: edit?.contractor ?? '',
    site_phone_raw: edit?.site_phone_raw ?? '',
    manager_mobile: edit?.manager_mobile ?? '',
    site_address: edit?.site_address ?? '',
    office_address: edit?.office_address ?? '',
    region: edit?.region ?? '',
    start_date: edit?.start_date ?? '',
    planned_completion_date: edit?.planned_completion_date ?? '',
    manual_status: edit?.manual_status ?? '',
    memo: edit?.memo ?? '',
    is_favorite: edit?.is_favorite ?? false,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (field: keyof typeof form, value: unknown) => setForm(f => ({ ...f, [field]: value }))

  async function save() {
    if (saving) return
    setError(null)
    if (!form.site_name.trim()) { setError('현장명을 입력하세요.'); return }
    if (!form.source_category) { setError('법 구분을 선택하세요.'); return }
    if (form.start_date && form.planned_completion_date && form.planned_completion_date < form.start_date) {
      setError('준공예정일이 착수일보다 빠릅니다.'); return
    }

    setSaving(true)
    try {
      const payload = {
        original_site_name: form.site_name.trim(),
        site_name: form.site_name.trim().replace(/\s+/g, ' '),
        source_category: form.source_category,
        legal_category: LEGAL_CATEGORY_BY_SOURCE[form.source_category],
        manager_name: form.manager_name,
        contractor: form.contractor.trim(),
        site_phone_raw: form.site_phone_raw.trim(),
        manager_mobile: form.manager_mobile ? formatPhone(form.manager_mobile.trim()) : '',
        site_landline: edit?.site_landline ?? '',
        phone_uncertain: edit?.phone_uncertain ?? false,
        site_address: form.site_address.trim(),
        office_address: form.office_address.trim(),
        region: form.region,
        start_date: form.start_date || null,
        planned_completion_date: form.planned_completion_date || null,
        manual_status: form.manual_status || null,
        memo: form.memo,
        is_favorite: form.is_favorite,
      }

      if (edit) {
        const { error: err } = await supabase.from('sites')
          .update({ ...payload, updated_at: new Date().toISOString() }).eq('id', edit.id)
        if (err) { setError(`저장 실패: ${err.message}`); return }
      } else {
        const { error: err } = await supabase.from('sites').insert(payload)
        if (err) { setError(`저장 실패: ${err.message}`); return }
      }
      onSaved()
    } finally { setSaving(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 12, width: 560, maxWidth: 'calc(100vw - 40px)', maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #e8e8e6', background: '#111', borderRadius: '12px 12px 0 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>
            {edit ? `현장 수정 — ${edit.site_name} (No.${edit.site_code})` : '신규 현장 추가'}
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'rgba(255,255,255,0.15)', color: '#fff', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 13 }}>✕</button>
        </div>

        <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Row2>
            <Field label="현장명 *"><input style={inp} value={form.site_name} onChange={e => set('site_name', e.target.value)} /></Field>
            <Field label="법 구분 *">
              <select style={inp} value={form.source_category} onChange={e => set('source_category', e.target.value as SourceCategory)}>
                {SOURCE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </Field>
          </Row2>
          <Field label="감리원/담당자 (여러 명은 줄바꿈으로 구분)">
            <textarea style={{ ...inp, height: 60, paddingTop: 8, resize: 'vertical' }} value={form.manager_name} onChange={e => set('manager_name', e.target.value)} />
          </Field>
          <Field label="시공사"><input style={inp} value={form.contractor} onChange={e => set('contractor', e.target.value)} /></Field>
          <Row2>
            <Field label="현장 연락처 (원본, 자유 입력)">
              <input style={inp} value={form.site_phone_raw} onChange={e => set('site_phone_raw', e.target.value)} placeholder="010-1234-5678 등" />
            </Field>
            <Field label="책임자 핸드폰 (숫자만 입력해도 자동 포맷)">
              <input style={inp} value={form.manager_mobile} onChange={e => set('manager_mobile', formatPhone(e.target.value))} placeholder="010-1234-5678" />
            </Field>
          </Row2>
          <Field label="현장주소 (입력하면 지역 자동 추출)">
            <input style={inp} value={form.site_address} onChange={e => { set('site_address', e.target.value); set('region', extractRegion(e.target.value)) }} />
          </Field>
          <Row2>
            <Field label="사무실주소"><input style={inp} value={form.office_address} onChange={e => set('office_address', e.target.value)} /></Field>
            <Field label="지역 (시·도)">
              <select style={inp} value={form.region} onChange={e => set('region', e.target.value)}>
                <option value="">미지정</option>
                {REGIONS.map(r => <option key={r}>{r}</option>)}
              </select>
            </Field>
          </Row2>
          <Row2>
            <Field label="착수일"><input style={inp} type="date" value={form.start_date} onChange={e => set('start_date', e.target.value)} /></Field>
            <Field label="준공예정일"><input style={inp} type="date" value={form.planned_completion_date} onChange={e => set('planned_completion_date', e.target.value)} /></Field>
          </Row2>
          <Field label="진행 상태">
            <select style={inp} value={form.manual_status} onChange={e => set('manual_status', e.target.value)}>
              {MANUAL_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="비고"><input style={inp} value={form.memo} onChange={e => set('memo', e.target.value)} /></Field>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#555', cursor: 'pointer' }}>
            <input type="checkbox" checked={form.is_favorite} onChange={e => set('is_favorite', e.target.checked)} />
            ★ 즐겨찾기
          </label>

          {error && <div style={{ padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, color: '#b91c1c' }}>{error}</div>}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <button onClick={onClose} style={outlineBtn}>취소</button>
            <button onClick={save} disabled={saving} style={{ ...primaryBtn, opacity: saving ? 0.6 : 1 }}>{saving ? '저장 중...' : '저장'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div style={{ flex: 1 }}><div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>{label}</div>{children}</div>
}
function Row2({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>{children}</div>
}

const inp: React.CSSProperties = { width: '100%', height: 34, padding: '0 10px', border: '1px solid #e8e8e6', borderRadius: 6, fontSize: 13, background: '#fff', boxSizing: 'border-box' }
const primaryBtn: React.CSSProperties = { height: 34, padding: '0 16px', borderRadius: 6, border: 'none', background: '#111', color: '#fff', fontSize: 13, cursor: 'pointer' }
const outlineBtn: React.CSSProperties = { height: 34, padding: '0 14px', borderRadius: 6, border: '1px solid #e8e8e6', background: '#fff', color: '#333', fontSize: 13, cursor: 'pointer' }
