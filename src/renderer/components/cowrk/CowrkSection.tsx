/**
 * CowrkSection — Agents 탭 (채팅 리스트 스타일)
 *
 * 메신저 앱처럼 에이전트별 마지막 메시지 프리뷰와 시간을 표시합니다.
 * 에이전트 클릭 시 CowrkChatPanel이 열립니다.
 */

import type { CowrkAgentState, CowrkChatMessage } from '../../../shared/types'
import { type Locale, t } from '../../i18n'
import './CowrkPanel.css'

interface CowrkSectionProps {
  agents: CowrkAgentState[]
  activeAgent: string | null
  /** 에이전트별 마지막 메시지 (프리뷰용) */
  chatMessages: Record<string, CowrkChatMessage[]>
  locale: Locale
  onSelectAgent: (name: string) => void
  onCreateAgent: () => void
}

/** 상태별 인디케이터 색상 */
function statusColor(status: CowrkAgentState['status']): string {
  switch (status) {
    case 'thinking': return 'var(--cowrk-thinking, #f0b429)'
    case 'error': return 'var(--cowrk-error, #e74c3c)'
    default: return 'var(--cowrk-idle, rgba(255,255,255,0.3))'
  }
}

/** 시간 포맷: 오늘이면 HH:MM, 아니면 M/D */
function formatTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return `${d.getMonth() + 1}/${d.getDate()}`
}

/** 메시지 프리뷰 (첫 줄, 최대 40자) */
function preview(content: string): string {
  const line = content.split('\n')[0] || ''
  return line.length > 40 ? line.slice(0, 40) + '...' : line
}

export default function CowrkSection({
  agents,
  activeAgent,
  chatMessages,
  locale,
  onSelectAgent,
  onCreateAgent,
}: CowrkSectionProps): JSX.Element {
  return (
    <div className="cowrk-tab-panel">
      {agents.length === 0 ? (
        <div className="cowrk-tab-empty">
          <div className="cowrk-tab-empty-icon">🤖</div>
          <p>{t(locale, 'cowrk.empty')}</p>
          <button className="cowrk-tab-create-btn" onClick={onCreateAgent}>
            {t(locale, 'cowrk.createFirst')}
          </button>
        </div>
      ) : (
        <div className="cowrk-chat-list">
          {agents.map(agent => {
            const msgs = chatMessages[agent.name] || []
            const lastMsg = msgs[msgs.length - 1]
            const isActive = activeAgent === agent.name

            return (
              <button
                key={agent.name}
                className={`cowrk-chat-item${isActive ? ' cowrk-chat-item--active' : ''}`}
                onClick={() => onSelectAgent(agent.name)}
              >
                {/* 아바타 */}
                <div className="cowrk-chat-avatar">
                  {agent.avatarPath ? (
                    <img
                      className="cowrk-chat-avatar-img"
                      src={`file://${agent.avatarPath}?t=${Date.now()}`}
                      alt={agent.name}
                      draggable={false}
                    />
                  ) : (
                    <span className="cowrk-chat-avatar-letter">
                      {agent.name[0].toUpperCase()}
                    </span>
                  )}
                  <span
                    className="cowrk-chat-avatar-dot"
                    style={{ backgroundColor: statusColor(agent.status) }}
                  />
                </div>

                {/* 이름 + 프리뷰 */}
                <div className="cowrk-chat-body">
                  <div className="cowrk-chat-top">
                    <span className="cowrk-chat-name">{agent.name}</span>
                    {lastMsg && (
                      <span className="cowrk-chat-time">{formatTime(lastMsg.timestamp)}</span>
                    )}
                  </div>
                  <div className="cowrk-chat-preview">
                    {lastMsg ? (
                      <>
                        {lastMsg.isStreaming && <span className="cowrk-chat-typing">{t(locale, 'cowrk.typing')}</span>}
                        {!lastMsg.isStreaming && preview(lastMsg.content)}
                      </>
                    ) : (
                      <span className="cowrk-chat-no-msg">{t(locale, 'cowrk.startConversation')}</span>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
