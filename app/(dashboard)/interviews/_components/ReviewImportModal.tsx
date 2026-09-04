'use client'

import { useRef, useState } from 'react'
import type { ImportedReviewDraft } from '@/lib/evaluations/hwpImport'

/**
 * 면접후기 HWP 올리기 — 파일 선택 + 읽기 결과 확인 화면.
 *
 * 이 화면은 문서를 **읽기만** 한다. 저장은 다음 단계(등록 폼)에서 사람이 값을 확인한 뒤에
 * 일어난다 — 문서 서식이 연도마다 달라 파싱이 틀릴 수 있으므로 자동 저장하지 않는다.
 *
 * 여러 파일을 한 번에 받되 서버에는 한 건씩 순서대로 보낸다. 어느 파일이 실패했는지 그대로
 * 보여주고(실패는 조용히 넘기지 않는다), 성공한 것만 다음 단계로 넘긴다.
 */
export interface ImportedFile {
  fileName: string
  draft: ImportedReviewDraft
  questionCount: number
}

interface FileState {
  fileName: string
  status: 'pending' | 'reading' | 'done' | 'error'
  message?: string
  result?: ImportedFile
}

interface ReviewImportModalProps {
  onClose: () => void
  /** 읽어낸 초안들을 등록 폼으로 넘긴다(1건씩 확인 후 저장). */
  onStart: (files: ImportedFile[]) => void
}

