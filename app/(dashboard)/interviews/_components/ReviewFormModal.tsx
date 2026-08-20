'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { evaluationReviewErrorMessage } from '@/lib/evaluations/errors'
import {
  buildExtraAttendees,
  buildParticipantRows,
  countAttendees,
  newExtraAttendee,
  participantShortLabel,
  rowsForNewProject,
  toAttendeePayloads,
  type ExtraAttendeeDraft,
  type ParticipantRef,
  type ParticipantRow,
} from '@/lib/evaluations/attendees'
import {
  applyProjectSelection,
  canReloadFromProject,
  initialOwnership,
  markEdited,
  preservedNotice,
  reloadFromProject,
  type AutofillOwnership,
} from '@/lib/evaluations/projectAutofill'
import {
  countValidQuestions,
  groupLabel,
  groupOptionsForSelect,
  hasDuplicateGroups,
  newQuestionDraft,
  newQuestionGroup,
  nextAvailableGroup,
  toQuestionGroupDrafts,
  toQuestionPayloads,
  type QuestionGroupDraft,
} from '@/lib/evaluations/questionGroups'
import type {
  EvaluationQuestionCategory,
  EvaluationRole,
  EvaluationType,
  ReviewDetail,
  ReviewSavePayload,
} from '@/lib/evaluations/types'
import type { InterviewEngineerRef, InterviewProjectRef } from '../types'

interface ReviewFormModalProps {
  /** null = 신규 작성 */
  review: ReviewDetail | null
  projects: InterviewProjectRef[]
  engineers: InterviewEngineerRef[]
  roles: EvaluationRole[]
  categories: EvaluationQuestionCategory[]
  evaluationTypes: EvaluationType[]
  /** 시설용도 입력칸 추천 목록 — 기존에 입력된 값들(자유 입력이라 고정 목록이 없다). */
  facilitySuggestions: string[]
  currentUserEmail: string
  onClose: () => void
  onSaved: (reviewId: string) => void
}

