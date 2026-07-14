'use client'

import { useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { DailySummary, Project, WorkRecord } from '@/lib/overtime/types'
import WorkRecordForm from './WorkRecordForm'

/**
 * "YYYY-MM-DD" 문자열을 로컬 타임존으로 직접 파싱한다.
 * new Date("2026-07-03")는 UTC로 해석되어 한국에서는 하루 전으로 밀릴 수 있으므로
 * (docs/conventions.md 참고) 문자열을 그대로 분해해서 쓴다.
 */
function formatDateHeader(date: string): string {
  const [, month, day] = date.split('-').map(Number)
  return `${month}월 ${day}일`
}

function formatHoursKorean(hours: number): string {
  const rounded = Math.round(hours * 100) / 100
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}시간`
}

/**
 * 셀 클릭 시 열리는 모달 — 날짜/총 연장시간/등록된 업무 목록을 보여주고,
 * 업무 추가·수정·삭제를 이 안에서 처리한다. 저장/삭제 후에는 항상 onSaved()를 불러
 * 부모(page.tsx)가 overtime_work_records를 다시 조회해 그리드·모달을 함께 갱신한다 —
 * 합계·건수를 이 컴포넌트가 직접 고치지 않는다(1단계 원칙: 항상 원본에서 재계산).
 */
export default function WorkRecordModal({
  employeeId,
  date,
  employeeName,
  summary,
  projects,
  defaultProjectId,
  onClose,
  onSaved,
}: {
  employeeId: string
  date: string
  employeeName: string
  summary?: DailySummary
  projects: Project[]
  defaultProjectId?: string // 프로젝트별 그리드에서 들어온 경우, 업무 추가 폼에 그 프로젝트를 미리 선택
  onClose: () => void
  onSaved: () => void
}) {
  const supabase = createSupabaseBrowserClient()
  const [formOpen, setFormOpen] = useState(false)
  const [editingRecord, setEditingRecord] = useState<WorkRecord | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const records = summary?.records ?? []
  const totalHours = summary?.total_hours ?? 0
  const projectNameById = new Map(projects.map(p => [p.id, p.name]))

  // 신규 등록에는 진행중 프로젝트만 보여준다(종료된 프로젝트는 새 업무를 붙이지 않음).
  // 다만 수정 중인 기록이 이미 종료된 프로젝트를 가리키고 있거나, 프로젝트별 그리드에서
  // 종료된 프로젝트의 셀로 들어온 경우(defaultProjectId)에는 그 프로젝트도 선택지에 넣어
  // 드롭다운이 빈 값으로 보이지 않게 한다.
  const projectOptions = projects.filter(p =>
    p.status === '진행중' || p.id === editingRecord?.project_id || p.id === defaultProjectId
  )

  function openAddForm() {
    setEditingRecord(null)
    setFormOpen(true)
  }

  function openEditForm(record: WorkRecord) {
    setEditingRecord(record)
    setFormOpen(true)
  }

  function closeForm() {
    setFormOpen(false)
    setEditingRecord(null)
  }

  function handleSaved() {
    closeForm()
    onSaved()
  }

  async function handleDelete(record: WorkRecord) {
    if (!confirm('이 업무 기록을 삭제하시겠습니까?')) return
    setDeletingId(record.id)
    setDeleteError(null)
    const { error } = await supabase.from('overtime_work_records').delete().eq('id', record.id)
    setDeletingId(null)
    if (error) { setDeleteError(`삭제 실패: ${error.message}`); return }
    onSaved()
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}
      onClick={onClose}
    >
      <div
        style={{ background: '#fff', borderRadius: 12, width: 420, maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #e8e8e6', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', background: '#111', borderRadius: '12px 12px 0 0' }}>
          <div>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>{employeeName}</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>{formatDateHeader(date)}</div>
            <div style={{ fontSize: 12, color: '#f59e0b', marginTop: 2 }}>총 연장 {formatHoursKorean(totalHours)}</div>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'rgba(255,255,255,0.15)', color: '#fff', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 13 }}>✕</button>
        </div>

        <div style={{ padding: '8px 20px' }}>
          {records.length === 0 ? (
            <div style={{ padding: '30px 0', textAlign: 'center', color: '#bbb', fontSize: 13 }}>등록된 업무가 없습니다</div>
          ) : (
            records.map((record, i) => (
              <div key={record.id} style={{ padding: '14px 0', borderBottom: i < records.length - 1 ? '1px solid #f0f0ee' : 'none' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>프로젝트 {projectNameById.get(record.project_id) ?? '(알 수 없음)'}</div>
                    <div style={{ fontSize: 13, color: '#111', marginBottom: 4 }}>업무 {record.task_description}</div>
                    <div style={{ fontSize: 12, color: '#555' }}>{record.start_time}~{record.end_time}</div>
                    {record.note && <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>{record.note}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    <button onClick={() => openEditForm(record)} style={editBtn}>수정</button>
                    <button onClick={() => handleDelete(record)} disabled={deletingId === record.id} style={deleteBtn}>삭제</button>
                  </div>
                </div>
              </div>
            ))
          )}
          {deleteError && <div style={{ padding: '8px 0', fontSize: 12, color: '#b91c1c' }}>{deleteError}</div>}
        </div>

        <div style={{ padding: '0 20px 20px' }}>
          {formOpen ? (
            <WorkRecordForm
              employeeId={employeeId}
              workDate={date}
              projects={projectOptions}
              initial={editingRecord ?? undefined}
              defaultProjectId={defaultProjectId}
              onCancel={closeForm}
              onSaved={handleSaved}
            />
          ) : (
            <button onClick={openAddForm} style={addBtn}>+ 업무 추가</button>
          )}
        </div>
      </div>
    </div>
  )
}

const addBtn: React.CSSProperties = { width: '100%', height: 36, borderRadius: 6, border: '1px solid #e8e8e6', background: '#f8f8f7', color: '#555', fontSize: 13, cursor: 'pointer' }
const editBtn: React.CSSProperties = { height: 24, padding: '0 8px', borderRadius: 4, border: '1px solid #e8e8e6', background: '#fff', color: '#333', fontSize: 11, cursor: 'pointer' }
const deleteBtn: React.CSSProperties = { height: 24, padding: '0 8px', borderRadius: 4, border: 'none', background: '#fee2e2', color: '#b91c1c', fontSize: 11, cursor: 'pointer' }