export default function ReviewImportModal({ onClose, onStart }: ReviewImportModalProps) {
  const [files, setFiles] = useState<FileState[]>([])
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function readFiles(picked: FileList) {
    const list = [...picked]
    if (list.length === 0) return

    setBusy(true)
    setFiles(list.map(f => ({ fileName: f.name, status: 'pending' as const })))

    for (let i = 0; i < list.length; i += 1) {
      setFiles(prev => prev.map((f, idx) => (idx === i ? { ...f, status: 'reading' } : f)))

      const body = new FormData()
      body.append('file', list[i])

      try {
        const res = await fetch('/api/interviews/import', { method: 'POST', body })
        const json = await res.json().catch(() => ({}))

        if (!res.ok) {
          const message = typeof json.error === 'string' ? json.error : '문서를 읽지 못했습니다.'
          setFiles(prev => prev.map((f, idx) => (idx === i ? { ...f, status: 'error', message } : f)))
          continue
        }

        setFiles(prev => prev.map((f, idx) => (idx === i ? {
          ...f,
          status: 'done',
          result: {
            fileName: json.fileName ?? list[i].name,
            draft: json.draft as ImportedReviewDraft,
            questionCount: Number(json.questionCount ?? 0),
          },
        } : f)))
      } catch {
        setFiles(prev => prev.map((f, idx) => (idx === i
          ? { ...f, status: 'error', message: '서버와 통신하지 못했습니다.' }
          : f)))
      }
    }

    setBusy(false)
  }

  const succeeded = files.filter(f => f.status === 'done' && f.result).map(f => f.result!)
  const failedCount = files.filter(f => f.status === 'error').length

  return (
    <div style={overlay} onClick={busy ? undefined : onClose}>
      <div style={panel} onClick={e => e.stopPropagation()}>
        <div style={panelHeader}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>면접후기 HWP 올리기</span>
          <button onClick={onClose} disabled={busy} style={closeBtn}>✕</button>
        </div>

        <div style={panelBody}>
          <div style={{ fontSize: 12, color: '#555', lineHeight: 1.7, marginBottom: 12 }}>
            면접후기 HWP·HWPX 문서를 올리면 발주처·용역명·일시·참석자·실제질의를 읽어 등록 폼에
            채워 드립니다. 여러 개를 한 번에 올릴 수 있고, <strong>한 건씩 값을 확인한 뒤 저장</strong>합니다.
            읽는 것만으로는 면접 DB에 아무것도 저장되지 않습니다.
          </div>

          <input
            ref={inputRef}
            type="file"
            accept=".hwp,.hwpx"
            multiple
            disabled={busy}
            onChange={e => {
              const picked = e.target.files
              if (picked) void readFiles(picked)
              // 같은 파일을 다시 고를 수 있게 값을 비운다.
              e.target.value = ''
            }}
            style={{ display: 'none' }}
          />
          <button onClick={() => inputRef.current?.click()} disabled={busy} style={busy ? disabledBtn : outlineBtn}>
            {files.length > 0 ? '다시 고르기' : 'HWP 파일 고르기'}
          </button>

          {files.length > 0 && (
            <div style={{ marginTop: 12, border: '1px solid #f0f0ee', borderRadius: 8, overflow: 'hidden' }}>
              {files.map((f, i) => (
                <div key={`${f.fileName}-${i}`} style={{ ...fileRow, borderBottom: i === files.length - 1 ? 'none' : '1px solid #f6f6f4' }}>
                  <span style={{ fontSize: 12, color: '#222', minWidth: 0, wordBreak: 'break-all' }}>{f.fileName}</span>
                  <span style={{ flexShrink: 0, fontSize: 11 }}>
                    {f.status === 'pending' && <span style={{ color: '#bbb' }}>대기</span>}
                    {f.status === 'reading' && <span style={{ color: '#0369a1' }}>읽는 중…</span>}
                    {f.status === 'done' && (
                      <span style={{ color: '#15803d' }}>
                        질문 {f.result?.questionCount ?? 0}건 읽음
                      </span>
                    )}
                    {f.status === 'error' && <span style={{ color: '#b91c1c' }}>{f.message}</span>}
                  </span>
                </div>
              ))}
            </div>
          )}

          {failedCount > 0 && !busy && (
            <div style={hint}>
              읽지 못한 {failedCount}건은 등록 폼에서 직접 입력하거나, 문서 서식을 확인한 뒤 다시 올려주세요.
            </div>
          )}
        </div>

        <div style={panelFooter}>
          <span style={{ fontSize: 11, color: '#888' }}>
            {succeeded.length > 0 ? `${succeeded.length}건을 확인 화면에서 순서대로 저장합니다.` : ''}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} disabled={busy} style={outlineBtn}>닫기</button>
            <button
              onClick={() => onStart(succeeded)}
              disabled={busy || succeeded.length === 0}
              style={busy || succeeded.length === 0 ? disabledBtn : primaryBtn}
            >
              확인 화면으로{succeeded.length > 0 ? ` (${succeeded.length}건)` : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 210, padding: 12 }
const panel: React.CSSProperties = { background: '#fff', borderRadius: 10, width: '100%', maxWidth: 520, maxHeight: '92vh', display: 'flex', flexDirection: 'column', boxShadow: '0 12px 40px rgba(0,0,0,0.18)' }
const panelHeader: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #f0f0ee' }
const panelBody: React.CSSProperties = { padding: '14px 18px 18px', overflowY: 'auto', flex: 1 }
const panelFooter: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', borderTop: '1px solid #f0f0ee', gap: 8, flexWrap: 'wrap' }
const fileRow: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '7px 10px' }
const outlineBtn: React.CSSProperties = { border: '1px solid #e8e8e6', background: '#fff', borderRadius: 6, padding: '8px 14px', fontSize: 12, cursor: 'pointer', color: '#333' }
const primaryBtn: React.CSSProperties = { border: '1px solid #111', background: '#111', color: '#fff', borderRadius: 6, padding: '8px 16px', fontSize: 12, cursor: 'pointer' }
const disabledBtn: React.CSSProperties = { ...outlineBtn, color: '#bbb', cursor: 'default' }
const closeBtn: React.CSSProperties = { border: 'none', background: 'none', cursor: 'pointer', fontSize: 16, color: '#aaa' }
const hint: React.CSSProperties = { fontSize: 11, color: '#999', marginTop: 8, lineHeight: 1.6 }
