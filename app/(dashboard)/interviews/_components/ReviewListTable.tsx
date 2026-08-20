'use client'

import { formatAttendees, formatEvaluationDateTime, formatEvaluationType } from '@/lib/evaluations/reviewFormat'
import type { ReviewListItem } from '@/lib/evaluations/types'

/**
 * 면접후기 목록. 모바일에서는 프로젝트 List와 같은 방식으로 표 대신 카드로 보여준다
 * (app/(dashboard)/projects/page.tsx의 모바일 카드와 같은 감각).
 *
 * 평가유형(면접/SOQ/TP/종심제 등)은 badge로 표시한다 — 같은 프로젝트에 유형이 다른 후기가
 * 여러 건 있을 수 있어서 목록에서 바로 구분돼야 한다.
 */
interface ReviewListTableProps {
  reviews: ReviewListItem[]
  /** 평가유형 id → 표시 이름. */
  typeNameById: ReadonlyMap<string, string>
  isMobile: boolean
  canWrite: boolean
  onOpen: (review: ReviewListItem) => void
  onEdit: (review: ReviewListItem) => void
}

export default function ReviewListTable({ reviews, typeNameById, isMobile, canWrite, onOpen, onEdit }: ReviewListTableProps) {
  if (reviews.length === 0) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#bbb', fontSize: 13 }}>등록된 후기가 없습니다.</div>
  }

  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {reviews.map(r => (
          <div key={r.id} style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={typeBadge}>{formatEvaluationType(r, typeNameById)}</span>
              <span style={{ fontSize: 11, color: '#999' }}>{formatEvaluationDateTime(r)}</span>
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#111', lineHeight: 1.4 }}>
              {r.project_name_snapshot || '(용역명 없음)'}
            </div>
            <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>{r.client_snapshot || '-'}</div>
            <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>
              {r.facility_type && `${r.facility_type} · `}질문 {r.question_count}건
            </div>
            <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>{formatAttendees(r.attendees)}</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <button onClick={() => onOpen(r)} style={{ ...miniBtn, flex: 1 }}>면접후기 보기</button>
              {canWrite && <button onClick={() => onEdit(r)} style={{ ...miniBtn, flex: 1 }}>수정</button>}
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #e8e8e6', borderRadius: 8, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: '#fafafa' }}>
            <th style={th}>평가일</th>
            <th style={th}>평가유형</th>
            <th style={{ ...th, minWidth: 240 }}>용역명</th>
            <th style={th}>발주처</th>
            <th style={th}>시설용도</th>
            <th style={th}>참석기술인</th>
            <th style={{ ...th, textAlign: 'right' }}>질문수</th>
            <th style={th}>관리</th>
          </tr>
        </thead>
        <tbody>
          {reviews.map(r => (
            <tr key={r.id} style={{ borderTop: '1px solid #f0f0ee' }}>
              <td style={{ ...td, whiteSpace: 'nowrap' }}>{formatEvaluationDateTime(r)}</td>
              <td style={td}><span style={typeBadge}>{formatEvaluationType(r, typeNameById)}</span></td>
              <td style={td}>{r.project_name_snapshot || '-'}</td>
              <td style={td}>{r.client_snapshot || '-'}</td>
              <td style={td}>{r.facility_type || '-'}</td>
              <td style={td}>{formatAttendees(r.attendees)}</td>
              <td style={{ ...td, textAlign: 'right' }}>{r.question_count}</td>
              <td style={{ ...td, whiteSpace: 'nowrap' }}>
                <button onClick={() => onOpen(r)} style={miniBtn}>면접후기 보기</button>
                {canWrite && <button onClick={() => onEdit(r)} style={{ ...miniBtn, marginLeft: 4 }}>수정</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const th: React.CSSProperties = { padding: '9px 10px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#666', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '9px 10px', color: '#222', verticalAlign: 'top', lineHeight: 1.5 }
const miniBtn: React.CSSProperties = { border: '1px solid #e8e8e6', background: '#fff', borderRadius: 4, padding: '4px 9px', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' }
const card: React.CSSProperties = { background: '#fff', border: '1px solid #e8e8e6', borderRadius: 8, padding: 12 }
const typeBadge: React.CSSProperties = {
  fontSize: 10, color: '#0369a1', background: '#f0f9ff', border: '1px solid #bae6fd',
  borderRadius: 3, padding: '1px 6px', whiteSpace: 'nowrap',
}
