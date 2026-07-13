'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { useIsMobile } from '@/lib/useIsMobile'
import { Employee, Project, WorkRecord } from '@/lib/overtime/types'
import { currentPayPeriod, formatHours, payPeriodDays, payPeriodRange, sumHoursByDate, sumHoursByEmployee, sumHoursByProject, summarizeByEmployeeAndDate, summaryKey } from '@/lib/overtime/summary'

const MONTH_NAMES = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월']

/**
 * "직원별 연장근무 내역" / "프로젝트별 투입내역" / "전체 월간 집계표" — 월말에 뽑아 쓰는 출력 3종.
 * PDF/Excel 파일 생성은 마스터 프롬프트가 "향후" 과제로 명시했으므로 이번 단계에서는 만들지 않는다.
 * 지금은 그 대신 (1) CSV 다운로드 — 엑셀에서 바로 열리고 새 의존성이 필요 없음, (2) 브라우저 인쇄
 * (Ctrl+P → PDF로 저장) 두 가지로 "출력"을 지원한다.
 */
export default function OvertimePrintPage() {
  const isMobile = useIsMobile()
  const supabase = createSupabaseBrowserClient()

  const initialPeriod = currentPayPeriod()
  const [viewYear, setViewYear] = useState(initialPeriod.year)
  const [viewMonth, setViewMonth] = useState(initialPeriod.month)

  const [employees, setEmployees] = useState<Employee[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [records, setRecords] = useState<WorkRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (year: number, month: number) => {
    setLoading(true)
    const { start, end } = payPeriodRange(year, month)
    const [empRes, projRes, recRes] = await Promise.all([
      supabase.from('overtime_employees').select('*').order('sort_order', { ascending: true }),
      supabase.from('overtime_projects').select('*').order('sort_order', { ascending: true }),
      supabase.from('overtime_work_records').select('*').gte('work_date', start).lte('work_date', end),
    ])

    if (empRes.error || projRes.error || recRes.error) {
      setError('데이터를 불러올 수 없습니다. supabase/migration_overtime.sql이 적용되었는지 확인하세요.')
    } else {
      setError(null)
      setEmployees((empRes.data ?? []) as Employee[])
      setProjects((projRes.data ?? []) as Project[])
      setRecords((recRes.data ?? []) as WorkRecord[])
    }
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { load(viewYear, viewMonth) }, [viewYear, viewMonth, load])

  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11) }
    else setViewMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0) }
    else setViewMonth(m => m + 1)
  }

  const employeeName = (id: string) => employees.find(e => e.id === id)?.name ?? '(알 수 없음)'
  const projectName = (id: string) => projects.find(p => p.id === id)?.name ?? '(알 수 없음)'

  const byEmployeeGroups = employees
    .map(emp => ({ emp, records: records.filter(r => r.employee_id === emp.id).sort((a, b) => a.work_date.localeCompare(b.work_date)) }))
    .filter(g => g.records.length > 0)

  const byProjectGroups = projects
    .map(proj => ({ proj, records: records.filter(r => r.project_id === proj.id).sort((a, b) => a.work_date.localeCompare(b.work_date)) }))
    .filter(g => g.records.length > 0)

  const days = payPeriodDays(viewYear, viewMonth)
  const periodLabel = `${days[0].month + 1}/${days[0].day} ~ ${days[days.length - 1].month + 1}/${days[days.length - 1].day}`
  const gridSummaries = summarizeByEmployeeAndDate(records)
  const dailyTotals = sumHoursByDate(records)
  const employeeTotals = sumHoursByEmployee(records, employees)
  const projectTotals = sumHoursByProject(records, projects)
  const grandTotal = records.reduce((sum, r) => sum + r.hours, 0)

  function exportEmployeeCsv() {
    const rows = byEmployeeGroups.flatMap(g => g.records.map(r => [
      g.emp.name, r.work_date, projectName(r.project_id), r.task_description, r.start_time, r.end_time, r.hours, r.note,
    ]))
    downloadCsv(`직원별_연장근무내역_${viewYear}-${viewMonth + 1}.csv`, toCsv(['직원', '날짜', '프로젝트', '업무내용', '시작', '종료', '연장시간', '비고'], rows))
  }

  function exportProjectCsv() {
    const rows = byProjectGroups.flatMap(g => g.records.map(r => [
      g.proj.name, r.work_date, employeeName(r.employee_id), r.task_description, r.start_time, r.end_time, r.hours, r.note,
    ]))
    downloadCsv(`프로젝트별_투입내역_${viewYear}-${viewMonth + 1}.csv`, toCsv(['프로젝트', '날짜', '직원', '업무내용', '시작', '종료', '연장시간', '비고'], rows))
  }

  function exportGridCsv() {
    const headers = ['직원', ...days.map(d => `${d.month + 1}/${d.day}`), '합계']
    const rows = employees.map(emp => [
      emp.name,
      ...days.map(d => gridSummaries.get(summaryKey(emp.id, d.dateStr))?.total_hours ?? ''),
      employeeTotals.find(t => t.id === emp.id)?.hours ?? 0,
    ])
    rows.push(['합계', ...days.map(d => dailyTotals.get(d.dateStr) ?? ''), grandTotal])
    downloadCsv(`월간집계표_${viewYear}-${viewMonth + 1}.csv`, toCsv(headers, rows))
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f8f8f7' }}>
      <header className="no-print" style={{ background: '#fff', borderBottom: '1px solid #e8e8e6' }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', padding: isMobile ? '0 12px' : '0 24px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Link href="/overtime" style={{ textDecoration: 'none', color: '#888', fontSize: 13 }}>← 그리드로</Link>
            <span style={{ fontSize: 14, color: '#555' }}>연장근무 출력</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button onClick={prevMonth} style={navBtn}>‹</button>
            <span style={{ fontSize: 14, fontWeight: 600, minWidth: 90, textAlign: 'center', color: '#111' }}>{viewYear}년 {MONTH_NAMES[viewMonth]}</span>
            <span style={{ fontSize: 12, color: '#999' }}>({periodLabel})</span>
            <button onClick={nextMonth} style={navBtn}>›</button>
            <button onClick={() => window.print()} style={{ ...outlineBtn, marginLeft: 8 }}>인쇄 / PDF로 저장</button>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1400, margin: '0 auto', padding: isMobile ? '12px 12px 60px' : '20px 24px 60px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h1 style={{ fontSize: 16, fontWeight: 700, color: '#111', margin: 0 }}>{viewYear}년 {MONTH_NAMES[viewMonth]} 연장근무 출력 ({periodLabel})</h1>

        {error && (
          <div style={{ padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, color: '#b91c1c' }}>{error}</div>
        )}

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#bbb', fontSize: 13 }}>불러오는 중...</div>
        ) : (
          <>
            {/* 전체 월간 집계표 */}
            <Section title="전체 월간 집계표" onExport={exportGridCsv}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', fontSize: 11, width: '100%' }}>
                  <thead>
                    <tr style={{ background: '#f4f4f2' }}>
                      <th style={thLeft}>직원</th>
                      {days.map((d, i) => (
                        <th key={d.dateStr} style={{ ...thCenter, borderLeft: (i === 0 || d.day === 1) ? '2px solid #ccc' : thCenter.borderLeft }}>
                          {(i === 0 || d.day === 1) ? `${d.month + 1}/${d.day}` : d.day}
                        </th>
                      ))}
                      <th style={{ ...thCenter, fontWeight: 700 }}>합계</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employees.map(emp => (
                      <tr key={emp.id}>
                        <td style={tdLeft}>{emp.name}</td>
                        {days.map((d, i) => {
                          const hours = gridSummaries.get(summaryKey(emp.id, d.dateStr))?.total_hours
                          return <td key={d.dateStr} style={{ ...tdCenter, borderLeft: (i === 0 || d.day === 1) ? '2px solid #ccc' : tdCenter.borderLeft }}>{hours ? hours : ''}</td>
                        })}
                        <td style={{ ...tdCenter, fontWeight: 700 }}>{formatHours(employeeTotals.find(t => t.id === emp.id)?.hours ?? 0)}</td>
                      </tr>
                    ))}
                    <tr style={{ background: '#f9f9f8', borderTop: '2px solid #e8e8e6' }}>
                      <td style={{ ...tdLeft, fontWeight: 700 }}>합계</td>
                      {days.map((d, i) => {
                        const hours = dailyTotals.get(d.dateStr)
                        return <td key={d.dateStr} style={{ ...tdCenter, fontWeight: 700, borderLeft: (i === 0 || d.day === 1) ? '2px solid #ccc' : tdCenter.borderLeft }}>{hours ? hours : ''}</td>
                      })}
                      <td style={{ ...tdCenter, fontWeight: 700 }}>{formatHours(grandTotal)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Section>

            {/* 직원별 연장근무 내역 */}
            <Section title="직원별 연장근무 내역" onExport={exportEmployeeCsv}>
              {byEmployeeGroups.length === 0 ? (
                <EmptyNote />
              ) : (
                byEmployeeGroups.map(g => (
                  <GroupTable key={g.emp.id} label={g.emp.name} totalHours={employeeTotals.find(t => t.id === g.emp.id)?.hours ?? 0}>
                    {g.records.map(r => (
                      <tr key={r.id}>
                        <td style={tdLeft}>{r.work_date}</td>
                        <td style={tdLeft}>{projectName(r.project_id)}</td>
                        <td style={tdLeft}>{r.task_description}</td>
                        <td style={tdCenter}>{r.start_time}~{r.end_time}</td>
                        <td style={tdCenter}>{formatHours(r.hours)}</td>
                        <td style={tdLeft}>{r.note}</td>
                      </tr>
                    ))}
                  </GroupTable>
                ))
              )}
            </Section>

            {/* 프로젝트별 투입내역 */}
            <Section title="프로젝트별 투입내역" onExport={exportProjectCsv}>
              {byProjectGroups.length === 0 ? (
                <EmptyNote />
              ) : (
                byProjectGroups.map(g => (
                  <GroupTable key={g.proj.id} label={g.proj.name} totalHours={projectTotals.find(t => t.id === g.proj.id)?.hours ?? 0}>
                    {g.records.map(r => (
                      <tr key={r.id}>
                        <td style={tdLeft}>{r.work_date}</td>
                        <td style={tdLeft}>{employeeName(r.employee_id)}</td>
                        <td style={tdLeft}>{r.task_description}</td>
                        <td style={tdCenter}>{r.start_time}~{r.end_time}</td>
                        <td style={tdCenter}>{formatHours(r.hours)}</td>
                        <td style={tdLeft}>{r.note}</td>
                      </tr>
                    ))}
                  </GroupTable>
                ))
              )}
            </Section>
          </>
        )}
      </div>
    </div>
  )
}

