/**
 * ChatPanel — 통합 채팅 패널 (Push Layout)
 *
 * ⌘⇧G로 토글. Projects 탭에서 벗어나지 않고 사용.
 * 1:1 에이전트 + 팀 채팅을 하나의 패널에서 관리.
 *
 * 뷰 구조:
 *   리스트 뷰 — 에이전트 + 팀 목록 (클릭 → 채팅 진입)
 *   채팅 뷰 — flat 메시지 + 마크다운 + 연속 그룹핑
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { X, Plus, Square, Users, ArrowLeft, Trash2, ChevronDown, Camera, MessageSquare, Maximize2, Minimize2, BookOpen, Pencil, Zap, Settings } from 'lucide-react'
import type { CowrkAgentState, CowrkChatMessage, TeamState, TeamChatMessage, AgentPermission } from '../../../shared/types'
import { type Locale, t } from '../../i18n'
import './TeamChat.css'

/* ═══════ Props ═══════ */

interface ChatPanelProps {
  locale: Locale
  projectDir?: string
  // 1:1 Agents
  agents: CowrkAgentState[]
  agentMessages: Record<string, CowrkChatMessage[]>
  onAskAgent: (name: string, message: string, projectDir?: string) => void
  onCancelAgent: (name: string) => void
  onDeleteAgent: (name: string) => Promise<void>
  onCreateAgent: () => void
  onSetAvatar: (name: string, base64: string) => Promise<void>
  // Teams
  teams: TeamState[]
  teamMessages: Record<string, TeamChatMessage[]>
  onAskTeam: (name: string, message: string, projectDir?: string) => void
  onCancelTeam: (name: string) => void
  onDeleteTeam: (name: string) => Promise<void>
  onCreateTeam: () => void
  // Panel
  onClose: () => void
  isFullscreen?: boolean
  onToggleFullscreen?: () => void
  /** 에이전트 목록 갱신 (권한 변경 후 UI 반영) */
  onRefreshAgents?: (agents: CowrkAgentState[]) => void
  /** 히스토리 로드 콜백 */
  onLoadAgentHistory?: (name: string, messages: CowrkChatMessage[]) => void
  onLoadTeamHistory?: (name: string, messages: TeamChatMessage[]) => void
  /** 에이전트 페르소나 저장 */
  onSavePersona?: (name: string, persona: string) => Promise<void>
  /** 팀 기본 프로젝트 폴더 변경 */
  onSetTeamProjectDir?: (name: string, dir: string) => Promise<void>
  /** 팀 멤버 변경 */
  onUpdateTeamMembers?: (name: string, members: string[]) => Promise<void>
}

/* ═══════ 권한 ═══════ */

const PERMISSION_CYCLE: AgentPermission[] = ['read', 'edit', 'full']
const PERMISSION_ICON: Record<AgentPermission, typeof BookOpen> = {
  read: BookOpen,
  edit: Pencil,
  full: Zap,
}
const PERMISSION_LABEL: Record<AgentPermission, string> = {
  read: 'Read',
  edit: 'Edit',
  full: 'Full',
}
const PERMISSION_COLOR: Record<AgentPermission, string> = {
  read: 'var(--text-secondary, #8585a8)',
  edit: 'var(--accent-warm, #f7a046)',
  full: 'var(--accent-danger, #ff5c72)',
}

/* ═══════ 에이전트 색상 ═══════ */

const AGENT_COLORS = [
  '#7c5cfc', '#06d6a0', '#f7a046', '#6B8AFF',
  '#ff5c72', '#FBBF24', '#a78bfa', '#34d399',
]

/* ═══════ 마크다운 렌더 ═══════ */

function renderMarkdown(text: string): JSX.Element[] {
  const lines = text.split('\n')
  const elements: JSX.Element[] = []
  let codeBlock = false
  let codeContent = ''
  let codeLang = ''

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
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
    if (codeBlock) { codeContent += (codeContent ? '\n' : '') + line; continue }
    elements.push(<span key={`l-${i}`}>{parseInline(line)}{i < lines.length - 1 && '\n'}</span>)
  }
  if (codeBlock && codeContent) {
    elements.push(<pre key="code-end" className="tc-code-block"><code>{codeContent}</code></pre>)
  }
  return elements
}

