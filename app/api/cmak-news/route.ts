export const revalidate = 1800 // 30분 캐시

interface NewsItem {
  idx: string
  title: string
  date: string
}

export async function GET() {
  try {
    const res = await fetch('https://www.cmak.or.kr/html/notice/news.asp', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ko-KR,ko;q=0.9',
      },
      next: { revalidate: 1800 },
    })

    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const html = await res.text()

    // go_Edit('idx') 패턴으로 각 행 파싱
    const items: NewsItem[] = []
    const rowRegex = /go_Edit\('(\d+)'\)[^>]*>([\s\S]*?)<\/a>[\s\S]*?(\d{2}\.\d{2}\.\d{2})/g
    let match: RegExpExecArray | null

    while ((match = rowRegex.exec(html)) !== null && items.length < 10) {
      const idx = match[1]
      const rawTitle = match[2].replace(/<[^>]+>/g, '').trim()
      const date = `20${match[3].replace(/\./g, '-')}`
      if (rawTitle) items.push({ idx, title: rawTitle, date })
    }

    return Response.json({ items })
  } catch (e) {
    console.error('[cmak-news]', e)
    return Response.json({ items: [], error: String(e) }, { status: 500 })
  }
}
