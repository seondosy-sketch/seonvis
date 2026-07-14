import { Employee, Project, ProjectMember, WorkRecord } from '@/lib/overtime/types'
import { formatHours, PayPeriodDay } from '@/lib/overtime/summary'

const DAY_LABEL = ['일', '월', '화', '수', '목', '금', '토']

/**
 * 프로젝트별 월간 그리드 — 행이 "프로젝트 × 담당직원", 열이 날짜인 표.
 *
 *   | 프로젝트명 | 담당직원 | 6/21 | 6/22 | ... | 7/20 | 합계 |
 *
 * MonthGrid(직원별 보기)와 같은 기간(PayPeriodDay[])을 쓰고, 셀 값도 같은
 * overtime_work_records에서 나온다 — 이 컴포넌트는 project_id까지 포함해
 * "프로젝트 × 직원 × 날짜"로 합산해서 보여줄 뿐, 저장 단위는 그대로다.
 *
 * 프로젝트에 시작일/종료일이 설정되어 있으면 기간 밖 날짜 셀은 회색으로 비활성화한다 —
 * "직원별로 프로젝트 기간 내에 근무시간을 입력"하게 하기 위함. 단, 기간 밖인데 이미
 * 기록이 있는 셀(기간을 나중에 좁힌 경우)은 값을 보여주고 클릭도 허용해 수정할 수 있게 한다.
 */
