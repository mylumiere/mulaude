/**
 * Pane 폴링 + 팀 config 스캔 + 자식 pane 포워딩 모듈
 *
 * 2초 간격으로 tmux pane 내용을 캡처하고,
 * team config 기반으로 에이전트-pane 매칭을 수행합니다.
 * 자식 pane 데이터를 16ms 배치 처리로 렌더러에 전달합니다.
 */

import type { BrowserWindow } from 'electron'
import { ipcMain } from 'electron'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { SessionManager } from './session-manager'
import { listTmuxPanesWithIds, getPaneCurrentCommand, getPaneCommand } from './tmux-utils'
import { createBatchForwarder } from './session-forwarder'
import type { AgentPaneInfo } from './child-pane-streamer'
import type { AgentInfo } from '../shared/types'
import { PANE_POLL_INTERVAL } from '../shared/constants'

/** team config mtime 캐시 (경로 -> { mtime, members }) */
interface TeamConfigCache {
  mtime: number
  members: { name: string; agentType?: string; tmuxPaneId?: string; isActive?: boolean }[]
}
const teamConfigCaches = new Map<string, TeamConfigCache>()

/**
 * 에이전트 패널 깜박임 방지용 grace 카운터.
 * child pane이 일시적으로 감지 안 되는 경우 즉시 클리어하지 않고,
 * 연속 GRACE_THRESHOLD회 감지 안 될 때만 클리어합니다.
 */
const GRACE_THRESHOLD = 2
const agentAbsentCount = new Map<string, number>()
/** 마지막으로 전송한 에이전트 목록 직렬화 (변경 감지용) */
const lastSentAgents = new Map<string, string>()

