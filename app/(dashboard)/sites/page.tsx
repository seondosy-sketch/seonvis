'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { useIsMobile } from '@/lib/useIsMobile'
import { useMenuPermission } from '@/app/components/PermissionsProvider'
import { LEGAL_CATEGORIES, LegalCategory, Site } from '@/lib/sites/types'
import { computeSiteStatus } from '@/lib/sites/status'
import { normalizePhone } from '@/lib/engineers/format'
import SiteTable from './_components/SiteTable'
import SiteDetailModal from './_components/SiteDetailModal'
import SiteFormModal from './_components/SiteFormModal'

type SortKey = 'name' | 'start' | 'end' | 'region'
type CompletionFilter = '전체' | '3개월' | '6개월' | '1년'

export default function SitesPage() {
  const isMobile = useIsMobile()
  const supabase = createSupabaseBrowserClient()
  // 읽기 권한 사용자는 검색·복사·상세 보기만 — 추가/수정/비활성/즐겨찾기 편집을 막는다
  const canWrite = useMenuPermission('sites') === 'write'

  const [sites, setSites] = useState<Site[]>([])
  const [loading, setLoading] = useState(true)

  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [legalFilter, setLegalFilter] = useState<'전체' | LegalCategory>('전체')
  const [statusFilter, setStatusFilter] = useState('전체')
  const [regionFilter, setRegionFilter] = useState('전체')
  const [contractorFilter, setContractorFilter] = useState('전체')
  const [completionFilter, setCompletionFilter] = useState<CompletionFilter>('전체')
  const [includeInactive, setIncludeInactive] = useState(false)
  const [sort, setSort] = useState<SortKey>('name')

  const [detailId, setDetailId] = useState<string | null>(null)
  const [formModal, setFormModal] = useState<{ open: boolean; edit: Site | null }>({ open: false, edit: null })
  const [toast, setToast] = useState<string | null>(null)

  const load = useCallback(async () => {
    // 89건 규모 — 전체를 한 번에 불러와 클라이언트에서 검색/필터한다 (engineers와 동일 패턴)
    const { data } = await supabase.from('sites').select('*').order('site_name', { ascending: true }).limit(2000)
    if (data) setSites(data as Site[])
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 250)
    return () => clearTimeout(t)
  }, [searchInput])

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 1500)
  }, [])

  const copyText = useCallback(async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      showToast(`${label}를 복사했습니다.`)
    } catch {
      showToast('복사에 실패했습니다.')
    }
  }, [showToast])

  const today = useMemo(() => new Date(), [])
  const statusOf = useCallback((s: Site) =>
    computeSiteStatus(s.start_date, s.planned_completion_date, s.manual_status, today),
  [today])

  const regions = useMemo(() =>
    ['전체', ...Array.from(new Set(sites.map(s => s.region).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ko'))],
  [sites])
  const contractors = useMemo(() =>
    ['전체', ...Array.from(new Set(sites.map(s => s.contractor).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ko'))],
  [sites])
  const statuses = ['전체', '착수 전', '진행 중', '준공 임박', '준공 완료', '중지', '일정 미등록']

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const qDigits = normalizePhone(q)
    const searchByPhone = qDigits.length >= 3 && /^[\d\-\s]+$/.test(search.trim())
    const list = sites.filter(s => {
      if (!includeInactive && !s.active) return false
      if (legalFilter !== '전체' && s.legal_category !== legalFilter) return false
      if (regionFilter !== '전체' && s.region !== regionFilter) return false
      if (contractorFilter !== '전체' && s.contractor !== contractorFilter) return false
      const st = statusOf(s)
      if (statusFilter !== '전체' && st !== statusFilter) return false
      if (completionFilter !== '전체' && s.planned_completion_date) {
        const days = Math.round((new Date(s.planned_completion_date).getTime() - today.getTime()) / 86400000)
        const limit = completionFilter === '3개월' ? 90 : completionFilter === '6개월' ? 180 : 365
        if (days < 0 || days > limit) return false
      } else if (completionFilter !== '전체') {
        return false
      }
      if (!q) return true
      if (searchByPhone) {
        return normalizePhone(s.site_phone_raw).includes(qDigits) || normalizePhone(s.manager_mobile).includes(qDigits)
      }
      const haystack = [
        s.site_name, s.manager_name, s.contractor, s.site_address, s.office_address,
        s.region, s.memo, s.site_phone_raw,
      ].join(' ').toLowerCase()
      return haystack.includes(q)
    })
    // 진행 중(+준공 임박) 우선 → 즐겨찾기 우선 → 선택 정렬 (요구 4·8)
    const priority = (st: string) => (st === '진행 중' || st === '준공 임박' ? 0 : st === '착수 전' ? 1 : 2)
    return list.sort((a, b) => {
      const p = priority(statusOf(a)) - priority(statusOf(b))
      if (p !== 0) return p
      if (a.is_favorite !== b.is_favorite) return a.is_favorite ? -1 : 1
      switch (sort) {
        case 'start': return (a.start_date ?? '9999').localeCompare(b.start_date ?? '9999')
        case 'end': return (a.planned_completion_date ?? '9999').localeCompare(b.planned_completion_date ?? '9999')
        case 'region': return a.region.localeCompare(b.region, 'ko') || a.site_name.localeCompare(b.site_name, 'ko')
        default: return a.site_name.localeCompare(b.site_name, 'ko')
      }
    })
  }, [sites, search, legalFilter, statusFilter, regionFilter, contractorFilter, completionFilter, includeInactive, sort, statusOf, today])

  const counts = useMemo(() => {
    const active = sites.filter(s => s.active)
    return {
      total: active.length,
      beforeStart: active.filter(s => statusOf(s) === '착수 전').length,
      inProgress: active.filter(s => statusOf(s) === '진행 중').length,
      dueSoon: active.filter(s => statusOf(s) === '준공 임박').length,
      completed: active.filter(s => statusOf(s) === '준공 완료').length,
      // 카드에 없는 나머지 상태(중지·일정 미등록)까지 포함해 total과 항상 맞아떨어지게 한다
      other: active.filter(s => { const st = statusOf(s); return st === '중지' || st === '일정 미등록' }).length,
    }
  }, [sites, statusOf])

  const resetFilters = () => {
    setSearchInput(''); setSearch(''); setLegalFilter('전체'); setStatusFilter('전체')
    setRegionFilter('전체'); setContractorFilter('전체'); setCompletionFilter('전체')
    setIncludeInactive(false); setSort('name')
  }

  async function toggleFavorite(s: Site) {
    if (!canWrite) return
    await supabase.from('sites').update({ is_favorite: !s.is_favorite }).eq('id', s.id)
    load()
  }

  const detail = sites.find(s => s.id === detailId) ?? null

  return (
    <div style={{ minHeight: '100vh', background: '#f8f8f7' }}>
      <header style={{ background: '#fff', borderBottom: '1px solid #e8e8e6' }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', padding: isMobile ? '0 12px' : '0 24px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 14, color: '#555' }}>현장 현황</span>
          {canWrite && <button onClick={() => setFormModal({ open: true, edit: null })} style={primaryBtn}>+ 신규 현장 추가</button>}
        </div>
      </header>

      <div style={{ maxWidth: 1400, margin: '0 auto', padding: isMobile ? '12px 12px 60px' : '20px 24px 60px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 16 }}>
          {[
            { label: '전체 현장', n: counts.total, color: '#111' },
            { label: '착수 전', n: counts.beforeStart, color: '#1d4ed8' },
            { label: '진행 중', n: counts.inProgress, color: '#15803d' },
            { label: '준공 임박', n: counts.dueSoon, color: '#b45309' },
            { label: '준공 완료', n: counts.completed, color: '#888' },
            // 중지·일정 미등록은 드물어 값이 있을 때만 카드로 노출 — 그래도 total과는 항상 일치한다
            ...(counts.other > 0 ? [{ label: '중지·일정 미등록', n: counts.other, color: '#b91c1c' }] : []),
          ].map(({ label, n, color }) => (
            <div key={label} style={{ background: '#fff', border: '1px solid #e8e8e6', borderRadius: 8, padding: '12px 16px' }}>
              <div style={{ fontSize: 12, color: '#999', marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 20, fontWeight: 600, color }}>{n}건</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="현장명, 감리원, 시공사, 전화번호, 주소 검색..."
            style={{ flex: 1, minWidth: 220, height: 34, padding: '0 12px', border: '1px solid #e8e8e6', borderRadius: 6, fontSize: 13, background: '#fff' }}
          />
          <select value={legalFilter} onChange={e => setLegalFilter(e.target.value as typeof legalFilter)} style={sel} title="법 구분">
            <option value="전체">법 구분 전체</option>
            {LEGAL_CATEGORIES.map(c => <option key={c}>{c}</option>)}
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={sel} title="진행 상태">
            {statuses.map(s => <option key={s}>{s === '전체' ? '상태 전체' : s}</option>)}
          </select>
          <select value={regionFilter} onChange={e => setRegionFilter(e.target.value)} style={sel} title="지역">
            {regions.map(r => <option key={r}>{r === '전체' ? '지역 전체' : r}</option>)}
          </select>
          <select value={contractorFilter} onChange={e => setContractorFilter(e.target.value)} style={sel} title="시공사">
            {contractors.map(c => <option key={c}>{c === '전체' ? '시공사 전체' : c}</option>)}
          </select>
          <select value={completionFilter} onChange={e => setCompletionFilter(e.target.value as CompletionFilter)} style={sel} title="준공 예정 시기">
            <option value="전체">준공 시기 전체</option>
            <option value="3개월">3개월 내</option>
            <option value="6개월">6개월 내</option>
            <option value="1년">1년 내</option>
          </select>
          <select value={sort} onChange={e => setSort(e.target.value as SortKey)} style={sel} title="정렬">
            <option value="name">현장명 가나다순</option>
            <option value="start">착수일순</option>
            <option value="end">준공예정일순</option>
            <option value="region">지역순</option>
          </select>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#555', cursor: 'pointer' }}>
            <input type="checkbox" checked={includeInactive} onChange={e => setIncludeInactive(e.target.checked)} />
            비활성 포함
          </label>
          <button onClick={resetFilters} style={{ ...sel, cursor: 'pointer' }}>초기화</button>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#bbb', fontSize: 13 }}>불러오는 중...</div>
        ) : (
          <SiteTable
            sites={filtered}
            statusOf={statusOf}
            canWrite={canWrite}
            onRowClick={s => setDetailId(s.id)}
            onEdit={s => setFormModal({ open: true, edit: s })}
            onCopy={copyText}
            onToggleFavorite={toggleFavorite}
          />
        )}
        <div style={{ marginTop: 8, fontSize: 11, color: '#999' }}>{filtered.length}건 표시 중 (전체 {counts.total}건)</div>
      </div>

      {detail && (
        <SiteDetailModal
          site={detail}
          status={statusOf(detail)}
          canWrite={canWrite}
          onClose={() => setDetailId(null)}
          onEdit={() => setFormModal({ open: true, edit: detail })}
          onCopy={copyText}
          onChanged={load}
        />
      )}

      {formModal.open && (
        <SiteFormModal
          edit={formModal.edit}
          onClose={() => setFormModal({ open: false, edit: null })}
          onSaved={() => { setFormModal({ open: false, edit: null }); load() }}
        />
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 30, left: '50%', transform: 'translateX(-50%)', background: '#111', color: '#fff', fontSize: 13, padding: '9px 18px', borderRadius: 8, zIndex: 500, boxShadow: '0 8px 24px rgba(0,0,0,0.2)' }}>
          {toast}
        </div>
      )}
    </div>
  )
}

const sel: React.CSSProperties = { height: 34, padding: '0 10px', border: '1px solid #e8e8e6', borderRadius: 6, fontSize: 12, background: '#fff', color: '#555' }
const primaryBtn: React.CSSProperties = { height: 34, padding: '0 14px', borderRadius: 6, border: 'none', background: '#111', color: '#fff', fontSize: 13, cursor: 'pointer' }
