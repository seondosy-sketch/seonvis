/**
 * 공통 Export 인프라 — pdfmake 저수준 도우미.
 * 공통 테이블 테두리 스타일, 페이지 설정 기본값, 버퍼 생성만 다룬다. 실제 문서 내용(레이아웃)은
 * 각 기능의 export 레이어(예: lib/lodging/export/*)가 pdfmake 콘텐츠 배열로 직접 구성한다.
 */
import type { Content, CustomTableLayout, TDocumentDefinitions } from 'pdfmake/interfaces'
import pdfMake from 'pdfmake'
import { KOREAN_FONT, registerKoreanFont } from './fonts'

export { KOREAN_FONT }
export type { Content }

/** 표에 공통으로 쓰는 얇은 회색 테두리 레이아웃 — Excel 출력의 THIN_BORDER와 시각적으로 맞춘다. */
export const commonTableLayout: CustomTableLayout = {
  hLineWidth: () => 0.5,
  vLineWidth: () => 0.5,
  hLineColor: () => '#999999',
  vLineColor: () => '#999999',
  paddingLeft: () => 4,
  paddingRight: () => 4,
  paddingTop: () => 2,
  paddingBottom: () => 2,
}

/** A4 방향/여백 등 공통 기본값 + 각 기능이 만든 content를 합친 문서 정의를 만든다. */
export function withPdfDefaults(
  content: Content,
  orientation: 'portrait' | 'landscape' = 'landscape',
  extra?: Partial<Omit<TDocumentDefinitions, 'content'>>,
): TDocumentDefinitions {
  return {
    pageSize: 'A4',
    pageOrientation: orientation,
    pageMargins: [24, 24, 24, 24],
    defaultStyle: { font: KOREAN_FONT, fontSize: 9 },
    ...extra,
    content,
  }
}

export async function buildPdfBuffer(docDefinition: TDocumentDefinitions): Promise<Buffer> {
  registerKoreanFont()
  const pdfDoc = pdfMake.createPdf(docDefinition)
  return pdfDoc.getBuffer()
}
