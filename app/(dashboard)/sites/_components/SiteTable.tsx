import { Site, SiteStatus } from '@/lib/sites/types'

/**
 * 현장 목록 테이블 — 현장명 좌측 고정, 헤더 상단 고정 (engineers/leave와 같은 sticky 패턴).
 * 89건 규모는 전체 렌더로 충분 — 페이지네이션 없음.
 */
export default function SiteTable({
  sites,
  statusOf,
  canWrite,
  onRowClick,
  onEdit,
  onCopy,
  onToggleFavorite,
}: {
  sites: Site[]
  statusOf: (s: Site) => SiteStatus
  canWrite: boolean
  onRowClick: (s: Site) => void
  onEdit: (s: Site) => void
  onCopy: (text: string, label: string) => void
  onToggleFavorite: (s: Site) => void
}) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e8e8e6', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ ...headerCell, width: 34, textAlign: 'center' }}>★</th>
              <th style={{ ...headerCell, position: 'sticky', left: 0, top: 0, zIndex: 3, minWidth: 140 }}>현장명</th>
              <th style={headerCell}>법 구분</th>
              <th style={headerCell}>감리원/담당자</th>
              <th style={headerCell}>시공사</th>
              <th style={headerCell}>지역</th>
              <th style={headerCell}>연락처</th>
              <th style={headerCell}>착수일</th>
              <th style={headerCell}>준공예정일</th>
              <th style={headerCell}>상태</th>
              {canWrite && <th style={headerCell}></th>}
            </tr>
          </thead>
          <tbody>
            {sites.length === 0 ? (
              <tr>
                <td colSpan={11} style={{ padding: 40, textAlign: 'center', color: '#bbb' }}>
                  검색 조건에 맞는 현장이 없습니다.
                </td>
              </tr>
            ) : sites.map(s => {
              const status = statusOf(s)
              const inactive = !s.active
              const managerFirst = s.manager_name.split(/\n/)[0]?.trim() ?? ''
              const managerCount = s.manager_name.split(/\n/).map(x => x.trim()).filter(Boolean).length
              return (
                <tr key={s.id} onClick={() => onRowClick(s)} style={{ cursor: 'pointer', opacity: inactive ? 0.5 : 1 }}>
                  <td style={{ ...td, textAlign: 'center' }}>
                    <button
                      onClick={e => { e.stopPropagation(); onToggleFavorite(s) }}
                      title={canWrite ? '즐겨찾기' : undefined}
                      style={{ border: 'none', background: 'none', cursor: canWrite ? 'pointer' : 'default', fontSize: 14, color: s.is_favorite ? '#f59e0b' : '#ddd', padding: 0 }}
                    >★</button>
                  </td>
                  <td style={{ ...td, position: 'sticky', left: 0, zIndex: 1, background: '#fff', fontWeight: 600, color: '#111', maxWidth: 0 }} title={s.original_site_name.replace(/\n/g, ' ')}>
                    <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.site_name}</span>
                  </td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}><span style={legalBadge}>{s.legal_category}</span></td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }} title={s.manager_name.replace(/\n/g, ' / ')}>
                    {managerFirst}{managerCount > 1 ? ` 외 ${managerCount - 1}명` : ''}
                  </td>
                  <td style={{ ...td, whiteSpace: 'nowrap', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.contractor}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{s.region}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    {s.manager_mobile && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        {s.manager_mobile}
                        {s.phone_uncertain && <span title="원본에 번호가 여럿 있어 확인이 필요합니다" style={{ color: '#b45309', fontSize: 10 }}>?</span>}
                        <CopyBtn onClick={e => { e.stopPropagation(); onCopy(s.manager_mobile, '전화번호') }} />
                      </span>
                    )}
                  </td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{s.start_date ?? ''}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{s.planned_completion_date ?? ''}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    <span style={{ ...statusBadge, ...STATUS_STYLE[status] }}>{status}</span>
                    {s.manual_status && <span style={{ fontSize: 10, color: '#999', marginLeft: 4 }}>· 수동</span>}
                  </td>
                  {canWrite && (
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      <button onClick={e => { e.stopPropagation(); onEdit(s) }} style={editBtn}>수정</button>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function CopyBtn({ onClick }: { onClick: (e: React.MouseEvent) => void }) {
  return (
    <button onClick={onClick} title="복사" style={{ flexShrink: 0, border: '1px solid #e8e8e6', background: '#fff', borderRadius: 4, cursor: 'pointer', fontSize: 10, color: '#888', padding: '1px 5px', lineHeight: 1.4 }}>
      복사
    </button>
  )
}

const STATUS_STYLE: Record<SiteStatus, React.CSSProperties> = {
  '착수 전': { background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' },
  '진행 중': { background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0' },
  '준공 임박': { background: '#fffbeb', color: '#b45309', border: '1px solid #fde68a' },
  '준공 완료': { background: '#f4f4f2', color: '#888', border: '1px solid #ddd' },
  '중지': { background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' },
  '일정 미등록': { background: '#f4f4f2', color: '#aaa', border: '1px solid #e8e8e6' },
}

const headerCell: React.CSSProperties = {
  position: 'sticky', top: 0, zIndex: 2, background: '#f4f4f2', padding: '8px 10px',
  textAlign: 'left', fontWeight: 500, color: '#555', borderBottom: '1px solid #e8e8e6', whiteSpace: 'nowrap',
}

const td: React.CSSProperties = { padding: '7px 10px', borderBottom: '1px solid #f0f0ee', verticalAlign: 'middle', color: '#333' }

const legalBadge: React.CSSProperties = {
  display: 'inline-block', fontSize: 10, padding: '1px 6px', borderRadius: 3,
  background: '#f0f0ee', color: '#555', border: '1px solid #e0e0de', whiteSpace: 'nowrap',
}

const statusBadge: React.CSSProperties = { fontSize: 11, padding: '2px 7px', borderRadius: 4 }

const editBtn: React.CSSProperties = { height: 24, padding: '0 8px', borderRadius: 4, border: '1px solid #e8e8e6', background: '#fff', color: '#333', fontSize: 11, cursor: 'pointer' }
