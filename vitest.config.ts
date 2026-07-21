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
    },
  },
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['node_modules/**', '.next/**'],
  },
})
