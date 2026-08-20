'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { useIsMobile } from '@/lib/useIsMobile'
import { useMenuPermission } from '@/app/components/PermissionsProvider'
import { evaluationReviewErrorMessage } from '@/lib/evaluations/errors'
import { EMPTY_FILTER, type QuestionFilterState } from '@/lib/evaluations/questionFilters'
import { searchReviews, sortReviewsByDateDesc } from '@/lib/evaluations/reviewFormat'
import type {
  EvaluationAttendee,
  EvaluationQuestion,
  EvaluationQuestionCategory,
  EvaluationRole,
  EvaluationType,
  QuestionWithReview,
  ReviewDetail,
  ReviewListItem,
} from '@/lib/evaluations/types'
import type { InterviewEngineerRef, InterviewProjectRef } from './types'
import ReviewListTable from './_components/ReviewListTable'
import ReviewFormModal from './_components/ReviewFormModal'
import ReviewDetailDrawer from './_components/ReviewDetailDrawer'
import QuestionSearchPanel from './_components/QuestionSearchPanel'

/**
 * 면접 DB — 면접후기 / 질의 두 탭.
 *
 * 사용자 화면 용어는 "면접"이지만(실제 HWP 양식과 업무 용어가 그렇다), 담기는 데이터는 면접만이
 * 아니다. SOQ·TP·종심제 등도 PT 발표와 기술인 질의응답 평가를 하고 그때 실제 질의가 나오므로,
 * 내부 모델은 평가 수행기록(evaluation_reviews)이고 평가유형(evaluation_types)으로 구분한다.
 *
 * 두 탭은 같은 데이터를 본다. 후기 탭에서 입력한 질문(evaluation_questions)이 질의 탭의 검색
 * 대상이고, 질문을 복제해 두는 테이블은 없다 — 질의 탭에서 질문을 클릭하면 그 질문이 나온
 * 후기 상세(Drawer)가 열린다.
 */
const MIGRATION_HINT = 'supabase/migration_evaluation_db.sql이 적용되었는지 확인하세요.'

