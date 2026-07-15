'use client'

import { useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { EngineerContact, EngineerSpecialty, EmploymentStatus, RANK_ORDER, REGIONS } from '@/lib/engineers/types'
import { extractRegion, formatPhone, looksLikeMobile, normalizePhone } from '@/lib/engineers/format'

/**
 * 기술인 추가/수정 모달. 필수: 성명·직위·핸드폰·주소.
 * 전화는 숫자만 입력해도 자동 하이픈, 지역은 주소 입력 시 자동 추출(수정 가능).
 * 중복(전화/이메일)은 경고 후 confirm 저장 허용 — 실데이터에 중복 3건이 이미 있다 (04 문서).
 */
export default function EngineerFormModal({
  contacts,
  specialties,
  selectedSpecialtyIds,
  edit,
  onClose,
  onSaved,
}: {
  contacts: EngineerContact[]
  specialties: EngineerSpecialty[]
  selectedSpecialtyIds: string[]
  edit: EngineerContact | null
  onClose: () => void
  onSaved: () => void
}) {
  const supabase = createSupabaseBrowserClient()
  const [form, setForm] = useState({
    name: edit?.name ?? '',
    rank: edit?.rank ?? '',
    position: edit?.position ?? '',
    company: edit?.company ?? '',
    mobile_phone: edit?.mobile_phone ?? '',
    office_phone: edit?.office_phone ?? '',
    email: edit?.email ?? '',
    region: edit?.region ?? '',
    address: edit?.address ?? '',
    employment_status: (edit?.employment_status ?? '재직') as EmploymentStatus,
    joined_date: edit?.joined_date ?? '',
    retired_date: edit?.retired_date ?? '',
    memo: edit?.memo ?? '',
    is_favorite: edit?.is_favorite ?? false,
  })
  const [specIds, setSpecIds] = useState<Set<string>>(new Set(selectedSpecialtyIds))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (field: keyof typeof form, value: unknown) => setForm(f => ({ ...f, [field]: value }))

  const existingRanks = Array.from(new Set([...RANK_ORDER, ...contacts.map(c => c.rank).filter(Boolean)]))

  async function save() {
    if (saving) return
    setError(null)

    // 차단 검증
    if (!form.name.trim()) { setError('성명을 입력하세요.'); return }
    if (!form.rank.trim()) { setError('직위를 입력하세요.'); return }
    if (!form.mobile_phone.trim()) { setError('핸드폰 번호를 입력하세요.'); return }
    if (!form.address.trim()) { setError('주소를 입력하세요.'); return }
    if (form.email && !/^\S+@\S+\.\S+$/.test(form.email)) { setError('이메일 형식이 올바르지 않습니다.'); return }
    if (form.joined_date && form.retired_date && form.retired_date < form.joined_date) {
      setError('퇴사일이 입사일보다 빠릅니다.'); return
    }
    const digits = normalizePhone(form.mobile_phone)
    if (looksLikeMobile(form.mobile_phone) && digits.length !== 10 && digits.length !== 11) {
      setError('휴대전화 번호 자릿수가 올바르지 않습니다.'); return
    }

    // 경고 검증 (confirm 후 저장 허용)
    const warns: string[] = []
    if (form.employment_status === '재직' && form.retired_date) warns.push('재직 상태인데 퇴사일이 입력되어 있습니다.')
    if (form.employment_status === '퇴직' && !form.retired_date) warns.push('퇴직 상태인데 퇴사일이 없습니다.')
    const others = contacts.filter(c => c.id !== edit?.id)
    const dupPhone = others.filter(c => normalizePhone(c.mobile_phone) === digits && digits !== '')
    if (dupPhone.length > 0) warns.push(`동일한 전화번호를 사용하는 기술인이 이미 등록되어 있습니다: ${dupPhone.map(c => c.name).join(', ')}.`)
    const dupEmail = form.email ? others.filter(c => c.email && c.email.toLowerCase() === form.email.toLowerCase()) : []
    if (dupEmail.length > 0) warns.push(`동일한 이메일을 사용하는 기술인이 이미 등록되어 있습니다: ${dupEmail.map(c => c.name).join(', ')}.`)
    for (const w of warns) {
      if (!confirm(`${w}\n그래도 저장하시겠습니까?`)) return
    }

    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        rank: form.rank.trim(),
        position: form.position.trim(),
        company: form.company.trim(),
        mobile_phone: formatPhone(form.mobile_phone.trim()),
        office_phone: form.office_phone ? formatPhone(form.office_phone.trim()) : '',
        email: form.email.trim(),
        region: form.region,
        address: form.address.trim(),
        employment_status: form.employment_status,
        joined_date: form.joined_date || null,
        retired_date: form.retired_date || null,
        memo: form.memo,
        is_favorite: form.is_favorite,
      }

      let contactId = edit?.id
      if (edit) {
        const { error: err } = await supabase.from('engineer_contacts')
          .update({ ...payload, updated_at: new Date().toISOString() }).eq('id', edit.id)
        if (err) { setError(`저장 실패: ${err.message}`); return }
      } else {
        const { data, error: err } = await supabase.from('engineer_contacts')
          .insert(payload).select('id').single()
        if (err || !data) { setError(`저장 실패: ${err?.message ?? ''}`); return }
        contactId = data.id
      }

      // 전문분야 재지정 — 지웠다 다시 넣는다 (junction 소규모라 diff 불필요)
      await supabase.from('engineer_contact_specialties').delete().eq('contact_id', contactId)
      if (specIds.size > 0) {
        const { error: linkErr } = await supabase.from('engineer_contact_specialties')
          .insert([...specIds].map(sid => ({ contact_id: contactId, specialty_id: sid })))
        if (linkErr) { setError(`전문분야 저장 실패: ${linkErr.message}`); return }
      }

      onSaved()
    } finally { setSaving(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 12, width: 560, maxWidth: 'calc(100vw - 40px)', maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #e8e8e6', background: '#111', borderRadius: '12px 12px 0 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>
            {edit ? `기술인 수정 — ${edit.name} (No.${edit.engineer_no})` : '기술인 추가'}
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'rgba(255,255,255,0.15)', color: '#fff', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 13 }}>✕</button>
        </div>

        <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Row2>
            <Field label="성명 *"><input style={inp} value={form.name} onChange={e => set('name', e.target.value)} /></Field>
            <Field label="직위 *">
              <input style={inp} value={form.rank} onChange={e => set('rank', e.target.value)} list="rank-options" placeholder="상무, 부장 등" />
              <datalist id="rank-options">{existingRanks.map(r => <option key={r} value={r} />)}</datalist>
            </Field>
          </Row2>
          <Row2>
            <Field label="소속 (회사/부서)"><input style={inp} value={form.company} onChange={e => set('company', e.target.value)} /></Field>
            <Field label="직책"><input style={inp} value={form.position} onChange={e => set('position', e.target.value)} placeholder="팀장, 본부장 등" /></Field>
          </Row2>
          <Field label="전문분야 (복수 선택)">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {specialties.filter(s => s.is_active || specIds.has(s.id)).map(s => {
                const on = specIds.has(s.id)
                return (
                  <button key={s.id} onClick={() => setSpecIds(prev => {
                    const next = new Set(prev)
                    if (on) next.delete(s.id); else next.add(s.id)
                    return next
                  })} style={on ? specChipOn : specChip}>{s.name}</button>
                )
              })}
            </div>
          </Field>
          <Row2>
            <Field label="핸드폰 * (숫자만 입력해도 자동 포맷)">
              <input style={inp} value={form.mobile_phone} onChange={e => set('mobile_phone', formatPhone(e.target.value))} placeholder="010-1234-5678" />
            </Field>
            <Field label="사무실 전화">
              <input style={inp} value={form.office_phone} onChange={e => set('office_phone', formatPhone(e.target.value))} placeholder="02-123-4567" />
            </Field>
          </Row2>
          <Field label="이메일"><input style={inp} value={form.email} onChange={e => set('email', e.target.value)} placeholder="name@company.com" /></Field>
          <Field label="주소 * (입력하면 지역 자동 추출)">
            <input style={inp} value={form.address} onChange={e => { set('address', e.target.value); set('region', extractRegion(e.target.value)) }} placeholder="시/도부터 입력" />
          </Field>
          <Row2>
            <Field label="지역 (시·도)">
              <select style={inp} value={form.region} onChange={e => set('region', e.target.value)}>
                <option value="">미지정</option>
                {REGIONS.map(r => <option key={r}>{r}</option>)}
              </select>
            </Field>
            <Field label="재직 상태">
              <select style={inp} value={form.employment_status} onChange={e => set('employment_status', e.target.value)}>
                {['재직', '퇴직', '비활성'].map(s => <option key={s}>{s}</option>)}
              </select>
            </Field>
          </Row2>
          <Row2>
            <Field label="입사일"><input style={inp} type="date" value={form.joined_date} onChange={e => set('joined_date', e.target.value)} /></Field>
            <Field label="퇴사일"><input style={inp} type="date" value={form.retired_date} onChange={e => set('retired_date', e.target.value)} /></Field>
          </Row2>
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
const specChip: React.CSSProperties = { height: 26, padding: '0 10px', borderRadius: 13, border: '1px solid #e8e8e6', background: '#fff', color: '#555', fontSize: 11, cursor: 'pointer' }
const specChipOn: React.CSSProperties = { ...specChip, background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', fontWeight: 600 }