export default function ReviewFormModal({
  review, projects, engineers, roles, categories, evaluationTypes, facilitySuggestions,
  currentUserEmail, onClose, onSaved,
}: ReviewFormModalProps) {
  const supabase = createSupabaseBrowserClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ── 기본정보 ────────────────────────────────────────────────────────────────
  const [projectId, setProjectId] = useState<string | null>(review?.project_id ?? null)
  const [projectQuery, setProjectQuery] = useState(review?.project_name_snapshot ?? '')
  const [projectDropdownOpen, setProjectDropdownOpen] = useState(false)

  const [evaluationTypeId, setEvaluationTypeId] = useState<string>(review?.evaluation_type_id ?? '')
  const [client, setClient] = useState(review?.client_snapshot ?? '')
  const [projectName, setProjectName] = useState(review?.project_name_snapshot ?? '')
  const [facilityType, setFacilityType] = useState(review?.facility_type ?? '')
  const [evaluationDate, setEvaluationDate] = useState(review?.evaluation_date ?? '')
  const [evaluationTime, setEvaluationTime] = useState(review?.evaluation_time ?? '')
  const [location, setLocation] = useState(review?.location ?? '')
  const [evaluatorCount, setEvaluatorCount] = useState(review?.evaluator_count?.toString() ?? '')
  const [companyCount, setCompanyCount] = useState(review?.participant_company_count?.toString() ?? '')
  const [presentationOrder, setPresentationOrder] = useState(review?.presentation_order?.toString() ?? '')
  const [companies, setCompanies] = useState(review?.participant_companies ?? '')
  const [method, setMethod] = useState(review?.evaluation_method ?? '')
  const [notes, setNotes] = useState(review?.special_notes ?? '')

  /**
   * 발주처·평가일의 소유자(자동입력 vs 사용자 입력). 프로젝트를 바꿀 때 무엇을 갈아끼우고 무엇을
   * 보존할지 이 값으로 결정한다 — 규칙은 lib/evaluations/projectAutofill.ts에 있다.
   */
  const [autofill, setAutofill] = useState<AutofillOwnership>(() => initialOwnership({
    client: review?.client_snapshot ?? '',
    evaluationDate: review?.evaluation_date ?? '',
  }))
  /** 프로젝트를 바꿀 때 사용자 값을 유지했음을 한 번 알려주는 문구. */
  const [autofillNotice, setAutofillNotice] = useState<string | null>(null)

  // ── 참석 기술인 (Project List 참여기술인 연동) ───────────────────────────────
  const [rows, setRows] = useState<ParticipantRow[]>([])
  const [extras, setExtras] = useState<ExtraAttendeeDraft[]>([])
  const [participantsBusy, setParticipantsBusy] = useState(false)
  const [participantsError, setParticipantsError] = useState<string | null>(null)
  const [extraDropdown, setExtraDropdown] = useState<string | null>(null)
  /** 최초 1회 로드에서만 저장된 참석자로 체크 상태를 복원한다(이후 프로젝트 변경은 초기화). */
  const restoreSavedRef = useRef(true)

  // ── 실제 질의 ───────────────────────────────────────────────────────────────
  const unspecifiedCategoryId = useMemo(
    () => categories.find(c => c.code === 'unspecified')?.id ?? null,
    [categories],
  )
  /**
   * 질의그룹 초기값. 이 모달은 페이지가 마스터를 다 읽은 뒤에만 열리므로(로딩 중에는 등록 버튼이
   * 없다) 첫 렌더에 roles/categories가 이미 채워져 있다 — 그래서 effect로 나중에 채우지 않고
   * 초기값에서 바로 결정한다(effect 안 setState는 연쇄 렌더를 만든다).
   * 신규 작성이면 첫 그룹을 '책임'(sort_order가 가장 앞선 그룹)으로 열어둔다.
   */
  const [groups, setGroups] = useState<QuestionGroupDraft[]>(() => {
    if (review && review.questions.length > 0) return toQuestionGroupDrafts(review.questions)
    const first = nextAvailableGroup(roles, [])
    const defaultCategory = categories.find(c => c.code === 'unspecified')?.id ?? null
    return [newQuestionGroup(first?.id ?? null, defaultCategory)]
  })

  const roleNameById = useMemo(() => new Map(roles.map(r => [r.id, r.name])), [roles])
  const activeCategories = useMemo(() => categories.filter(c => c.is_active), [categories])

  const projectOptions = useMemo(() => {
    const q = projectQuery.trim().toLowerCase()
    return projects
      .filter(p => p.status !== '취소')
      .filter(p => !q || p.name.toLowerCase().includes(q) || p.project_number.toLowerCase().includes(q))
      .slice(0, 30)
  }, [projects, projectQuery])

  /**
   * 선택한 프로젝트의 참여기술인을 읽어 체크박스 목록을 만든다.
   * projects → project_participants → engineer_contacts / engineer_specialties 를 그대로 쓴다
   * (기술인 master를 새로 만들지 않는다).
   *
   * 프로젝트가 바뀌면 이전 프로젝트의 체크가 남지 않도록 rowsForNewProject로 갈아끼운다.
   */
  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!projectId) {
        if (cancelled) return
        setRows([])
        // 프로젝트 미연결 legacy 기록을 열었을 때는 저장된 참석자 전원을 기타 참석자로 편집한다.
        if (restoreSavedRef.current) {
          setExtras(buildExtraAttendees(review?.attendees ?? [], []))
          restoreSavedRef.current = false
        }
        return
      }

      setParticipantsBusy(true)
      setParticipantsError(null)
      const { data, error: err } = await supabase
        .from('project_participants')
        .select('engineer_id, role, is_director, sort_order, engineer:engineer_contacts(id, name), specialty:engineer_specialties(name)')
        .eq('project_id', projectId)
        .order('sort_order', { ascending: true })

      if (cancelled) return
      setParticipantsBusy(false)

      if (err) {
        setParticipantsError('참여기술인을 불러올 수 없습니다.')
        setRows([])
        return
      }

      type Row = {
        engineer_id: string
        role: string | null
        is_director: boolean
        sort_order: number
        engineer: { id: string; name: string } | null
        specialty: { name: string } | null
      }
      const list: ParticipantRef[] = ((data ?? []) as unknown as Row[])
        .filter(r => r.engineer)
        .map(r => ({
          engineer_contact_id: r.engineer!.id,
          name: r.engineer!.name,
          role: r.role ?? '',
          specialty_name: r.specialty?.name ?? null,
          is_director: r.is_director,
          sort_order: r.sort_order,
        }))

      if (restoreSavedRef.current) {
        setRows(buildParticipantRows(list, review?.attendees ?? []))
        setExtras(buildExtraAttendees(review?.attendees ?? [], list))
        restoreSavedRef.current = false
      } else {
        setRows(rowsForNewProject(list))
      }
    })()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  /** 지금 연결된 프로젝트 — "다시 불러오기"의 원본값이다. */
  const selectedProject = useMemo(
    () => projects.find(p => p.id === projectId) ?? null,
    [projects, projectId],
  )

  /**
   * 프로젝트를 고르면 Project List에 실제로 있는 값을 채운다 — 용역명(name), 발주처(client),
   * 평가일(interview_date). 시설용도는 projects에 대응 컬럼이 없어 사용자가 직접 입력한다.
   *
   * 용역명은 항상 새 프로젝트명으로 바꾸고, 발주처·평가일은 자동입력으로 채워진 값일 때만
   * 갈아끼운다(사용자가 직접 고친 값은 보존). 규칙은 lib/evaluations/projectAutofill.ts 참고.
   * 참여기술인은 projectId가 바뀌면 위 effect가 새 프로젝트 기준으로 다시 읽는다.
   */
  function selectProject(p: InterviewProjectRef) {
    const result = applyProjectSelection(
      { projectName, client, evaluationDate },
      autofill,
      p,
    )
    setProjectId(p.id)
    setProjectQuery(p.name)
    setProjectName(result.values.projectName)
    setClient(result.values.client)
    setEvaluationDate(result.values.evaluationDate)
    setAutofill(result.ownership)
    setAutofillNotice(preservedNotice(result.preserved))
    setProjectDropdownOpen(false)
  }

  /** 사용자가 직접 고친 발주처·평가일을 프로젝트 원본값으로 되돌린다. */
  function reloadProjectInfo() {
    if (!selectedProject) return
    const result = reloadFromProject(selectedProject)
    setProjectName(result.values.projectName)
    setProjectQuery(result.values.projectName)
    setClient(result.values.client)
    setEvaluationDate(result.values.evaluationDate)
    setAutofill(result.ownership)
    setAutofillNotice(null)
  }

  function updateClient(value: string) {
    setClient(value)
    setAutofill(prev => markEdited(prev, 'client', value))
    setAutofillNotice(null)
  }

  function updateEvaluationDate(value: string) {
    setEvaluationDate(value)
    setAutofill(prev => markEdited(prev, 'evaluationDate', value))
    setAutofillNotice(null)
  }

  function clearProject() {
    setProjectId(null)
    setProjectQuery('')
    setProjectDropdownOpen(false)
    setAutofillNotice(null)
  }

  function toggleRow(engineerId: string) {
    setRows(prev => prev.map(r => (r.engineer_contact_id === engineerId ? { ...r, checked: !r.checked } : r)))
  }

  function updateExtra(key: string, patch: Partial<ExtraAttendeeDraft>) {
    setExtras(prev => prev.map(x => (x.key === key ? { ...x, ...patch } : x)))
  }

  function engineerOptions(query: string): InterviewEngineerRef[] {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return engineers.filter(e => e.name.toLowerCase().includes(q)).slice(0, 8)
  }

  // ── 질의그룹 편집 ───────────────────────────────────────────────────────────
  function addGroup() {
    const next = nextAvailableGroup(roles, groups)
    if (!next) return
    setGroups(prev => [...prev, newQuestionGroup(next.id, unspecifiedCategoryId)])
  }

  function updateGroupRole(key: string, roleId: string | null) {
    setGroups(prev => prev.map(g => (g.key === key ? { ...g, role_id: roleId } : g)))
  }

  function updateQuestion(groupKey: string, questionKey: string, patch: { text?: string; category_id?: string | null }) {
    setGroups(prev => prev.map(g => (
      g.key === groupKey
        ? { ...g, questions: g.questions.map(q => (q.key === questionKey ? { ...q, ...patch } : q)) }
        : g
    )))
  }

  function addQuestion(groupKey: string) {
    setGroups(prev => prev.map(g => (
      g.key === groupKey ? { ...g, questions: [...g.questions, newQuestionDraft(unspecifiedCategoryId)] } : g
    )))
  }

  function removeQuestion(groupKey: string, questionKey: string) {
    setGroups(prev => prev.map(g => {
      if (g.key !== groupKey) return g
      const next = g.questions.filter(q => q.key !== questionKey)
      // 질문칸이 하나도 없으면 그룹이 아무것도 못 받는 상태가 되므로 빈 칸 하나는 남긴다.
      return { ...g, questions: next.length > 0 ? next : [newQuestionDraft(unspecifiedCategoryId)] }
    }))
  }

  const validQuestionCount = countValidQuestions(groups)
  const attendeeCount = countAttendees(rows, extras)
  const canAddGroup = nextAvailableGroup(roles, groups) !== null
  /** 마스터를 못 읽으면(migration 미적용 등) 저장 자체가 불가능하다 — 조용히 넘기지 않는다. */
  const mastersMissing = evaluationTypes.length === 0 || roles.length === 0 || categories.length === 0

  async function handleSave() {
    if (busy || mastersMissing) return
    setError(null)

    if (!evaluationTypeId) {
      setError('평가유형을 선택해주세요.')
      return
    }
    if (!projectName.trim() && !client.trim()) {
      setError('용역명 또는 발주처 중 하나는 입력해야 합니다.')
      return
    }
    if (hasDuplicateGroups(groups)) {
      setError('같은 질의그룹이 두 번 있습니다. 하나로 합쳐주세요.')
      return
    }

    const reviewPayload: ReviewSavePayload = {
      project_id: projectId,
      evaluation_type_id: evaluationTypeId,
      // 신규 입력은 마스터에서 고르므로 legacy 원문 칸은 기존 값을 그대로 둔다(신규는 빈 문자열).
      evaluation_type_source: review?.evaluation_type_source ?? '',
      client_snapshot: client.trim(),
      project_name_snapshot: projectName.trim(),
      facility_type: facilityType.trim(),
      evaluation_date: evaluationDate || null,
      // 신규 입력 화면은 실제 평가일만 받는다 — legacy 연도 칸은 이관 전용이라 입력을 요구하지 않는다.
      evaluation_year: review?.evaluation_year ?? null,
      evaluation_time: evaluationTime.trim(),
      location: location.trim(),
      evaluator_count: evaluatorCount === '' ? null : Number(evaluatorCount),
      participant_company_count: companyCount === '' ? null : Number(companyCount),
      presentation_order: presentationOrder === '' ? null : Number(presentationOrder),
      participant_companies: companies.trim(),
      evaluation_method: method,
      special_notes: notes,
    }

    setBusy(true)
    try {
      // 기록 + 참석자 + 질문을 한 트랜잭션으로 저장한다(중간에 실패하면 전부 취소).
      // 저장 버튼은 busy 동안 disabled — 같은 기록이 두 번 만들어지는 것을 막는다.
      const { data, error: err } = await supabase.rpc('save_evaluation_review', {
        p_review_id: review?.id ?? null,
        p_review: reviewPayload,
        p_attendees: toAttendeePayloads(rows, extras),
        p_questions: toQuestionPayloads(groups),
        p_actor: currentUserEmail,
      })

      if (err) {
        setError(evaluationReviewErrorMessage('save', err.code))
        return
      }

      const savedId = (data as { id: string } | null)?.id ?? review?.id
      if (savedId) onSaved(savedId)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const activeTypes = evaluationTypes.filter(t => t.is_active || t.id === evaluationTypeId)

  return (
    <div style={overlay} onClick={busy ? undefined : onClose}>
      <div style={panel} onClick={e => e.stopPropagation()}>
        <div style={panelHeader}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{review ? '면접후기 수정' : '면접후기 등록'}</span>
          <button onClick={onClose} disabled={busy} style={closeBtn}>✕</button>
        </div>

        <div style={panelBody}>
          {mastersMissing && (
            <div style={errorBox}>
              평가유형·질의그룹·질의분류 목록을 불러오지 못해 후기를 저장할 수 없습니다.
              <br />supabase/migration_evaluation_db.sql이 적용되었는지 확인하세요.
            </div>
          )}
          {error && <div style={errorBox}>{error}</div>}

          {/* ── 기본정보 ── */}
          <SectionTitle>기본정보</SectionTitle>

          <Field label="프로젝트">
            <div style={{ position: 'relative' }}>
              <input
                style={inp}
                value={projectQuery}
                placeholder="용역명 또는 공사번호로 검색 (선택)"
                onChange={e => { setProjectQuery(e.target.value); setProjectDropdownOpen(true) }}
                onFocus={() => setProjectDropdownOpen(true)}
              />
              {projectId && (
                <button onClick={clearProject} style={{ ...miniBtn, position: 'absolute', right: 6, top: 6 }}>연결 해제</button>
              )}
              {projectDropdownOpen && projectOptions.length > 0 && (
                <div style={dropdown}>
                  {projectOptions.map(p => (
                    <div key={p.id} onClick={() => selectProject(p)} style={dropdownItem}>
                      <span style={{ color: '#999', marginRight: 6 }}>{p.project_number}</span>
                      {p.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={hint}>
              프로젝트를 고르면 발주처·용역명·평가일과 <strong>참여기술인 목록</strong>을 Project List에서 가져옵니다.
              프로젝트를 바꾸면 자동으로 채워진 값은 새 프로젝트 값으로 바뀌고, 직접 고친 발주처·평가일은
              그대로 유지됩니다. 한 프로젝트에 SOQ·TP·면접 등 후기를 여러 건 등록할 수 있습니다.
            </div>
            {/* 직접 고친 값이 프로젝트 원본과 다를 때만 되돌릴 수단을 준다. */}
            {canReloadFromProject({ client, evaluationDate }, autofill, selectedProject) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                <button onClick={reloadProjectInfo} style={miniBtn}>프로젝트 정보 다시 불러오기</button>
                <span style={{ fontSize: 11, color: '#888' }}>발주처·평가일을 프로젝트 값으로 되돌립니다.</span>
              </div>
            )}
            {autofillNotice && (
              <div style={{ fontSize: 11, color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 4, padding: '5px 8px', marginTop: 4 }}>
                {autofillNotice}
              </div>
            )}
          </Field>

          <Row>
            <Field label="평가유형 *">
              <select
                style={inp}
                value={evaluationTypeId}
                onChange={e => setEvaluationTypeId(e.target.value)}
                disabled={activeTypes.length === 0}
              >
                <option value="">{activeTypes.length === 0 ? '목록을 불러오지 못했습니다' : '선택하세요'}</option>
                {activeTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
            <Field label="시설용도">
              <input
                style={inp}
                list="evaluation-facility-suggestions"
                value={facilityType}
                onChange={e => setFacilityType(e.target.value)}
                placeholder="변전소 / 공동주택 / 군시설 ..."
              />
              <datalist id="evaluation-facility-suggestions">
                {facilitySuggestions.map(f => <option key={f} value={f} />)}
              </datalist>
            </Field>
          </Row>

          <Field label="발주처">
            <input style={inp} value={client} onChange={e => updateClient(e.target.value)} placeholder="한국전력공사 경인건설본부 경기건설지사" />
          </Field>

          <Field label="용역명">
            <input style={inp} value={projectName} onChange={e => setProjectName(e.target.value)} />
          </Field>

          <Row>
            <Field label="평가일">
              <input style={inp} type="date" value={evaluationDate} onChange={e => updateEvaluationDate(e.target.value)} />
            </Field>
            <Field label="시간">
              <input style={inp} value={evaluationTime} onChange={e => setEvaluationTime(e.target.value)} placeholder="13:30~" />
            </Field>
          </Row>

          {review?.evaluation_year !== null && review?.evaluation_year !== undefined && !review?.evaluation_date && (
            <div style={hint}>
              이 기록은 과거 자료라 <strong>{review.evaluation_year}년</strong>만 확인됐고 월·일은 원본에 없습니다.
              실제 평가일을 아시면 위 평가일 칸에 입력하세요(연도가 다르면 저장되지 않습니다).
            </div>
          )}

          <Field label="장소">
            <input style={inp} value={location} onChange={e => setLocation(e.target.value)} placeholder="경기건설지사 5층 안전상황실" />
          </Field>

          <Row>
            <Field label="참가업체 수">
              <input style={inp} type="number" min={0} value={companyCount} onChange={e => setCompanyCount(e.target.value)} placeholder="7" />
            </Field>
            <Field label="발표/면접 순서">
              <input style={inp} type="number" min={0} value={presentationOrder} onChange={e => setPresentationOrder(e.target.value)} placeholder="1" />
            </Field>
            <Field label="면접관 수">
              <input style={inp} type="number" min={0} value={evaluatorCount} onChange={e => setEvaluatorCount(e.target.value)} placeholder="5" />
            </Field>
          </Row>

          <Field label="참가업체">
            <input style={inp} value={companies} onChange={e => setCompanies(e.target.value)} placeholder="업체명을 쉼표로 구분해 입력" />
          </Field>

          {/* ── 참석 기술인 ── */}
          <SectionTitle>참석 기술인</SectionTitle>
          {participantsError && <div style={errorBox}>{participantsError}</div>}

          {!projectId ? (
            <div style={{ fontSize: 12, color: '#999', padding: '6px 0' }}>
              프로젝트를 선택하면 그 프로젝트의 참여기술인이 여기에 표시됩니다. 프로젝트 없이 작성하는 경우
              아래 &ldquo;기타 참석자&rdquo;로 직접 입력하세요.
            </div>
          ) : participantsBusy ? (
            <div style={{ fontSize: 12, color: '#bbb', padding: '6px 0' }}>참여기술인 불러오는 중...</div>
          ) : rows.length === 0 ? (
            <div style={{ fontSize: 12, color: '#999', padding: '6px 0' }}>
              이 프로젝트에 등록된 참여기술인이 없습니다. 기술인 출근부에서 참여기술인을 등록하거나, 아래
              &ldquo;기타 참석자&rdquo;로 직접 입력하세요.
            </div>
          ) : (
            <div style={{ border: '1px solid #e8e8e6', borderRadius: 8, padding: '4px 0', background: '#fcfcfb' }}>
              {rows.map(r => (
                <label key={r.engineer_contact_id} style={participantRow}>
                  <input
                    type="checkbox"
                    checked={r.checked}
                    onChange={() => toggleRow(r.engineer_contact_id)}
                    style={{ cursor: 'pointer' }}
                  />
                  <span style={roleBadge}>{participantShortLabel(r)}</span>
                  <span style={{ fontSize: 12, color: '#111', fontWeight: r.checked ? 600 : 400 }}>{r.name}</span>
                  <span style={{ fontSize: 11, color: '#aaa', marginLeft: 'auto' }}>
                    {[r.role, r.specialty_name].filter(Boolean).join(' · ')}
                  </span>
                </label>
              ))}
            </div>
          )}

          <div style={{ fontSize: 11, color: '#888', margin: '8px 0 4px' }}>기타 참석자 (수행직원 등)</div>
          {extras.map(x => (
            <div key={x.key} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'flex-start' }}>
              <div style={{ position: 'relative', flex: 2 }}>
                <input
                  style={inp}
                  value={x.name}
                  placeholder="성명 (주소록 검색 또는 직접 입력)"
                  onChange={e => {
                    // 이름을 직접 고쳤으면 주소록 연결은 끊는다 — 다른 사람 이름에 남의 id가 붙는 것을 막는다.
                    updateExtra(x.key, { name: e.target.value, engineer_contact_id: null })
                    setExtraDropdown(x.key)
                  }}
                  onFocus={() => setExtraDropdown(x.key)}
                />
                {x.engineer_contact_id && <span style={linkedBadge}>주소록 연결</span>}
                {extraDropdown === x.key && engineerOptions(x.name).length > 0 && (
                  <div style={dropdown}>
                    {engineerOptions(x.name).map(e => (
                      <div
                        key={e.id}
                        onClick={() => { updateExtra(x.key, { name: e.name, engineer_contact_id: e.id }); setExtraDropdown(null) }}
                        style={dropdownItem}
                      >
                        {e.name}
                        <span style={{ color: '#999', marginLeft: 6 }}>{[e.rank, e.company].filter(Boolean).join(' · ')}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <input
                style={{ ...inp, flex: 1 }}
                value={x.role}
                placeholder="역할 (수행 등)"
                onChange={e => updateExtra(x.key, { role: e.target.value })}
              />
              <button onClick={() => setExtras(prev => prev.filter(v => v.key !== x.key))} style={miniBtn}>삭제</button>
            </div>
          ))}
          <button onClick={() => setExtras(prev => [...prev, newExtraAttendee()])} style={miniBtn}>+ 기타 참석자</button>

          {/* ── 진행방법 / 특이사항 ── */}
          <SectionTitle>진행방법</SectionTitle>
          <textarea
            style={{ ...inp, minHeight: 72, resize: 'vertical' }}
            value={method}
            onChange={e => setMethod(e.target.value)}
            placeholder={'예) PT 발표 후 책임기술인 및 분야별 기술인 질의응답\n기술인별 1분 자기소개\n각 2문항 6분 내 답변'}
          />
          <div style={hint}>평가유형(SOQ·TP·종심제 등)과 별개로, 실제로 어떻게 진행됐는지를 자유롭게 적습니다.</div>

          <SectionTitle>특이사항</SectionTitle>
          <textarea
            style={{ ...inp, minHeight: 56, resize: 'vertical' }}
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="분위기, 좌석배치 등"
          />

          {/* ── 실제 질의 ── */}
          <SectionTitle>실제 질의</SectionTitle>
          <div style={hint}>
            질문은 한 칸에 여러 개를 몰아 적지 말고 한 줄에 하나씩 입력하세요. 여기 입력한 질문이 그대로
            <strong> 질의 탭의 검색 대상</strong>이 됩니다.
            <br />
            <strong>질의그룹</strong>은 누구에게 나온 질문인지(책임/건축/안전/토목/기계/전기),
            <strong> 질의분류</strong>는 질문의 주제(공정/품질/안전 등)입니다 — 서로 다른 축입니다.
          </div>

          {groups.map(g => (
            <div key={g.key} style={groupBox}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: '#888' }}>질의그룹</span>
                <select
                  style={{ ...inp, width: 'auto', minWidth: 120, fontWeight: 600 }}
                  value={g.role_id ?? ''}
                  onChange={e => updateGroupRole(g.key, e.target.value || null)}
                >
                  <option value="">선택</option>
                  {groupOptionsForSelect(roles, groups, g.role_id).map(r => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
                <span style={{ fontSize: 11, color: '#bbb' }}>{groupLabel(g.role_id ? roleNameById.get(g.role_id) : null)}</span>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  <button onClick={() => addQuestion(g.key)} style={miniBtn}>+ 질문</button>
                  <button onClick={() => setGroups(prev => prev.filter(x => x.key !== g.key))} style={miniBtn}>그룹 삭제</button>
                </div>
              </div>

              {g.questions.map((q, qi) => (
                <div key={q.key} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 11, color: '#999', paddingTop: 9, minWidth: 22 }}>Q{qi + 1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <textarea
                      style={{ ...inp, minHeight: 34, resize: 'vertical' }}
                      value={q.text}
                      onChange={e => updateQuestion(g.key, q.key, { text: e.target.value })}
                      placeholder="실제로 받은 질문 1개"
                    />
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
                      <span style={{ fontSize: 11, color: '#888' }}>질의분류</span>
                      <select
                        style={{ ...inp, width: 'auto', minWidth: 120 }}
                        value={q.category_id ?? ''}
                        onChange={e => updateQuestion(g.key, q.key, { category_id: e.target.value || null })}
                        disabled={activeCategories.length === 0}
                      >
                        <option value="">선택</option>
                        {activeCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <button onClick={() => removeQuestion(g.key, q.key)} style={miniBtn}>삭제</button>
                </div>
              ))}
            </div>
          ))}

          <button onClick={addGroup} disabled={!canAddGroup} style={{ ...miniBtn, marginTop: 4, opacity: canAddGroup ? 1 : 0.5 }}>
            + 질의그룹 추가
          </button>
          {!canAddGroup && groups.length > 0 && (
            <span style={{ fontSize: 11, color: '#aaa', marginLeft: 8 }}>6개 그룹을 모두 추가했습니다.</span>
          )}
        </div>

        <div style={panelFooter}>
          <span style={{ fontSize: 11, color: '#888' }}>참석자 {attendeeCount}명 · 저장될 질문 {validQuestionCount}건</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} disabled={busy} style={outlineBtn}>취소</button>
            <button onClick={handleSave} disabled={busy || mastersMissing} style={{ ...primaryBtn, opacity: busy || mastersMissing ? 0.5 : 1 }}>
              {busy ? '저장 중...' : '저장'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12, fontWeight: 700, color: '#444', margin: '16px 0 8px', paddingBottom: 4, borderBottom: '1px solid #f0f0ee' }}>{children}</div>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 8, flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 11, color: '#888', marginBottom: 3 }}>{label}</div>
      {children}
    </div>
  )
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{children}</div>
}

const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 12 }
const panel: React.CSSProperties = { background: '#fff', borderRadius: 10, width: '100%', maxWidth: 760, maxHeight: '92vh', display: 'flex', flexDirection: 'column', boxShadow: '0 12px 40px rgba(0,0,0,0.18)' }
const panelHeader: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #f0f0ee' }
const panelBody: React.CSSProperties = { padding: '4px 18px 18px', overflowY: 'auto', flex: 1 }
const panelFooter: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', borderTop: '1px solid #f0f0ee', gap: 8, flexWrap: 'wrap' }
const inp: React.CSSProperties = { width: '100%', border: '1px solid #e8e8e6', borderRadius: 6, padding: '7px 9px', fontSize: 12, color: '#111', fontFamily: 'inherit', boxSizing: 'border-box' }
const miniBtn: React.CSSProperties = { border: '1px solid #e8e8e6', background: '#fff', borderRadius: 4, padding: '4px 9px', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' }
const outlineBtn: React.CSSProperties = { border: '1px solid #e8e8e6', background: '#fff', borderRadius: 6, padding: '8px 14px', fontSize: 12, cursor: 'pointer', color: '#333' }
const primaryBtn: React.CSSProperties = { border: '1px solid #111', background: '#111', color: '#fff', borderRadius: 6, padding: '8px 16px', fontSize: 12, cursor: 'pointer' }
const closeBtn: React.CSSProperties = { border: 'none', background: 'none', cursor: 'pointer', fontSize: 16, color: '#aaa' }
const dropdown: React.CSSProperties = { position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #e8e8e6', borderRadius: 6, marginTop: 2, maxHeight: 180, overflowY: 'auto', zIndex: 10, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }
const dropdownItem: React.CSSProperties = { padding: '6px 9px', fontSize: 12, cursor: 'pointer', borderBottom: '1px solid #f6f6f4' }
const groupBox: React.CSSProperties = { border: '1px solid #e8e8e6', borderRadius: 8, padding: 10, marginBottom: 8, background: '#fcfcfb' }
const errorBox: React.CSSProperties = { marginTop: 12, padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, color: '#b91c1c', lineHeight: 1.6 }
const hint: React.CSSProperties = { fontSize: 11, color: '#999', marginTop: 4, lineHeight: 1.6 }
const linkedBadge: React.CSSProperties = { position: 'absolute', right: 8, top: 8, fontSize: 9, color: '#0ea5e9', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 3, padding: '1px 4px' }
const participantRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', cursor: 'pointer' }
const roleBadge: React.CSSProperties = { fontSize: 10, color: '#0369a1', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 3, padding: '1px 6px', minWidth: 34, textAlign: 'center' }
