/**
 * 평가 DB (사용자 화면 명칭: "면접 DB") — 도메인 타입 정의
 *
 * 사용자는 "면접 DB / 면접후기 / 질의"라는 업무 용어로 쓰지만, 담기는 데이터는 면접만이 아니다.
 * SOQ·TP·종심제 등도 PT 발표와 기술인 질의응답 평가를 진행하고 그때 실제 질의가 나온다. 그래서
 * 내부 모델은 면접보다 넓은 "평가 수행기록"(evaluation review)으로 두었다.
 *
 * ⚠ 이름 충돌 주의: 기존 `projects.evaluation`은 "평가"가 아니라 **낙찰사**를 담는 컬럼이다.
 * 여기 나오는 Evaluation* 타입들과는 아무 관계가 없다.
 *
 * 핵심 불변 원칙:
 *   - 질문 1개 = evaluation_questions 1행. 질문을 복제해 두는 테이블은 없다.
 *   - 발주처/용역명/시설용도/평가일/평가유형은 review에만 있고 질문에는 없다 — 질의 화면에서
 *     필요하면 review를 조인해 읽는다(QuestionWithReview).
 *   - 평가 관련 정식 분류축은 **평가유형 하나**다. 질문별 "질의출처"(PPT/기술제안서/과업수행계획서/
 *     발표내용/현장 등)는 의도적으로 만들지 않았다 — 과거 자료로도, 신규 작성자도 정확히
 *     판별하기 어려워 사용자가 추측해 넣은 값이 정식 분류축이 되어버린다. 그런 컬럼·마스터·필터를
 *     추가하지 않는 것이 이 기능의 정책이다.
 *
 * 필드명은 이 코드베이스의 다른 타입들과 동일하게 Supabase 컬럼명과 1:1 대응한다.
 * (supabase/migration_evaluation_db.sql 참고)
 */

/** 평가유형 마스터(evaluation_types) — 면접/SOQ/TP/종심제/... 핵심 분류축. */
export interface EvaluationType {
  id: string
  code: string
  name: string
  sort_order: number
  is_active: boolean
  created_at: string
}

/**
 * 질의그룹 마스터(evaluation_roles) — "누구에게 나온 질문인가" 축.
 * 신규 입력 UI의 기본 6종(책임/건축/안전/토목/기계/전기)은 is_primary = true이고,
 * legacy 수용 전용(공통/타사/기타/미지정)은 false다. 검색 필터에서는 전부 보인다.
 *
 * ⚠ 질문의 "주제"가 아니다 — 주제는 EvaluationQuestionCategory(질의분류)다.
 */
export interface EvaluationRole {
  id: string
  name: string
  sort_order: number
  /** 신규 입력 화면의 기본 선택지인지(업무용 6종). legacy 전용 값은 false. */
  is_primary: boolean
  is_active: boolean
  created_at: string
}

/**
 * 질의분류 마스터(evaluation_question_categories) — "질문의 주제가 무엇인가" 축
 * (품질/안전/공정/사업관리/시공/설계/원가/계약·클레임/민원/법규·기준/현장관리/기술일반/기타/미지정).
 *
 * 기술인의 전문분야(engineer_specialties)와 이름이 겹치는 값이 있지만 다른 축이다 —
 * 전자는 사람의 분야, 이쪽은 질문의 주제다.
 */
export interface EvaluationQuestionCategory {
  id: string
  code: string
  name: string
  sort_order: number
  is_active: boolean
  created_at: string
}

/** 전문분야 — 기술인 주소록의 분야 마스터(engineer_specialties)에서 필요한 최소 필드만. */
export interface EvaluationSpecialtyRef {
  id: string
  name: string
}

export interface EvaluationReview {
  id: string

  /**
   * Project List 연계. 프로젝트 행이 지워지면 null이 되지만(on delete set null) 아래 스냅샷들이
   * 남아 기록 자체는 그대로 읽힌다. 과거 자료처럼 대응 프로젝트가 없는 기록도 null이다.
   */
  project_id: string | null

  /**
   * **정규화된 평가유형** (evaluation_types.id) — 검색·필터·통계·향후 AI 분석의 유일한 공식
   * 분류축이다. 신규 입력에서는 사용자가 고른 값이 authoritative value다.
   *
   * 타입상 nullable이지만 실제로는 비우지 않는다 — 사실 확인이 안 되는 자료는 null이 아니라
   * '미지정' 유형을 가리킨다("모름"의 표현을 한 가지로 유지). 신규 입력은 화면에서 필수.
   */
  evaluation_type_id: string | null
  /**
   * **legacy 원문** — 기존 Excel `평가자료`에 실제로 적혀 있던 문자열을 손실 없이 보존한다
   * (예: 'T P', '기술자평가서/PPT', 'SOQ\n종심제'). 추적성·원본 보존 목적이며
   * **통계의 분류축으로 쓰지 않는다**. 신규 입력 화면에는 노출하지 않는다.
   *
   * evaluation_type_id와 의미가 다르다는 점을 혼동하지 말 것 — 위 필드 설명 참고.
   */
  evaluation_type_source: string

  client_snapshot: string        // 발주처
  project_name_snapshot: string  // 용역명
  facility_type: string          // 시설용도 — Project List에 대응 컬럼이 없어 기록이 보관한다

