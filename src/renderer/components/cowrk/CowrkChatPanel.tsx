/**
 * CowrkChatPanel — 우측 플로팅 채팅 패널
 *
 * 에이전트와의 대화를 표시하고 메시지를 입력할 수 있는 패널입니다.
 * position: fixed로 우측에 슬라이드하며, Esc로 닫을 수 있습니다.
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { ArrowLeft, X, Trash2, Square, Camera } from 'lucide-react'
import type { CowrkChatMessage } from '../../../shared/types'
import { type Locale, t } from '../../i18n'
import './CowrkPanel.css'

interface CowrkChatPanelProps {
  agentName: string
  messages: CowrkChatMessage[]
  isStreaming: boolean
  locale: Locale
  onSend: (message: string) => void
  onCancel: () => void
  onClose: () => void
  onDelete: () => void
  /** 현재 활성 세션의 workingDir */
  projectDir?: string
  /** 에이전트 프로필 이미지 경로 */
  avatarPath?: string
  /** 아바타 변경 콜백 (base64 → 저장) */
  onAvatarChange?: (base64: string) => void
}

export default function CowrkChatPanel({
  agentName,
  messages,
  isStreaming,
  locale,
  onSend,
  onCancel,
  onClose,
  onDelete,
  projectDir,
  avatarPath,
  onAvatarChange,
}: CowrkChatPanelProps): JSX.Element {
  const [input, setInput] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteInput, setDeleteInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const avatarInputRef = useRef<HTMLInputElement>(null)

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

  // 에이전트 전환 시 상태 리셋 + 입력창 포커스
  useEffect(() => {
    setConfirmDelete(false)
    setDeleteInput('')
    setInput('')
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
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
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
      setDeleteInput('')
      return
    }
    if (deleteInput !== agentName) return
    onDelete()
  }, [confirmDelete, deleteInput, agentName, onDelete])

  // 아바타 파일 선택 핸들러 (최대 5MB)
  const handleAvatarFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !onAvatarChange) return
    if (file.size > 5 * 1024 * 1024) {
      e.target.value = ''
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      const base64 = dataUrl.split(',')[1]
      if (base64) onAvatarChange(base64)
    }
    reader.onerror = () => {
      console.error('[CowrkChatPanel] FileReader error:', reader.error)
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }, [onAvatarChange])

  return (
    <div className="cowrk-panel" ref={panelRef}>
      {/* 헤더 */}
      <div className="cowrk-panel-header">
        <button className="cowrk-panel-back" onClick={onClose} title={t(locale, 'cowrk.close')}>
          <ArrowLeft size={14} />
        </button>
        {/* 헤더 아바타 (클릭 → 이미지 변경) */}
        <div
          className="cowrk-avatar-upload"
          onClick={() => avatarInputRef.current?.click()}
          title={t(locale, 'cowrk.changeAvatar')}
        >
          {avatarPath ? (
            <img
              className="cowrk-chat-avatar-img"
              src={`file://${avatarPath}?t=${Date.now()}`}
              alt={agentName}
              draggable={false}
              style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'cover' }}
            />
          ) : (
            <span className="cowrk-header-avatar-letter">{agentName[0].toUpperCase()}</span>
          )}
          <div className="cowrk-avatar-upload-overlay">
            <Camera size={10} />
          </div>
        </div>
        <input
          ref={avatarInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleAvatarFileChange}
        />
        <span className="cowrk-panel-name">{agentName}</span>
        <div className="cowrk-panel-actions">
          <button
            className={`cowrk-panel-btn cowrk-panel-btn--danger${confirmDelete ? ' cowrk-panel-btn--confirm' : ''}`}
            onClick={handleDelete}
            title={confirmDelete ? t(locale, 'cowrk.deleteConfirmTitle') : t(locale, 'cowrk.deleteAgent')}
          >
            <Trash2 size={12} />
          </button>
          <button className="cowrk-panel-btn" onClick={onClose} title={t(locale, 'cowrk.closeEsc')}>
            <X size={12} />
          </button>
        </div>
      </div>
      {/* 삭제 확인 입력 바 */}
      {confirmDelete && (
        <div className="cowrk-panel-delete-confirm">
          <span className="cowrk-panel-delete-hint">
            {(() => {
              const raw = t(locale, 'cowrk.deleteConfirmHint', {})
              const parts = raw.split('{name}')
              if (parts.length < 2) return raw
              return <>{parts[0]}<strong>{agentName}</strong>{parts[1]}</>
            })()}
          </span>
          <div className="cowrk-panel-delete-row">
            <input
              className="cowrk-panel-delete-input"
              value={deleteInput}
              onChange={e => setDeleteInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) handleDelete(); if (e.key === 'Escape') { setConfirmDelete(false); setDeleteInput('') } }}
              placeholder={agentName}
              autoFocus
            />
            <button
              className="cowrk-panel-delete-btn"
              onClick={handleDelete}
              disabled={deleteInput !== agentName}
            >
              {t(locale, 'cowrk.delete')}
            </button>
            <button
              className="cowrk-panel-delete-cancel"
              onClick={() => { setConfirmDelete(false); setDeleteInput('') }}
            >
              {t(locale, 'cowrk.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* 메시지 목록 */}
      <div className="cowrk-panel-messages">
        {messages.length === 0 && (
          <div className="cowrk-panel-empty">
            {t(locale, 'cowrk.startWith', { name: agentName })}
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`cowrk-msg cowrk-msg--${msg.role}`}>
            <div className="cowrk-msg-role">
              {msg.role === 'user' ? t(locale, 'cowrk.you') : agentName}
            </div>
            <div className="cowrk-msg-content">{msg.content}</div>
            {msg.isStreaming && <span className="cowrk-msg-cursor">|</span>}
          </div>
        ))}
        {/* Composing indicator: thinking 상태 + 마지막 메시지가 user (아직 스트림 미시작) */}
        {isStreaming && messages.length > 0 && messages[messages.length - 1]?.role === 'user' && (
          <div className="cowrk-msg cowrk-msg--assistant">
            <div className="cowrk-msg-role">{agentName}</div>
            <div className="cowrk-composing">
              <span className="cowrk-composing-dot" />
              <span className="cowrk-composing-dot" />
              <span className="cowrk-composing-dot" />
            </div>
          </div>
        )}
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
            placeholder={t(locale, 'cowrk.askPlaceholder')}
            rows={1}
            disabled={isStreaming}
          />
          {isStreaming ? (
            <button className="cowrk-panel-send cowrk-panel-send--cancel" onClick={onCancel} title={t(locale, 'cowrk.cancelStream')}>
              <Square size={14} />
            </button>
          ) : (
            <button
              className="cowrk-panel-send"
              onClick={handleSend}
              disabled={!input.trim()}
              title={t(locale, 'cowrk.send')}
            >
              ↵
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
