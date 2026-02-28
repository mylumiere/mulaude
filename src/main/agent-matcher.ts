/**
 * agent-matcher — config SSOT 기반 에이전트 목록 생성
 *
 * team config를 단일 진실 소스(SSOT)로 사용합니다.
 * config에 멤버가 있으면 무조건 UI에 표시하고,
 * tmux 매칭은 터미널 스트리밍 시작 시점만 결정합니다.
 *
 * session ↔ team 바인딩:
 *   최초 매칭 시 session → teamName을 고정하여,
 *   이후 폴링에서는 해당 team config만 참조합니다.
 *
 * 라이프사이클:
 *   1. config에 멤버 추가 (tmuxPaneId 없음) → pending (placeholder)
 *   2. tmuxPaneId 매칭 → running (xterm 터미널)
 *   3. isActive: false 또는 쉘 감지 → exited (블러 오버레이)
 *   4. config에서 멤버 삭제 → pane 제거
 */

import { rmSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { BrowserWindow } from 'electron'
import { getPaneCommand } from './tmux-utils'
import type { AgentPaneInfo } from './child-pane-streamer'
import type { AgentInfo } from '../shared/types'
import type { TeamConfigCache } from './team-config-scanner'
import { SHELL_COMMANDS } from '../shared/constants'

/** paneId → paneIndex 캐시 (tmux 응답 지연 시 이전 값 사용) */
const paneIndexCache = new Map<string, number>()
/** 마지막 전송 직렬화 (변경 감지용) */
const lastSentAgents = new Map<string, string>()
/** session → team 바인딩 (한 번 매칭되면 고정) */
const sessionTeamMap = new Map<string, string>()
/** 에이전트 목록이 변경되었을 때만 IPC 전송 */
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

/**
 * Config SSOT 기반 에이전트 목록 생성.
 *
 * config의 모든 멤버를 에이전트로 포함합니다 (리더 제외).
 * tmuxPaneId가 있지만 아직 tmux에서 매칭 안 된 경우 캐시를 사용하고,
 * 한 번도 매칭 안 된 경우 synthetic paneIndex를 부여합니다.
 *
 * session ↔ team 바인딩: 최초 매칭 시 고정하여 다른 세션에 영향 없음.
 *
 * @returns agents - UI용 (config 기반, 안정적)
 * @returns agentPanes - 스트리밍용 (실제 tmux pane만)
 */
export function buildAgentsFromConfig(
  tmuxPath: string,
  sessionId: string,
  teamConfigs: { teamName: string; leadAgentId?: string; members: TeamConfigCache['members'] }[],
  childPaneMap: Map<string, number>,
  allPaneIds: Set<string>
): { agents: AgentInfo[]; agentPanes: AgentPaneInfo[] } {
  const agents: AgentInfo[] = []
  const agentPanes: AgentPaneInfo[] = []
  let pendingIdx = 1 // pending 에이전트용 안정적 인덱스 (-(1), -(2), ...)

  // 이미 바인딩된 team이 있으면 해당 team config만 사용
  const boundTeam = sessionTeamMap.get(sessionId)
  const configsToCheck = boundTeam
    ? teamConfigs.filter(c => c.teamName === boundTeam)
    : teamConfigs

  // 바인딩된 team config가 사라졌으면 (팀 해산) 바인딩 해제
  if (boundTeam && configsToCheck.length === 0) {
    sessionTeamMap.delete(sessionId)
    return { agents, agentPanes }
  }

  for (const { teamName, leadAgentId, members } of configsToCheck) {
    // 최초 바인딩: 이 team의 멤버 pane이 이 세션에 속하는지 검증
    // 멤버 중 하나라도 이 세션의 tmux pane에 속하면 바인딩
    if (!boundTeam && allPaneIds.size > 0) {
      const hasMatchingPane = members.some(
        m => m.tmuxPaneId && allPaneIds.has(m.tmuxPaneId)
      )
      if (!hasMatchingPane) continue // 이 세션과 무관한 team → 스킵
    }

    for (const member of members) {
      // 리더는 메인 터미널이므로 스킵
      if (leadAgentId && member.agentId === leadAgentId) continue
      // tmuxPaneId 필드 자체가 없으면 스킵
      if (member.tmuxPaneId === undefined) continue

      // tmuxPaneId 빈 문자열 = pane 미배정 → pending
      if (!member.tmuxPaneId) {
        agents.push({
          name: member.name,
          type: member.agentType,
          status: 'pending',
          paneIndex: -(pendingIdx++)
        })
        continue
      }

      // paneIndex: tmux에서 찾으면 캐시 갱신, 못 찾으면 캐시 사용
      const tmuxIndex = childPaneMap.get(member.tmuxPaneId)
      let paneIndex: number | undefined
      if (tmuxIndex !== undefined) {
        paneIndex = tmuxIndex
        paneIndexCache.set(member.tmuxPaneId, tmuxIndex)
      } else {
        paneIndex = paneIndexCache.get(member.tmuxPaneId)
      }

      // 한 번도 tmux에서 감지 안 됨 → pending (break-pane 진행 중)
      if (paneIndex === undefined) {
        agents.push({
          name: member.name,
          type: member.agentType,
          status: 'pending',
          paneIndex: -(pendingIdx++)
        })
        continue
      }

      // status: config의 isActive 기준
      let status: 'running' | 'completed' | 'exited' =
        member.isActive !== false ? 'running' : 'exited'

      // running + 실제 tmux에 존재 → 쉘 프로세스 감지로 exited 판별
      if (status === 'running' && tmuxIndex !== undefined) {
        const cmd = getPaneCommand(tmuxPath, member.tmuxPaneId)
        if (cmd && (SHELL_COMMANDS as readonly string[]).includes(cmd)) {
          status = 'exited'
        }
      }

      agents.push({ name: member.name, type: member.agentType, status, paneIndex })

      // 스트리밍은 실제 tmux에 존재하는 pane만
      if (tmuxIndex !== undefined) {
        agentPanes.push({ paneId: member.tmuxPaneId, paneIndex })
      }
    }

    if (agents.length > 0) {
      // 최초 매칭: session ↔ team 바인딩 고정
      if (!boundTeam) {
        sessionTeamMap.set(sessionId, teamName)
      }
      break
    }
  }

  return { agents, agentPanes }
}

/**
 * 세션 제거 시 상태 정리 + team config 삭제.
 *
 * destroySession에서 호출합니다.
 * 세션에 연결된 team config 디렉토리(~/.claude/teams/{teamName}/)를
 * 함께 삭제하여 좀비 config가 남지 않도록 합니다.
 */
export function cleanupAgentState(sessionId: string): void {
  const teamName = sessionTeamMap.get(sessionId)
  if (teamName) {
    const teamDir = join(homedir(), '.claude', 'teams', teamName)
    try {
      rmSync(teamDir, { recursive: true, force: true })
    } catch {
      // 이미 삭제됨 또는 권한 없음 → 무시
    }
    sessionTeamMap.delete(sessionId)
  }
  lastSentAgents.delete(sessionId)
}
