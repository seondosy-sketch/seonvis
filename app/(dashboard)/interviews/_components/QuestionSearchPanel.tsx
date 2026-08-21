'use client'

import { useMemo } from 'react'
import {
  ALL,
  EMPTY_FILTER,
  UNSET,
  hasActiveFilter,
  splitUnspecifiedOption,
  type QuestionFilterOptions,
  type QuestionFilterState,
} from '@/lib/evaluations/questionFilters'
import { totalPages } from '@/lib/evaluations/questionQuery'
import { questionTagLabel } from '@/lib/evaluations/questionGroups'
import type {
  EvaluationQuestionCategory,
  EvaluationRole,
  EvaluationType,
  QuestionWithReview,
} from '@/lib/evaluations/types'

/**
 * 질의 탭 — 후기에 입력된 질문을 질문 단위로 검색/분류해서 보여준다.
 * 별도의 질문 복제 테이블을 보지 않는다: 여기 나오는 행은 evaluation_questions 그 자체다.
 *
 * 검색축 7개(복수 동시): 전체검색 · 평가유형 · 질의그룹 · 질의분류 · 발주처 · 시설용도 · 연도.
 * 전문분야 필터는 두지 않는다 — 질의그룹이 분야 의미를 이미 담고 있어서 뜻이 겹치는 필터를
 * 사용자에게 두 개 보여주지 않는다(전문분야는 legacy 전용 컬럼으로만 남는다).
 *
 * 이 컴포넌트는 걸러진 결과를 **받아서 그리기만** 한다. 필터·정렬·페이지네이션은 DB가 처리한다
 * (lib/evaluations/questionQuery.ts). 예전처럼 질문 전체를 받아 여기서 거르면 PostgREST의
 * 1,000행 응답 상한 때문에 그 뒤 질문이 검색되지 않는다.
 */
interface QuestionSearchPanelProps {
  /** 현재 페이지에 보여줄 질문(이미 필터·정렬된 상태). */
  questions: QuestionWithReview[]
  /** 필터를 적용한 총 결과 수 — DB의 exact count. */
  total: number
  /** 필터 없는 전체 질문 수 — "등록된 질문이 없습니다"와 "조건에 맞는 질문이 없습니다"를 가른다. */
  totalAll: number
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  loading: boolean
  error: string | null
  /** 발주처·시설용도·연도 후보 — 전체 데이터 기준(현재 페이지에 종속되지 않는다). */
  options: QuestionFilterOptions
  evaluationTypes: EvaluationType[]
  roles: EvaluationRole[]
  categories: EvaluationQuestionCategory[]
  filter: QuestionFilterState
  onFilterChange: (next: QuestionFilterState) => void
  isMobile: boolean
  /** 질문을 클릭하면 그 질문이 나온 후기 상세를 연다. */
  onOpenReview: (reviewId: string, questionId: string) => void
}

