/**
 * 공통 Export 인프라 — pdfmake 한글 폰트 등록.
 *
 * pdfmake 기본 폰트(Roboto)는 한글 글리프가 없다. Noto Sans KR(SIL Open Font License 1.1 —
 * 상업적 사용·재배포·임베딩 전부 허용, public/fonts/NotoSansKR-OFL.txt)의 Regular/Bold TTF를
 * Google Fonts(fonts.gstatic.com)에서 받아 public/fonts/에 두고 이 파일에서 등록한다.
 * italics/bolditalics는 별도 이탤릭 웨이트를 구하지 않고 Regular/Bold로 대체한다 — 한글에는
 * 기울임꼴 글리프 자체가 없어(가상 기울임 렌더링) 별도 파일이 큰 의미가 없다.
 *
 * pdfmake 0.3.x 서버 API(setFonts/setLocalAccessPolicy/createPdf)를 쓴다 — 옛 PdfPrinter 생성자
 * API가 아니다. setLocalAccessPolicy로 로컬 파일 경로 읽기를 허용해야 Node에서 폰트 파일을 읽는다.
 */
import path from 'node:path'
import pdfMake from 'pdfmake'

export const KOREAN_FONT = 'NotoSansKR'

let registered = false

export function registerKoreanFont(): void {
  if (registered) return

  const fontsDir = path.join(process.cwd(), 'public', 'fonts')
  const regular = path.join(fontsDir, 'NotoSansKR-Regular.ttf')
  const bold = path.join(fontsDir, 'NotoSansKR-Bold.ttf')

  pdfMake.setLocalAccessPolicy(() => true)
  pdfMake.setFonts({
    [KOREAN_FONT]: {
      normal: regular,
      bold: bold,
      italics: regular,
      bolditalics: bold,
    },
  })
  registered = true
}
