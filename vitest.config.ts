import { defineConfig } from 'vitest/config'
import path from 'node:path'

/**
 * 이번 기술인 출퇴근부 기능(Phase 1)에서 처음 도입한 테스트 러너.
 * 이 저장소에는 기존 테스트 설정이 없어 순수 함수(기간 계산·검증 로직) 위주로 최소 구성했다.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname),
      // lib/supabase-admin.ts의 import 'server-only' — Next.js는 내장 별칭으로 처리하지만 vitest(node)는 모른다.
      // 패키지를 설치하지 않고 Next에 들어 있는 빈 모듈(서버 컴포넌트용)로 연결한다.
      'server-only': path.resolve(__dirname, 'node_modules/next/dist/compiled/server-only/empty.js'),
    },
  },
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['node_modules/**', '.next/**'],
  },
})