export default function QuestionSearchPanel({
  questions, total, totalAll, page, pageSize, onPageChange, loading, error, options,
  evaluationTypes, roles, categories, filter, onFilterChange, isMobile, onOpenReview,
}: QuestionSearchPanelProps) {
  const typeNameById = useMemo(() => new Map(evaluationTypes.map(t => [t.id, t.name])), [evaluationTypes])
  const roleNameById = useMemo(() => new Map(roles.map(r => [r.id, r.name])), [roles])
  const categoryNameById = useMemo(() => new Map(categories.map(c => [c.id, c.name])), [categories])

  // 마스터에도 `미지정` 행이 있어서, 그대로 그리면 아래 "미지정"(값이 비어 있음) 칸과 겹쳐
  // 사용자에게 같은 이름이 두 번 보였다. 마스터의 `미지정`은 목록에서 빼고, 하나로 합친
  // `미지정` 칸이 마스터 미지정 + NULL을 함께 찾는다(questionFilters.ts UNSPECIFIED_NAME).
  const typeOptions = useMemo(() => splitUnspecifiedOption(evaluationTypes).options, [evaluationTypes])
  const roleOptions = useMemo(() => splitUnspecifiedOption(roles).options, [roles])
  const categoryOptions = useMemo(() => splitUnspecifiedOption(categories).options, [categories])

  const pageCount = totalPages(total, pageSize)
  const firstIndex = total === 0 ? 0 : (page - 1) * pageSize + 1
  const lastIndex = Math.min(page * pageSize, total)

  function set<K extends keyof QuestionFilterState>(key: K, value: QuestionFilterState[K]) {
    onFilterChange({ ...filter, [key]: value })
  }

  return (
    <div>
      <div style={filterBox}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          <div style={{ flex: isMobile ? '1 1 100%' : '2 1 240px' }}>
            <FilterLabel>전체검색</FilterLabel>
            <input
              style={inp}
              value={filter.search}
              onChange={e => set('search', e.target.value)}
              placeholder="질문 내용 · 용역명 · 발주처 · 시설용도"
            />
          </div>

          <div style={{ flex: '1 1 130px' }}>
            <FilterLabel>평가유형</FilterLabel>
            <select style={inp} value={filter.evaluationTypeId} onChange={e => set('evaluationTypeId', e.target.value as QuestionFilterState['evaluationTypeId'])}>
              <option value={ALL}>전체</option>
              {typeOptions.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              <option value={UNSET}>미지정</option>
            </select>
          </div>

          <div style={{ flex: '1 1 120px' }}>
            <FilterLabel>질의그룹</FilterLabel>
            <select style={inp} value={filter.groupId} onChange={e => set('groupId', e.target.value as QuestionFilterState['groupId'])}>
              <option value={ALL}>전체</option>
              {roleOptions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              <option value={UNSET}>미지정</option>
            </select>
          </div>

          <div style={{ flex: '1 1 130px' }}>
            <FilterLabel>질의분류</FilterLabel>
            <select style={inp} value={filter.categoryId} onChange={e => set('categoryId', e.target.value as QuestionFilterState['categoryId'])}>
              <option value={ALL}>전체</option>
              {categoryOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              <option value={UNSET}>미지정</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 200px' }}>
            <FilterLabel>발주처</FilterLabel>
            <input
              style={inp}
              list="question-client-options"
              value={filter.clientQuery}
              onChange={e => set('clientQuery', e.target.value)}
              placeholder="예: 한국전력공사 (산하 본부·지사 포함)"
            />
            <datalist id="question-client-options">
              {options.clients.map(c => <option key={c} value={c} />)}
            </datalist>
          </div>

          <div style={{ flex: '1 1 170px' }}>
            <FilterLabel>시설용도</FilterLabel>
            <input
              style={inp}
              list="question-facility-options"
              value={filter.facilityQuery}
              onChange={e => set('facilityQuery', e.target.value)}
              placeholder="예: 변전소"
            />
            <datalist id="question-facility-options">
              {options.facilities.map(f => <option key={f} value={f} />)}
            </datalist>
          </div>

          <div style={{ flex: '0 1 190px' }}>
            <FilterLabel>연도</FilterLabel>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <select style={inp} value={filter.yearFrom} onChange={e => set('yearFrom', e.target.value)}>
                <option value="">처음</option>
                {options.years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
              <span style={{ fontSize: 11, color: '#999' }}>~</span>
              <select style={inp} value={filter.yearTo} onChange={e => set('yearTo', e.target.value)}>
                <option value="">최근</option>
                {options.years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: '#888' }}>
            {/* 건수는 현재 페이지가 아니라 DB가 센 전체 결과 수다. */}
            검색결과 {total.toLocaleString()}건
            {total > 0 && ` (${firstIndex.toLocaleString()}~${lastIndex.toLocaleString()} 표시)`}
            {total !== totalAll && ` / 전체 ${totalAll.toLocaleString()}건`}
            {loading && ' · 조회 중...'}
          </span>
          {hasActiveFilter(filter) && (
            <button onClick={() => onFilterChange(EMPTY_FILTER)} style={miniBtn}>필터 초기화</button>
          )}
        </div>
      </div>

      {error && <div style={errorBox}>{error}</div>}

      {questions.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#bbb', fontSize: 13 }}>
          {loading
            ? '불러오는 중...'
            : totalAll === 0
              ? '등록된 질문이 없습니다. 면접후기에 실제 질문을 입력하면 여기에서 검색됩니다.'
              : '조건에 맞는 질문이 없습니다.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {questions.map(q => (
            <div
              key={q.id}
              onClick={() => onOpenReview(q.review_id, q.id)}
              style={resultCard}
              title="이 질문이 나온 후기 보기"
            >
              <div style={{ fontSize: 13, color: '#111', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{q.question_text}</div>
              <div style={{ fontSize: 11, color: '#888', marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {/* 질의그룹 · 질의분류 — 질문의 핵심 분류 두 축을 한눈에 */}
                <span style={groupTag}>
                  {questionTagLabel(
                    q.role_id ? roleNameById.get(q.role_id) : null,
                    q.category_id ? categoryNameById.get(q.category_id) : null,
                  )}
                </span>
                {q.review.client_snapshot && <span>{q.review.client_snapshot}</span>}
                {q.review.project_name_snapshot && <span>{q.review.project_name_snapshot}</span>}
                {q.review.evaluation_type_id && typeNameById.get(q.review.evaluation_type_id) && (
                  <span style={typeTag}>{typeNameById.get(q.review.evaluation_type_id)}</span>
                )}
                {q.review.facility_type && <span>{q.review.facility_type}</span>}
                {/* 실제 평가일이 있으면 날짜까지, 연도만 아는 legacy 자료면 "2015년"으로 적는다. */}
                {q.review.evaluation_date
                  ? <span>{q.review.evaluation_date.replace(/-/g, '.')}</span>
                  : q.review.evaluation_year_effective !== null && <span>{q.review.evaluation_year_effective}년</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 페이지 이동 — 결과가 한 페이지에 다 들어가면 굳이 보여주지 않는다. */}
      {pageCount > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, marginTop: 14 }}>
          <button
            style={page <= 1 ? pageBtnDisabled : pageBtn}
            disabled={page <= 1 || loading}
            onClick={() => onPageChange(page - 1)}
          >
            이전
          </button>
          <span style={{ fontSize: 12, color: '#555' }}>
            {page.toLocaleString()} / {pageCount.toLocaleString()}
          </span>
          <button
            style={page >= pageCount ? pageBtnDisabled : pageBtn}
            disabled={page >= pageCount || loading}
            onClick={() => onPageChange(page + 1)}
          >
            다음
          </button>
        </div>
      )}
    </div>
  )
}

function FilterLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, color: '#888', marginBottom: 3 }}>{children}</div>
}

const filterBox: React.CSSProperties = { background: '#fff', border: '1px solid #e8e8e6', borderRadius: 8, padding: 12, marginBottom: 12 }
const inp: React.CSSProperties = { width: '100%', border: '1px solid #e8e8e6', borderRadius: 6, padding: '7px 9px', fontSize: 12, color: '#111', fontFamily: 'inherit', boxSizing: 'border-box' }
const miniBtn: React.CSSProperties = { border: '1px solid #e8e8e6', background: '#fff', borderRadius: 4, padding: '4px 9px', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' }
const resultCard: React.CSSProperties = { background: '#fff', border: '1px solid #e8e8e6', borderRadius: 8, padding: '11px 13px', cursor: 'pointer' }
const groupTag: React.CSSProperties = { color: '#0369a1', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 3, padding: '1px 5px', fontWeight: 600 }
const typeTag: React.CSSProperties = { color: '#7c3aed', background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 3, padding: '1px 5px', fontWeight: 600 }
const pageBtn: React.CSSProperties = { border: '1px solid #e8e8e6', background: '#fff', borderRadius: 6, padding: '6px 14px', fontSize: 12, cursor: 'pointer', color: '#333' }
const pageBtnDisabled: React.CSSProperties = { ...pageBtn, color: '#ccc', cursor: 'default' }
const errorBox: React.CSSProperties = { marginBottom: 12, padding: '8px 12px', borderRadius: 6, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 12 }
