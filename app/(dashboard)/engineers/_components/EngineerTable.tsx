import { EngineerContact } from '@/lib/engineers/types'

/**
 * 기술인 목록 테이블 — 성명 좌측 고정, 헤더 상단 고정 (휴가관리 그리드와 같은 sticky 패턴).
 * 긴 주소는 말줄임 + title 툴팁, 전화·주소 옆 복사 버튼(행 클릭과 분리 stopPropagation).
 * 667행 규모는 전체 렌더로 충분 — 페이지네이션 없음 (04 문서).
 */
export default function EngineerTable({
  contacts,
  specialtyNames,
  showSpecialty,
  canWrite,
  onRowClick,
  onEdit,
  onCopy,
  onToggleFavorite,
}: {
  contacts: EngineerContact[]
  specialtyNames: Map<string, string[]>
  showSpecialty: boolean // 전문분야 데이터가 생기기 전에는 열을 숨긴다
  canWrite: boolean
  onRowClick: (c: EngineerContact) => void
  onEdit: (c: EngineerContact) => void
  onCopy: (text: string, label: string) => void
  onToggleFavorite: (c: EngineerContact) => void
}) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e8e8e6', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ ...headerCell, width: 34, textAlign: 'center' }}>★</th>
              <th style={{ ...headerCell, position: 'sticky', left: 0, top: 0, zIndex: 3, minWidth: 80 }}>성명</th>
              <th style={headerCell}>직위</th>
              <th style={headerCell}>소속</th>
              {showSpecialty && <th style={headerCell}>전문분야</th>}
              <th style={headerCell}>핸드폰</th>
              <th style={headerCell}>지역</th>
              <th style={{ ...headerCell, width: '38%' }}>주소</th>
              <th style={headerCell}>상태</th>
              {canWrite && <th style={headerCell}></th>}
            </tr>
          </thead>
          <tbody>
            {contacts.length === 0 ? (
              <tr>
                <td colSpan={10} style={{ padding: 40, textAlign: 'center', color: '#bbb' }}>
                  검색 조건에 맞는 기술인이 없습니다.
                </td>
              </tr>
            ) : contacts.map(c => {
              const inactive = c.employment_status !== '재직'
              return (
                <tr
                  key={c.id}
                  onClick={() => onRowClick(c)}
                  style={{ cursor: 'pointer', opacity: inactive ? 0.5 : 1 }}
                >
                  <td style={{ ...td, textAlign: 'center' }}>
                    <button
                      onClick={e => { e.stopPropagation(); onToggleFavorite(c) }}
                      title={canWrite ? '즐겨찾기' : undefined}
                      style={{ border: 'none', background: 'none', cursor: canWrite ? 'pointer' : 'default', fontSize: 14, color: c.is_favorite ? '#f59e0b' : '#ddd', padding: 0 }}
                    >★</button>
                  </td>
                  <td style={{ ...td, position: 'sticky', left: 0, zIndex: 1, background: '#fff', fontWeight: 600, color: '#111', whiteSpace: 'nowrap' }}>
                    {c.name}
                  </td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{c.rank}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.company}</td>
                  {showSpecialty && (
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      {(specialtyNames.get(c.id) ?? []).map(n => (
                        <span key={n} style={chip}>{n}</span>
                      ))}
                    </td>
                  )}
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    {c.mobile_phone && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        {c.mobile_phone}
                        <CopyBtn onClick={e => { e.stopPropagation(); onCopy(c.mobile_phone, '전화번호') }} />
                      </span>
                    )}
                  </td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{c.region}</td>
                  <td style={{ ...td, maxWidth: 0 }} title={c.address}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{c.address}</span>
                      {c.address && <CopyBtn onClick={e => { e.stopPropagation(); onCopy(c.address, '주소') }} />}
                    </span>
                  </td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    <span style={{ ...statusBadge, ...STATUS_STYLE[c.employment_status] }}>{c.employment_status}</span>
                  </td>
                  {canWrite && (
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      <button onClick={e => { e.stopPropagation(); onEdit(c) }} style={editBtn}>수정</button>
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

const STATUS_STYLE: Record<string, React.CSSProperties> = {
  재직: { background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0' },
  퇴직: { background: '#f4f4f2', color: '#888', border: '1px solid #ddd' },
  비활성: { background: '#f4f4f2', color: '#aaa', border: '1px solid #e8e8e6' },
}

const headerCell: React.CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 2,
  background: '#f4f4f2',
  padding: '8px 10px',
  textAlign: 'left',
  fontWeight: 500,
  color: '#555',
  borderBottom: '1px solid #e8e8e6',
  whiteSpace: 'nowrap',
}

const td: React.CSSProperties = {
  padding: '7px 10px',
  borderBottom: '1px solid #f0f0ee',
  verticalAlign: 'middle',
  color: '#333',
}

const chip: React.CSSProperties = {
  display: 'inline-block',
  fontSize: 10,
  padding: '1px 6px',
  borderRadius: 3,
  background: '#eff6ff',
  color: '#1d4ed8',
  border: '1px solid #bfdbfe',
  marginRight: 3,
}

const statusBadge: React.CSSProperties = {
  fontSize: 11,
  padding: '2px 7px',
  borderRadius: 4,
}

const editBtn: React.CSSProperties = {
  height: 24,
  padding: '0 8px',
  borderRadius: 4,
  border: '1px solid #e8e8e6',
  background: '#fff',
  color: '#333',
  fontSize: 11,
  cursor: 'pointer',
}
