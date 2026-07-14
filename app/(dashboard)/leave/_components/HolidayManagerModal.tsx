'use client'

import { useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { Holiday } from '@/lib/leave/types'

/**
 * 공휴일/회사휴무 관리. 차감 계산은 holidays 테이블만 보므로(오프라인 동작)
 * 여기서 연도별 목록을 관리한다. 「인터넷에서 불러오기」는 기존 /api/holidays
 * (대시보드 캘린더가 쓰는 date.nager.at 프록시)를 재사용해 그 연도를 upsert한다 —
 * 실패(오프라인)해도 기존 데이터는 유지된다.
 *
 * 이미 저장된 휴가의 차감은 저장 시점 스냅샷이라 여기서 공휴일을 바꿔도 소급되지
 * 않는다 — 필요하면 해당 휴가를 열어 다시 저장하면 재계산된다 (06 문서 ⑤).
 */
export default function HolidayManagerModal({
  initialYear,
  holidays,
  onClose,
  onChange,
}: {
  initialYear: number
  holidays: Holiday[]
  onClose: () => void
  onChange: () => void
}) {
  const supabase = createSupabaseBrowserClient()
  const [year, setYear] = useState(initialYear)
  const [newDate, setNewDate] = useState('')
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<Holiday['holiday_type']>('회사휴무')
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const yearHolidays = holidays.filter(h => h.holiday_date.startsWith(String(year)))

  async function add() {
    setError(null); setNotice(null)
    if (!newDate || !newName.trim()) { setError('날짜와 이름을 입력하세요.'); return }
    const { error: err } = await supabase.from('holidays')
      .insert({ holiday_date: newDate, name: newName.trim(), holiday_type: newType })
    if (err) {
      setError(err.code === '23505' ? '이미 등록된 날짜입니다.' : `추가 실패: ${err.message}`)
      return
    }
    setNewDate(''); setNewName('')
    onChange()
  }

  async function rename(h: Holiday, name: string) {
    if (!name.trim() || name === h.name) return
    await supabase.from('holidays').update({ name: name.trim() }).eq('id', h.id)
    onChange()
  }

  async function remove(h: Holiday) {
    if (!confirm(`${h.holiday_date} ${h.name}을(를) 삭제하시겠습니까?`)) return
    await supabase.from('holidays').delete().eq('id', h.id)
    onChange()
  }

  async function importYear() {
    setImporting(true); setError(null); setNotice(null)
    try {
      const res = await fetch(`/api/holidays?year=${year}`)
      const data: Array<{ date: string; localName: string }> = res.ok ? await res.json() : []
      if (!data.length) {
        setError('공휴일을 불러오지 못했습니다 (인터넷 연결 확인). 기존 데이터는 유지됩니다.')
        return
      }
      const { error: err } = await supabase.from('holidays').upsert(
        data.map(d => ({ holiday_date: d.date, name: d.localName, holiday_type: '법정공휴일' as const })),
        { onConflict: 'holiday_date' },
      )
      if (err) { setError(`저장 실패: ${err.message}`); return }
      setNotice(`${year}년 공휴일 ${data.length}건을 불러왔습니다. 회사와 다른 항목(제헌절 등)은 삭제하세요.`)
      onChange()
    } finally { setImporting(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 12, width: 560, maxWidth: 'calc(100vw - 40px)', maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #e8e8e6', background: '#111', borderRadius: '12px 12px 0 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>공휴일 관리</div>
            <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>휴가 차감 계산에서 제외되는 날 — 법정공휴일 + 회사휴무</div>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'rgba(255,255,255,0.15)', color: '#fff', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 13 }}>✕</button>
        </div>

        <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid #f0f0ee' }}>
          <button onClick={() => setYear(y => y - 1)} style={navBtn}>‹</button>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>{year}년</span>
          <button onClick={() => setYear(y => y + 1)} style={navBtn}>›</button>
          <div style={{ flex: 1 }} />
          <button onClick={importYear} disabled={importing} style={{ ...outlineBtn, opacity: importing ? 0.6 : 1 }}>
            {importing ? '불러오는 중...' : `${year}년 공휴일 인터넷에서 불러오기`}
          </button>
        </div>

        <div style={{ padding: '12px 20px', display: 'flex', gap: 6, borderBottom: '1px solid #f0f0ee', alignItems: 'center' }}>
          <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} style={{ ...inp, width: 140 }} />
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="이름 (창립기념일 등)" style={{ ...inp, flex: 1 }} />
          <select value={newType} onChange={e => setNewType(e.target.value as Holiday['holiday_type'])} style={{ ...inp, width: 110 }}>
            <option>회사휴무</option>
            <option>법정공휴일</option>
          </select>
          <button onClick={add} style={primaryBtn}>추가</button>
        </div>

        {(error || notice) && (
          <div style={{ margin: '10px 20px 0', padding: '8px 12px', borderRadius: 6, fontSize: 12,
            background: error ? '#fef2f2' : '#f0fdf4', border: `1px solid ${error ? '#fecaca' : '#bbf7d0'}`,
            color: error ? '#b91c1c' : '#15803d' }}>
            {error ?? notice}
          </div>
        )}

        <div style={{ padding: '8px 20px 20px' }}>
          {yearHolidays.length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: '#bbb', fontSize: 13 }}>
              {year}년 공휴일이 없습니다 — 불러오기 버튼을 누르거나 직접 추가하세요
            </div>
          ) : yearHolidays.map(h => (
            <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: '1px solid #f5f5f3' }}>
              <span style={{ fontSize: 12, color: '#555', width: 90, flexShrink: 0 }}>{h.holiday_date}</span>
              <input defaultValue={h.name} onBlur={e => rename(h, e.target.value)} style={{ ...inp, flex: 1 }} />
              <span style={{
                fontSize: 10, padding: '2px 6px', borderRadius: 4, flexShrink: 0,
                background: h.holiday_type === '법정공휴일' ? '#eff6ff' : '#fffbeb',
                color: h.holiday_type === '법정공휴일' ? '#1d4ed8' : '#b45309',
                border: `1px solid ${h.holiday_type === '법정공휴일' ? '#bfdbfe' : '#fde68a'}`,
              }}>{h.holiday_type}</span>
              <button onClick={() => remove(h)} style={deleteBtn}>삭제</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const inp: React.CSSProperties = { height: 30, padding: '0 8px', border: '1px solid #e8e8e6', borderRadius: 6, fontSize: 12, background: '#fff', boxSizing: 'border-box' }
const navBtn: React.CSSProperties = { border: 'none', background: 'none', cursor: 'pointer', color: '#888', fontSize: 16, padding: '2px 8px', borderRadius: 4 }
const primaryBtn: React.CSSProperties = { height: 30, padding: '0 14px', borderRadius: 6, border: 'none', background: '#111', color: '#fff', fontSize: 12, cursor: 'pointer', flexShrink: 0 }
const outlineBtn: React.CSSProperties = { height: 30, padding: '0 12px', borderRadius: 6, border: '1px solid #e8e8e6', background: '#fff', color: '#333', fontSize: 12, cursor: 'pointer' }
const deleteBtn: React.CSSProperties = { height: 26, padding: '0 10px', borderRadius: 4, border: 'none', background: '#fee2e2', color: '#b91c1c', fontSize: 11, cursor: 'pointer', flexShrink: 0 }
