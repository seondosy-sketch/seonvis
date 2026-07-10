'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { useIsMobile } from '@/lib/useIsMobile'
import { Employee, Project, WorkRecord } from '@/lib/overtime/types'
import { LabeledTotal, formatHours, monthRange, sumHoursByDate, sumHoursByEmployee, sumHoursByProject } from '@/lib/overtime/summary'

const MONTH_NAMES = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월']

// 프로젝트별 투입 비율의 색 순서 — 항상 이 순서로 고정해서 쓰고, 7번째부터는 "기타"로 묶는다
// (프로젝트 수가 늘어난다고 색을 계속 새로 만들지 않음). 이미 이 앱 다른 화면에서 쓰는 색만 재사용했다.
const CATEGORY_COLORS = ['#f59e0b', '#1d4ed8', '#15803d', '#f97316', '#7c3aed', '#ef4444']
const OTHER_COLOR = '#aaa'
const MAX_CATEGORY_SLOTS = CATEGORY_COLORS.length

export default function OvertimeDashboardPage() {
  const isMobile = useIsMobile()
  const supabase = createSupabaseBrowserClient()

  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()

  const [employees, setEmployees] = useState<Employee[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [records, setRecords] = useState<WorkRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { start, end } = monthRange(year, month)
    const [empRes, projRes, recRes] = await Promise.all([
      supabase.from('overtime_employees').select('*'),
      supabase.from('overtime_projects').select('*'),
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

  useEffect(() => { load() }, [load])

  const totalHours = records.reduce((sum, r) => sum + r.hours, 0)
  const byEmployee = sumHoursByEmployee(records, employees)
  const byProject = sumHoursByProject(records, projects)
  const byDate = sumHoursByDate(records)

  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const dailyBars = Array.from({ length: daysInMonth }, (_, i) => {
    const day = i + 1
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    return { day, weekday: new Date(year, month, day).getDay(), hours: byDate.get(dateStr) ?? 0 }
  })

  const recent = [...records]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 10)
  const employeeNameById = new Map(employees.map(e => [e.id, e.name]))
  const projectNameById = new Map(projects.map(p => [p.id, p.name]))

  return (
    <div style={{ minHeight: '100vh', background: '#f8f8f7' }}>
      <header style={{ background: '#fff', borderBottom: '1px solid #e8e8e6' }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', padding: isMobile ? '0 12px' : '0 24px', height: 56, display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link href="/overtime" style={{ textDecoration: 'none', color: '#888', fontSize: 13 }}>← 그리드로</Link>
          <span style={{ fontSize: 14, color: '#555' }}>연장근무 대시보드 · {year}년 {MONTH_NAMES[month]} (이번 달)</span>
        </div>
      </header>

      <div style={{ maxWidth: 1400, margin: '0 auto', padding: isMobile ? '12px 12px 60px' : '20px 24px 60px' }}>
        {error && (
          <div style={{ marginBottom: 12, padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, color: '#b91c1c' }}>{error}</div>
        )}

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#bbb', fontSize: 13 }}>불러오는 중...</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* 이번 달 총 연장시간 */}
            <Card>
              <div style={{ fontSize: 12, color: '#999', marginBottom: 6 }}>이번 달 총 연장시간</div>
              <div style={{ fontSize: 36, fontWeight: 700, color: '#111' }}>{formatHours(totalHours)}</div>
              <div style={{ fontSize: 12, color: '#bbb', marginTop: 4 }}>{records.length}건 · {byEmployee.length}명 · {byProject.length}개 프로젝트</div>
            </Card>

            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16 }}>
              <Card title="직원별 연장시간">
                <RankedBars items={byEmployee} emptyText="이번 달 기록이 없습니다" />
              </Card>
              <Card title="프로젝트별 연장시간">
                <RankedBars items={byProject} emptyText="이번 달 기록이 없습니다" />
              </Card>
            </div>

            <Card title="일별 연장시간">
              <DailyBarChart bars={dailyBars} />
            </Card>

            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16 }}>
              <Card title="프로젝트별 투입 비율">
                <ShareBar items={byProject} totalHours={totalHours} />
              </Card>
              <Card title="최근 입력 내역">
                {recent.length === 0 ? (
                  <div style={{ padding: '20px 0', textAlign: 'center', color: '#bbb', fontSize: 13 }}>등록된 업무가 없습니다</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {recent.map((r, i) => (
                      <div key={r.id} style={{ padding: '10px 0', borderBottom: i < recent.length - 1 ? '1px solid #f0f0ee' : 'none' }}>
                        <div style={{ fontSize: 12, color: '#555' }}>
                          {employeeNameById.get(r.employee_id) ?? '(알 수 없음)'} · {projectNameById.get(r.project_id) ?? '(알 수 없음)'}
                        </div>
                        <div style={{ fontSize: 13, color: '#111' }}>{r.task_description}</div>
                        <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>
                          {r.work_date} {r.start_time}~{r.end_time} · {formatHours(r.hours)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e8e8e6', borderRadius: 8, padding: '16px 20px' }}>
      {title && <div style={{ fontSize: 13, fontWeight: 600, color: '#333', marginBottom: 12 }}>{title}</div>}
      {children}
    </div>
  )
}

/** 직원별/프로젝트별 연장시간 — 값(크기)만 다루는 단일 계열이라 색은 하나(amber)로 고정, 길이로만 크기를 표현한다. */
function RankedBars({ items, emptyText }: { items: LabeledTotal[]; emptyText: string }) {
  if (items.length === 0) return <div style={{ padding: '20px 0', textAlign: 'center', color: '#bbb', fontSize: 13 }}>{emptyText}</div>
  const max = Math.max(...items.map(i => i.hours))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map(item => (
        <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }} title={`${item.label} ${formatHours(item.hours)}`}>
          <div style={{ width: 88, flexShrink: 0, fontSize: 12, color: '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</div>
          <div style={{ flex: 1, height: 10, background: '#f4f4f2', borderRadius: 5, overflow: 'hidden' }}>
            <div style={{ width: `${max > 0 ? (item.hours / max) * 100 : 0}%`, height: '100%', background: '#f59e0b', borderRadius: 5 }} />
          </div>
          <div style={{ width: 44, flexShrink: 0, fontSize: 12, color: '#111', fontWeight: 600, textAlign: 'right' }}>{formatHours(item.hours)}</div>
        </div>
      ))}
    </div>
  )
}

/** 일별 연장시간 — 날짜(축)를 따라가는 크기 비교라 세로 막대 하나로 충분, 색은 하나로 고정. */
function DailyBarChart({ bars }: { bars: { day: number; weekday: number; hours: number }[] }) {
  const max = Math.max(1, ...bars.map(b => b.hours))
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 110, overflowX: 'auto' }}>
      {bars.map(b => (
        <div key={b.day} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: '1 0 auto', minWidth: 16 }} title={`${b.day}일: ${formatHours(b.hours)}`}>
          <div style={{ width: '100%', height: 80, display: 'flex', alignItems: 'flex-end' }}>
            <div style={{ width: '100%', height: `${(b.hours / max) * 100}%`, minHeight: b.hours > 0 ? 2 : 0, background: '#f59e0b', borderRadius: '3px 3px 0 0' }} />
          </div>
          <div style={{ fontSize: 9, marginTop: 4, color: b.weekday === 0 ? '#ef4444' : b.weekday === 6 ? '#3b82f6' : '#999' }}>{b.day}</div>
        </div>
      ))}
    </div>
  )
}

