/**
 * TeamChatPanel — 팀 그룹 채팅 패널 (Push Layout)
 *
 * 메인 터미널 영역 옆에 push 방식으로 배치됩니다.
 * Dark Observatory 테마에 맞춘 세련된 디자인.
 * 간단한 마크다운 렌더링 (볼드, 이탤릭, 인라인코드, 코드블록).
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { X, Trash2, Square, Users, ChevronDown } from 'lucide-react'
import type { TeamState, TeamChatMessage, CowrkAgentState } from '../../../shared/types'
import { type Locale, t } from '../../i18n'
import './TeamChat.css'

interface TeamChatPanelProps {
  teamName: string
  team: TeamState
  messages: TeamChatMessage[]
  agents: CowrkAgentState[]
  locale: Locale
  onSend: (message: string) => void
  onCancel: () => void
  onClose: () => void
  onDelete: () => void
  projectDir?: string
}

/** 에이전트별 고유 색상 (순서 기반) */
const AGENT_COLORS = [
  '#7c5cfc', // purple
  '#06d6a0', // teal
  '#f7a046', // orange
  '#6B8AFF', // blue
  '#ff5c72', // coral
  '#FBBF24', // amber
  '#a78bfa', // lavender
  '#34d399', // mint
]

/** 간단한 마크다운 → JSX 변환 */
function renderMarkdown(text: string): JSX.Element[] {
  const lines = text.split('\n')
  const elements: JSX.Element[] = []
  let codeBlock = false
  let codeContent = ''
  let codeLang = ''

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!

    // 코드 블록
    if (line.startsWith('```')) {
      if (!codeBlock) {
        codeBlock = true
        codeLang = line.slice(3).trim()
        codeContent = ''
      } else {
        elements.push(
          <pre key={`code-${i}`} className="tc-code-block">
            {codeLang && <span className="tc-code-lang">{codeLang}</span>}
            <code>{codeContent.trimEnd()}</code>
          </pre>
        )
        codeBlock = false
        codeLang = ''
      }
      continue
    }

    if (codeBlock) {
      codeContent += (codeContent ? '\n' : '') + line
      continue
    }

    // 일반 라인: 인라인 마크다운 파싱
    elements.push(<span key={`line-${i}`}>{parseInline(line)}{i < lines.length - 1 && '\n'}</span>)
  }

  // 미닫힌 코드 블록
  if (codeBlock && codeContent) {
    elements.push(<pre key="code-unclosed" className="tc-code-block"><code>{codeContent}</code></pre>)
  }

  return elements
}

