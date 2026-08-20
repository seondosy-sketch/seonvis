'use client'

import { useMemo } from 'react'
import { groupLabel, groupQuestions } from '@/lib/evaluations/questionGroups'
import {
  formatAttendees,
  formatEvaluationDateTime,
  formatEvaluationType,
  formatEvaluatorCount,
  formatParticipantCompanies,
} from '@/lib/evaluations/reviewFormat'
import type {
  EvaluationQuestionCategory,
  EvaluationRole,
  ReviewDetail,
} from '@/lib/evaluations/types'

/**
 * 후기 상세 — 우측 Drawer.
 *
 * 정보량이 많아 tooltip을 쓰지 않는다(프로젝트 List의 상세 tooltip과 달리). 화면 구성은 참고자료
 * HWP 면접후기 문서의 순서를 그대로 따른다: 개요 → 진행방법 → 특이사항 → 실제질의.
 * 실제질의는 질의그룹으로 묶고, 질문마다 질의분류를 함께 보여준다.
 */
interface ReviewDetailDrawerProps {
  review: ReviewDetail
  roles: EvaluationRole[]
  categories: EvaluationQuestionCategory[]
  /** 평가유형 id → 표시 이름. */
  typeNameById: ReadonlyMap<string, string>
  canWrite: boolean
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
  /** 질의 탭에서 열었을 때 강조할 질문 id — 어떤 질문을 따라 들어왔는지 보이게 한다. */
  highlightQuestionId?: string | null
}

export default function ReviewDetailDrawer({
  review, roles, categories, typeNameById, canWrite, onClose, onEdit, onDelete, highlightQuestionId,
}: ReviewDetailDrawerProps) {
  const roleNameById = useMemo(() => new Map(roles.map(r => [r.id, r.name])), [roles])
  const categoryNameById = useMemo(() => new Map(categories.map(c => [c.id, c.name])), [categories])
  const groups = useMemo(() => groupQuestions(review.questions), [review.questions])

  const title = review.project_name_snapshot.trim() || review.client_snapshot.trim() || '면접후기'

  return (
    <div style={overlay} onClick={onClose}>
      <aside style={drawer} onClick={e => e.stopPropagation()}>
        <div style={header}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
              <span style={typeBadge}>{formatEvaluationType(review, typeNameById)}</span>
              <span style={{ fontSize: 11, color: '#999' }}>질문 {review.questions.length}건</span>
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#111', lineHeight: 1.4 }}>{title}</div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
            {canWrite && <button onClick={onEdit} style={miniBtn}>수정</button>}
            {canWrite && <button onClick={onDelete} style={{ ...miniBtn, color: '#b91c1c', border: '1px solid #fecaca' }}>삭제</button>}
            <button onClick={onClose} style={closeBtn}>✕</button>
          </div>
        </div>

        <div style={body}>
          <SectionTitle>개요</SectionTitle>
          <dl style={dl}>
            <DetailRow label="평가유형" value={formatEvaluationType(review, typeNameById)} />
            <DetailRow label="발주처" value={review.client_snapshot} />
            <DetailRow label="용역명" value={review.project_name_snapshot} />
            <DetailRow label="시설용도" value={review.facility_type} />
            <DetailRow label="일시" value={formatEvaluationDateTime(review)} />
            <DetailRow label="장소" value={review.location} />
            <DetailRow label="참석자" value={formatAttendees(review.attendees)} />
            <DetailRow label="참가업체" value={formatParticipantCompanies(review)} />
            <DetailRow label="면접관" value={formatEvaluatorCount(review.evaluator_count)} />
          </dl>

          {review.evaluation_date === null && review.evaluation_year !== null && (
            <div style={{ fontSize: 11, color: '#999', marginTop: 6, lineHeight: 1.5 }}>
              과거 자료라 원본에 연도만 있고 월·일은 없습니다.
            </div>
          )}

          <SectionTitle>진행방법</SectionTitle>
          <MultilineText text={review.evaluation_method} />

          <SectionTitle>특이사항</SectionTitle>
          <MultilineText text={review.special_notes} />

          <SectionTitle>실제질의</SectionTitle>
          {groups.length === 0 ? (
            <div style={{ fontSize: 12, color: '#999' }}>등록된 질문이 없습니다.</div>
          ) : (
            groups.map(g => (
              <div key={g.group_order} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#0369a1', marginBottom: 6 }}>
                  [{groupLabel(g.role_id ? roleNameById.get(g.role_id) : null)}]
                </div>
                {g.questions.map((q, i) => (
                  <div
                    key={q.id}
                    style={{
                      padding: '5px 6px', borderRadius: 4, marginBottom: 2,
                      background: q.id === highlightQuestionId ? '#fffbeb' : 'transparent',
                    }}
                  >
                    <div style={{ display: 'flex', gap: 8 }}>
                      <span style={{ fontSize: 11, color: '#999', flexShrink: 0, paddingTop: 1 }}>Q{i + 1}</span>
                      <span style={{ fontSize: 12, color: '#222', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{q.question_text}</span>
                    </div>
                    <div style={{ paddingLeft: 27, marginTop: 2 }}>
                      <span style={categoryTag}>
                        {(q.category_id ? categoryNameById.get(q.category_id) : null) ?? '미지정'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </aside>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 12, fontWeight: 700, color: '#444', margin: '18px 0 8px', paddingBottom: 4, borderBottom: '1px solid #f0f0ee' }}>
      {children}
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 10, padding: '5px 0', borderBottom: '1px solid #f6f6f4' }}>
      <dt style={{ fontSize: 11, color: '#888', width: 66, flexShrink: 0 }}>{label}</dt>
      <dd style={{ fontSize: 12, color: '#222', margin: 0, lineHeight: 1.6, whiteSpace: 'pre-wrap', minWidth: 0, wordBreak: 'break-word' }}>
        {value.trim() || '-'}
      </dd>
    </div>
  )
}

/** 여러 줄로 입력된 값(진행방법/특이사항)을 줄바꿈 그대로 보여준다. */
function MultilineText({ text }: { text: string }) {
  const value = text.trim()
  if (!value) return <div style={{ fontSize: 12, color: '#bbb' }}>-</div>
  return <div style={{ fontSize: 12, color: '#222', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{value}</div>
}

const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 250, display: 'flex', justifyContent: 'flex-end' }
const drawer: React.CSSProperties = { background: '#fff', width: '100%', maxWidth: 520, height: '100%', display: 'flex', flexDirection: 'column', boxShadow: '-8px 0 32px rgba(0,0,0,0.12)' }
const header: React.CSSProperties = { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, padding: '14px 18px', borderBottom: '1px solid #f0f0ee' }
const body: React.CSSProperties = { padding: '4px 18px 40px', overflowY: 'auto', flex: 1 }
const dl: React.CSSProperties = { margin: 0 }
const miniBtn: React.CSSProperties = { border: '1px solid #e8e8e6', background: '#fff', borderRadius: 4, padding: '4px 9px', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' }
const closeBtn: React.CSSProperties = { border: 'none', background: 'none', cursor: 'pointer', fontSize: 16, color: '#aaa' }
const typeBadge: React.CSSProperties = { fontSize: 10, color: '#7c3aed', background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 3, padding: '1px 6px', whiteSpace: 'nowrap', fontWeight: 600 }
const categoryTag: React.CSSProperties = { fontSize: 10, color: '#666', background: '#f4f4f2', border: '1px solid #e8e8e6', borderRadius: 3, padding: '1px 6px' }
