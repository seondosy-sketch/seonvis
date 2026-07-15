'use client'

import { useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { EngineerContact } from '@/lib/engineers/types'

/**
 * 기술인 상세 모달 — 행 클릭으로 열린다 (우측 상시 패널 대신 모달, 06 문서 ⑧).
 * 복사·수정 진입·비활성화·완전 삭제. 완전 삭제는 여기서만 가능하고(요구 13),
 * 비활성화가 기본 — 상태 변경일 뿐이라 어떤 참조 데이터에도 영향이 없다.
 */
export default function EngineerDetailModal({
  contact,
  specialtyNames,
  canWrite,
  onClose,
  onEdit,
  onCopy,
  onChanged,
  onDeleted,
}: {
  contact: EngineerContact
  specialtyNames: string[]
  canWrite: boolean
  onClose: () => void
  onEdit: () => void
  onCopy: (text: string, label: string) => void
  onChanged: () => void
  onDeleted: () => void
}) {
  const supabase = createSupabaseBrowserClient()
  const [busy, setBusy] = useState(false)

  async function setStatus(status: EngineerContact['employment_status']) {
    setBusy(true)
    await supabase.from('engineer_contacts')
      .update({ employment_status: status, updated_at: new Date().toISOString() })
      .eq('id', contact.id)
    setBusy(false)
    onChanged()
  }

  async function hardDelete() {
    if (!confirm(`${contact.name}을(를) 주소록에서 완전히 삭제하시겠습니까?\n삭제 대신 "비활성"을 권장합니다 — 비활성은 목록에서 숨겨지지만 정보는 보존됩니다.`)) return
    setBusy(true)
    const { error } = await supabase.from('engineer_contacts').delete().eq('id', contact.id)
    setBusy(false)
    if (error) { alert(`삭제 실패: ${error.message}`); return }
    onDeleted()
  }

  const rows: { label: string; value: string; copy?: string }[] = [
    { label: '핸드폰', value: contact.mobile_phone, copy: '전화번호' },
    { label: '사무실', value: contact.office_phone, copy: '전화번호' },
    { label: '이메일', value: contact.email, copy: '이메일' },
    { label: '주소', value: contact.address, copy: '주소' },
    { label: '소속', value: contact.company },
    { label: '직책', value: contact.position },
    { label: '지역', value: contact.region },
    { label: '입사일', value: contact.joined_date ?? '' },
    { label: '퇴사일', value: contact.retired_date ?? '' },
    { label: '비고', value: contact.memo },
  ]

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 12, width: 520, maxWidth: 'calc(100vw - 40px)', maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #e8e8e6', background: '#111', borderRadius: '12px 12px 0 0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 3 }}>
              No.{contact.engineer_no}
              {contact.is_favorite && <span style={{ color: '#f59e0b', marginLeft: 6 }}>★ 즐겨찾기</span>}
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#fff' }}>{contact.name}</div>
            <div style={{ fontSize: 12, color: '#bbb', marginTop: 2 }}>
              {contact.rank}
              {specialtyNames.length > 0 && ` · ${specialtyNames.join('/')}`}
              {' · '}
              <span style={{ color: contact.employment_status === '재직' ? '#4ade80' : '#999' }}>{contact.employment_status}</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            {canWrite && <button onClick={onEdit} style={{ border: 'none', background: '#2563eb', color: '#fff', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12 }}>수정</button>}
            <button onClick={onClose} style={{ border: 'none', background: 'rgba(255,255,255,0.15)', color: '#fff', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 13 }}>✕</button>
          </div>
        </div>

        <div style={{ padding: '14px 20px' }}>
          {rows.filter(r => r.value).map(r => (
            <div key={r.label} style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '7px 0', borderBottom: '1px solid #f5f5f3' }}>
              <span style={{ fontSize: 11, color: '#888', minWidth: 52, flexShrink: 0 }}>{r.label}</span>
              <span style={{ fontSize: 13, color: '#111', flex: 1, wordBreak: 'break-all' }}>{r.value}</span>
              {r.copy && (
                <button onClick={() => onCopy(r.value, r.copy!)} style={copyBtn}>복사</button>
              )}
            </div>
          ))}
          <div style={{ marginTop: 10, fontSize: 11, color: '#bbb' }}>
            등록 {contact.created_at?.slice(0, 10)} · 최종 수정 {contact.updated_at?.slice(0, 10)}
          </div>

          {canWrite && (
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 14, paddingTop: 12, borderTop: '1px solid #f0f0ee' }}>
              {contact.employment_status !== '재직' && (
                <button onClick={() => setStatus('재직')} disabled={busy} style={statusActionBtn}>재직으로 변경</button>
              )}
              {contact.employment_status !== '퇴직' && (
                <button onClick={() => setStatus('퇴직')} disabled={busy} style={statusActionBtn}>퇴직 처리</button>
              )}
              {contact.employment_status !== '비활성' && (
                <button onClick={() => setStatus('비활성')} disabled={busy} style={statusActionBtn}>비활성화</button>
              )}
              <button onClick={hardDelete} disabled={busy} style={deleteBtn}>완전 삭제</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const copyBtn: React.CSSProperties = { flexShrink: 0, border: '1px solid #e8e8e6', background: '#fff', borderRadius: 4, cursor: 'pointer', fontSize: 10, color: '#888', padding: '2px 7px' }
const statusActionBtn: React.CSSProperties = { height: 28, padding: '0 10px', borderRadius: 4, border: '1px solid #e8e8e6', background: '#fff', color: '#555', fontSize: 11, cursor: 'pointer' }
const deleteBtn: React.CSSProperties = { height: 28, padding: '0 10px', borderRadius: 4, border: 'none', background: '#fee2e2', color: '#b91c1c', fontSize: 11, cursor: 'pointer' }
