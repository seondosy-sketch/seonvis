'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { useIsMobile } from '@/lib/useIsMobile'
import { useMenuPermission } from '@/app/components/PermissionsProvider'
import { ContactSpecialty, EngineerContact, EngineerSpecialty, rankSortKey } from '@/lib/engineers/types'
import { normalizePhone } from '@/lib/engineers/format'
import EngineerTable from './_components/EngineerTable'
import EngineerDetailModal from './_components/EngineerDetailModal'
import EngineerFormModal from './_components/EngineerFormModal'
import SpecialtyManagerModal from './_components/SpecialtyManagerModal'

type SortKey = 'name' | 'rank' | 'company' | 'joined' | 'updated'

export default function EngineersPage() {
  const isMobile = useIsMobile()
  const supabase = createSupabaseBrowserClient()
  // 읽기 권한 사용자는 검색·복사·상세 보기만 — 추가/수정/비활성/삭제/즐겨찾기 편집을 막는다
  const canWrite = useMenuPermission('engineers') === 'write'

  const [contacts, setContacts] = useState<EngineerContact[]>([])
  const [specialties, setSpecialties] = useState<EngineerSpecialty[]>([])
  const [links, setLinks] = useState<ContactSpecialty[]>([])
  const [loading, setLoading] = useState(true)

  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('') // debounce 250ms 적용된 실제 검색어
  const [statusFilter, setStatusFilter] = useState<'전체' | '재직' | '퇴직' | '비활성'>('재직')
  const [rankFilter, setRankFilter] = useState('전체')
  const [specialtyFilter, setSpecialtyFilter] = useState('전체')
  const [regionFilter, setRegionFilter] = useState('전체')
  const [favoriteOnly, setFavoriteOnly] = useState(false)
  const [sort, setSort] = useState<SortKey>('name')

  const [detailId, setDetailId] = useState<string | null>(null)
  const [formModal, setFormModal] = useState<{ open: boolean; edit: EngineerContact | null }>({ open: false, edit: null })
  const [showSpecialtyManager, setShowSpecialtyManager] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const load = useCallback(async () => {
    // 667건 규모라 전체를 한 번에 불러와 클라이언트에서 검색/필터한다 (04 문서)
    const [conRes, speRes, linkRes] = await Promise.all([
      supabase.from('engineer_contacts').select('*').order('name', { ascending: true }).limit(5000),
      supabase.from('engineer_specialties').select('*').order('sort_order', { ascending: true }),
      supabase.from('engineer_contact_specialties').select('*'),
    ])
    if (conRes.data) setContacts(conRes.data as EngineerContact[])
    if (speRes.data) setSpecialties(speRes.data as EngineerSpecialty[])
    if (linkRes.data) setLinks(linkRes.data as ContactSpecialty[])
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { load() }, [load])

  // 통합 검색 debounce — 입력은 즉시 반영하되 필터 계산용 검색어만 250ms 지연
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

  const specialtyNamesByContact = useMemo(() => {
    const nameById = new Map(specialties.map(s => [s.id, s.name]))
    const map = new Map<string, string[]>()
    for (const l of links) {
      const arr = map.get(l.contact_id) ?? []
      const n = nameById.get(l.specialty_id)
      if (n) arr.push(n)
      map.set(l.contact_id, arr)
    }
    return map
  }, [links, specialties])

  // 전문분야 데이터가 하나도 없는 동안에는 열/필터를 자동으로 숨긴다 (승인 시 추가 요청)
  const hasSpecialtyData = links.length > 0

  const ranks = useMemo(() =>
    ['전체', ...Array.from(new Set(contacts.map(c => c.rank).filter(Boolean)))
      .sort((a, b) => rankSortKey(a) - rankSortKey(b) || a.localeCompare(b, 'ko'))],
  [contacts])

  const regions = useMemo(() =>
    ['전체', ...Array.from(new Set(contacts.map(c => c.region).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ko'))],
  [contacts])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const qDigits = normalizePhone(q)
    const searchByPhone = qDigits.length >= 3 && /^[\d\-\s]+$/.test(search.trim())
    const list = contacts.filter(c => {
      if (statusFilter !== '전체' && c.employment_status !== statusFilter) return false
      if (rankFilter !== '전체' && c.rank !== rankFilter) return false
      if (regionFilter !== '전체' && c.region !== regionFilter) return false
      if (favoriteOnly && !c.is_favorite) return false
      if (specialtyFilter !== '전체' && !(specialtyNamesByContact.get(c.id) ?? []).includes(specialtyFilter)) return false
      if (!q) return true
      if (searchByPhone) {
        return normalizePhone(c.mobile_phone).includes(qDigits) || normalizePhone(c.office_phone).includes(qDigits)
      }
      const haystack = [
        c.name, c.rank, c.position, c.company, c.mobile_phone, c.office_phone,
        c.email, c.region, c.address, c.memo, ...(specialtyNamesByContact.get(c.id) ?? []),
      ].join(' ').toLowerCase()
      return haystack.includes(q)
    })
    // 기본 정렬 체인: 재직 우선 → 즐겨찾기 우선 → 선택한 정렬 키 (04 문서)
    const statusOrder = (s: string) => (s === '재직' ? 0 : s === '퇴직' ? 1 : 2)
    return list.sort((a, b) => {
      const st = statusOrder(a.employment_status) - statusOrder(b.employment_status)
      if (st !== 0) return st
      if (a.is_favorite !== b.is_favorite) return a.is_favorite ? -1 : 1
      switch (sort) {
        case 'rank': return rankSortKey(a.rank) - rankSortKey(b.rank) || a.name.localeCompare(b.name, 'ko')
        case 'company': return a.company.localeCompare(b.company, 'ko') || a.name.localeCompare(b.name, 'ko')
        case 'joined': return (b.joined_date ?? '').localeCompare(a.joined_date ?? '') || a.name.localeCompare(b.name, 'ko')
        case 'updated': return b.updated_at.localeCompare(a.updated_at)
        default: return a.name.localeCompare(b.name, 'ko')
      }
    })
  }, [contacts, search, statusFilter, rankFilter, regionFilter, favoriteOnly, specialtyFilter, specialtyNamesByContact, sort])

  const counts = useMemo(() => ({
    total: contacts.length,
    active: contacts.filter(c => c.employment_status === '재직').length,
    inactive: contacts.filter(c => c.employment_status !== '재직').length,
    favorite: contacts.filter(c => c.is_favorite).length,
  }), [contacts])

  const resetFilters = () => {
    setSearchInput(''); setSearch(''); setStatusFilter('재직'); setRankFilter('전체')
    setSpecialtyFilter('전체'); setRegionFilter('전체'); setFavoriteOnly(false); setSort('name')
  }

  async function toggleFavorite(c: EngineerContact) {
    if (!canWrite) return
    await supabase.from('engineer_contacts').update({ is_favorite: !c.is_favorite }).eq('id', c.id)
    load()
  }

  const detail = contacts.find(c => c.id === detailId) ?? null

  return (
    <div style={{ minHeight: '100vh', background: '#f8f8f7' }}>
      <header style={{ background: '#fff', borderBottom: '1px solid #e8e8e6' }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', padding: isMobile ? '0 12px' : '0 24px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <span style={{ fontSize: 14, color: '#555' }}>기술인 주소록</span>
            {!isMobile && <span style={{ fontSize: 12, color: '#aaa', marginLeft: 10 }}>기술인의 연락처와 기본정보를 검색하고 관리합니다.</span>}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {canWrite && <button onClick={() => setShowSpecialtyManager(true)} style={outlineBtn}>전문분야 관리</button>}
            {canWrite && <button onClick={() => setFormModal({ open: true, edit: null })} style={primaryBtn}>+ 기술인 추가</button>}
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1400, margin: '0 auto', padding: isMobile ? '12px 12px 60px' : '20px 24px 60px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
          {([['전체 기술인', counts.total, '#111'], ['재직', counts.active, '#15803d'], ['퇴직·비활성', counts.inactive, '#888'], ['즐겨찾기', counts.favorite, '#b45309']] as const).map(([label, n, color]) => (
            <div key={label} style={{ background: '#fff', border: '1px solid #e8e8e6', borderRadius: 8, padding: '12px 16px' }}>
              <div style={{ fontSize: 12, color: '#999', marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 20, fontWeight: 600, color }}>{n}명</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="성명, 직위, 소속, 전화번호, 주소 검색..."
            style={{ flex: 1, minWidth: 220, height: 34, padding: '0 12px', border: '1px solid #e8e8e6', borderRadius: 6, fontSize: 13, background: '#fff' }}
          />
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as typeof statusFilter)} style={sel} title="재직 상태">
            {['재직', '전체', '퇴직', '비활성'].map(s => <option key={s}>{s}</option>)}
          </select>
          <select value={rankFilter} onChange={e => setRankFilter(e.target.value)} style={sel} title="직위">
            {ranks.map(r => <option key={r}>{r === '전체' ? '직위 전체' : r}</option>)}
          </select>
          {hasSpecialtyData && (
            <select value={specialtyFilter} onChange={e => setSpecialtyFilter(e.target.value)} style={sel} title="전문분야">
              <option>전체</option>
              {specialties.filter(s => s.is_active).map(s => <option key={s.id}>{s.name}</option>)}
            </select>
          )}
          <select value={regionFilter} onChange={e => setRegionFilter(e.target.value)} style={sel} title="지역">
            {regions.map(r => <option key={r}>{r === '전체' ? '지역 전체' : r}</option>)}
          </select>
          <button onClick={() => setFavoriteOnly(v => !v)} style={{ ...sel, cursor: 'pointer', background: favoriteOnly ? '#fffbeb' : '#fff', color: favoriteOnly ? '#b45309' : '#555', borderColor: favoriteOnly ? '#fde68a' : '#e8e8e6' }}>
            ★ 즐겨찾기만
          </button>
          <select value={sort} onChange={e => setSort(e.target.value as SortKey)} style={sel} title="정렬">
            <option value="name">성명 가나다순</option>
            <option value="rank">직위순</option>
            <option value="company">소속순</option>
            <option value="joined">입사일순</option>
            <option value="updated">최근 수정순</option>
          </select>
          <button onClick={resetFilters} style={{ ...sel, cursor: 'pointer' }}>초기화</button>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#bbb', fontSize: 13 }}>불러오는 중...</div>
        ) : (
          <EngineerTable
            contacts={filtered}
            specialtyNames={specialtyNamesByContact}
            showSpecialty={hasSpecialtyData}
            canWrite={canWrite}
            onRowClick={c => setDetailId(c.id)}
            onEdit={c => setFormModal({ open: true, edit: c })}
            onCopy={copyText}
            onToggleFavorite={toggleFavorite}
          />
        )}
        <div style={{ marginTop: 8, fontSize: 11, color: '#999' }}>{filtered.length}명 표시 중 (전체 {counts.total}명)</div>
      </div>

      {detail && (
        <EngineerDetailModal
          contact={detail}
          specialtyNames={specialtyNamesByContact.get(detail.id) ?? []}
          canWrite={canWrite}
          onClose={() => setDetailId(null)}
          onEdit={() => { setFormModal({ open: true, edit: detail }) }}
          onCopy={copyText}
          onChanged={() => { load() }}
          onDeleted={() => { setDetailId(null); load() }}
        />
      )}

      {formModal.open && (
        <EngineerFormModal
          contacts={contacts}
          specialties={specialties}
          selectedSpecialtyIds={formModal.edit ? links.filter(l => l.contact_id === formModal.edit!.id).map(l => l.specialty_id) : []}
          edit={formModal.edit}
          onClose={() => setFormModal({ open: false, edit: null })}
          onSaved={() => { setFormModal({ open: false, edit: null }); load() }}
        />
      )}

      {showSpecialtyManager && (
        <SpecialtyManagerModal onClose={() => setShowSpecialtyManager(false)} onChange={load} />
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
const outlineBtn: React.CSSProperties = { height: 34, padding: '0 14px', borderRadius: 6, border: '1px solid #e8e8e6', background: '#fff', color: '#333', fontSize: 13, cursor: 'pointer' }
const primaryBtn: React.CSSProperties = { height: 34, padding: '0 14px', borderRadius: 6, border: 'none', background: '#111', color: '#fff', fontSize: 13, cursor: 'pointer' }
