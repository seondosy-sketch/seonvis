import { useMemo } from 'react'
import type { PayPeriodDay } from '@/lib/attendance/period'
import { computeAttendancePeriod, isDateWithinAttendancePeriod } from '@/lib/attendance/participantPeriod'
import { presentDatesByParticipant } from '@/lib/attendance/summary'
import type { AttendanceRecord, ProjectParticipant } from '@/lib/attendance/types'
import type { EngineerContact, EngineerSpecialty } from '@/lib/engineers/types'
import type { AttendanceProjectRow } from '../types'

const DAY_LABEL = ['일', '월', '화', '수', '목', '금', '토']

/**
 * 기술인 출근부 월별 그리드 — 행이 "프로젝트 × 참여기술인", 열이 날짜인 표.
 * 연장근무 ProjectGrid.tsx(프로젝트×담당직원 rowSpan 병합, 기간 밖 음영 처리)의 구조를 그대로 응용했다.
 *
 * 셀 클릭 가능 여부는 프로젝트 공고일~면접일과 참여기간(관리자 예외조정 포함)을 함께 판정한다
 * (lib/attendance/participantPeriod.ts, Phase 1에서 이미 구현된 순수 로직 재사용 — 중복 구현하지 않음).
 */
export default function AttendanceGrid({
  days,
  projects,
  getRowParticipants,
  engineersById,
  specialtiesById,
  records,
  presentCounts,
  pendingCells,
  editable,
  onToggleCell,
  onManageProject,
}: {
  days: PayPeriodDay[]
  projects: AttendanceProjectRow[]
  getRowParticipants: (projectId: string) => ProjectParticipant[]
  engineersById: Map<string, EngineerContact>
  specialtiesById: Map<string, EngineerSpecialty>
  records: AttendanceRecord[]
  presentCounts: Map<string, number>
  pendingCells: Set<string>
  editable: boolean
  onToggleCell: (participant: ProjectParticipant, project: AttendanceProjectRow, dateStr: string) => void
  onManageProject: (project: AttendanceProjectRow) => void
}) {
  const today = new Date()
  const periodEnd = days[days.length - 1].dateStr

  const presentDates = useMemo(() => presentDatesByParticipant(records), [records])

  const dayMeta = (d: PayPeriodDay, isFirstOfMonth: boolean) => {
    const weekday = new Date(d.year, d.month, d.day).getDay()
    const isToday = today.getFullYear() === d.year && today.getMonth() === d.month && today.getDate() === d.day
    const color = weekday === 0 ? '#ef4444' : weekday === 6 ? '#3b82f6' : '#555'
    return { weekday, isToday, color, showMonthLabel: isFirstOfMonth }
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #e8e8e6', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 260px)' }}>
        <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: 12 }}>
          <colgroup>
            <col style={{ width: 160 }} />
            <col style={{ width: 64 }} />
            <col style={{ width: 64 }} />
            <col style={{ width: 84 }} />
            {days.map(d => <col key={d.dateStr} />)}
            <col style={{ width: 48 }} />
          </colgroup>
          <thead>
            <tr>
              <th style={cornerHeaderCell}>프로젝트</th>
              <th style={cornerHeaderCell}>직책</th>
              <th style={cornerHeaderCell}>분야</th>
              <th style={cornerHeaderCell}>성명</th>
              {days.map((d, i) => {
                const isFirstOfMonth = i === 0 || d.day === 1
                const { weekday, isToday, color, showMonthLabel } = dayMeta(d, isFirstOfMonth)
                return (
                  <th
                    key={d.dateStr}
                    style={{
                      ...dayHeaderCell,
                      background: isToday ? '#eff6ff' : '#f4f4f2',
                      borderLeft: isFirstOfMonth ? '2px solid #ccc' : dayHeaderCell.borderLeft,
                    }}
                  >
                    <div style={{ fontSize: 9, color: '#aaa', height: 11 }}>{showMonthLabel ? `${d.month + 1}월` : ''}</div>
                    <div style={{ color, fontWeight: 600 }}>{d.day}</div>
                    <div style={{ color, opacity: 0.7, fontSize: 10 }}>{DAY_LABEL[weekday]}</div>
                  </th>
                )
              })}
              <th style={{ ...cornerHeaderCell, textAlign: 'center' }}>합계</th>
            </tr>
          </thead>
          <tbody>
            {projects.length === 0 ? (
              <tr>
                <td colSpan={days.length + 5} style={{ padding: 40, textAlign: 'center', color: '#bbb' }}>
                  조회된 프로젝트가 없습니다.
                </td>
              </tr>
            ) : (
              projects.flatMap(project => {
                const rows = getRowParticipants(project.id)

                const projectCell = (rowSpan: number) => (
                  <td rowSpan={rowSpan} style={projectNameCell}>
                    <div style={{ fontWeight: 600, color: '#111', whiteSpace: 'normal', wordBreak: 'keep-all' }}>{project.name}</div>
                    <div style={{ fontSize: 10, color: '#999', marginTop: 2 }}>{project.project_number}</div>
                    {editable && (
                      <button onClick={() => onManageProject(project)} style={manageBtn}>참여기술인 관리</button>
                    )}
                  </td>
                )

                if (rows.length === 0) {
                  return [(
                    <tr key={project.id}>
                      {projectCell(1)}
                      <td colSpan={days.length + 4} style={{ ...dataCellDisabled, textAlign: 'left', padding: '8px 12px', color: '#bbb', cursor: 'default' }}>
                        등록된 참여기술인이 없습니다.
                      </td>
                    </tr>
                  )]
                }

                return rows.map((participant, rowIdx) => {
                  const period = computeAttendancePeriod({
                    announceDate: project.announce_date,
                    interviewDate: project.interview_date,
                    participationStart: participant.participation_start,
                    participationEnd: participant.participation_end,
                    viewedPeriodEnd: periodEnd,
                  })
                  const engineer = engineersById.get(participant.engineer_id)
                  const specialty = participant.specialty_id ? specialtiesById.get(participant.specialty_id) : undefined
                  const total = presentCounts.get(participant.id) ?? 0
                  const presentSet = presentDates.get(participant.id)

                  return (
                    <tr key={participant.id}>
                      {rowIdx === 0 && projectCell(rows.length)}
                      <td style={infoCell}>{participant.role}{participant.is_director && <span style={directorBadge}>단장</span>}</td>
                      <td style={infoCell}>{specialty?.name ?? ''}</td>
                      <td style={infoCell}>{engineer?.name ?? '(알 수 없음)'}</td>
                      {days.map((d, i) => {
                        const isFirstOfMonth = i === 0 || d.day === 1
                        const eligible = isDateWithinAttendancePeriod(period, d.dateStr)
                        const present = presentSet?.has(d.dateStr) ?? false
                        const pending = pendingCells.has(`${participant.id}__${d.dateStr}`)
                        const clickable = editable && eligible && !pending
                        const base = eligible ? dataCell : dataCellDisabled
                        const borderLeft = isFirstOfMonth ? '2px solid #ccc' : base.borderLeft
                        return (
                          <td
                            key={d.dateStr}
                            style={{
                              ...base,
                              borderLeft,
                              background: present ? '#facc15' : eligible ? '#fff' : '#f4f4f2',
                              color: present ? '#78350a' : undefined,
                              fontWeight: present ? 700 : undefined,
                              cursor: clickable ? 'pointer' : 'default',
                              opacity: pending ? 0.5 : 1,
                            }}
                            onClick={clickable ? () => onToggleCell(participant, project, d.dateStr) : undefined}
                            title={!eligible ? '체크 가능 기간이 아닙니다' : undefined}
                          >
                            {present ? '✓' : ''}
                          </td>
                        )
                      })}
                      <td style={totalCell}>{total > 0 ? total : ''}</td>
                    </tr>
                  )
                })
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const cornerHeaderCell: React.CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 2,
  background: '#f4f4f2',
  padding: '8px 8px',
  textAlign: 'left',
  fontWeight: 500,
  color: '#555',
  borderBottom: '1px solid #e8e8e6',
  borderRight: '1px solid #e8e8e6',
  overflow: 'hidden',
}

const dayHeaderCell: React.CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 2,
  padding: '6px 2px',
  textAlign: 'center',
  borderBottom: '1px solid #e8e8e6',
  borderLeft: '1px solid #f0f0ee',
  overflow: 'hidden',
}

const projectNameCell: React.CSSProperties = {
  padding: '8px 8px',
  borderBottom: '1px solid #e8e8e6',
  borderRight: '1px solid #e8e8e6',
  verticalAlign: 'top',
  background: '#fbfbfa',
  overflow: 'hidden',
}

const infoCell: React.CSSProperties = {
  padding: '8px 6px',
  borderBottom: '1px solid #f0f0ee',
  borderRight: '1px solid #e8e8e6',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

const dataCell: React.CSSProperties = {
  height: 36,
  borderBottom: '1px solid #f0f0ee',
  borderLeft: '1px solid #f0f0ee',
  textAlign: 'center',
  overflow: 'hidden',
}

const dataCellDisabled: React.CSSProperties = {
  ...dataCell,
}

const totalCell: React.CSSProperties = {
  height: 36,
  borderBottom: '1px solid #f0f0ee',
  borderLeft: '1px solid #e8e8e6',
  textAlign: 'center',
  fontWeight: 700,
  color: '#111',
  background: '#fbfbfa',
  overflow: 'hidden',
}

const manageBtn: React.CSSProperties = {
  marginTop: 6,
  height: 22,
  padding: '0 8px',
  borderRadius: 4,
  border: '1px solid #e8e8e6',
  background: '#fff',
  color: '#555',
  fontSize: 10,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

const directorBadge: React.CSSProperties = {
  marginLeft: 4,
  fontSize: 9,
  padding: '1px 4px',
  borderRadius: 3,
  background: '#fffbeb',
  color: '#b45309',
  border: '1px solid #fde68a',
}