function Section({ title, onExport, children }: { title: string; onExport: () => void; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e8e8e6', borderRadius: 8, padding: '16px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#111' }}>{title}</div>
        <button className="no-print" onClick={onExport} style={outlineBtn}>CSV 다운로드</button>
      </div>
      {children}
    </div>
  )
}

function GroupTable({ label, totalHours, children }: { label: string; totalHours: number; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#333', marginBottom: 6 }}>
        {label} <span style={{ color: '#999', fontWeight: 400 }}>· 합계 {formatHours(totalHours)}</span>
      </div>
      <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
        <thead>
          <tr style={{ background: '#f4f4f2' }}>
            <th style={thLeft}>날짜</th>
            <th style={thLeft}>프로젝트/직원</th>
            <th style={thLeft}>업무내용</th>
            <th style={thCenter}>시간</th>
            <th style={thCenter}>연장시간</th>
            <th style={thLeft}>비고</th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

function EmptyNote() {
  return <div style={{ padding: '20px 0', textAlign: 'center', color: '#bbb', fontSize: 13 }}>이번 달 기록이 없습니다</div>
}

function toCsv(headers: string[], rows: (string | number)[][]): string {
  const escape = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
  return [headers, ...rows].map(r => r.map(escape).join(',')).join('\n')
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

const navBtn: React.CSSProperties = { border: 'none', background: 'none', cursor: 'pointer', color: '#888', fontSize: 16, padding: '2px 8px', borderRadius: 4 }
const outlineBtn: React.CSSProperties = { height: 30, padding: '0 12px', borderRadius: 6, border: '1px solid #e8e8e6', background: '#fff', color: '#333', fontSize: 12, cursor: 'pointer' }
const thLeft: React.CSSProperties = { padding: '6px 10px', textAlign: 'left', fontWeight: 500, color: '#555', borderBottom: '1px solid #e8e8e6', whiteSpace: 'nowrap' }
const thCenter: React.CSSProperties = { ...thLeft, textAlign: 'center' }
const tdLeft: React.CSSProperties = { padding: '6px 10px', color: '#333', borderBottom: '1px solid #f0f0ee' }
const tdCenter: React.CSSProperties = { ...tdLeft, textAlign: 'center', whiteSpace: 'nowrap' }
