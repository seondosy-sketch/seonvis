// 서버 전용 — service role 키를 쓰는 클라이언트라 브라우저 번들에 들어가면 빌드가 실패하게 막는다.
// ('server-only'는 Next.js 내장 별칭으로 해석된다. vitest는 vitest.config.ts의 별칭으로 빈 모듈을 쓴다.)
import 'server-only'
import { createClient } from '@supabase/supabase-js'

export function createSupabaseAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}
