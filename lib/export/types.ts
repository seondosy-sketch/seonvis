/**
 * 공통 Export 인프라 — 포맷 중립 저수준 타입.
 * 이 레이어는 어떤 기능의 "기존 엑셀 양식"도 강제 재현하지 않는다 — 그건 각 기능의 몫
 * (예: lib/lodging/export/*). 여기서는 워크북/PDF 생성에서 반복되는 저수준 스타일·설정만 다룬다.
 */

export type ExportFormat = 'xlsx' | 'pdf'

export interface PrintSetupOptions {
  orientation: 'portrait' | 'landscape'
  fitToWidth?: number   // exceljs pageSetup.fitToWidth (기본 1페이지 폭)
  fitToHeight?: number  // 0 = 세로는 자연스럽게 여러 페이지로
}