/** 에이전트 목록이 실제로 변경되었을 때만 IPC 전송 */
function sendAgentsIfChanged(
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
 * ~/.claude/teams/{name}/config.json 스캔 -> 팀 멤버 목록 반환
 * mtime 캐싱으로 불필요한 파일 읽기 방지
 */
function scanTeamConfigs(): { teamName: string; members: TeamConfigCache['members'] }[] {
  const teamsDir = join(homedir(), '.claude', 'teams')
  let teamDirs: string[]
  try {
    teamDirs = readdirSync(teamsDir)
  } catch {
    return []
  }

  const results: { teamName: string; members: TeamConfigCache['members'] }[] = []
  const validPaths = new Set<string>()

  for (const teamName of teamDirs) {
    const configPath = join(teamsDir, teamName, 'config.json')
    try {
      const stat = statSync(configPath)
      const mtime = stat.mtimeMs
      const cached = teamConfigCaches.get(configPath)

      if (cached && cached.mtime === mtime) {
        validPaths.add(configPath)
        results.push({ teamName, members: cached.members })
        continue
      }

      const raw = readFileSync(configPath, 'utf-8')
      const config = JSON.parse(raw)
      const members = Array.isArray(config.members) ? config.members : []
      teamConfigCaches.set(configPath, { mtime, members })
      validPaths.add(configPath)
      results.push({ teamName, members })
    } catch {
      // config.json 없거나 파싱 실패 -> 무시
    }
  }

  // 삭제된 팀의 캐시 정리
  for (const key of teamConfigCaches.keys()) {
    if (!validPaths.has(key)) teamConfigCaches.delete(key)
  }

  return results
}

/**
 * 에이전트 pane 폴링을 시작합니다.
 *
 * 2초 간격으로:
 *   1. 각 세션의 pane 내용을 캡처하여 렌더러에 전달
 *   2. team config 기반으로 에이전트-pane 매칭 수행
 *   3. ChildPaneStreamer를 확정된 에이전트 목록으로 동기화
 *
 * @returns cleanup 함수 (앱 종료 시 호출)
 */
export function setupPanePolling(
  mainWindow: BrowserWindow,
  sessionManager: SessionManager
): () => void {
  // tmux 미사용 시 폴링 불필요
  if (!sessionManager.checkTmux().available) return () => {}

  const streamer = sessionManager.getChildPaneStreamer()
  const tmuxPath = sessionManager.getTmuxPath()!

  const timer = setInterval(() => {
    if (mainWindow.isDestroyed()) {
      clearInterval(timer)
      return
    }

    const sessions = sessionManager.getSessionList()
    if (sessions.length === 0) return

    // team config는 세션 루프 밖에서 한 번만 스캔
    const teamConfigs = scanTeamConfigs()

    for (const session of sessions) {
      // 메인 pane의 현재 프로세스명 확인 (쉘 감지용)
      if (session.tmuxSessionName) {
        const cmd = getPaneCurrentCommand(tmuxPath, session.tmuxSessionName)
        if (cmd) {
          mainWindow.webContents.send('session:pane-command', session.id, cmd)
        }
      }

      const panes = sessionManager.getSessionPaneContents(session.id)
      if (panes.length > 0) {
        mainWindow.webContents.send('session:panes', session.id, panes)
      }

      // Team config 기반 에이전트-pane 매칭 + ChildPaneStreamer 동기화
      if (!session.tmuxSessionName) continue

      const panesWithIds = listTmuxPanesWithIds(tmuxPath, session.tmuxSessionName)
      // window 0 = 리더, window 1+ = break-pane으로 분리된 child pane
      const childPanes = panesWithIds.filter(p => p.windowIndex > 0)

      // paneId -> windowIndex 맵 (렌더러 식별용)
      const childPaneMap = new Map<string, number>()
      for (const p of childPanes) {
        childPaneMap.set(p.paneId, p.windowIndex)
      }

      // 에이전트 매칭 시도
      let agents: AgentInfo[] = []
      let agentPanes: AgentPaneInfo[] = []

      if (childPaneMap.size > 0 && teamConfigs.length > 0) {
        for (const { members } of teamConfigs) {
          for (const member of members) {
            if (!member.tmuxPaneId) continue
            const paneIndex = childPaneMap.get(member.tmuxPaneId)
            if (paneIndex === undefined) continue
            // pane 프로세스 확인: 쉘이면 에이전트 종료 (비정상 종료 감지)
            let status: 'running' | 'completed' | 'exited' = member.isActive !== false ? 'running' : 'completed'
            if (status === 'running') {
              const cmd = getPaneCommand(tmuxPath, member.tmuxPaneId)
              const SHELLS = ['zsh', 'bash', 'sh', 'fish']
              if (cmd && SHELLS.includes(cmd)) {
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
      }

      if (agents.length > 0) {
        // 에이전트 발견 → grace 카운터 리셋 + 변경 시만 전송
        agentAbsentCount.delete(session.id)
        sendAgentsIfChanged(mainWindow, session.id, agents)
        if (streamer) streamer.syncWithAgents(session.id, agentPanes)
      } else {
        // 에이전트 미감지 → grace period 적용 (즉시 클리어하지 않음)
        const count = (agentAbsentCount.get(session.id) ?? 0) + 1
        agentAbsentCount.set(session.id, count)
        if (count >= GRACE_THRESHOLD) {
          sendAgentsIfChanged(mainWindow, session.id, [])
          if (streamer) streamer.syncWithAgents(session.id, [])
        }
      }
    }
  }, PANE_POLL_INTERVAL)

  return (): void => {
    clearInterval(timer)
  }
}

/**
 * 자식 pane 데이터를 렌더러로 포워딩합니다.
 * 16ms 배치 처리로 IPC 부하를 절감합니다.
 *
 * 자식 pane IPC 핸들러(childpane:write, childpane:resize)도 등록합니다.
 */
export function setupChildPaneForwarding(
  mainWindow: BrowserWindow,
  sessionManager: SessionManager
): void {
  const streamer = sessionManager.getChildPaneStreamer()
  if (!streamer) return

  // 데이터 배치 (16ms, 복합 키 사용)
  const pendingData: Map<string, Map<number, string>> = new Map()
  let flushScheduled = false

  const flush = (): void => {
    flushScheduled = false
    if (mainWindow.isDestroyed()) return
    for (const [sessionId, paneMap] of pendingData) {
      for (const [paneIndex, data] of paneMap) {
        mainWindow.webContents.send('childpane:data', sessionId, paneIndex, data)
      }
    }
    pendingData.clear()
  }

  streamer.onData((sessionId, paneIndex, data) => {
    if (!pendingData.has(sessionId)) {
      pendingData.set(sessionId, new Map())
    }
    const paneMap = pendingData.get(sessionId)!
    paneMap.set(paneIndex, (paneMap.get(paneIndex) || '') + data)
    if (!flushScheduled) {
      flushScheduled = true
      setTimeout(flush, 16)
    }
  })

  streamer.onPaneDiscovered((sessionId, paneIndex, initialContent) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('childpane:discovered', sessionId, paneIndex, initialContent)
    }
  })

  streamer.onPaneRemoved((sessionId, paneIndex) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('childpane:removed', sessionId, paneIndex)
    }
  })

  // 자식 pane IPC 핸들러
  ipcMain.on('childpane:write', (_e, sessionId: string, paneIndex: number, data: string) => {
    sessionManager.getChildPaneStreamer()?.writeToPane(sessionId, paneIndex, data)
  })
  ipcMain.on('childpane:resize', (_e, sessionId: string, paneIndex: number, cols: number, rows: number) => {
    sessionManager.getChildPaneStreamer()?.resizePane(sessionId, paneIndex, cols, rows)
  })
}
