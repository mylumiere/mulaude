/**
 * AgentTree - 세션 하위 에이전트 트리
 *
 * 세션에 연결된 에이전트 목록을 접기/펼치기 가능한 트리로 표시합니다.
 * 부모 Sidebar.css의 스타일을 사용합니다.
 */

import { memo } from 'react'
import { ChevronRight } from 'lucide-react'
import type { AgentInfo } from '../../../shared/types'

interface AgentTreeProps {
  agents: AgentInfo[]
  isCollapsed: boolean
  onToggleCollapse: () => void
}

export default memo(function AgentTree({
  agents,
  isCollapsed,
  onToggleCollapse
}: AgentTreeProps): JSX.Element {
  return (
    <div className="session-agents">
      <button
        className="session-agents-toggle"
        onClick={(e) => {
          e.stopPropagation()
          onToggleCollapse()
        }}
      >
        <span className={`session-agents-arrow ${isCollapsed ? '' : 'session-agents-arrow--open'}`}>
          <ChevronRight size={10} />
        </span>
        <span className="session-agents-count">
          {agents.filter(a => a.status === 'running').length}/{agents.length} agents
        </span>
      </button>
      {!isCollapsed && (
        <div className="session-agents-list">
          {agents.map((agent, agentIdx) => (
            <div
              key={`${agent.name}-${agentIdx}`}
              className={`session-agent-row session-agent-row--${agent.status}`}
              title={agent.description || ''}
            >
              <span className={`session-agent-indicator session-agent-indicator--${agent.status}`} />
              <div className="session-agent-info">
                <span className="session-agent-name">{agent.name}</span>
                {agent.type && (
                  <span className="session-agent-type">{agent.type}</span>
                )}
              </div>
              {agent.status === 'running' && agent.detail && (
                <span className="session-agent-detail" title={agent.detail}>
                  {agent.detail}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
})
