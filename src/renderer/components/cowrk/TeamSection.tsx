/**
 * TeamSection — 사이드바 팀 리스트
 *
 * CowrkSection 아래에 표시되는 팀 채팅방 목록입니다.
 * 메신저 스타일로 멤버 아바타 겹쳐 표시 + 마지막 메시지 프리뷰.
 */

import type { TeamState, TeamChatMessage, CowrkAgentState } from '../../../shared/types'
import { type Locale, t } from '../../i18n'

interface TeamSectionProps {
  teams: TeamState[]
  activeTeam: string | null
  teamMessages: Record<string, TeamChatMessage[]>
  /** 아바타 표시용 에이전트 정보 */
  agents: CowrkAgentState[]
  locale: Locale
  onSelectTeam: (name: string) => void
  onCreateTeam: () => void
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function preview(content: string): string {
  const line = content.split('\n')[0] || ''
  return line.length > 40 ? line.slice(0, 40) + '...' : line
}

export default function TeamSection({
  teams,
  activeTeam,
  teamMessages,
  agents,
  locale,
  onSelectTeam,
  onCreateTeam,
}: TeamSectionProps): JSX.Element {
  const agentMap = new Map(agents.map(a => [a.name, a]))

  return (
    <div className="team-section">
      {/* 섹션 헤더 */}
      <div className="team-section-header">
        <span className="team-section-title">{t(locale, 'team.sectionTitle')}</span>
        <button className="team-section-add" onClick={onCreateTeam} title={t(locale, 'team.newTeamBtn')}>
          +
        </button>
      </div>

      {teams.length === 0 ? (
        <div className="team-section-empty">
          <p>{t(locale, 'team.empty')}</p>
          <button className="cowrk-tab-create-btn" onClick={onCreateTeam}>
            {t(locale, 'team.createFirst')}
          </button>
        </div>
      ) : (
        <div className="cowrk-chat-list">
          {teams.map(team => {
            const msgs = teamMessages[team.name] || []
            const lastMsg = msgs[msgs.length - 1]
            const isActive = activeTeam === team.name

            return (
              <button
                key={team.name}
                className={`cowrk-chat-item${isActive ? ' cowrk-chat-item--active' : ''}`}
                onClick={() => onSelectTeam(team.name)}
              >
                {/* 멤버 아바타 겹치기 (최대 3개) */}
                <div className="team-avatar-stack">
                  {team.members.slice(0, 3).map((name, i) => {
                    const agent = agentMap.get(name)
                    return (
                      <div
                        key={name}
                        className="team-avatar-item"
                        style={{ zIndex: 3 - i, marginLeft: i > 0 ? -8 : 0 }}
                      >
                        {agent?.avatarPath ? (
                          <img
                            className="cowrk-chat-avatar-img"
                            src={`file://${agent.avatarPath}?t=1`}
                            alt={name}
                            draggable={false}
                          />
                        ) : (
                          <span className="cowrk-chat-avatar-letter">
                            {name[0]?.toUpperCase() || '?'}
                          </span>
                        )}
                      </div>
                    )
                  })}
                  {team.members.length > 3 && (
                    <div className="team-avatar-item team-avatar-more" style={{ marginLeft: -8 }}>
                      <span>+{team.members.length - 3}</span>
                    </div>
                  )}
                  {/* 상태 인디케이터 */}
                  {team.status === 'running' && (
                    <span className="team-status-dot team-status-running" />
                  )}
                </div>

                {/* 이름 + 프리뷰 */}
                <div className="cowrk-chat-body">
                  <div className="cowrk-chat-top">
                    <span className="cowrk-chat-name">{team.name}</span>
                    {lastMsg && (
                      <span className="cowrk-chat-time">{formatTime(lastMsg.timestamp)}</span>
                    )}
                  </div>
                  <div className="cowrk-chat-preview">
                    {team.status === 'running' && team.currentAgent ? (
                      <span className="cowrk-chat-typing">
                        {t(locale, 'team.responding', {
                          agent: team.currentAgent,
                          current: String((team.completedCount || 0) + 1),
                          total: String(team.members.length),
                        })}
                      </span>
                    ) : lastMsg ? (
                      <>
                        {lastMsg.agentName && <span className="team-preview-agent">{lastMsg.agentName}: </span>}
                        {preview(lastMsg.content)}
                      </>
                    ) : (
                      <span className="cowrk-chat-no-msg">{t(locale, 'team.askPlaceholder')}</span>
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
