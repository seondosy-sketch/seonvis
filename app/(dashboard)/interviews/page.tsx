'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { useIsMobile } from '@/lib/useIsMobile'
import { useMenuPermission } from '@/app/components/PermissionsProvider'
import { evaluationReviewErrorMessage } from '@/lib/evaluations/errors'
import {
  EMPTY_FILTER,
  type QuestionFilterOptions,
  type QuestionFilterState,
} from '@/lib/evaluations/questionFilters'
import {
  QUESTION_FACETS_VIEW,
  QUESTION_PAGE_SIZE,
  QUESTION_SEARCH_VIEW,
  buildFilterOptionsFromFacets,
  buildQuestionQueryPlan,
  clampPage,
  toQuestionWithReview,
  type QuestionFacetRow,
  type QuestionSearchRow,
} from '@/lib/evaluations/questionQuery'
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
const QUESTION_VIEW_HINT = 'supabase/migration_evaluation_question_search.sql이 적용되었는지 확인하세요.'
const EMPTY_QUESTION_OPTIONS: QuestionFilterOptions = { clients: [], facilities: [], years: [] }

export default function InterviewsPage() {
  const isMobile = useIsMobile()
  const supabase = createSupabaseBrowserClient()
  // 읽기 권한 사용자는 조회만 — 등록/수정/삭제 UI를 숨긴다(관리자 화면에서 설정).
  // 권한 키는 사용자 메뉴 이름을 따라 'interview_db'를 그대로 쓴다(내부 테이블명과 별개).
  const canWrite = useMenuPermission('interview_db') === 'write'

  const [tab, setTab] = useState<'reviews' | 'questions'>('reviews')

  const [reviews, setReviews] = useState<ReviewListItem[]>([])
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

  // ── 질의 탭 상태 ────────────────────────────────────────────────────────────
  // questionFilter는 사용자가 지금 입력칸에 넣은 값(즉시 반영), appliedQuestionFilter는 실제로 DB에
  // 보낸 조건이다. 검색어는 타이핑 중이라 300ms 뒤에 적용하므로 둘을 나눠 둔다.
  const [questionFilter, setQuestionFilter] = useState<QuestionFilterState>(EMPTY_FILTER)
  const [appliedQuestionFilter, setAppliedQuestionFilter] = useState<QuestionFilterState>(EMPTY_FILTER)
  const [questionPage, setQuestionPage] = useState(1)
  /** 현재 페이지 질문만 담는다 — 전체를 담지 않는다(PostgREST 1,000행 상한 문제의 원인이었다). */
  const [questionRows, setQuestionRows] = useState<QuestionWithReview[]>([])
  /** 필터를 적용한 총 결과 수 — DB가 센 값(exact count). */
  const [questionTotal, setQuestionTotal] = useState(0)
  /** 필터 없는 전체 질문 수 — 빈 화면 문구를 가르는 데 쓴다. */
  const [questionTotalAll, setQuestionTotalAll] = useState(0)
  // 첫 조회가 끝나기 전에는 "등록된 질문이 없습니다"가 아니라 "불러오는 중"이 보여야 한다.
  const [questionsLoading, setQuestionsLoading] = useState(true)
  const [questionError, setQuestionError] = useState<string | null>(null)
  const [questionOptions, setQuestionOptions] = useState<QuestionFilterOptions>(EMPTY_QUESTION_OPTIONS)
  /** 저장/삭제 후 현재 페이지를 다시 읽게 하는 방아쇠(오래된 closure를 붙잡지 않기 위해 카운터로 둔다). */
  const [questionReloadKey, setQuestionReloadKey] = useState(0)
  /** 질의 조회 요청 번호 — 늦게 도착한 이전 응답이 최신 결과를 덮어쓰지 않게 막는다. */
  const questionRequestRef = useRef(0)

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
   * 질의 탭 — 조건에 맞는 질문 중 **현재 페이지 것만** 읽는다.
   *
   * 예전에는 질문 전체를 받아 브라우저에서 걸렀는데, PostgREST가 요청 limit과 무관하게 한 응답에
   * 최대 1,000행만 주기 때문에 그 뒤 질문은 검색조차 되지 않았다. 그래서 필터·정렬·건수·페이지를
   * 전부 DB로 내렸다. 조회 대상은 evaluation_question_search view다(질문 + 기록 조인, RLS 유지).
   * 건수는 Prefer: count=exact로 DB가 세므로 페이지 크기와 무관하게 정확하다.
   */
  const loadQuestionPage = useCallback(async (f: QuestionFilterState, page: number): Promise<void> => {
    // 조건을 빠르게 바꾸면 조회가 겹친다. 응답이 도착한 순서는 보낸 순서와 다를 수 있어, 늦게 온
    // 이전 조회 결과가 최신 결과를 덮어쓸 수 있다(페이지를 넘긴 직후 필터를 걸면 재현된다).
    // 그래서 요청마다 번호를 매기고, 돌아왔을 때 최신 요청이 아니면 결과를 버린다.
    const requestId = questionRequestRef.current + 1
    questionRequestRef.current = requestId
    const isStale = () => questionRequestRef.current !== requestId

    const plan = buildQuestionQueryPlan(f, page, QUESTION_PAGE_SIZE)

    let query = supabase.from(QUESTION_SEARCH_VIEW).select('*', { count: 'exact' })
    if (plan.or) query = query.or(plan.or)
    for (const filter of plan.filters) {
      switch (filter.op) {
        case 'eq': query = query.eq(filter.column, filter.value); break
        case 'isNull': query = query.is(filter.column, null); break
        case 'ilike': query = query.ilike(filter.column, filter.pattern); break
        case 'gte': query = query.gte(filter.column, filter.value); break
        case 'lte': query = query.lte(filter.column, filter.value); break
      }
    }
    // 정렬이 완전해야(마지막 키가 유일값 id) 페이지를 넘길 때 행이 빠지거나 겹치지 않는다.
    for (const key of plan.order) {
      query = query.order(key.column, { ascending: key.ascending, nullsFirst: key.nullsFirst })
    }

    const { data, error, count } = await query.range(plan.from, plan.to)
    if (isStale()) return
    if (error) {
      setQuestionRows([])
      setQuestionTotal(0)
      setQuestionError(`질문을 불러올 수 없습니다. ${QUESTION_VIEW_HINT}`)
      return
    }
    const total = count ?? 0
    setQuestionError(null)
    setQuestionTotal(total)
    setQuestionRows(((data ?? []) as unknown as QuestionSearchRow[]).map(toQuestionWithReview))

    // 후기를 지워 결과가 줄면 보고 있던 페이지가 범위를 벗어날 수 있다. 그때는 마지막 페이지로
    // 당긴다(페이지가 바뀌면 조회 effect가 다시 돌아 실제 행을 채운다).
    const valid = clampPage(page, total, QUESTION_PAGE_SIZE)
    if (valid !== page) setQuestionPage(valid)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * 필터 후보(발주처·시설용도·연도)와 전체 질문 수.
   * 후보는 현재 페이지가 아니라 전체 데이터 기준이어야 한다 — 페이지마다 후보가 달라지면 필터를
   * 쓸 수 없다. 발주처/시설용도는 마스터가 없는 자유 입력이라 실제 값에서 뽑는다(집계 view).
   */
  const loadQuestionFacets = useCallback(async (): Promise<void> => {
    const [facetRes, totalRes] = await Promise.all([
      supabase.from(QUESTION_FACETS_VIEW).select('facet, value, question_count').order('question_count', { ascending: false }),
      supabase.from(QUESTION_SEARCH_VIEW).select('id', { count: 'exact', head: true }),
    ])
    if (!facetRes.error) {
      setQuestionOptions(buildFilterOptionsFromFacets((facetRes.data ?? []) as unknown as QuestionFacetRow[]))
    }
    if (!totalRes.error) setQuestionTotalAll(totalRes.count ?? 0)
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
      const [, missingMasters] = await Promise.all([loadReviews(), loadMasters()])
      if (cancelled) return
      if (missingMasters.length > 0) {
        setLoadError(
          `${missingMasters.join(' · ')} 목록을 불러올 수 없어 후기 등록/수정이 불가합니다. ${MIGRATION_HINT}`,
        )
      }
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [loadReviews, loadMasters])

  /**
   * 검색어·발주처·시설용도는 타이핑 중이므로 300ms 뒤에 적용하고, select 필터는 곧바로 적용한다.
   * 조건이 바뀌면 페이지를 1로 되돌린다(3페이지를 보던 중 조건을 좁히면 빈 페이지가 되기 때문).
   */
  useEffect(() => {
    if (questionFilter === appliedQuestionFilter) return
    const typing =
      questionFilter.search !== appliedQuestionFilter.search ||
      questionFilter.clientQuery !== appliedQuestionFilter.clientQuery ||
      questionFilter.facilityQuery !== appliedQuestionFilter.facilityQuery
    const timer = setTimeout(() => {
      setAppliedQuestionFilter(questionFilter)
      setQuestionPage(1)
    }, typing ? 300 : 0)
    return () => clearTimeout(timer)
  }, [questionFilter, appliedQuestionFilter])

  /** 질의 탭을 열었을 때(그리고 저장/삭제 후) 필터 후보와 전체 건수를 읽는다. */
  useEffect(() => {
    if (tab !== 'questions') return
    void (async () => { await loadQuestionFacets() })()
  }, [tab, questionReloadKey, loadQuestionFacets])

  /** 조건·페이지가 바뀔 때마다 그 페이지만 조회한다. */
  useEffect(() => {
    if (tab !== 'questions') return
    let cancelled = false
    void (async () => {
      setQuestionsLoading(true)
      await loadQuestionPage(appliedQuestionFilter, questionPage)
      if (!cancelled) setQuestionsLoading(false)
    })()
    return () => { cancelled = true }
  }, [tab, appliedQuestionFilter, questionPage, questionReloadKey, loadQuestionPage])

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
    await loadReviews()
    setQuestionReloadKey(k => k + 1)
    showToast('삭제했습니다.')
  }

  async function handleSaved(reviewId: string) {
    await loadReviews()
    setQuestionReloadKey(k => k + 1)
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
            // 마스터(평가유형·질의그룹·질의분류)를 읽기 전에 열면 select가 빈 상태로 뜨고, 첫 질의그룹이
            // 선택되지 않은 채 시작된다. 로딩 중에는 열지 못하게 막는다.
            <button
              onClick={() => setFormTarget({ review: null })}
              disabled={loading}
              style={loading ? { ...outlineBtn, color: '#bbb', cursor: 'default' } : outlineBtn}
            >
              면접후기 등록
            </button>
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
            questions={questionRows}
            total={questionTotal}
            totalAll={questionTotalAll}
            page={questionPage}
            pageSize={QUESTION_PAGE_SIZE}
            onPageChange={setQuestionPage}
            loading={questionsLoading}
            error={questionError}
            options={questionOptions}
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
