/**
 * CowrkChatPanel — 우측 플로팅 채팅 패널
 *
 * 에이전트와의 대화를 표시하고 메시지를 입력할 수 있는 패널입니다.
 * position: fixed로 우측에 슬라이드하며, Esc로 닫을 수 있습니다.
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { ArrowLeft, X, Trash2, Square } from 'lucide-react'
import type { CowrkChatMessage } from '../../../shared/types'
import './CowrkPanel.css'

interface CowrkChatPanelProps {
  agentName: string
  messages: CowrkChatMessage[]
  isStreaming: boolean
  onSend: (message: string) => void
  onCancel: () => void
  onClose: () => void
  onDelete: () => void
  /** 현재 활성 세션의 workingDir */
  projectDir?: string
}

export default function CowrkChatPanel({
  agentName,
  messages,
  isStreaming,
  onSend,
  onCancel,
  onClose,
  onDelete,
  projectDir,
}: CowrkChatPanelProps): JSX.Element {
  const [input, setInput] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // 자동 스크롤
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Esc 키로 닫기
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // 패널 열릴 때 입력창 포커스
  useEffect(() => {
    setTimeout(() => textareaRef.current?.focus(), 100)
  }, [agentName])

  const handleSend = useCallback(() => {
    const text = input.trim()
    if (!text || isStreaming) return
    setInput('')
    onSend(text)

    // textarea 높이 리셋
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [input, isStreaming, onSend])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  // textarea 자동 높이 조절
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }, [])

  const handleDelete = useCallback(() => {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    onDelete()
  }, [confirmDelete, onDelete])

  return (
    <div className="cowrk-panel" ref={panelRef}>
      {/* 헤더 */}
      <div className="cowrk-panel-header">
        <button className="cowrk-panel-back" onClick={onClose} title="Close">
          <ArrowLeft size={14} />
        </button>
        <span className="cowrk-panel-name">{agentName}</span>
        <div className="cowrk-panel-actions">
          <button
            className={`cowrk-panel-btn cowrk-panel-btn--danger${confirmDelete ? ' cowrk-panel-btn--confirm' : ''}`}
            onClick={handleDelete}
            title={confirmDelete ? 'Click again to confirm' : 'Delete agent'}
          >
            <Trash2 size={12} />
            {confirmDelete && <span className="cowrk-panel-btn-label">?</span>}
          </button>
          <button className="cowrk-panel-btn" onClick={onClose} title="Close (Esc)">
            <X size={12} />
          </button>
        </div>
      </div>

      {/* 메시지 목록 */}
      <div className="cowrk-panel-messages">
        {messages.length === 0 && (
          <div className="cowrk-panel-empty">
            Start a conversation with {agentName}
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`cowrk-msg cowrk-msg--${msg.role}`}>
            <div className="cowrk-msg-role">
              {msg.role === 'user' ? 'You' : agentName}
            </div>
            <div className="cowrk-msg-content">{msg.content}</div>
            {msg.isStreaming && <span className="cowrk-msg-cursor">|</span>}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* 입력 영역 */}
      <div className="cowrk-panel-input">
        {projectDir && (
          <div className="cowrk-panel-context">
            {projectDir.split('/').pop()}
          </div>
        )}
        <div className="cowrk-panel-input-row">
          <textarea
            ref={textareaRef}
            className="cowrk-panel-textarea"
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Ask something..."
            rows={1}
            disabled={isStreaming}
          />
          {isStreaming ? (
            <button className="cowrk-panel-send cowrk-panel-send--cancel" onClick={onCancel} title="Cancel">
              <Square size={14} />
            </button>
          ) : (
            <button
              className="cowrk-panel-send"
              onClick={handleSend}
              disabled={!input.trim()}
              title="Send (Enter)"
            >
              ↵
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
