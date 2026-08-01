'use client'

import { useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { LodgingHotel } from '@/lib/lodging/types'
import { lodgingHotelErrorMessage } from '@/lib/lodging/errors'

interface HotelMasterModalProps {
  hotels: LodgingHotel[]
  onClose: () => void
  onChange: () => void
}

export default function HotelMasterModal({ hotels, onClose, onChange }: HotelMasterModalProps) {
  const supabase = createSupabaseBrowserClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [address, setAddress] = useState('')
  const [phone, setPhone] = useState('')

  function resetForm() {
    setEditingId(null)
    setName('')
    setPrice('')
    setAddress('')
    setPhone('')
  }

  function startEdit(hotel: LodgingHotel) {
    setEditingId(hotel.id)
    setName(hotel.name)
    setPrice(String(hotel.default_price_per_night))
    setAddress(hotel.address)
    setPhone(hotel.phone)
  }

  async function save() {
    if (busy || !name.trim()) { if (!name.trim()) setError('숙소 이름을 입력하세요.'); return }
    setBusy(true)
    setError(null)
    const payload = {
      name: name.trim(),
      default_price_per_night: Number(price) || 0,
      address: address.trim(),
      phone: phone.trim(),
    }
    const result = editingId
      ? await supabase.from('lodging_hotels').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', editingId)
      : await supabase.from('lodging_hotels').insert(payload)
    setBusy(false)
    if (result.error) {
      setError(lodgingHotelErrorMessage(editingId ? 'update' : 'insert', result.error.code))
      return
    }
    resetForm()
    onChange()
  }

  async function remove(hotel: LodgingHotel) {
    if (busy || !confirm(`"${hotel.name}"을(를) 삭제하시겠습니까?`)) return
    setBusy(true)
    const { error: delError } = await supabase.from('lodging_hotels').delete().eq('id', hotel.id)
    setBusy(false)
    if (delError) { setError(lodgingHotelErrorMessage('delete', delError.code)); return }
    onChange()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }} onClick={busy ? undefined : onClose}>
      <div style={{ background: '#fff', borderRadius: 10, width: 520, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>숙소 마스터 관리</span>
          <button onClick={onClose} disabled={busy} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 14, color: '#888' }}>✕</button>
        </div>

        <div style={{ padding: 16, overflowY: 'auto' }}>
          {error && <div style={{ marginBottom: 10, padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, color: '#b91c1c' }}>{error}</div>}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="숙소 이름" style={inp} />
            <input value={price} onChange={e => setPrice(e.target.value)} placeholder="기본 단가" type="number" style={inp} />
            <input value={address} onChange={e => setAddress(e.target.value)} placeholder="주소" style={inp} />
            <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="연락처" style={inp} />
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
            <button onClick={save} disabled={busy} style={primaryBtn}>{editingId ? '수정 저장' : '숙소 추가'}</button>
            {editingId && <button onClick={resetForm} disabled={busy} style={miniBtn}>취소</button>}
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #eee', color: '#666' }}>
                <th style={{ textAlign: 'left', padding: '4px 6px' }}>이름</th>
                <th style={{ textAlign: 'right', padding: '4px 6px' }}>기본단가</th>
                <th style={{ padding: '4px 6px' }} />
              </tr>
            </thead>
            <tbody>
              {hotels.map(h => (
                <tr key={h.id} style={{ borderBottom: '1px solid #f7f7f6' }}>
                  <td style={{ padding: '4px 6px' }}>{h.name}</td>
                  <td style={{ padding: '4px 6px', textAlign: 'right' }}>{h.default_price_per_night.toLocaleString('ko-KR')}</td>
                  <td style={{ padding: '4px 6px', whiteSpace: 'nowrap' }}>
                    <button onClick={() => startEdit(h)} disabled={busy} style={miniBtn}>수정</button>
                    <button onClick={() => remove(h)} disabled={busy} style={{ ...miniBtn, color: '#b91c1c' }}>삭제</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

const inp: React.CSSProperties = { height: 34, padding: '0 10px', border: '1px solid #e8e8e6', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }
const primaryBtn: React.CSSProperties = { border: 'none', background: '#111', color: '#fff', borderRadius: 6, padding: '8px 14px', fontSize: 12, cursor: 'pointer' }
const miniBtn: React.CSSProperties = { border: '1px solid #e8e8e6', background: '#fff', borderRadius: 4, padding: '3px 8px', fontSize: 11, cursor: 'pointer', marginRight: 4 }
