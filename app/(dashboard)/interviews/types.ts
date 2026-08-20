/**
 * 면접 DB 화면이 다른 테이블에서 읽어오는 참조용 타입.
 * (숙박관리의 app/(dashboard)/lodging/types.ts와 같은 역할 — 화면에서 필요한 최소 컬럼만 담는다.)
 *
 * 화면 경로는 /interviews를 유지한다(사용자에게 노출되는 메뉴가 "면접 DB"이므로). 내부 데이터
 * 모델은 더 넓은 개념인 evaluation_*이며 타입은 @/lib/evaluations/types에 있다.
 */

/**
 * Project List에서 후기 작성에 쓰는 필드.
 * 시설용도는 projects에 대응 컬럼이 없어 여기 없다(사용자가 직접 입력).
 * interview_date는 Project List의 기존 컬럼명 그대로다 — 후기의 평가일 기본값으로만 쓴다.
 */
export interface InterviewProjectRef {
  id: string
  project_number: string
  name: string
  client: string
  interview_date: string | null
  status: string
}

/** 기술인 주소록 — 참석자 연결용. */
export interface InterviewEngineerRef {
  id: string
  name: string
  rank: string
  company: string
}
