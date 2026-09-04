/**
 * 메인 대시보드 "CM업계소식" — 한국CM협회(CMAK) 국내외소식 목록을 읽어 온다.
 *
 * 협회 사이트는 공개 API가 없어 목록 HTML을 파싱한다. 그래서 사이트가 개편되면 반드시 깨진다 —
 * 2026-09 개편이 실제로 그랬다(아래 참고). 다음 개편 때 빨리 알아채도록 두 가지를 지킨다:
 *   1. 목록 URL은 받아왔는데 **한 건도 못 뽑으면 에러로 돌려준다.** 빈 목록(200)으로 돌려주면
 *      화면이 "소식이 없다"처럼 보여서 깨진 걸 모른다.
 *   2. 기사 상세 URL을 여기서 만들어 내려준다. 화면이 URL 모양을 알지 못하게 해서, 개편 때
 *      고칠 곳을 이 파일 하나로 모은다.
 *
 * 2026-09 개편 전/후
 *   목록  https://www.cmak.or.kr/html/notice/news.asp   → https://www.cmak.or.kr/notice/news
 *   상세  .../news_r.asp?code=0&...&no={idx}            → https://www.cmak.or.kr/board/news_domestic/{idx}
 *   인코딩 EUC-KR                                        → UTF-8
 *   목록 마크업 go_Edit('idx') onclick                    → <a href="/board/news_domestic/{idx}">
 * 옛 URL은 둘 다 새 **목록**으로 302되므로, 옛 상세 링크는 기사로 가지 못하고 목록으로 튕긴다.
 */
export const revalidate = 1800 // 30분 캐시

export const CMAK_NEWS_URL = 'https://www.cmak.or.kr/notice/news'
const CMAK_ORIGIN = 'https://www.cmak.or.kr'

interface NewsItem {
  idx: string
  title: string
  date: string
  /** 기사 상세 주소 — 화면은 이 값을 그대로 쓴다(직접 조립하지 않는다). */
  url: string
}

/**
 * 목록 행 하나: 번호 td → 제목 a(+ 'N' 뱃지 span) → 등록일 td.
 * 제목과 등록일 사이에 뱃지·공백이 얼마든 끼어들 수 있어 넉넉하게 건너뛴다.
 */
const ROW_REGEX =
  /<a\s+href="(\/board\/[^"]*?\/(\d+))"[^>]*>([\s\S]*?)<\/a>[\s\S]{0,600}?(\d{4}-\d{2}-\d{2})/g

function decodeEntities(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 목록 HTML → 기사 목록. 순수 함수라 실제 응답 HTML로 단위테스트한다. */
export function parseCmakNews(html: string, limit = 10): NewsItem[] {
  const items: NewsItem[] = []
  const seen = new Set<string>()

  ROW_REGEX.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = ROW_REGEX.exec(html)) !== null && items.length < limit) {
    const [, path, idx, rawTitle, date] = match
    const title = decodeEntities(rawTitle)
    // 같은 기사가 목록·사이드에 두 번 나오는 경우가 있어 idx로 한 번만 담는다.
    if (!title || seen.has(idx)) continue
    seen.add(idx)
    items.push({ idx, title, date, url: `${CMAK_ORIGIN}${path}` })
  }

  return items
}

export async function GET() {
  try {
    const res = await fetch(CMAK_NEWS_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ko-KR,ko;q=0.9',
      },
      next: { revalidate: 1800 },
    })

    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const html = await res.text()
    const items = parseCmakNews(html)

    // 페이지는 받아왔는데 한 건도 못 뽑았다 = 서식이 또 바뀌었다는 뜻이다. 조용히 빈 목록을
    // 돌려주지 않는다(그러면 화면이 "소식 없음"처럼 보여 개편을 놓친다).
    if (items.length === 0) {
      console.error('[cmak-news] 목록에서 기사를 찾지 못했습니다 — 사이트 서식 변경 가능성')
      return Response.json(
        { items: [], error: 'CMAK 목록 서식이 바뀐 것 같습니다(파싱 결과 0건).' },
        { status: 502 },
      )
    }

    return Response.json({ items })
  } catch (e) {
    console.error('[cmak-news]', e)
    return Response.json({ items: [], error: String(e) }, { status: 500 })
  }
}
