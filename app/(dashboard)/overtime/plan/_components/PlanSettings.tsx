'use client'

import { useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { friendlyOvertimeError } from '@/lib/overtime/planning/errors'
import type { MemberTask } from '@/lib/overtime/planningTypes'
import type { Employee, EmployeeTask, Project, ProjectMember } from '@/lib/overtime/types'

/**
 * 자동배정 설정 — 직원별 월 목표시간, 참여 프로젝트, 프로젝트별 담당업무.
 * 표 하나에 다 넣지 않고 직원 행을 펼쳐 그 직원의 프로젝트·업무만 보여준다.
 *  - 월 목표: 급여기간 직원별 총 연장근무 한도(수동·자동 합산). 비우면 "미입력"(행 삭제 → 자동배정·수동 입력 차단),
 *    0은 "0시간"(유효, 양수 입력 모두 차단) — 둘을 구분한다
 *  - 참여 프로젝트: overtime_project_members(기존 담당직원 테이블)를 그대로 쓴다
 *  - 업무: overtime_member_tasks. 하나도 고르지 않으면 그 직원의 기본업무 전체를 쓴다
 */

export interface CandidateProject {
  project: Project
  submitDate: string | null
}

export default function PlanSettings({
  periodLabel,
  employees,
  targets,
  lockedHours,
  candidates,
  allProjects,
  members,
  memberTasks,
  tasks,
  canWrite,
  onChanged,
}: {
  periodLabel: string
  employees: Employee[]
  targets: Map<string, number>
  lockedHours: Map<string, number>
  candidates: CandidateProject[]           // 이 급여기간에 배정할 수 있는 프로젝트(제출일 순)
  allProjects: Project[]
  members: ProjectMember[]
  memberTasks: Pick<MemberTask, 'id' | 'member_id' | 'task_id'>[]
  tasks: EmployeeTask[]
  canWrite: boolean
  onChanged: () => void
}) {
  const supabase = createSupabaseBrowserClient()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  const md = (d: string | null) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : '')

  async function saveTarget(employeeId: string, text: string) {
    setError(null)
    const value = text.trim()
    let res
    if (value === '') {
      res = await supabase.from('overtime_monthly_targets').delete().eq('employee_id', employeeId).eq('period_label', periodLabel)
    } else {
      const hours = Number(value)
      if (!Number.isFinite(hours) || hours < 0 || hours > 999) { setError('월 목표시간은 0 이상의 숫자로 입력하세요'); return }
      res = await supabase.from('overtime_monthly_targets')
        .upsert({ employee_id: employeeId, period_label: periodLabel, target_hours: hours }, { onConflict: 'employee_id,period_label' })
    }
    if (res.error) { setError(friendlyOvertimeError(res.error.message)); return }
    setDrafts(d => { const n = { ...d }; delete n[employeeId]; return n })
    onChanged()
  }

  async function toggleProject(employeeId: string, projectId: string, on: boolean) {
    setError(null)
    const res = on
      ? await supabase.from('overtime_project_members').insert({ project_id: projectId, employee_id: employeeId })
      : await supabase.from('overtime_project_members').delete().eq('project_id', projectId).eq('employee_id', employeeId)
    if (res.error) { setError(friendlyOvertimeError(res.error.message)); return }
    onChanged()
  }

  async function toggleTask(memberId: string, employeeId: string, taskId: string, on: boolean) {
    setError(null)
    const res = on
      ? await supabase.from('overtime_member_tasks').insert({ member_id: memberId, task_id: taskId, employee_id: employeeId })
      : await supabase.from('overtime_member_tasks').delete().eq('member_id', memberId).eq('task_id', taskId)
    if (res.error) { setError(friendlyOvertimeError(res.error.message)); return }
    onChanged()
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #e8e8e6', borderRadius: 8 }}>
      {error && <div style={{ margin: 12, padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, color: '#b91c1c' }}>{error}</div>}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: '#f4f4f2', color: '#555', fontSize: 12 }}>
            <th style={thL}>직원</th>
            <th style={th}>월 목표시간</th>
            <th style={th}>이미 입력된 시간</th>
            <th style={th}>참여 프로젝트</th>
            <th style={th}></th>
          </tr>
        </thead>
        <tbody>
          {employees.map(emp => {
            const mine = members.filter(m => m.employee_id === emp.id)
            const target = targets.get(emp.id)
            const text = drafts[emp.id] ?? (target === undefined ? '' : String(target))
            const open = expanded === emp.id
            const ownTasks = tasks.filter(t => t.employee_id === emp.id)
            // 고를 수 있는 프로젝트 = 이 기간 배정 가능 + 이미 참여 중(종료됐어도 해제할 수 있게)
            const shown = [
              ...candidates,
              ...mine.filter(m => !candidates.some(c => c.project.id === m.project_id))
                .map(m => ({ project: allProjects.find(p => p.id === m.project_id)!, submitDate: null }))
                .filter(c => c.project),
            ]
            return [
              <tr key={emp.id} style={{ borderTop: '1px solid #f0f0ee' }}>
                <td style={tdL}>
                  <span style={{ fontWeight: 600 }}>{emp.name}</span>
                  <span style={{ fontSize: 11, color: '#999', marginLeft: 6 }}>{emp.position}</span>
                </td>
                <td style={td}>
                  <input
                    value={text}
                    disabled={!canWrite}
                    inputMode="decimal"
                    placeholder="미입력"
                    onChange={e => setDrafts(d => ({ ...d, [emp.id]: e.target.value }))}
                    onBlur={e => { if (e.target.value.trim() !== (target === undefined ? '' : String(target))) saveTarget(emp.id, e.target.value) }}
                    style={{ width: 70, height: 30, textAlign: 'right', padding: '0 8px', border: '1px solid #e8e8e6', borderRadius: 6, fontSize: 13, background: target === undefined ? '#fffbeb' : '#fff' }}
                  />
                  <span style={{ fontSize: 11, color: '#999', marginLeft: 4 }}>시간</span>
                </td>
                <td style={td}>
                  {lockedHours.get(emp.id) ? `${lockedHours.get(emp.id)}시간` : '-'}
                  {/* 월 목표 = 급여기간 총 한도. 목표를 기존 합계보다 낮추면 기록은 그대로 두고 초과 상태로 표시(이후 증가 입력은 차단) */}
                  {target !== undefined && (lockedHours.get(emp.id) ?? 0) > target && (
                    <span data-testid="over-target" style={{ marginLeft: 6, fontSize: 11, padding: '1px 6px', borderRadius: 4, background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' }}>
                      목표 초과 {Math.round(((lockedHours.get(emp.id) ?? 0) - target) * 100) / 100}시간
                    </span>
                  )}
                </td>
                <td style={td}>{mine.length > 0 ? `${mine.length}개` : <span style={{ color: '#b91c1c' }}>없음</span>}</td>
                <td style={td}>
                  <button onClick={() => setExpanded(open ? null : emp.id)} style={open ? btnActive : btn}>프로젝트·업무 {open ? '▲' : '▼'}</button>
                </td>
              </tr>,
              open && (
                <tr key={`${emp.id}-detail`}>
                  <td colSpan={5} style={{ padding: '4px 16px 14px', background: '#fafaf9' }}>
                    {shown.length === 0 ? (
                      <div style={{ fontSize: 12, color: '#999', padding: 8 }}>이 급여기간에 배정할 수 있는 프로젝트가 없습니다</div>
                    ) : shown.map(({ project, submitDate }) => {
                      const member = mine.find(m => m.project_id === project.id)
                      const chosen = member ? memberTasks.filter(mt => mt.member_id === member.id).map(mt => mt.task_id) : []
                      return (
                        <div key={project.id} style={{ padding: '8px 0', borderBottom: '1px solid #f0f0ee' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: canWrite ? 'pointer' : 'default' }}>
                            <input type="checkbox" checked={!!member} disabled={!canWrite} onChange={e => toggleProject(emp.id, project.id, e.target.checked)} />
                            <span style={{ fontWeight: 600 }}>{project.name}</span>
                            <span style={{ fontSize: 11, color: '#999' }}>
                              {md(project.start_date)}~{md(project.end_date)}{submitDate ? ` · 제출 ${md(submitDate)}` : ''}{project.status === '종료' ? ' · 종료' : ''}
                            </span>
                          </label>
                          {member && (
                            <div style={{ margin: '6px 0 0 24px', display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                              {ownTasks.length === 0 ? (
                                <span style={{ fontSize: 11, color: '#b91c1c' }}>등록된 업무가 없습니다 — 직원 관리 → 기본업무내용에서 먼저 등록하세요</span>
                              ) : ownTasks.map(t => (
                                <label key={t.id} style={{ ...chip, background: chosen.includes(t.id) ? '#111' : '#fff', color: chosen.includes(t.id) ? '#fff' : '#333' }}>
                                  <input type="checkbox" style={{ display: 'none' }} checked={chosen.includes(t.id)} disabled={!canWrite}
                                    onChange={e => toggleTask(member.id, emp.id, t.id, e.target.checked)} />
                                  {t.task_name}
                                </label>
                              ))}
                              {ownTasks.length > 0 && (
                                <span style={{ fontSize: 11, color: '#999' }}>{chosen.length === 0 ? '고르지 않으면 기본업무 전체 사용' : `${chosen.length}개 사용`}</span>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </td>
                </tr>
              ),
            ]
          })}
        </tbody>
      </table>
    </div>
  )
}

const th: React.CSSProperties = { padding: '8px 10px', fontWeight: 500, textAlign: 'center' }
const thL: React.CSSProperties = { ...th, textAlign: 'left' }
const td: React.CSSProperties = { padding: '8px 10px', textAlign: 'center' }
const tdL: React.CSSProperties = { ...td, textAlign: 'left' }
const btn: React.CSSProperties = { height: 28, padding: '0 10px', borderRadius: 4, borderWidth: 1, borderStyle: 'solid', borderColor: '#e8e8e6', background: '#fff', color: '#555', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' }
const btnActive: React.CSSProperties = { ...btn, background: '#111', color: '#fff', borderColor: '#111' }
const chip: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', height: 24, padding: '0 10px', borderRadius: 12, border: '1px solid #e8e8e6', fontSize: 12, cursor: 'pointer' }
