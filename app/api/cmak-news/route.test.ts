import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { parseCmakNews } from './route'

/**
 * 실제 CMAK 국내외소식 목록 HTML(2026-09 개편 후)의 표 부분을 그대로 담아 둔 fixture로 검증한다.
 * 사이트가 또 개편되면 이 테스트는 통과하지만 실제 호출이 502를 돌려주므로, 그때 fixture를 새로
 * 받아 갱신하면 된다(라우트 주석 참고).
 */
const FIXTURE = fs.readFileSync(
  path.join(__dirname, '__fixtures__', 'news-list-2026-09.html'),
  'utf8',
)

describe('parseCmakNews', () => {
  const items = parseCmakNews(FIXTURE)

  it('목록에서 기사를 뽑는다', () => {
    expect(items.length).toBe(10)
  })

  it('제목·등록일·상세주소를 채운다', () => {
    expect(items[0]).toEqual({
      idx: '11228',
      title: '경남도, 정부예산안 국비 11조 6,811억원 반영',
      date: '2026-09-04',
      url: 'https://www.cmak.or.kr/board/news_domestic/11228',
    })
  })

  it('제목의 HTML 엔티티를 되돌린다', () => {
    const quoted = items.find(i => i.idx === '11226')
    expect(quoted?.title).toBe("수도권 공공기관 350여 곳 지방 이전 추진…내년부터 '선도 이전'")
  })

  it("제목 뒤 'N' 뱃지를 제목에 섞지 않는다", () => {
    expect(items.every(i => !i.title.includes('N</span'))).toBe(true)
    expect(items.every(i => !/\bN$/.test(i.title))).toBe(true)
  })

  it('날짜는 모두 YYYY-MM-DD다', () => {
    expect(items.every(i => /^\d{4}-\d{2}-\d{2}$/.test(i.date))).toBe(true)
  })

  it('같은 기사를 두 번 담지 않는다', () => {
    expect(new Set(items.map(i => i.idx)).size).toBe(items.length)
  })

  it('개수 제한을 지킨다', () => {
    expect(parseCmakNews(FIXTURE, 3).length).toBe(3)
  })

  it('옛 서식(go_Edit)은 한 건도 못 뽑는다 — 라우트가 502로 알린다', () => {
    const legacy = `<tr><td><a href="#" onclick="go_Edit('9999')">옛 제목</a></td><td>26.01.02</td></tr>`
    expect(parseCmakNews(legacy)).toEqual([])
  })

  it('빈 HTML은 빈 목록이다', () => {
    expect(parseCmakNews('')).toEqual([])
  })
})