export default function InterviewsPage() {
  const isMobile = useIsMobile()
  const supabase = createSupabaseBrowserClient()
  // 읽기 권한 사용자는 조회만 — 등록/수정/삭제 UI를 숨긴다(관리자 화면에서 설정).
  // 권한 키는 사용자 메뉴 이름을 따라 'interview_db'를 그대로 쓴다(내부 테이블명과 별개).
  const canWrite = useMenuPermission('interview_db') === 'write'

  const [tab, setTab] = useState<'reviews' | 'questions'>('reviews')

  const [reviews, setReviews] = useState<ReviewListItem[]>([])
  const [questions, setQuestions] = useState<QuestionWithReview[]>([])
  const [evaluationTypes, setEvaluationTypes] = useState<EvaluationType[]>([])
  const [roles, setRoles] = useState<EvaluationRole[]>([])
  const [categories, setCategories] = useState<EvaluationQuestionCategory[]>([])
  const [projects, setProjects] = useState<InterviewProjectRef[]>([])
  const [engineers, setEngineers] = useState<InterviewEngineerRef[]>([])

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [currentUserEmail, setCurrentUserEmail] = useState('')

  const [reviewSearch, setReviewSearch] = useState('')
  const [questionFilter, setQuestionFilter] = useState<QuestionFilterState>(EMPTY_FILTER)

  const [formTarget, setFormTarget] = useState<{ review: ReviewDetail | null } | null>(null)
  const [detail, setDetail] = useState<{ review: ReviewDetail; highlightQuestionId: string | null } | null>(null)
  const [detailBusy, setDetailBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }, [])

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setCurrentUserEmail(data.user?.email ?? ''))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** 후기 목록 — 참석자와 질문 수를 함께 읽는다(목록에 그대로 보여줄 값들). */
  const loadReviews = useCallback(async (): Promise<void> => {
    const { data, error } = await supabase
      .from('evaluation_reviews')
      .select('*, attendees:evaluation_review_attendees(*), question_count:evaluation_questions(count)')
      .order('evaluation_year_effective', { ascending: false, nullsFirst: false })

    if (error) {
      setLoadError(`후기를 불러올 수 없습니다. ${MIGRATION_HINT}`)
      setReviews([])
      return
    }

    type Row = Omit<ReviewListItem, 'attendees' | 'question_count'> & {
      attendees: EvaluationAttendee[] | null
      question_count: { count: number }[] | null
    }
    const rows = (data ?? []) as unknown as Row[]
    setLoadError(null)
    setReviews(rows.map(r => ({
      ...r,
      attendees: r.attendees ?? [],
      question_count: r.question_count?.[0]?.count ?? 0,
    })))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * 질의 탭 데이터 — 질문 행에 후기의 조회용 필드를 조인해서 읽는다. 평가유형/발주처/시설용도/
   * 평가일을 질문에 복제 저장하지 않기 때문에 여기서 조인이 필요하다(그게 정상 경로다).
   */
  const loadQuestions = useCallback(async (): Promise<void> => {
    const { data, error } = await supabase
      .from('evaluation_questions')
      .select('*, review:evaluation_reviews!inner(id, evaluation_type_id, client_snapshot, project_name_snapshot, facility_type, evaluation_date, evaluation_year_effective)')
      .limit(5000)

    if (error) {
      setQuestions([])
      return
    }
    setQuestions((data ?? []) as unknown as QuestionWithReview[])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * 마스터 로드. 평가유형/질의그룹/질의분류를 못 읽으면 화면이 조용히 빈 select를 보여주게 되므로
   * (사용자에게는 "메뉴가 없다"로 보인다) 반드시 loadError로 드러낸다 — migration 미적용이 그 원인이다.
   */
  const loadMasters = useCallback(async () => {
    const [typeRes, roleRes, catRes, projRes, engRes] = await Promise.all([
      // 평가유형·질의그룹·질의분류는 비활성 항목도 읽어둔다 — 과거 기록이 참조하는 이름을 표시해야
      // 하기 때문이다(신규 입력 목록에서는 폼이 is_active/is_primary로 다시 거른다).
      supabase.from('evaluation_types').select('*').order('sort_order', { ascending: true }),
      supabase.from('evaluation_roles').select('*').order('sort_order', { ascending: true }),
      supabase.from('evaluation_question_categories').select('*').order('sort_order', { ascending: true }),
      // 프로젝트 선택 목록은 프로젝트 List와 같은 공사번호 순(lib/projectOrder.ts와 같은 기준).
      supabase.from('projects').select('id, project_number, name, client, interview_date, status').order('project_number', { ascending: true }),
      supabase.from('engineer_contacts').select('id, name, rank, company').order('name', { ascending: true }).limit(5000),
    ])

    setEvaluationTypes((typeRes.data ?? []) as EvaluationType[])
    setRoles((roleRes.data ?? []) as EvaluationRole[])
    setCategories((catRes.data ?? []) as EvaluationQuestionCategory[])
    if (projRes.data) setProjects(projRes.data as InterviewProjectRef[])
    if (engRes.data) setEngineers(engRes.data as InterviewEngineerRef[])

    // 마스터 3종 중 하나라도 못 읽었으면 그대로 알린다(에러를 삼키지 않는다).
    const missing = [
      typeRes.error ? '평가유형' : null,
      roleRes.error ? '질의그룹' : null,
      catRes.error ? '질의분류' : null,
    ].filter(Boolean)
    return missing as string[]
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 최초 진입 시 한 번만 전부 읽는다. setLoading(true)를 effect 본문에서 동기로 호출하지 않고
  // loading의 초기값(true)을 그대로 쓰는 이유는 react-hooks/set-state-in-effect 규칙 때문이다 —
  // effect 본문에서 곧바로 setState하면 연쇄 렌더가 발생한다.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [, , missingMasters] = await Promise.all([loadReviews(), loadQuestions(), loadMasters()])
      if (cancelled) return
      if (missingMasters.length > 0) {
        setLoadError(
          `${missingMasters.join(' · ')} 목록을 불러올 수 없어 후기 등록/수정이 불가합니다. ${MIGRATION_HINT}`,
        )
      }
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [loadReviews, loadQuestions, loadMasters])

  /** 상세/수정에 필요한 후기 1건 전체(참석자 + 질문)를 읽는다. */
  const fetchDetail = useCallback(async (reviewId: string): Promise<ReviewDetail | null> => {
    const { data, error } = await supabase
      .from('evaluation_reviews')
      .select('*, attendees:evaluation_review_attendees(*), questions:evaluation_questions(*)')
      .eq('id', reviewId)
      .single()

    if (error || !data) return null
    const row = data as unknown as ReviewDetail & {
      attendees: EvaluationAttendee[] | null
      questions: EvaluationQuestion[] | null
    }
    return { ...row, attendees: row.attendees ?? [], questions: row.questions ?? [] }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function openDetail(reviewId: string, highlightQuestionId: string | null = null) {
    if (detailBusy) return
    setDetailBusy(true)
    setActionError(null)
    try {
      const found = await fetchDetail(reviewId)
      if (!found) {
        setActionError('후기를 불러올 수 없습니다.')
        return
      }
      setDetail({ review: found, highlightQuestionId })
    } finally {
      setDetailBusy(false)
    }
  }

  async function openEdit(reviewId: string) {
    const found = await fetchDetail(reviewId)
    if (!found) {
      setActionError('후기를 불러올 수 없습니다.')
      return
    }
    setDetail(null)
    setFormTarget({ review: found })
  }

  async function handleDelete(review: ReviewDetail) {
    if (!confirm('이 후기를 삭제하시겠습니까? 후기에 입력된 질문도 함께 삭제됩니다.')) return
    setActionError(null)

    // 프로젝트 List 삭제와 같은 방식으로 error와 실제 삭제된 행을 모두 확인한다 — RLS에 조용히
    // 막히는 경우(에러 없이 0건)를 놓치지 않기 위함이다. 질문은 on delete cascade로 함께 지워진다.
    const { data, error } = await supabase.from('evaluation_reviews').delete().eq('id', review.id).select('id')
    if (error) {
      setActionError(evaluationReviewErrorMessage('delete', error.code))
      return
    }
    if (!data?.length) {
      setActionError('삭제 권한이 없어 처리되지 않았습니다. 관리자에게 문의하세요.')
      return
    }

    setDetail(null)
    await Promise.all([loadReviews(), loadQuestions()])
    showToast('삭제했습니다.')
  }

  async function handleSaved(reviewId: string) {
    await Promise.all([loadReviews(), loadQuestions()])
    showToast('저장했습니다.')
    // 저장 직후 방금 쓴 후기를 바로 확인할 수 있게 상세를 열어준다.
    await openDetail(reviewId)
  }

  const typeNameById = useMemo(
    () => new Map(evaluationTypes.map(t => [t.id, t.name])),
    [evaluationTypes],
  )

  const visibleReviews = useMemo(
    () => sortReviewsByDateDesc(searchReviews(reviews, reviewSearch)),
    [reviews, reviewSearch],
  )

  /** 시설용도 입력칸 추천 목록 — 기존에 입력된 값에서 뽑는다(자유 입력이라 고정 목록이 없다). */
  const facilitySuggestions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of reviews) {
      const f = r.facility_type.trim()
      if (f) counts.set(f, (counts.get(f) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name)
  }, [reviews])

  return (
    <div style={{ minHeight: '100vh', background: '#f8f8f7' }}>
      <header style={{ background: '#fff', borderBottom: '1px solid #e8e8e6' }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', padding: isMobile ? '0 12px' : '0 24px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 14, color: '#555' }}>면접 DB</span>
          {canWrite && (
            <button onClick={() => setFormTarget({ review: null })} style={outlineBtn}>면접후기 등록</button>
          )}
        </div>
      </header>

      <div style={{ maxWidth: 1400, margin: '0 auto', padding: isMobile ? '12px 12px 60px' : '20px 24px 60px' }}>
        <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
          {(['reviews', 'questions'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={t === tab ? tabBtnActive : tabBtn}>
              {t === 'reviews' ? '면접후기' : '질의'}
            </button>
          ))}
        </div>

        {loadError && <div style={errorBox}>{loadError}</div>}
        {actionError && <div style={errorBox}>{actionError}</div>}

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#bbb', fontSize: 13 }}>불러오는 중...</div>
        ) : tab === 'reviews' ? (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                style={{ ...inp, maxWidth: 320 }}
                value={reviewSearch}
                onChange={e => setReviewSearch(e.target.value)}
                placeholder="용역명 · 발주처 · 시설용도 · 참석자 검색"
              />
              <span style={{ fontSize: 11, color: '#888' }}>
                후기 {visibleReviews.length}건
                {visibleReviews.length !== reviews.length && ` / 전체 ${reviews.length}건`}
              </span>
            </div>

            <ReviewListTable
              reviews={visibleReviews}
              typeNameById={typeNameById}
              isMobile={isMobile}
              canWrite={canWrite}
              onOpen={r => openDetail(r.id)}
              onEdit={r => openEdit(r.id)}
            />
          </>
        ) : (
          <QuestionSearchPanel
            questions={questions}
            evaluationTypes={evaluationTypes}
            roles={roles}
            categories={categories}
            filter={questionFilter}
            onFilterChange={setQuestionFilter}
            isMobile={isMobile}
            onOpenReview={(reviewId, questionId) => openDetail(reviewId, questionId)}
          />
        )}
      </div>

      {formTarget && (
        <ReviewFormModal
          review={formTarget.review}
          projects={projects}
          engineers={engineers}
          roles={roles}
          categories={categories}
          evaluationTypes={evaluationTypes}
          facilitySuggestions={facilitySuggestions}
          currentUserEmail={currentUserEmail}
          onClose={() => setFormTarget(null)}
          onSaved={handleSaved}
        />
      )}

      {detail && (
        <ReviewDetailDrawer
          review={detail.review}
          roles={roles}
          categories={categories}
          typeNameById={typeNameById}
          canWrite={canWrite}
          highlightQuestionId={detail.highlightQuestionId}
          onClose={() => setDetail(null)}
          onEdit={() => openEdit(detail.review.id)}
          onDelete={() => handleDelete(detail.review)}
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

const outlineBtn: React.CSSProperties = { border: '1px solid #e8e8e6', background: '#fff', borderRadius: 6, padding: '8px 14px', fontSize: 12, cursor: 'pointer', color: '#333' }
const tabBtn: React.CSSProperties = { border: '1px solid #e8e8e6', background: '#fff', borderRadius: 6, padding: '7px 14px', fontSize: 12, cursor: 'pointer', color: '#666' }
const tabBtnActive: React.CSSProperties = { ...tabBtn, background: '#111', color: '#fff', border: '1px solid #111' }
const inp: React.CSSProperties = { width: '100%', border: '1px solid #e8e8e6', borderRadius: 6, padding: '7px 9px', fontSize: 12, color: '#111', fontFamily: 'inherit', boxSizing: 'border-box' }
const errorBox: React.CSSProperties = { marginBottom: 12, padding: '8px 12px', borderRadius: 6, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 12 }
