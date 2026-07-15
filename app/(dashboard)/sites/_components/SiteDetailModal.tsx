'use client'

import { useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { Site, SiteStatus } from '@/lib/sites/types'

/**
 * 현장 상세 모달 — 행 클릭으로 열린다. 복사·수정 진입·비활성화/재개.
 * 완전 삭제 UI는 MVP에서 제공하지 않는다(사용자 결정) — 비활성이 소프트 삭제 역할.
 */
export default function SiteDetailModal({
  site,
  status,
  canWrite,
  onClose,
  onEdit,
  onCopy,
  onChanged,
}: {
  site: Site
  status: SiteStatus
  canWrite: boolean
  onClose: () => void
  onEdit: () => void
  onCopy: (text: string, label: string) => void
  onChanged: () => void
}) {
  const supabase = createSupabaseBrowserClient()
  const [busy, setBusy] = useState(false)

  async function toggleActive() {
    setBusy(true)
    await supabase.from('sites').update({ active: !site.active, updated_at: new Date().toISOString() }).eq('id', site.id)
    setBusy(false)
    onChanged()
  }

  const rows: { label: string; value: string; copy?: string }[] = [
    { label: '책임자 HP', value: site.manager_mobile, copy: '전화번호' },
    { label: '원본 연락처', value: site.site_phone_raw, copy: '전화번호' },
    { label: '유선전화', value: site.site_landline, copy: '전화번호' },
    { label: '시공사', value: site.contractor },
    { label: '현장주소', value: site.site_address, copy: '주소' },
    { label: '사무실주소', value: site.office_address, copy: '주소' },
    { label: '지역', value: site.region },
    { label: '착수일', value: site.start_date ?? '' },
    { label: '준공예정일', value: site.planned_completion_date ?? '' },
    { label: '비고', value: site.memo },
  ]

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 12, width: 540, maxWidth: 'calc(100vw - 40px)', maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #e8e8e6', background: '#111', borderRadius: '12px 12px 0 0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 3 }}>
              No.{site.site_code}
              {site.is_favorite && <span style={{ color: '#f59e0b', marginLeft: 6 }}>★ 즐겨찾기</span>}
              {!site.active && <span style={{ color: '#f87171', marginLeft: 6 }}>비활성</span>}
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', lineHeight: 1.4 }}>{site.site_name}</div>
            <div style={{ fontSize: 12, color: '#bbb', marginTop: 2 }}>
              {site.legal_category} · {status}
              {site.manual_status && <span style={{ color: '#999' }}> (수동)</span>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            {canWrite && <button onClick={onEdit} style={{ border: 'none', background: '#2563eb', color: '#fff', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12 }}>수정</button>}
            <button onClick={onClose} style={{ border: 'none', background: 'rgba(255,255,255,0.15)', color: '#fff', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 13 }}>✕</button>
          </div>
        </div>

        <div style={{ padding: '14px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '7px 0', borderBottom: '1px solid #f5f5f3' }}>
            <span style={{ fontSize: 11, color: '#888', minWidth: 68, flexShrink: 0 }}>감리원/담당자</span>
            <span style={{ fontSize: 13, color: '#111', flex: 1, whiteSpace: 'pre-wrap' }}>{site.manager_name}</span>
          </div>
          {rows.filter(r => r.value).map(r => (
            <div key={r.label} style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '7px 0', borderBottom: '1px solid #f5f5f3' }}>
              <span style={{ fontSize: 11, color: '#888', minWidth: 68, flexShrink: 0 }}>{r.label}</span>
              <span style={{ fontSize: 13, color: '#111', flex: 1, wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>{r.value}</span>
              {r.copy && <button onClick={() => onCopy(r.value, r.copy!)} style={copyBtn}>복사</button>}
            </div>
          ))}
          {site.phone_uncertain && (
            <div style={{ marginTop: 8, padding: '8px 10px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, fontSize: 11, color: '#92400e' }}>
              원본 연락처에 번호가 여럿 있어 책임자 HP는 자동 추출한 추정값입니다 — 원본 연락처로 확인하세요.
            </div>
          )}
          <div style={{ marginTop: 10, fontSize: 11, color: '#bbb' }}>
            등록 {site.created_at?.slice(0, 10)} · 최종 수정 {site.updated_at?.slice(0, 10)}
          </div>

          {canWrite && (
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 14, paddingTop: 12, borderTop: '1px solid #f0f0ee' }}>
              <button onClick={toggleActive} disabled={busy} style={site.active ? deactivateBtn : reactivateBtn}>
                {site.active ? '비활성화' : '재개(활성화)'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const copyBtn: React.CSSProperties = { flexShrink: 0, border: '1px solid #e8e8e6', background: '#fff', borderRadius: 4, cursor: 'pointer', fontSize: 10, color: '#888', padding: '2px 7px' }
const deactivateBtn: React.CSSProperties = { height: 28, padding: '0 10px', borderRadius: 4, border: 'none', background: '#fee2e2', color: '#b91c1c', fontSize: 11, cursor: 'pointer' }
const reactivateBtn: React.CSSProperties = { height: 28, padding: '0 10px', borderRadius: 4, border: '1px solid #bbf7d0', background: '#f0fdf4', color: '#15803d', fontSize: 11, cursor: 'pointer' }
