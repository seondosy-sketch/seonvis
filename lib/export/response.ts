/**
 * 공통 Export 인프라 — 파일 다운로드 응답. app/api/hwpx/route.ts와 동일한 응답 패턴
 * (한글 파일명은 filename*=UTF-8''로 인코딩해야 브라우저가 깨지지 않게 처리한다).
 */
import { NextResponse } from 'next/server'
import { ExportFormat } from './types'

const CONTENT_TYPE: Record<ExportFormat, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
}

export function buildDownloadResponse(buffer: Buffer, filename: string, format: ExportFormat): NextResponse {
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': CONTENT_TYPE[format],
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  })
}