  /** 실제 평가일. 신규 기록은 이 값을 쓴다. */
  evaluation_date: string | null  // YYYY-MM-DD
  /** 연도만 아는 legacy 자료용. 가짜 월/일을 만들지 않기 위해 별도 컬럼으로 둔다. */
  evaluation_year: number | null
  /**
   * DB generated column — evaluation_date가 있으면 그 연도, 없으면 evaluation_year.
   * 연도 필터/통계는 항상 이 값만 본다(읽기 전용 — insert/update 페이로드에 넣으면 Postgres 에러).
   */
  evaluation_year_effective: number | null

  evaluation_time: string        // "13:30~" 같은 자유 표기(원본 문서 표기를 그대로 유지)
  location: string

  evaluator_count: number | null            // 평가위원(면접관) 수
  participant_company_count: number | null
  presentation_order: number | null         // 발표/면접 순서
  participant_companies: string             // 업체명 나열(업체 마스터 없음)

  /** 진행방법 — 평가유형(제도)과 다른 개념. 예: "PT 발표 후 분야별 기술인 질의응답". */
  evaluation_method: string
  special_notes: string

  created_by: string
  updated_by: string
  created_at: string
  updated_at: string
}

export interface EvaluationAttendee {
  id: string
  review_id: string
  /** 기술인 주소록에 있으면 연결, 없으면(내부 수행직원 등) null + 이름만 남긴다. */
  engineer_contact_id: string | null
  attendee_name_snapshot: string
  attendee_role: string  // 단장/안전/수행 등 후기에 적힌 그대로
  sort_order: number
  created_at: string
}

export interface EvaluationQuestion {
  id: string
  review_id: string
  question_text: string
  /** 질의그룹(evaluation_roles.id) — 누구에게 나온 질문인가. 모름은 null 대신 '미지정' 행. */
  role_id: string | null
  /** 질의분류(evaluation_question_categories.id) — 질문의 주제. 모름은 '미지정' 행. */
  category_id: string | null
  /**
   * 전문분야 — **legacy 이관 전용**. 신규 입력 화면은 쓰지 않는다(질의그룹이 분야 의미를 이미
   * 담고 있어 사용자에게 중복 선택을 요구하지 않는다). 항상 null일 수 있다.
   */
  specialty_id: string | null
  group_order: number
  question_order: number
  created_at: string
  updated_at: string
}

/**
 * 질의 화면이 쓰는 조회 결과 1건 — 질문 행 + 그 질문이 나온 기록의 조회용 필드.
 * Supabase 중첩 select(`evaluation_questions.select('*, review:evaluation_reviews(...)')`)의
 * 응답 모양과 같다. review가 null이 되는 경우는 없다(review_id는 not null).
 */
export interface QuestionWithReview extends EvaluationQuestion {
  review: Pick<
    EvaluationReview,
    | 'id'
    | 'evaluation_type_id'
    | 'client_snapshot'
    | 'project_name_snapshot'
    | 'facility_type'
    | 'evaluation_date'
    | 'evaluation_year_effective'
  >
}

/** 후기 목록 1행 — 기록 + 목록에 필요한 집계/참석자. */
export interface ReviewListItem extends EvaluationReview {
  attendees: EvaluationAttendee[]
  question_count: number
}

/** 상세보기(Drawer)가 쓰는 완전한 기록 1건. */
export interface ReviewDetail extends EvaluationReview {
  attendees: EvaluationAttendee[]
  questions: EvaluationQuestion[]
}

/**
 * 등록/수정 폼(ReviewFormModal)의 초기값.
 *
 * 저장된 기록(ReviewDetail)이거나, HWP 후기 문서에서 읽어온 **초안**이다. 초안은 아직 DB에 없으므로
 * id가 null이고, 폼은 이 값을 신규 등록으로 저장한다(lib/evaluations/importSeed.ts가 만든다).
 * ReviewDetail은 이 타입에 그대로 대입된다.
 */
export type ReviewFormSeed = Omit<ReviewDetail, 'id'> & { id: string | null }

// ── 저장 페이로드 ──────────────────────────────────────────────────────────────
// save_evaluation_review RPC에 넘기는 모양. 기록 + 참석자 + 질문을 한 트랜잭션으로 저장하기 위해
// supabase-js의 insert/update를 여러 번 호출하지 않고 RPC 한 번으로 보낸다.
// evaluation_year_effective는 generated column이라 페이로드에 넣지 않는다.

export interface ReviewSavePayload {
  project_id: string | null
  evaluation_type_id: string | null
  evaluation_type_source: string
  client_snapshot: string
  project_name_snapshot: string
  facility_type: string
  evaluation_date: string | null
  evaluation_year: number | null
  evaluation_time: string
  location: string
  evaluator_count: number | null
  participant_company_count: number | null
  presentation_order: number | null
  participant_companies: string
  evaluation_method: string
  special_notes: string
}

export interface AttendeeSavePayload {
  engineer_contact_id: string | null
  attendee_name_snapshot: string
  attendee_role: string
}

export interface QuestionSavePayload {
  question_text: string
  /** 질의그룹 */
  role_id: string | null
  /** 질의분류 */
  category_id: string | null
  group_order: number
  question_order: number
}