/** 인라인 마크다운 파싱: **bold**, *italic*, `code` */
function parseInline(text: string): (string | JSX.Element)[] {
  const parts: (string | JSX.Element)[] = []
  // bold → italic → code 순서로 처리
  const regex = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`([^`]+?)`)/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0

  while ((match = regex.exec(text)) !== null) {
    // 매치 전 텍스트
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }

    if (match[2]) {
      // **bold**
      parts.push(<strong key={`b${key++}`} className="tc-bold">{match[2]}</strong>)
    } else if (match[4]) {
      // *italic*
      parts.push(<em key={`i${key++}`} className="tc-italic">{match[4]}</em>)
    } else if (match[6]) {
      // `code`
      parts.push(<code key={`c${key++}`} className="tc-inline-code">{match[6]}</code>)
    }

    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts.length > 0 ? parts : [text]
}

export default function TeamChatPanel({
  teamName,
  team,
  messages,
  agents,
  locale,
  onSend,
  onCancel,
  onClose,
  onDelete,
  projectDir,
}: TeamChatPanelProps): JSX.Element {
  const [input, setInput] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteInput, setDeleteInput] = useState('')
  const [showMembers, setShowMembers] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const isRunning = team.status === 'running'
  const agentMap = useMemo(() => new Map(agents.map(a => [a.name, a])), [agents])
  const memberColors = useMemo(() => {
    const map = new Map<string, string>()
    team.members.forEach((name, i) => map.set(name, AGENT_COLORS[i % AGENT_COLORS.length]!))
    return map
  }, [team.members])

  // 자동 스크롤
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // textarea 포커스
  useEffect(() => {
    textareaRef.current?.focus()
  }, [teamName])

  // textarea 자동 높이
  const adjustTextarea = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = '40px'
    el.style.height = Math.min(el.scrollHeight, 140) + 'px'
  }, [])

  const handleSend = useCallback(() => {
    const trimmed = input.trim()
    if (!trimmed || isRunning) return
    onSend(trimmed)
    setInput('')
    setTimeout(adjustTextarea, 0)
  }, [input, isRunning, onSend, adjustTextarea])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  return (
    <div className="tc-panel">
      {/* ═══ 헤더 ═══ */}
      <div className="tc-header">
        <div className="tc-header-left">
          <div className="tc-header-icon">
            <Users size={14} />
          </div>
          <span className="tc-header-name">{teamName}</span>
          <button
            className="tc-header-members-btn"
            onClick={() => setShowMembers(!showMembers)}
          >
            <span className="tc-header-count">{team.members.length}</span>
            <ChevronDown size={10} className={showMembers ? 'tc-chevron-open' : ''} />
          </button>
        </div>
        <div className="tc-header-right">
          {confirmDelete ? (
            <div className="tc-delete-inline">
              <input
                className="tc-delete-input"
                value={deleteInput}
                onChange={e => setDeleteInput(e.target.value)}
                placeholder={teamName}
                autoFocus
              />
              <button
                className="tc-btn tc-btn-danger"
                disabled={deleteInput !== teamName}
                onClick={() => { onDelete(); setConfirmDelete(false) }}
              >
                {t(locale, 'team.delete')}
              </button>
              <button
                className="tc-btn tc-btn-ghost"
                onClick={() => { setConfirmDelete(false); setDeleteInput('') }}
              >
                {t(locale, 'team.cancel')}
              </button>
            </div>
          ) : (
            <>
              <button className="tc-header-action" onClick={() => setConfirmDelete(true)} title={t(locale, 'team.delete')}>
                <Trash2 size={13} />
              </button>
              <button className="tc-header-action" onClick={onClose} title="⌘⇧G">
                <X size={13} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* 멤버 드롭다운 */}
      {showMembers && (
        <div className="tc-members-dropdown">
          {team.members.map((name, i) => {
            const agent = agentMap.get(name)
            const color = memberColors.get(name) || AGENT_COLORS[0]!
            const isCurrent = isRunning && team.currentAgent === name
            return (
              <div key={name} className={`tc-member-row${isCurrent ? ' tc-member-row--active' : ''}`}>
                <div className="tc-member-dot" style={{ background: color }} />
                <div className="tc-member-avatar-sm">
                  {agent?.avatarPath
                    ? <img src={`file://${agent.avatarPath}?t=1`} alt={name} draggable={false} />
                    : <span>{name[0]?.toUpperCase()}</span>}
                </div>
                <span className="tc-member-label">{name}</span>
                <span className="tc-member-order">#{i + 1}</span>
                {isCurrent && <span className="tc-member-typing">{t(locale, 'cowrk.typing')}</span>}
              </div>
            )
          })}
        </div>
      )}

      {/* 진행 인디케이터 */}
      {isRunning && team.currentAgent && (
        <div className="tc-progress">
          <div className="tc-progress-track">
            <div
              className="tc-progress-fill"
              style={{ width: `${((team.completedCount || 0) / team.members.length) * 100}%` }}
            />
          </div>
          <span className="tc-progress-label">
            {t(locale, 'team.responding', {
              agent: team.currentAgent,
              current: String((team.completedCount || 0) + 1),
              total: String(team.members.length),
            })}
          </span>
        </div>
      )}

      {/* ═══ 메시지 영역 ═══ */}
      <div className="tc-messages">
        {messages.length === 0 && (
          <div className="tc-empty">
            <Users size={32} strokeWidth={1} />
            <p>{t(locale, 'team.askPlaceholder')}</p>
            <span className="tc-empty-hint">{team.members.join(' · ')}</span>
          </div>
        )}

        {messages.map((msg, i) => {
          const isUser = msg.role === 'user'
          const agent = msg.agentName ? agentMap.get(msg.agentName) : undefined
          const color = msg.agentName ? memberColors.get(msg.agentName) : undefined

          return (
            <div key={i} className={`tc-msg${isUser ? ' tc-msg--user' : ' tc-msg--agent'}`}>
              {!isUser && (
                <div className="tc-msg-sender">
                  <div className="tc-msg-avatar" style={{ borderColor: color }}>
                    {agent?.avatarPath
                      ? <img src={`file://${agent.avatarPath}?t=1`} alt={msg.agentName || ''} draggable={false} />
                      : <span style={{ color }}>{(msg.agentName || '?')[0]?.toUpperCase()}</span>}
                  </div>
                  <span className="tc-msg-name" style={{ color }}>{msg.agentName}</span>
                </div>
              )}

              {isUser && (
                <div className="tc-msg-sender tc-msg-sender--user">
                  <span className="tc-msg-name tc-msg-name--user">{t(locale, 'team.you')}</span>
                </div>
              )}

              <div
                className={`tc-msg-bubble${isUser ? ' tc-msg-bubble--user' : ''}`}
                style={!isUser ? { borderLeftColor: color } : undefined}
              >
                <div className="tc-msg-text">
                  {renderMarkdown(msg.content)}
                  {msg.isStreaming && <span className="tc-cursor" />}
                </div>
              </div>
            </div>
          )
        })}

        {/* Composing 인디케이터 */}
        {isRunning && team.currentAgent && !messages.some(m => m.agentName === team.currentAgent && m.isStreaming) && (
          <div className="tc-msg tc-msg--agent">
            <div className="tc-msg-sender">
              <div className="tc-msg-avatar" style={{ borderColor: memberColors.get(team.currentAgent!) }}>
                {(() => {
                  const a = agentMap.get(team.currentAgent!)
                  const c = memberColors.get(team.currentAgent!)
                  return a?.avatarPath
                    ? <img src={`file://${a.avatarPath}?t=1`} alt={team.currentAgent!} draggable={false} />
                    : <span style={{ color: c }}>{(team.currentAgent!)[0]?.toUpperCase()}</span>
                })()}
              </div>
              <span className="tc-msg-name" style={{ color: memberColors.get(team.currentAgent!) }}>{team.currentAgent}</span>
            </div>
            <div className="tc-composing-bubble" style={{ borderLeftColor: memberColors.get(team.currentAgent!) }}>
              <span className="tc-dot" />
              <span className="tc-dot" />
              <span className="tc-dot" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ═══ 입력 ═══ */}
      <div className="tc-input-area">
        {projectDir && (
          <div className="tc-project-badge">{projectDir.split('/').pop()}</div>
        )}
        <div className="tc-input-row">
          <textarea
            ref={textareaRef}
            className="tc-textarea"
            value={input}
            onChange={e => { setInput(e.target.value); adjustTextarea() }}
            onKeyDown={handleKeyDown}
            placeholder={t(locale, 'team.askPlaceholder')}
            rows={1}
            disabled={isRunning}
          />
          <button
            className={`tc-send-btn${isRunning ? ' tc-send-btn--stop' : ''}`}
            onClick={isRunning ? onCancel : handleSend}
            disabled={!isRunning && !input.trim()}
            title={isRunning ? t(locale, 'team.cancelSequence') : t(locale, 'team.send')}
          >
            {isRunning ? <Square size={12} /> : <span className="tc-send-arrow">↵</span>}
          </button>
        </div>
      </div>
    </div>
  )
}
