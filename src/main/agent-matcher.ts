/**
 * agent-matcher — 에이전트-pane 매칭 및 변경 감지
 *
 * team config의 멤버 정보와 tmux pane을 매칭하여
 * 에이전트 목록을 생성합니다.
 */

import type { BrowserWindow } from 'electron'
import { getPaneCommand } from './tmux-utils'
import type { AgentPaneInfo } from './child-pane-streamer'
import type { AgentInfo } from '../shared/types'
import type { TeamConfigCache } from './team-config-scanner'
import { AGENT_GRACE_THRESHOLD, SHELL_COMMANDS } from '../shared/constants'

/**
 * 에이전트 패널 깜박임 방지용 grace 카운터.
 * child pane이 일시적으로 감지 안 되는 경우 즉시 클리어하지 않고,
 * 연속 AGENT_GRACE_THRESHOLD회 감지 안 될 때만 클리어합니다.
 */
const agentAbsentCount = new Map<string, number>()
/** 마지막으로 전송한 에이전트 목록 직렬화 (변경 감지용) */
const lastSentAgents = new Map<string, string>()

/** 에이전트 목록이 실제로 변경되었을 때만 IPC 전송 */
export function sendAgentsIfChanged(
  win: BrowserWindow,
  sessionId: string,
  agents: AgentInfo[]
): boolean {
  const serialized = JSON.stringify(agents)
  if (lastSentAgents.get(sessionId) === serialized) return false
  lastSentAgents.set(sessionId, serialized)
  win.webContents.send('session:team-agents', sessionId, agents)
  return true
}

/** team config 멤버와 child pane을 매칭하여 에이전트 목록 생성 */
export function matchAgentsFromTeamConfigs(
  tmuxPath: string,
  teamConfigs: { teamName: string; members: TeamConfigCache['members'] }[],
  childPaneMap: Map<string, number>
): { agents: AgentInfo[]; agentPanes: AgentPaneInfo[] } {
  const agents: AgentInfo[] = []
  const agentPanes: AgentPaneInfo[] = []

  if (childPaneMap.size === 0 || teamConfigs.length === 0) {
    return { agents, agentPanes }
  }

  for (const { members } of teamConfigs) {
    for (const member of members) {
      if (!member.tmuxPaneId) continue
      const paneIndex = childPaneMap.get(member.tmuxPaneId)
      if (paneIndex === undefined) continue
      // pane 프로세스 확인: 쉘이면 에이전트 종료 (비정상 종료 감지)
      let status: 'running' | 'completed' | 'exited' = member.isActive !== false ? 'running' : 'completed'
      if (status === 'running') {
        const cmd = getPaneCommand(tmuxPath, member.tmuxPaneId)
        if (cmd && (SHELL_COMMANDS as readonly string[]).includes(cmd)) {
          status = 'exited'
        }
      }
      agents.push({
        name: member.name,
        type: member.agentType,
        status,
        paneIndex
      })
      agentPanes.push({ paneId: member.tmuxPaneId, paneIndex })
    }
    if (agents.length > 0) break // 1 session = 1 team
  }

  return { agents, agentPanes }
}

/** grace period를 적용하여 에이전트 부재 시 즉시 클리어하지 않음 */
export function applyGracePeriod(sessionId: string, hasAgents: boolean): boolean {
  if (hasAgents) {
    agentAbsentCount.delete(sessionId)
    return true
  }

  const count = (agentAbsentCount.get(sessionId) ?? 0) + 1
  agentAbsentCount.set(sessionId, count)
  return count >= AGENT_GRACE_THRESHOLD
}

/** 세션 제거 시 에이전트 상태 정리 */
export function cleanupAgentState(sessionId: string): void {
  agentAbsentCount.delete(sessionId)
  lastSentAgents.delete(sessionId)
}
