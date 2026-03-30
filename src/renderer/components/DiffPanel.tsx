/**
 * DiffPanel — git diff 인라인 뷰어
 *
 * 파일 목록 (상태 뱃지 + 변경 통계) + diff 내용 (라인 넘버 2열)
 * PlanPanel과 동일한 레이아웃 패턴 사용
 */

import { useState, useCallback, useMemo } from 'react'
import { X, RefreshCw } from 'lucide-react'
import type { DiffFile } from '../../shared/types'
import type { Locale } from '../i18n'
import { t } from '../i18n'
import './DiffPanel.css'

interface DiffPanelProps {
  sessionId: string
  files: DiffFile[]
  locale: Locale
  onClose: () => void
  onRefresh: () => void
}

/** 파일 상태별 뱃지 라벨 + CSS 클래스 */
const STATUS_MAP: Record<DiffFile['status'], { label: string; cls: string }> = {
  added: { label: 'A', cls: 'diff-badge--added' },
  modified: { label: 'M', cls: 'diff-badge--modified' },
  deleted: { label: 'D', cls: 'diff-badge--deleted' },
  renamed: { label: 'R', cls: 'diff-badge--renamed' }
}

export default function DiffPanel({ sessionId: _sessionId, files, locale, onClose, onRefresh }: DiffPanelProps): JSX.Element {
  const [selectedFile, setSelectedFile] = useState<string | null>(null)

  // 총 추가/삭제 통계
  const stats = useMemo(() => {
    let additions = 0
    let deletions = 0
    for (const f of files) {
      additions += f.additions
      deletions += f.deletions
    }
    return { additions, deletions }
  }, [files])

  // 선택된 파일 (없으면 전체 표시)
  const displayFiles = useMemo(() => {
    if (!selectedFile) return files
    return files.filter(f => f.path === selectedFile)
  }, [files, selectedFile])

  const handleFileClick = useCallback((path: string) => {
    setSelectedFile(prev => prev === path ? null : path)
  }, [])

  if (files.length === 0) {
    return (
      <div className="diff-panel">
        <div className="diff-panel-header">
          <span className="diff-panel-title">{t(locale, 'diff.title')}</span>
          <div className="diff-panel-actions">
            <button className="diff-panel-btn" onClick={onRefresh} title={t(locale, 'diff.refresh')}>
              <RefreshCw size={12} />
            </button>
            <button className="diff-panel-btn" onClick={onClose} title={t(locale, 'diff.close')}>
              <X size={12} />
            </button>
          </div>
        </div>
        <div className="diff-panel-empty">{t(locale, 'diff.empty')}</div>
      </div>
    )
  }

  return (
    <div className="diff-panel">
      {/* 헤더 */}
      <div className="diff-panel-header">
        <span className="diff-panel-title">
          {t(locale, 'diff.title')}
          <span className="diff-panel-stats">
            <span className="diff-stat-count">{files.length} {files.length === 1 ? 'file' : 'files'}</span>
            <span className="diff-stat-add">+{stats.additions}</span>
            <span className="diff-stat-del">-{stats.deletions}</span>
          </span>
        </span>
        <div className="diff-panel-actions">
          <button className="diff-panel-btn" onClick={onRefresh} title={t(locale, 'diff.refresh')}>
            <RefreshCw size={12} />
          </button>
          <button className="diff-panel-btn" onClick={onClose} title={t(locale, 'diff.close')}>
            <X size={12} />
          </button>
        </div>
      </div>

      {/* 파일 목록 (2+ 파일일 때) */}
      {files.length > 1 && (
        <div className="diff-file-list">
          {files.map(f => {
            const s = STATUS_MAP[f.status]
            const isSelected = selectedFile === f.path
            return (
              <button
                key={f.path}
                className={`diff-file-item${isSelected ? ' diff-file-item--selected' : ''}`}
                onClick={() => handleFileClick(f.path)}
              >
                <span className={`diff-badge ${s.cls}`}>{s.label}</span>
                <span className="diff-file-path">{f.path}</span>
                <span className="diff-file-stats">
                  {f.additions > 0 && <span className="diff-stat-add">+{f.additions}</span>}
                  {f.deletions > 0 && <span className="diff-stat-del">-{f.deletions}</span>}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* Diff 내용 */}
      <div className="diff-content">
        {displayFiles.map(file => (
          <div key={file.path} className="diff-file-section">
            {/* 파일이 여러 개일 때는 위에서 선택하므로, 파일 헤더는 선택된 파일만 / 단일 파일일 때만 표시 */}
            {(files.length === 1 || selectedFile) && (
              <div className="diff-file-header">
                <span className={`diff-badge ${STATUS_MAP[file.status].cls}`}>{STATUS_MAP[file.status].label}</span>
                <span className="diff-file-header-path">
                  {file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
                </span>
              </div>
            )}
            {file.hunks.map((hunk, hi) => (
              <div key={hi} className="diff-hunk">
                <div className="diff-hunk-header">{hunk.header}</div>
                {hunk.lines.map((line, li) => (
                  <div key={li} className={`diff-line diff-line--${line.type}`}>
                    <span className="diff-line-no diff-line-no--old">
                      {line.oldLineNo ?? ''}
                    </span>
                    <span className="diff-line-no diff-line-no--new">
                      {line.newLineNo ?? ''}
                    </span>
                    <span className="diff-line-marker">
                      {line.type === 'add' ? '+' : line.type === 'delete' ? '-' : ' '}
                    </span>
                    <span className="diff-line-content">{line.content}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
