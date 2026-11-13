'use client'

/**
 * 프로젝트 List "참여현황" 탭 — 엑셀 대장 2시트(○○년 참여기술자)를 화면으로 옮긴 것.
 * 왼쪽 = 책임기술인(단장), 오른쪽 = 분야별 기술인. 수주 프로젝트에 참여한 사람은 노란 음영
 * (엑셀 출력 lib/projects/export/projectLedgerWorkbook.ts와 같은 규칙).
 *
 * 올해는 1시트 인력 칸에서 계산한 값(ledgerRows.ts), 과거 연도는 저장된 2시트 줄(lib/projects/archive.ts)이
 * 들어온다. 과거 연도의 줄 중 1시트 프로젝트와 연결되지 않은 줄은 흐린 글씨로 구분한다.
 * 전체 연도 보기에서는 사람별로 모든 연도의 줄을 합쳐(lib/projects/archive.ts mergeParticipationYears)
 * 줄마다 연도를 붙인다.
 */

import { useState } from 'react'
import type { ParticipationRow, ParticipationSheet } from '@/lib/projects/export/ledgerRows'
import type { ParticipationLine } from '@/lib/projects/archive'

type Row = ParticipationRow & { lines?: ParticipationLine[] }

const WIN_FILL = '#fff8c4'

export default function ParticipationPanel({
  sheet, loading, isMobile, isArchive, allYears = false,
}: {
  sheet: ParticipationSheet & { directors: Row[]; specialists: Row[] }
  loading: boolean
  isMobile: boolean
  isArchive: boolean
  allYears?: boolean
}) {
  const [search, setSearch] = useState('')
  const q = search.trim().toLowerCase()
  const match = (r: Row) => !q || r.name.toLowerCase().includes(q) || r.projectNames.some(n => n.toLowerCase().includes(q))

  const unlinked = [...sheet.directors, ...sheet.specialists].reduce((n, r) => n + (r.lines?.filter(l => !l.linked).length ?? 0), 0)

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder={allYears ? '성명 검색 — 모든 연도의 참여 이력...' : '성명, 프로젝트 검색...'}
          style={{ flex: 1, minWidth: 200, maxWidth: 360, height: 34, padding: '0 12px', border: '1px solid #e8e8e6', borderRadius: 6, fontSize: 13, background: '#fff' }} />
        <span style={{ fontSize: 11, color: '#999', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ display: 'inline-block', width: 12, height: 12, background: WIN_FILL, border: '1px solid #eadf8a', borderRadius: 2 }} />
          수주 프로젝트 참여
          {isArchive && unlinked > 0 && (
            <span style={{ marginLeft: 8, color: '#aaa' }}>
              · <span style={{ color: '#aaa', textDecoration: 'underline dotted' }}>흐린 글씨</span> = 대장(1시트)과 연결 안 된 엑셀 원문 {unlinked}줄
            </span>
          )}
        </span>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#bbb', fontSize: 13, background: '#fff', border: '1px solid #e8e8e6', borderRadius: 8 }}>불러오는 중...</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12, alignItems: 'start' }}>
          <Block title="책임기술인 참여현황" rows={sheet.directors.filter(match)} total={sheet.directors.length} />
          <Block title="분야별 기술인 참여현황" rows={sheet.specialists.filter(match)} total={sheet.specialists.length} />
        </div>
      )}
    </div>
  )
}

function Block({ title, rows, total }: { title: string; rows: Row[]; total: number }) {
  const sum = rows.reduce((n, r) => n + r.count, 0)
  return (
    <section style={{ background: '#fff', border: '1px solid #e8e8e6', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid #e8e8e6', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>{title}</span>
        <span style={{ fontSize: 11, color: '#999' }}>{rows.length === total ? `${total}명` : `${rows.length} / ${total}명`} · 누적 {sum}회</span>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: '#f4f4f2' }}>
            {['번호', '성명', '분야', '참여프로젝트', '누적(회)'].map(h => (
              <th key={h} style={{ padding: '7px 10px', textAlign: h === '누적(회)' ? 'right' : 'left', fontWeight: 500, color: '#555', borderBottom: '1px solid #e8e8e6', whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={5} style={{ padding: 32, textAlign: 'center', color: '#bbb' }}>데이터가 없습니다</td></tr>
          ) : rows.map((r, i) => (
            <tr key={`${r.name}-${i}`} style={{ borderBottom: '1px solid #f0f0ee', background: r.hasWin ? WIN_FILL : '#fff', verticalAlign: 'top' }}>
              <td style={{ padding: '7px 10px', color: '#999', width: 40 }}>{i + 1}</td>
              <td style={{ padding: '7px 10px', fontWeight: 500, color: '#111', whiteSpace: 'nowrap' }}>{r.name}</td>
              <td style={{ padding: '7px 10px', color: '#555', whiteSpace: 'nowrap' }}>{r.field}</td>
              <td style={{ padding: '7px 10px', lineHeight: 1.6 }}>
                {(r.lines ?? r.projectNames.map((text): ParticipationLine => ({ text, linked: true, win: false }))).map((l, j) => (
                  <div
                    key={j}
                    title={l.linked ? undefined : '대장(1시트)의 프로젝트와 연결되지 않은 엑셀 원문'}
                    style={{ color: l.linked ? '#333' : '#aaa', fontWeight: l.win ? 600 : 400 }}
                  >
                    {l.year !== undefined && <span style={{ display: 'inline-block', minWidth: 38, marginRight: 6, fontSize: 11, fontWeight: 600, color: '#0f766e' }}>{l.year}</span>}
                    <span style={{ textDecoration: l.linked ? 'none' : 'underline dotted' }}>{l.text}</span>
                  </div>
                ))}
              </td>
              <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 600, color: '#111' }}>{r.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
