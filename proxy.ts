import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // 홈화면 위젯 이미지(/api/widget/summary)는 쿠키 세션 없이 접근해야 하는 유일한 예외다 —
  // 휴대폰 위젯 앱이 URL만 들고 이미지를 가져가기 때문. 대신 그 라우트 안에서 ?token= 을
  // widget_tokens + allowed_users로 매 요청 검증한다(lib/widget/token.ts).
  // 발급/해지(/api/widget/token)는 로그인 필수라 예외에 넣지 않는다.
  // /fonts/*는 위젯 라우트가 파일시스템에서 폰트를 못 읽었을 때 쓰는 HTTP 폴백 경로다.
  // 회사 데이터가 아닌 오픈폰트(Noto Sans KR, OFL — 자유 재배포 허용)라 공개해도 무해하다.
  const isPublicWidgetImage = pathname === '/api/widget/summary' || pathname.startsWith('/fonts/')

  if (!user && !isPublicWidgetImage && pathname !== '/login' && pathname !== '/unauthorized' && pathname !== '/request-access' && !pathname.startsWith('/auth') && !pathname.startsWith('/api/access-requests')) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (user && pathname === '/login') {
    return NextResponse.redirect(new URL('/weekly', request.url))
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
