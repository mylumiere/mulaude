/**
 * Pane 폴링 + 자식 pane 포워딩 모듈
 *
 * 2초 간격으로 tmux pane 내용을 캡처하고,
 * team config 기반으로 에이전트-pane 매칭을 수행합니다.
 * 자식 pane 데이터를 16ms 배치 처리로 렌더러에 전달합니다.
 */

import type { BrowserWindow } from 'electron'
import { ipcMain } from 'electron'
import type { SessionManager } from './session-manager'
import { listTmuxPanesWithIds, getPaneCurrentCommand } from './tmux-utils'
import { scanTeamConfigs } from './team-config-scanner'
import {
  sendAgentsIfChanged,
  buildAgentsFromConfig
} from './agent-matcher'
import { PANE_POLL_INTERVAL } from '../shared/constants'

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
      // 이 세션에 속하는 전체 paneId 셋 (session ↔ team 바인딩 검증용)
      const allPaneIds = new Set(panesWithIds.map(p => p.paneId))

      // window 0 = 리더, window 1+ = break-pane으로 분리된 child pane
      const childPanes = panesWithIds.filter(p => p.windowIndex > 0)

      // paneId -> windowIndex 맵 (렌더러 식별용)
      const childPaneMap = new Map<string, number>()
      for (const p of childPanes) {
        childPaneMap.set(p.paneId, p.windowIndex)
      }

      // Config SSOT: config 기반 에이전트 목록 생성
      const { agents, agentPanes } = buildAgentsFromConfig(tmuxPath, session.id, teamConfigs, childPaneMap, allPaneIds)

      // UI: config 기반 (안정적, 깜박임 없음)
      sendAgentsIfChanged(mainWindow, session.id, agents)
      // 스트리밍: 실제 tmux pane만 (buildAgentsFromConfig가 필터링)
      if (streamer) streamer.syncWithAgents(session.id, agentPanes)
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
