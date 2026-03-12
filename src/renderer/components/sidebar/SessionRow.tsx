/**
 * SessionRow - 세션 목록 행
 *
 * 세션 상태 인디케이터, 이름 (인라인 편집), 서브타이틀, 상태 라벨,
 * 컨텍스트 퍼센테이지, 닫기 버튼을 표시합니다.
 * 부모 Sidebar.css의 스타일을 사용합니다.
 */

import { memo, useRef, useState, useCallback, useEffect } from 'react'
import { X } from 'lucide-react'
import type { SessionInfo, SessionStatus } from '../../../shared/types'
import type { Locale } from '../../i18n'
import { t } from '../../i18n'

interface SessionRowProps {
  session: SessionInfo
  isActive: boolean
  /** 사이드바 키보드 커서가 이 세션을 가리키고 있는지 */
  isCursor?: boolean
  /** 그리드에 현재 열려있는 세션인지 */
  isInGrid?: boolean
  status: SessionStatus | undefined
  contextPercent: number | undefined
  needsAttention: boolean
  /** Claude session ID (칩 표시용) */
  claudeSessionId?: string
  shortcut: string
  locale: Locale
  onSelect: () => void
  onDestroy: () => void
  onUpdateName: (name: string) => void
  previewAction?: React.ReactNode
}

export default memo(function SessionRow({
  session,
  isActive,
  isCursor,
  isInGrid,
  status,
  contextPercent,
  needsAttention,
  claudeSessionId,
  shortcut,
  locale,
  onSelect,
  onDestroy,
  onUpdateName,
  previewAction
}: SessionRowProps): JSX.Element {
  const rowRef = useRef<HTMLDivElement>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const editInputRef = useRef<HTMLInputElement>(null)

  // 커서 위치에 자동 스크롤
  useEffect(() => {
    if (isCursor && rowRef.current) {
      rowRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [isCursor])

  const startEditing = useCallback((currentName: string) => {
    setIsEditing(true)
    setEditValue(currentName)
    setTimeout(() => editInputRef.current?.select(), 0)
  }, [])

  const commitEdit = useCallback(() => {
    if (editValue.trim()) {
      onUpdateName(editValue.trim())
    }
    setIsEditing(false)
  }, [editValue, onUpdateName])

  const cancelEdit = useCallback(() => {
    setIsEditing(false)
  }, [])

  const isCompleted = status?.state === 'idle' && !!status.label
  const stateClass = status
    ? isCompleted ? 'indicator--completed' : `indicator--${status.state}`
    : ''
  const statusClass = status
    ? isCompleted ? 'status--completed' : `status--${status.state}`
    : ''
  const isShell = status?.state === 'shell'

  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.dataTransfer.setData('text/session-id', session.id)
    e.dataTransfer.effectAllowed = 'move'
  }, [session.id])

  return (
    <div
      ref={rowRef}
      className={`session-row ${isActive ? 'session-row--active' : ''} ${isCursor ? 'session-row--cursor' : ''} ${needsAttention ? 'session-row--attention' : ''}`}
      onClick={onSelect}
      draggable
      onDragStart={handleDragStart}
    >
      {isShell ? (
        <span className="session-row-shell-icon" title="Shell">{'>'}_</span>
      ) : (
        <div className={`session-row-indicator ${stateClass}`} />
      )}
      <div className="session-row-info">
        {isEditing ? (
          <input
            ref={editInputRef}
            className="session-row-name-input"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitEdit()
              else if (e.key === 'Escape') cancelEdit()
            }}
            onBlur={commitEdit}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            className="session-row-name"
            onDoubleClick={(e) => {
              e.stopPropagation()
              startEditing(session.name)
            }}
          >
            {session.name}
            {claudeSessionId && !isShell && (
              <span className="session-row-claude-chip">{claudeSessionId.slice(0, 4)}</span>
            )}
            {isInGrid && <span className="session-row-grid-badge" title="Open in grid">&#x25a3;</span>}
          </span>
        )}
        {session.subtitle && (
          <span className="session-row-subtitle" title={session.subtitle}>
            {session.subtitle}
          </span>
        )}
        <div className="session-row-meta">
          <span
            className={`session-row-status ${statusClass}`}
            title={status?.label || ''}
          >
            {isShell
              ? t(locale, 'session.shell')
              : status?.label || (status ? t(locale, `legend.${status.state}`) : '')}
          </span>
          {contextPercent != null && (
            <span className={`session-row-ctx ${contextPercent >= 80 ? 'session-row-ctx--warn' : ''}`}>
              ctx {contextPercent}%
            </span>
          )}
        </div>
      </div>
      {shortcut && <span className="session-shortcut">{shortcut}</span>}
      <div className="session-row-actions">
        {previewAction}
        <button
          className="session-close-btn"
          onClick={(e) => {
            e.stopPropagation()
            onDestroy()
          }}
          title={t(locale, 'session.close')}
        >
          <X size={12} />
        </button>
      </div>
    </div>
  )
})