function parseInline(text: string): (string | JSX.Element)[] {
  const parts: (string | JSX.Element)[] = []
  const regex = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`([^`]+?)`)/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let k = 0
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index))
    if (match[2]) parts.push(<strong key={`b${k++}`} className="tc-bold">{match[2]}</strong>)
    else if (match[4]) parts.push(<em key={`i${k++}`} className="tc-italic">{match[4]}</em>)
    else if (match[6]) parts.push(<code key={`c${k++}`} className="tc-inline-code">{match[6]}</code>)
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts.length > 0 ? parts : [text]
}

/* ═══════ 유틸 ═══════ */

function formatTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function previewText(content: string): string {
  const line = content.split('\n')[0] || ''
  return line.length > 35 ? line.slice(0, 35) + '...' : line
}

/* ═══════ 타입: 현재 뷰 ═══════ */

type ChatView =
  | { type: 'list' }
  | { type: 'agent'; name: string }
  | { type: 'team'; name: string }
  | { type: 'agent-settings'; name: string }
  | { type: 'team-settings'; name: string }
  | { type: 'create-agent' }

/* ═══════ ChatPanel ═══════ */

export default function ChatPanel({
  locale,
  projectDir,
  agents,
  agentMessages,
  onAskAgent,
  onCancelAgent,
  onDeleteAgent,
  onCreateAgent,
  onSetAvatar,
  teams,
  teamMessages,
  onAskTeam,
  onCancelTeam,
  onDeleteTeam,
  onCreateTeam,
  onClose,
  isFullscreen,
  onToggleFullscreen,
  onRefreshAgents,
  onLoadAgentHistory,
  onLoadTeamHistory,
  onSavePersona,
  onSetTeamProjectDir,
  onUpdateTeamMembers,
}: ChatPanelProps): JSX.Element {
  const [view, setView] = useState<ChatView>({ type: 'list' })
  const [lastRead, setLastRead] = useState<Record<string, number>>(() => {
    try {
      return JSON.parse(localStorage.getItem('mulaude-chat-lastread') || '{}')
    } catch { return {} }
  })
  const [input, setInput] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteInput, setDeleteInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const avatarInputRef = useRef<HTMLInputElement>(null)

  // 안 읽은 메시지 수
  const getUnreadCount = useCallback((name: string, msgs: Array<{ timestamp: number; role: string }>) => {
    const lr = lastRead[name] || 0
    return msgs.filter(m => m.timestamp > lr && m.role !== 'user').length
  }, [lastRead])

  // 색상 맵
  const agentColorMap = useMemo(() => {
    const map = new Map<string, string>()
    agents.forEach((a, i) => map.set(a.name, AGENT_COLORS[i % AGENT_COLORS.length]!))
    return map
  }, [agents])

  // 자동 스크롤
  const currentMessages = view.type === 'agent'
    ? agentMessages[view.name] || []
    : view.type === 'team'
    ? teamMessages[view.name] || []
    : []

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [currentMessages])

  // 채팅 진입 시 포커스 + 히스토리 로드 + lastRead 업데이트
  useEffect(() => {
    if (view.type !== 'list' && view.type !== 'agent-settings' && view.type !== 'team-settings') {
      setInput('')
      setConfirmDelete(false)
      setDeleteInput('')
      setTimeout(() => textareaRef.current?.focus(), 50)

      // 읽음 처리
      setLastRead(prev => {
        const next = { ...prev, [view.name]: Date.now() }
        localStorage.setItem('mulaude-chat-lastread', JSON.stringify(next))
        return next
      })

      // 히스토리가 비어있으면 백엔드에서 로드
      if (view.type === 'agent' && (!agentMessages[view.name] || agentMessages[view.name].length === 0)) {
        window.api.cowrkLoadHistory(view.name).then(history => {
          if (history.length > 0 && onLoadAgentHistory) {
            onLoadAgentHistory(view.name, history.map(h => ({
              role: h.role as 'user' | 'assistant',
              content: h.content,
              timestamp: new Date(h.ts).getTime(),
            })))
          }
        }).catch(() => {})
      }
      if (view.type === 'team' && (!teamMessages[view.name] || teamMessages[view.name].length === 0)) {
        window.api.teamLoadHistory(view.name).then(history => {
          if (history.length > 0 && onLoadTeamHistory) {
            onLoadTeamHistory(view.name, history.map(h => ({
              role: h.role as 'user' | 'agent',
              agentName: h.agentName,
              content: h.content,
              timestamp: new Date(h.ts).getTime(),
            })))
          }
        }).catch(() => {})
      }
    }
  }, [view])

  // textarea 자동 높이
  const adjustTextarea = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = '40px'
    el.style.height = Math.min(el.scrollHeight, 140) + 'px'
  }, [])

  const handleSend = useCallback(() => {
    const trimmed = input.trim()
    if (!trimmed) return
    if (view.type === 'agent') {
      onAskAgent(view.name, trimmed, projectDir)
    } else if (view.type === 'team') {
      onAskTeam(view.name, trimmed, projectDir)
    }
    setInput('')
    setTimeout(adjustTextarea, 0)
  }, [input, view, projectDir, onAskAgent, onAskTeam, adjustTextarea])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  const isStreaming = view.type === 'agent'
    ? agents.find(a => a.name === view.name)?.status === 'thinking'
    : view.type === 'team'
    ? teams.find(t => t.name === view.name)?.status === 'running'
    : false

  const handleCancel = useCallback(() => {
    if (view.type === 'agent') onCancelAgent(view.name)
    if (view.type === 'team') onCancelTeam(view.name)
  }, [view, onCancelAgent, onCancelTeam])

  const handleDelete = useCallback(async () => {
    if (view.type === 'agent') {
      await onDeleteAgent(view.name)
    } else if (view.type === 'team') {
      await onDeleteTeam(view.name)
    }
    setView({ type: 'list' })
    setConfirmDelete(false)
  }, [view, onDeleteAgent, onDeleteTeam])

  // 권한 토글 (read → edit → full → read) — 이름 기반
  const handleTogglePermission = useCallback(async (agentName?: string) => {
    const name = agentName || (view.type === 'agent' ? view.name : '')
    if (!name) return
    const currentAgent = agents.find(a => a.name === name)
    if (!currentAgent) return
    const currentIdx = PERMISSION_CYCLE.indexOf(currentAgent.permission || 'read')
    const nextPermission = PERMISSION_CYCLE[(currentIdx + 1) % PERMISSION_CYCLE.length]!
    await window.api.cowrkSetPermission(name, nextPermission)
    const updated = await window.api.cowrkListAgents()
    if (onRefreshAgents) onRefreshAgents(updated)
  }, [view, agents, onRefreshAgents])

  // 아바타 변경
  const handleAvatarFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || view.type !== 'agent') return
    if (file.size > 5 * 1024 * 1024) return
    const reader = new FileReader()
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1]
      if (base64) onSetAvatar(view.name, base64)
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }, [view, onSetAvatar])

  /* ═══════ 채팅 뷰 변수 (hooks 규칙: 조건 분기 전에 선언) ═══════ */

  const chatName = view.type !== 'list' ? view.name : ''
  const isTeam = view.type === 'team' || view.type === 'team-settings'
  const isSettings = view.type === 'agent-settings' || view.type === 'team-settings'
  const team = isTeam ? teams.find(t => t.name === chatName) : undefined
  const agent = !isTeam && chatName ? agents.find(a => a.name === chatName) : undefined
  const color = agentColorMap.get(chatName) || AGENT_COLORS[0]!

  const memberColors = useMemo(() => {
    if (!team) return new Map<string, string>()
    const map = new Map<string, string>()
    team.members.forEach((name, i) => map.set(name, AGENT_COLORS[i % AGENT_COLORS.length]!))
    return map
  }, [team])

  const shouldShowSender = useCallback((msgs: Array<{ role: string; agentName?: string }>, i: number): boolean => {
    if (i === 0) return true
    const prev = msgs[i - 1]!
    const curr = msgs[i]!
    if (prev.role !== curr.role) return true
    if (curr.role === 'agent' && prev.agentName !== curr.agentName) return true
    return false
  }, [])

  /* ═══════ 리스트 뷰 ═══════ */

  if (view.type === 'list') {
    return (
      <div className="tc-panel">
        <div className="tc-header">
          <div className="tc-header-left">
            <div className="tc-header-icon"><MessageSquare size={14} /></div>
            <span className="tc-header-name">Chat</span>
          </div>
          <div className="tc-header-right">
            {onToggleFullscreen && (
              <button className="tc-header-action" onClick={onToggleFullscreen} title={isFullscreen ? 'Minimize' : 'Maximize'}>
                {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
              </button>
            )}
            <button className="tc-header-action" onClick={onClose} title="⌘⇧G">
              <X size={13} />
            </button>
          </div>
        </div>

        <div className="tc-list">
          {/* 에이전트 섹션 */}
          <div className="tc-list-section">
            <div className="tc-list-section-header">
              <span className="tc-list-section-title">Agents</span>
              <button className="tc-list-section-add" onClick={() => setView({ type: 'create-agent' })} title={t(locale, 'cowrk.newAgentBtn')}>+</button>
            </div>
            {agents.map(agent => {
              const msgs = agentMessages[agent.name] || []
              const lastMsg = msgs[msgs.length - 1]
              const color = agentColorMap.get(agent.name)
              const perm = agent.permission || 'read'
              const PermIcon = PERMISSION_ICON[perm]
              const unread = getUnreadCount(agent.name, msgs)
              return (
                <button
                  key={agent.name}
                  className="tc-list-item"
                  onClick={() => setView({ type: 'agent', name: agent.name })}
                >
                  <div className="tc-list-avatar" style={{ borderColor: color }}>
                    {agent.avatarPath
                      ? <img src={`file://${agent.avatarPath}?t=${Date.now()}`} alt={agent.name} draggable={false} />
                      : <span style={{ color }}>{agent.name[0]?.toUpperCase()}</span>}
                  </div>
                  <div className="tc-list-body">
                    <div className="tc-list-top">
                      <span className="tc-list-name">{agent.name}</span>
                      {/* 권한 뱃지 (클릭으로 토글) */}
                      <span
                        className="tc-list-perm"
                        style={{ color: PERMISSION_COLOR[perm] }}
                        onClick={(e) => { e.stopPropagation(); handleTogglePermission(agent.name) }}
                        title={`${PERMISSION_LABEL[perm]} — click to change`}
                      >
                        <PermIcon size={9} />
                      </span>
                      {lastMsg && <span className="tc-list-time">{formatTime(lastMsg.timestamp)}</span>}
                    </div>
                    <div className="tc-list-preview">
                      {agent.status === 'thinking'
                        ? <span className="tc-list-typing">{t(locale, 'cowrk.typing')}</span>
                        : lastMsg
                        ? previewText(lastMsg.content)
                        : <span className="tc-list-hint">{t(locale, 'cowrk.startConversation')}</span>}
                    </div>
                  </div>
                  {unread > 0 && <span className="tc-unread-badge">{unread}</span>}
                  {agent.status === 'thinking' && <span className="tc-list-status-dot tc-list-status-dot--thinking" />}
                  <span
                    className="tc-list-settings"
                    onClick={(e) => { e.stopPropagation(); setView({ type: 'agent-settings', name: agent.name }) }}
                    title="Settings"
                  >
                    <Settings size={11} />
                  </span>
                </button>
              )
            })}
            {agents.length === 0 && (
              <div className="tc-list-empty-hint">
                <button className="tc-empty-btn" onClick={onCreateAgent}>{t(locale, 'cowrk.createFirst')}</button>
              </div>
            )}
          </div>

          {/* 팀 섹션 */}
          <div className="tc-list-section">
            <div className="tc-list-section-header">
              <span className="tc-list-section-title">Teams</span>
              <button className="tc-list-section-add" onClick={onCreateTeam} title={t(locale, 'team.newTeamBtn')}>+</button>
            </div>
              {teams.map(team => {
                const msgs = teamMessages[team.name] || []
                const lastMsg = msgs[msgs.length - 1]
                const unread = getUnreadCount(team.name, msgs)
                return (
                  <button
                    key={team.name}
                    className="tc-list-item"
                    onClick={() => setView({ type: 'team', name: team.name })}
                  >
                    <div className="tc-list-avatar tc-list-avatar--team">
                      <Users size={12} />
                    </div>
                    <div className="tc-list-body">
                      <div className="tc-list-top">
                        <span className="tc-list-name">{team.name}</span>
                        <span className="tc-list-badge">{team.members.length}</span>
                        {lastMsg && <span className="tc-list-time">{formatTime(lastMsg.timestamp)}</span>}
                      </div>
                      <div className="tc-list-preview">
                        {team.status === 'running'
                          ? <span className="tc-list-typing">{team.currentAgent} {t(locale, 'cowrk.typing')}</span>
                          : lastMsg
                          ? <>{lastMsg.agentName && <span className="tc-list-preview-agent">{lastMsg.agentName}: </span>}{previewText(lastMsg.content)}</>
                          : <span className="tc-list-hint">{team.members.join(' · ')}</span>}
                      </div>
                    </div>
                    {unread > 0 && <span className="tc-unread-badge">{unread}</span>}
                    {team.status === 'running' && <span className="tc-list-status-dot tc-list-status-dot--thinking" />}
                    <span
                      className="tc-list-settings"
                      onClick={(e) => { e.stopPropagation(); setView({ type: 'team-settings', name: team.name }) }}
                      title="Settings"
                    >
                      <Settings size={11} />
                    </span>
                  </button>
                )
              })}
          </div>
        </div>
      </div>
    )
  }

  /* ═══════ 대화형 에이전트 생성 뷰 ═══════ */

  if (view.type === 'create-agent') {
    return (
      <CreateAgentWizard
        locale={locale}
        onBack={() => setView({ type: 'list' })}
        onClose={onClose}
        onCreated={async (name, persona, permission) => {
          const agent = await window.api.cowrkCreateAgent(name, persona)
          await window.api.cowrkSetPermission(name, permission)
          if (onRefreshAgents) {
            const updated = await window.api.cowrkListAgents()
            onRefreshAgents(updated)
          }
          setView({ type: 'agent', name })
        }}
        isFullscreen={isFullscreen}
        onToggleFullscreen={onToggleFullscreen}
      />
    )
  }

  /* ═══════ 설정 뷰 ═══════ */

  if (isSettings) {
    return (
      <SettingsView
        type={view.type === 'agent-settings' ? 'agent' : 'team'}
        name={chatName}
        agent={agent}
        team={team}
        agents={agents}
        locale={locale}
        color={color}
        memberColors={memberColors}
        agentColorMap={agentColorMap}
        onBack={() => setView({ type: 'list' })}
        onClose={onClose}
        onTogglePermission={handleTogglePermission}
        onSavePersona={onSavePersona}
        onSetTeamProjectDir={onSetTeamProjectDir}
        onUpdateTeamMembers={onUpdateTeamMembers}
        onSetAvatar={onSetAvatar}
        isFullscreen={isFullscreen}
        onToggleFullscreen={onToggleFullscreen}
      />
    )
  }

  /* ═══════ 채팅 뷰 ═══════ */

  return (
    <div className="tc-panel">
      {/* 헤더 */}
      <div className="tc-header">
        <div className="tc-header-left">
          <button className="tc-header-action" onClick={() => setView({ type: 'list' })}>
            <ArrowLeft size={14} />
          </button>
          {/* 아바타 (1:1만 클릭 변경) */}
          {!isTeam ? (
            <div className="tc-header-chat-avatar" onClick={() => avatarInputRef.current?.click()} style={{ borderColor: color }}>
              {agent?.avatarPath
                ? <img src={`file://${agent.avatarPath}?t=${Date.now()}`} alt={chatName} draggable={false} />
                : <span style={{ color }}>{chatName[0]?.toUpperCase()}</span>}
              <div className="tc-avatar-overlay"><Camera size={8} /></div>
            </div>
          ) : (
            <div className="tc-header-chat-avatar tc-header-chat-avatar--team">
              <Users size={12} />
            </div>
          )}
          <input ref={avatarInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatarFile} />
          <span className="tc-header-name">{chatName}</span>
          {isTeam && team && <span className="tc-header-count">{team.members.length}</span>}
          {!isTeam && agent && (() => {
            const perm = agent.permission || 'read'
            const PermIcon = PERMISSION_ICON[perm]
            return (
              <button
                className="tc-permission-badge"
                style={{ color: PERMISSION_COLOR[perm], borderColor: PERMISSION_COLOR[perm] }}
                onClick={handleTogglePermission}
                title={`Permission: ${PERMISSION_LABEL[perm]} (click to cycle)`}
              >
                <PermIcon size={10} />
                <span>{PERMISSION_LABEL[perm]}</span>
              </button>
            )
          })()}
        </div>
        <div className="tc-header-right">
          {confirmDelete ? (
            <div className="tc-delete-inline">
              <input
                className="tc-delete-input"
                value={deleteInput}
                onChange={e => setDeleteInput(e.target.value)}
                placeholder={chatName}
                autoFocus
              />
              <button className="tc-btn tc-btn-danger" disabled={deleteInput !== chatName} onClick={handleDelete}>
                {t(locale, 'team.delete')}
              </button>
              <button className="tc-btn tc-btn-ghost" onClick={() => { setConfirmDelete(false); setDeleteInput('') }}>
                {t(locale, 'team.cancel')}
              </button>
            </div>
          ) : (
            <>
              <button className="tc-header-action" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={13} />
              </button>
              {onToggleFullscreen && (
                <button className="tc-header-action" onClick={onToggleFullscreen} title={isFullscreen ? 'Minimize' : 'Maximize'}>
                  {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                </button>
              )}
              <button className="tc-header-action" onClick={onClose} title="⌘⇧G">
                <X size={13} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* 팀 진행 바 */}
      {isTeam && team && team.status === 'running' && team.currentAgent && (
        <div className="tc-progress">
          <div className="tc-progress-track">
            <div className="tc-progress-fill" style={{ width: `${((team.completedCount || 0) / team.members.length) * 100}%` }} />
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

      {/* 메시지 영역 */}
      <div className="tc-messages">
        {currentMessages.length === 0 && (
          <div className="tc-empty">
            {isTeam ? <Users size={28} strokeWidth={1} /> : <MessageSquare size={28} strokeWidth={1} />}
            <p>{isTeam ? team?.members.join(' · ') : t(locale, 'cowrk.startWith', { name: chatName })}</p>
          </div>
        )}

        {currentMessages.map((msg, i) => {
          const isUser = msg.role === 'user'
          const senderName = isUser ? t(locale, 'team.you')
            : isTeam ? (msg as TeamChatMessage).agentName || chatName
            : chatName
          const senderColor = isUser ? undefined
            : isTeam ? memberColors.get(senderName) || color
            : color
          const senderAgent = isTeam ? agents.find(a => a.name === senderName) : agent
          const showSender = shouldShowSender(
            currentMessages.map(m => ({
              role: m.role,
              agentName: 'agentName' in m ? (m as TeamChatMessage).agentName : undefined,
            })),
            i
          )

          return (
            <div key={i} className={`tc-flat-msg${showSender ? ' tc-flat-msg--first' : ''}`}>
              {showSender && (
                <div className="tc-flat-sender">
                  {!isUser && (
                    <div className="tc-flat-avatar" style={{ borderColor: senderColor }}>
                      {senderAgent?.avatarPath
                        ? <img src={`file://${senderAgent.avatarPath}?t=1`} alt={senderName} draggable={false} />
                        : <span style={{ color: senderColor }}>{senderName[0]?.toUpperCase()}</span>}
                    </div>
                  )}
                  <span className="tc-flat-name" style={{ color: isUser ? 'var(--text-secondary)' : senderColor }}>
                    {senderName}
                  </span>
                </div>
              )}
              <div className={`tc-flat-content${isUser ? ' tc-flat-content--user' : ''}`}>
                {renderMarkdown(msg.content)}
                {msg.isStreaming && <span className="tc-cursor" />}
              </div>
            </div>
          )
        })}

        {/* Composing: 1:1 */}
        {!isTeam && isStreaming && currentMessages.length > 0 && currentMessages[currentMessages.length - 1]?.role === 'user' && (
          <div className="tc-flat-msg tc-flat-msg--first">
            <div className="tc-flat-sender">
              <div className="tc-flat-avatar" style={{ borderColor: color }}>
                {agent?.avatarPath
                  ? <img src={`file://${agent.avatarPath}?t=1`} alt={chatName} draggable={false} />
                  : <span style={{ color }}>{chatName[0]?.toUpperCase()}</span>}
              </div>
              <span className="tc-flat-name" style={{ color }}>{chatName}</span>
            </div>
            <div className="tc-flat-composing">
              <span className="tc-dot" /><span className="tc-dot" /><span className="tc-dot" />
            </div>
          </div>
        )}

        {/* Composing: Team */}
        {isTeam && team && team.status === 'running' && team.currentAgent
          && !currentMessages.some(m => (m as TeamChatMessage).agentName === team.currentAgent && m.isStreaming) && (
          <div className="tc-flat-msg tc-flat-msg--first">
            <div className="tc-flat-sender">
              <div className="tc-flat-avatar" style={{ borderColor: memberColors.get(team.currentAgent!) }}>
                {(() => {
                  const a = agents.find(x => x.name === team.currentAgent)
                  const c = memberColors.get(team.currentAgent!)
                  return a?.avatarPath
                    ? <img src={`file://${a.avatarPath}?t=1`} alt={team.currentAgent!} draggable={false} />
                    : <span style={{ color: c }}>{team.currentAgent![0]?.toUpperCase()}</span>
                })()}
              </div>
              <span className="tc-flat-name" style={{ color: memberColors.get(team.currentAgent!) }}>{team.currentAgent}</span>
            </div>
            <div className="tc-flat-composing">
              <span className="tc-dot" /><span className="tc-dot" /><span className="tc-dot" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 입력 */}
      <div className="tc-input-area">
        {projectDir && <div className="tc-project-badge">{projectDir.split('/').pop()}</div>}
        <div className="tc-input-row">
          <textarea
            ref={textareaRef}
            className="tc-textarea"
            value={input}
            onChange={e => { setInput(e.target.value); adjustTextarea() }}
            onKeyDown={handleKeyDown}
            placeholder={isTeam ? t(locale, 'team.askPlaceholder') : t(locale, 'cowrk.askPlaceholder')}
            rows={1}
            disabled={isStreaming}
          />
          <button
            className={`tc-send-btn${isStreaming ? ' tc-send-btn--stop' : ''}`}
            onClick={isStreaming ? handleCancel : handleSend}
            disabled={!isStreaming && !input.trim()}
          >
            {isStreaming ? <Square size={12} /> : <span className="tc-send-arrow">↵</span>}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════
   SettingsView — 에이전트/팀 설정 뷰
   ═══════════════════════════════════════════ */

interface SettingsViewProps {
  type: 'agent' | 'team'
  name: string
  agent?: CowrkAgentState
  team?: TeamState
  agents: CowrkAgentState[]
  locale: Locale
  color: string
  memberColors: Map<string, string>
  agentColorMap: Map<string, string>
  onBack: () => void
  onClose: () => void
  onTogglePermission: (name?: string) => Promise<void>
  onSavePersona?: (name: string, persona: string) => Promise<void>
  onSetTeamProjectDir?: (name: string, dir: string) => Promise<void>
  onUpdateTeamMembers?: (name: string, members: string[]) => Promise<void>
  onSetAvatar: (name: string, base64: string) => Promise<void>
  isFullscreen?: boolean
  onToggleFullscreen?: () => void
}

function SettingsView({
  type, name, agent, team, agents, locale, color, memberColors, agentColorMap,
  onBack, onClose, onTogglePermission, onSavePersona, onSetTeamProjectDir,
  onUpdateTeamMembers, onSetAvatar, isFullscreen, onToggleFullscreen,
}: SettingsViewProps): JSX.Element {
  const [persona, setPersona] = useState('')
  const [personaLoading, setPersonaLoading] = useState(false)
  const [personaDirty, setPersonaDirty] = useState(false)
  const [teamDir, setTeamDir] = useState('')
  const [members, setMembers] = useState<string[]>([])
  const avatarInputRef = useRef<HTMLInputElement>(null)

  // 초기 로드
  useEffect(() => {
    if (type === 'agent') {
      // 페르소나 로드
      window.api.cowrkLoadHistory(name).catch(() => {}) // ensure agent exists
      // persona는 별도 IPC가 필요한데 없으므로 일단 placeholder
      setPersona('')
      setPersonaDirty(false)
    }
    if (type === 'team' && team) {
      setMembers([...team.members])
      // projectDir은 team에 저장될 예정 — 현재는 빈 값
    }
  }, [type, name, team])

  const handleSavePersona = useCallback(async () => {
    if (!onSavePersona || !personaDirty) return
    setPersonaLoading(true)
    try {
      await onSavePersona(name, persona)
      setPersonaDirty(false)
    } finally {
      setPersonaLoading(false)
    }
  }, [name, persona, personaDirty, onSavePersona])

  const handleBrowseFolder = useCallback(async () => {
    // Electron dialog를 통한 폴더 선택
    const dir = await window.api.openDirectory()
    if (dir && onSetTeamProjectDir) {
      setTeamDir(dir)
      await onSetTeamProjectDir(name, dir)
    }
  }, [name, onSetTeamProjectDir])

  const moveMember = useCallback((index: number, dir: -1 | 1) => {
    setMembers(prev => {
      const next = [...prev]
      const newIdx = index + dir
      if (newIdx < 0 || newIdx >= next.length) return prev
      ;[next[index]!, next[newIdx]!] = [next[newIdx]!, next[index]!]
      return next
    })
  }, [])

  const removeMember = useCallback((memberName: string) => {
    setMembers(prev => prev.filter(m => m !== memberName))
  }, [])

  const handleSaveMembers = useCallback(async () => {
    if (!onUpdateTeamMembers || members.length < 2) return
    await onUpdateTeamMembers(name, members)
  }, [name, members, onUpdateTeamMembers])

  const handleAvatarFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) return
    const reader = new FileReader()
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1]
      if (base64) onSetAvatar(name, base64)
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }, [name, onSetAvatar])

  const perm = agent?.permission || 'read'
  const PermIcon = PERMISSION_ICON[perm]

  return (
    <div className="tc-panel">
      {/* 헤더 */}
      <div className="tc-header">
        <div className="tc-header-left">
          <button className="tc-header-action" onClick={onBack}>
            <ArrowLeft size={14} />
          </button>
          <Settings size={14} className="tc-settings-icon-active" />
          <span className="tc-header-name">{name}</span>
        </div>
        <div className="tc-header-right">
          {onToggleFullscreen && (
            <button className="tc-header-action" onClick={onToggleFullscreen}>
              {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            </button>
          )}
          <button className="tc-header-action" onClick={onClose} title="⌘⇧G">
            <X size={13} />
          </button>
        </div>
      </div>

      {/* 설정 본문 */}
      <div className="tc-settings-body">
        {type === 'agent' && (
          <>
            {/* 아바타 */}
            <div className="tc-settings-row">
              <label className="tc-settings-label">{t(locale, 'settings.avatar')}</label>
              <div className="tc-settings-avatar" onClick={() => avatarInputRef.current?.click()}>
                {agent?.avatarPath
                  ? <img src={`file://${agent.avatarPath}?t=${Date.now()}`} alt={name} draggable={false} />
                  : <span style={{ color }}>{name[0]?.toUpperCase()}</span>}
                <div className="tc-avatar-overlay"><Camera size={10} /></div>
              </div>
              <input ref={avatarInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatarFile} />
            </div>

            {/* 권한 */}
            <div className="tc-settings-row">
              <label className="tc-settings-label">{t(locale, 'settings.permission')}</label>
              <button
                className="tc-permission-badge"
                style={{ color: PERMISSION_COLOR[perm], borderColor: PERMISSION_COLOR[perm] }}
                onClick={() => onTogglePermission(name)}
              >
                <PermIcon size={10} />
                <span>{PERMISSION_LABEL[perm]}</span>
              </button>
              <span className="tc-settings-hint">
                {perm === 'read' ? t(locale, 'settings.permRead') : perm === 'edit' ? t(locale, 'settings.permEdit') : t(locale, 'settings.permFull')}
              </span>
            </div>

            {/* 페르소나 */}
            <div className="tc-settings-row tc-settings-row--col">
              <label className="tc-settings-label">{t(locale, 'settings.persona')}</label>
              <textarea
                className="tc-settings-textarea"
                value={persona}
                onChange={e => { setPersona(e.target.value); setPersonaDirty(true) }}
                placeholder="Senior code reviewer. Focuses on security and performance..."
                rows={5}
              />
              {personaDirty && (
                <button className="tc-settings-save" onClick={handleSavePersona} disabled={personaLoading}>
                  {personaLoading ? t(locale, 'settings.saving') : t(locale, 'settings.savePersona')}
                </button>
              )}
            </div>
          </>
        )}

        {type === 'team' && team && (
          <>
            {/* 기본 프로젝트 폴더 */}
            <div className="tc-settings-row">
              <label className="tc-settings-label">{t(locale, 'settings.projectFolder')}</label>
              <div className="tc-settings-folder">
                <span className="tc-settings-folder-path">
                  {teamDir || t(locale, 'settings.notSet')}
                </span>
                <button className="tc-btn tc-btn-ghost" onClick={handleBrowseFolder}>{t(locale, 'settings.browse')}</button>
              </div>
            </div>

            {/* 멤버 관리 */}
            <div className="tc-settings-row tc-settings-row--col">
              <label className="tc-settings-label">{t(locale, 'settings.members')} ({members.length})</label>
              <div className="tc-settings-members">
                {members.map((memberName, i) => {
                  const memberAgent = agents.find(a => a.name === memberName)
                  const mColor = agentColorMap.get(memberName) || AGENT_COLORS[0]!
                  return (
                    <div key={memberName} className="tc-settings-member">
                      <div className="tc-flat-avatar" style={{ borderColor: mColor }}>
                        {memberAgent?.avatarPath
                          ? <img src={`file://${memberAgent.avatarPath}?t=1`} alt={memberName} draggable={false} />
                          : <span style={{ color: mColor }}>{memberName[0]?.toUpperCase()}</span>}
                      </div>
                      <span className="tc-settings-member-name">{memberName}</span>
                      <span className="tc-settings-member-order">#{i + 1}</span>
                      <button className="tc-settings-member-btn" disabled={i === 0} onClick={() => moveMember(i, -1)}>↑</button>
                      <button className="tc-settings-member-btn" disabled={i === members.length - 1} onClick={() => moveMember(i, 1)}>↓</button>
                      {members.length > 2 && (
                        <button className="tc-settings-member-btn tc-settings-member-btn--remove" onClick={() => removeMember(memberName)}>×</button>
                      )}
                    </div>
                  )
                })}
              </div>
              {JSON.stringify(members) !== JSON.stringify(team.members) && (
                <button className="tc-settings-save" onClick={handleSaveMembers}>
                  {t(locale, 'settings.saveMembers')}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════
   CreateAgentWizard — 대화형 에이전트 생성
   ═══════════════════════════════════════════ */

interface WizardProps {
  locale: Locale
  onBack: () => void
  onClose: () => void
  onCreated: (name: string, persona: string, permission: string) => Promise<void>
  isFullscreen?: boolean
  onToggleFullscreen?: () => void
}

interface WizardMessage {
  role: 'user' | 'assistant'
  content: string
}

interface AgentDraft {
  name: string
  persona: string
  permission: string
}

/** 추천 에이전트 프리셋 (i18n 키 기반) */
const AGENT_PRESETS: Array<{ icon: string; labelKey: string; descKey: string; prompt: string }> = [
  { icon: '🔍', labelKey: 'preset.reviewer', descKey: 'preset.reviewerDesc', prompt: 'A code reviewer focused on finding bugs, security vulnerabilities, and performance issues. Thorough but concise.' },
  { icon: '🏗️', labelKey: 'preset.architect', descKey: 'preset.architectDesc', prompt: 'A system architect who evaluates design decisions, suggests patterns, and thinks about scalability and maintainability.' },
  { icon: '📋', labelKey: 'preset.pm', descKey: 'preset.pmDesc', prompt: 'A product manager who tracks progress, manages priorities, and keeps the big picture in mind. Organized and pragmatic.' },
  { icon: '🧪', labelKey: 'preset.qa', descKey: 'preset.qaDesc', prompt: 'A QA engineer who thinks about edge cases, test strategies, and what could break. Paranoid in a good way.' },
  { icon: '😈', labelKey: 'preset.devil', descKey: 'preset.devilDesc', prompt: "A devil's advocate who challenges every decision and assumption. Forces you to justify your choices. Breaks confirmation bias." },
  { icon: '👤', labelKey: 'preset.user', descKey: 'preset.userDesc', prompt: 'Simulates a non-technical end user. Points out confusing UX, missing affordances, and accessibility issues.' },
  { icon: '📝', labelKey: 'preset.doc', descKey: 'preset.docDesc', prompt: 'A technical writer who creates clear documentation, READMEs, and code comments. Makes complex things understandable.' },
  { icon: '🎓', labelKey: 'preset.mentor', descKey: 'preset.mentorDesc', prompt: 'A patient mentor who explains concepts clearly, provides examples, and helps you learn new technologies.' },
]

function CreateAgentWizard({ locale, onBack, onClose, onCreated, isFullscreen, onToggleFullscreen }: WizardProps): JSX.Element {
  const [messages, setMessages] = useState<WizardMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [draft, setDraft] = useState<AgentDraft | null>(null)
  const [creating, setCreating] = useState(false)
  const [showPresets, setShowPresets] = useState(true)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const adjustTextarea = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = '40px'
    el.style.height = Math.min(el.scrollHeight, 140) + 'px'
  }, [])

  const generateFromPrompt = useCallback(async (prompt: string) => {
    setShowPresets(false)
    setMessages(prev => [...prev, { role: 'user', content: prompt }])
    setLoading(true)

    try {
      const config = await window.api.cowrkGenerateAgent(prompt)
      setDraft(config)
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: t(locale, 'wizard.draftMsg', { name: config.name, permission: config.permission, persona: config.persona }),
      }])
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: t(locale, 'wizard.error'),
      }])
    } finally {
      setLoading(false)
    }
  }, [])

  const handleSend = useCallback(async () => {
    const trimmed = input.trim()
    if (!trimmed || loading) return
    setInput('')
    await generateFromPrompt(trimmed)
  }, [input, loading, generateFromPrompt])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  const handleCreate = useCallback(async () => {
    if (!draft || creating) return
    setCreating(true)
    try {
      await onCreated(draft.name, draft.persona, draft.permission)
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Error: ${(err as Error).message}. Try a different name?`,
      }])
      setCreating(false)
    }
  }, [draft, creating, onCreated])

  return (
    <div className="tc-panel">
      <div className="tc-header">
        <div className="tc-header-left">
          <button className="tc-header-action" onClick={onBack}>
            <ArrowLeft size={14} />
          </button>
          <div className="tc-header-icon" style={{ background: 'rgba(6, 214, 160, 0.1)', color: 'var(--accent-secondary)' }}>
            <Plus size={14} />
          </div>
          <span className="tc-header-name">{t(locale, 'cowrk.newAgent')}</span>
        </div>
        <div className="tc-header-right">
          {onToggleFullscreen && (
            <button className="tc-header-action" onClick={onToggleFullscreen}>
              {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            </button>
          )}
          <button className="tc-header-action" onClick={onClose} title="⌘⇧G">
            <X size={13} />
          </button>
        </div>
      </div>

      <div className="tc-messages">
        {/* 프리셋 추천 카드 */}
        {showPresets && messages.length === 0 && (
          <div className="tc-presets">
            <p className="tc-presets-title">
              {t(locale, 'cowrk.wizardGreeting')}
            </p>
            <div className="tc-presets-grid">
              {AGENT_PRESETS.map(preset => (
                <button
                  key={preset.labelKey}
                  className="tc-preset-card"
                  onClick={() => generateFromPrompt(preset.prompt)}
                >
                  <span className="tc-preset-icon">{preset.icon}</span>
                  <span className="tc-preset-label">{t(locale, preset.labelKey)}</span>
                  <span className="tc-preset-desc">{t(locale, preset.descKey)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`tc-flat-msg tc-flat-msg--first`}>
            <div className="tc-flat-sender">
              {msg.role === 'assistant' ? (
                <>
                  <div className="tc-flat-avatar" style={{ borderColor: 'var(--accent-secondary)' }}>
                    <span style={{ color: 'var(--accent-secondary)' }}>✦</span>
                  </div>
                  <span className="tc-flat-name" style={{ color: 'var(--accent-secondary)' }}>wizard</span>
                </>
              ) : (
                <span className="tc-flat-name" style={{ color: 'var(--text-secondary)' }}>{t(locale, 'team.you')}</span>
              )}
            </div>
            <div className={`tc-flat-content${msg.role === 'user' ? ' tc-flat-content--user' : ''}`}>
              {renderMarkdown(msg.content)}
            </div>
          </div>
        ))}

        {loading && (
          <div className="tc-flat-msg tc-flat-msg--first">
            <div className="tc-flat-sender">
              <div className="tc-flat-avatar" style={{ borderColor: 'var(--accent-secondary)' }}>
                <span style={{ color: 'var(--accent-secondary)' }}>✦</span>
              </div>
              <span className="tc-flat-name" style={{ color: 'var(--accent-secondary)' }}>wizard</span>
            </div>
            <div className="tc-flat-composing">
              <span className="tc-dot" /><span className="tc-dot" /><span className="tc-dot" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 생성 확인 바 */}
      {draft && !creating && (
        <div className="tc-wizard-confirm">
          <div className="tc-wizard-draft">
            <span className="tc-wizard-draft-name">{draft.name}</span>
            {(() => {
              const Icon = PERMISSION_ICON[draft.permission as AgentPermission] || BookOpen
              return <span className="tc-list-perm" style={{ color: PERMISSION_COLOR[draft.permission as AgentPermission] }}><Icon size={9} /></span>
            })()}
          </div>
          <button className="tc-wizard-create-btn" onClick={handleCreate}>
            {t(locale, 'wizard.createBtn')}
          </button>
        </div>
      )}

      {creating && (
        <div className="tc-wizard-confirm">
          <span className="tc-wizard-creating">{t(locale, 'wizard.creating')}</span>
        </div>
      )}

      <div className="tc-input-area">
        <div className="tc-input-row">
          <textarea
            ref={textareaRef}
            className="tc-textarea"
            value={input}
            onChange={e => { setInput(e.target.value); adjustTextarea() }}
            onKeyDown={handleKeyDown}
            placeholder={draft ? t(locale, 'wizard.placeholderDraft') : t(locale, 'wizard.placeholderNew')}
            rows={1}
            disabled={loading || creating}
          />
          <button
            className="tc-send-btn"
            onClick={handleSend}
            disabled={!input.trim() || loading || creating}
          >
            <span className="tc-send-arrow">↵</span>
          </button>
        </div>
      </div>
    </div>
  )
}