/** 프로젝트별 투입 비율 — 항목 자체가 정체성(어느 프로젝트인지)이라 색을 구분에 쓴다. 색은 고정 순서, 7개 이상은 "기타"로 묶는다. */
function ShareBar({ items, totalHours }: { items: LabeledTotal[]; totalHours: number }) {
  if (items.length === 0 || totalHours === 0) {
    return <div style={{ padding: '20px 0', textAlign: 'center', color: '#bbb', fontSize: 13 }}>이번 달 기록이 없습니다</div>
  }

  const top = items.slice(0, MAX_CATEGORY_SLOTS)
  const rest = items.slice(MAX_CATEGORY_SLOTS)
  const otherHours = rest.reduce((sum, i) => sum + i.hours, 0)
  const segments = [
    ...top.map((item, i) => ({ label: item.label, hours: item.hours, color: CATEGORY_COLORS[i] })),
    ...(otherHours > 0 ? [{ label: `기타 (${rest.length}개)`, hours: otherHours, color: OTHER_COLOR }] : []),
  ]

  return (
    <div>
      <div style={{ display: 'flex', height: 20, borderRadius: 6, overflow: 'hidden' }}>
        {segments.map((seg, i) => (
          <div
            key={seg.label}
            title={`${seg.label} · ${((seg.hours / totalHours) * 100).toFixed(1)}%`}
            style={{
              width: `${(seg.hours / totalHours) * 100}%`,
              background: seg.color,
              borderRight: i < segments.length - 1 ? '2px solid #fff' : 'none',
            }}
          />
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
        {segments.map(seg => (
          <div key={seg.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: seg.color, display: 'inline-block', flexShrink: 0 }} />
            <span style={{ color: '#555' }}>{seg.label}</span>
            <span style={{ color: '#111', fontWeight: 600 }}>{((seg.hours / totalHours) * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}