export default function ProjectGrid({
  days,
  projects,
  employees,
  members,
  records,
  onCellClick,
}: {
  days: PayPeriodDay[]
  projects: Project[]
  employees: Employee[]
  members: ProjectMember[]
  records: WorkRecord[]
  // anchor: 클릭한 셀의 화면 좌표 — 팝오버(OvertimeEntryPopover)를 셀 근처에 띄우는 데 쓴다
  onCellClick: (employeeId: string, projectId: string, date: string, anchor: { x: number; y: number }) => void
}) {
  const today = new Date()

  // 프로젝트 × 직원 × 날짜 셀 합계 — 저장 단위(WorkRecord)에서 매번 계산한다 (1단계 원칙)
  const cellHours = new Map<string, number>()
  for (const r of records) {
    const key = `${r.project_id}__${r.employee_id}__${r.work_date}`
    cellHours.set(key, (cellHours.get(key) ?? 0) + r.hours)
  }

  // 진행중 프로젝트 + (종료됐지만 이 기간에 기록이 있는 프로젝트)만 보여준다 —
  // 기록도 없는 종료 프로젝트까지 행으로 깔면 표만 길어진다.
  const recordedProjectIds = new Set(records.map(r => r.project_id))
  const visibleProjects = projects.filter(p => p.status === '진행중' || recordedProjectIds.has(p.id))

  // 프로젝트의 행 직원: 담당으로 배정된 직원 + (배정은 안 됐지만 이 기간에 그 프로젝트
  // 기록이 있는 직원). 후자를 빼면 이미 입력된 시간이 화면에서 사라져 보인다.
  function rowEmployees(project: Project): Employee[] {
    const ids = new Set(members.filter(m => m.project_id === project.id).map(m => m.employee_id))
    for (const r of records) if (r.project_id === project.id) ids.add(r.employee_id)
    return employees.filter(e => ids.has(e.id)) // employees가 이미 정렬순서대로라 그 순서를 따른다
  }

  // YYYY-MM-DD 문자열끼리는 사전순 비교가 곧 날짜 비교다 (UTC 파싱 버그 회피, docs/conventions.md)
  function inPeriod(project: Project, dateStr: string): boolean {
    if (project.start_date && dateStr < project.start_date) return false
    if (project.end_date && dateStr > project.end_date) return false
    return true
  }

  function periodLabel(project: Project): string {
    const fmt = (d: string) => { const [, m, day] = d.split('-').map(Number); return `${m}/${day}` }
    if (!project.start_date && !project.end_date) return ''
    return `${project.start_date ? fmt(project.start_date) : ''}~${project.end_date ? fmt(project.end_date) : ''}`
  }

  const dayMeta = (d: PayPeriodDay, isFirstOfMonth: boolean) => {
    const weekday = new Date(d.year, d.month, d.day).getDay()
    const isToday = today.getFullYear() === d.year && today.getMonth() === d.month && today.getDate() === d.day
    const color = weekday === 0 ? '#ef4444' : weekday === 6 ? '#3b82f6' : '#555'
    return { weekday, isToday, color, showMonthLabel: isFirstOfMonth }
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #e8e8e6', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 260px)' }}>
        {/* MonthGrid와 동일한 방식: 고정 컬럼만 폭을 주고 날짜 컬럼은 남은 폭을 균등 분배 */}
        <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: 12 }}>
          <colgroup>
            <col style={{ width: 110 }} />
            <col style={{ width: 84 }} />
            {days.map(d => <col key={d.dateStr} />)}
            <col style={{ width: 48 }} />
          </colgroup>
          <thead>
            <tr>
              <th style={cornerHeaderCell}>프로젝트</th>
              <th style={cornerHeaderCell}>담당직원</th>
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
            {visibleProjects.length === 0 ? (
              <tr>
                <td colSpan={days.length + 3} style={{ padding: 40, textAlign: 'center', color: '#bbb' }}>
                  진행중인 프로젝트가 없습니다. 프로젝트 관리에서 추가하세요.
                </td>
              </tr>
            ) : (
              visibleProjects.flatMap(project => {
                const rows = rowEmployees(project)
                const period = periodLabel(project)

                const projectCell = (rowSpan: number) => (
                  <td rowSpan={rowSpan} style={projectNameCell}>
                    <div style={{ fontWeight: 600, color: '#111', whiteSpace: 'normal', wordBreak: 'keep-all' }}>{project.name}</div>
                    {period && <div style={{ fontSize: 10, color: '#999', marginTop: 2 }}>{period}</div>}
                    {project.status === '종료' && <div style={{ fontSize: 10, color: '#bbb', marginTop: 2 }}>종료</div>}
                  </td>
                )

                if (rows.length === 0) {
                  return [(
                    <tr key={project.id}>
                      {projectCell(1)}
                      <td colSpan={days.length + 2} style={{ ...dataCellDisabled, textAlign: 'left', padding: '8px 12px', color: '#bbb', cursor: 'default' }}>
                        담당직원이 없습니다 — 프로젝트 관리에서 담당직원을 체크하세요
                      </td>
                    </tr>
                  )]
                }

                return rows.map((emp, rowIdx) => {
                  const rowTotal = days.reduce((sum, d) => sum + (cellHours.get(`${project.id}__${emp.id}__${d.dateStr}`) ?? 0), 0)
                  return (
                    <tr key={`${project.id}__${emp.id}`}>
                      {rowIdx === 0 && projectCell(rows.length)}
                      <td style={employeeCell}>
                        <div style={{ fontWeight: 600, color: '#111' }}>{emp.name}</div>
                        {emp.position && <div style={{ fontSize: 10, color: '#999' }}>{emp.position}</div>}
                      </td>
                      {days.map((d, i) => {
                        const isFirstOfMonth = i === 0 || d.day === 1
                        const hours = cellHours.get(`${project.id}__${emp.id}__${d.dateStr}`)
                        const active = inPeriod(project, d.dateStr)
                        // 기간 밖이라도 기록이 있으면 보여주고 수정할 수 있게 클릭을 허용한다
                        const clickable = active || hours !== undefined
                        const base = clickable ? dataCell : dataCellDisabled
                        return (
                          <td
                            key={d.dateStr}
                            style={{
                              ...base,
                              background: active ? base.background : '#f4f4f2',
                              borderLeft: isFirstOfMonth ? '2px solid #ccc' : base.borderLeft,
                            }}
                            onClick={clickable ? e => onCellClick(emp.id, project.id, d.dateStr, { x: e.clientX, y: e.clientY }) : undefined}
                            title={active ? undefined : '프로젝트 기간 밖입니다'}
                          >
                            {hours !== undefined && (
                              <span style={{ fontWeight: 600, color: '#111' }}>{formatHours(hours)}</span>
                            )}
                          </td>
                        )
                      })}
                      <td style={totalCell}>{rowTotal > 0 ? formatHours(rowTotal) : ''}</td>
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

const employeeCell: React.CSSProperties = {
  padding: '8px 8px',
  borderBottom: '1px solid #f0f0ee',
  borderRight: '1px solid #e8e8e6',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

const dataCell: React.CSSProperties = {
  height: 40,
  borderBottom: '1px solid #f0f0ee',
  borderLeft: '1px solid #f0f0ee',
  textAlign: 'center',
  cursor: 'pointer',
  overflow: 'hidden',
  background: '#fff',
}

const dataCellDisabled: React.CSSProperties = {
  ...dataCell,
  cursor: 'default',
  background: '#f4f4f2',
}

const totalCell: React.CSSProperties = {
  height: 40,
  borderBottom: '1px solid #f0f0ee',
  borderLeft: '1px solid #e8e8e6',
  textAlign: 'center',
  fontWeight: 700,
  color: '#111',
  background: '#fbfbfa',
  overflow: 'hidden',
}
