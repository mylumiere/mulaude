/**
 * Pane 폴링 + 자식 pane 포워딩 모듈
 *
 * 2초 간격으로 tmux pane 내용을 캡처하고,
 * team config 기반으로 에이전트-pane 매칭을 수행합니다.
 * 자식 pane 데이터를 16ms 배치 처리로 렌더러에 전달합니다.
 *
 * 비동기 전환: execFileSync → execFileAsync로 이벤트 루프 블로킹 방지.
 * 이중 호출 제거: getSessionPaneContents 결과를 변수에 저장 후 재사용.
 */

import type { BrowserWindow } from 'electron'
import { ipcMain } from 'electron'
import type { SessionManager } from './session-manager'
import { listTmuxPanesWithIdsAsync, getPaneCurrentCommandAsync } from './tmux-utils'
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

  /** pane command 폴링 라운드 카운터 — 매 사이클 세션의 1/3만 체크 */
  let pollRound = 0
  /** 에이전트 활성 세션 캐시 (child pane이 있었던 세션) */
  const sessionsWithAgents = new Set<string>()
  /** 중복 실행 방지 가드 */
  let polling = false

  const timer = setInterval(() => {
    if (mainWindow.isDestroyed()) {
      clearInterval(timer)
      return
    }
    if (polling) return // 이전 폴링이 아직 진행 중이면 스킵
    polling = true
    ;(async () => {
      try {
        const sessions = sessionManager.getSessionList()
        if (sessions.length === 0) return

        pollRound++

        // team config는 세션 루프 밖에서 한 번만 스캔 (비동기)
        const teamConfigs = await scanTeamConfigs()

        // team config가 있을 때만 에이전트 감지 수행 (없으면 비용 절약)
        const hasTeamConfigs = teamConfigs.length > 0

        for (let i = 0; i < sessions.length; i++) {
          const session = sessions[i]

          // pane command 체크: 라운드 로빈으로 분산 (세션 수가 많을 때 exec 호출 분산)
          if (session.tmuxSessionName && (i % 3 === pollRound % 3)) {
            const cmd = await getPaneCurrentCommandAsync(tmuxPath, session.tmuxSessionName)
            if (cmd) {
              mainWindow.webContents.send('session:pane-command', session.id, cmd)
            }
          }

          if (!session.tmuxSessionName) continue

          // 에이전트 감지: team config가 있거나 이전에 에이전트가 있었던 세션만
          if (!hasTeamConfigs && !sessionsWithAgents.has(session.id)) continue

          // -s 플래그로 모든 window의 pane 조회 (break-pane 후 별도 window의 child pane 포함)
          const panesWithIds = await listTmuxPanesWithIdsAsync(tmuxPath, session.tmuxSessionName)
          const allPaneIds = new Set(panesWithIds.map(p => p.paneId))
          const childPanes = panesWithIds.filter(p => p.windowIndex > 0)
          const hasChildPanes = childPanes.length > 0

          const childPaneMap = new Map<string, number>()
          for (const p of childPanes) {
            childPaneMap.set(p.paneId, p.windowIndex)
          }

          const { agents, agentPanes } = await buildAgentsFromConfig(tmuxPath, session.id, teamConfigs, childPaneMap, allPaneIds)

          sendAgentsIfChanged(mainWindow, session.id, agents)
          if (streamer) streamer.syncWithAgents(session.id, agentPanes)

          // child pane이 있으면 pane 내용도 캡처하여 전달
          if (hasChildPanes) {
            sessionsWithAgents.add(session.id)
            const panes = await sessionManager.getSessionPaneContents(session.id)
            if (panes.length > 0) {
              mainWindow.webContents.send('session:panes', session.id, panes)
            }
          } else if (agents.length === 0) {
            // 에이전트도 child pane도 없으면 캐시에서 제거
            sessionsWithAgents.delete(session.id)
          }
        }
      } catch (err) {
        console.error('[PanePoller] polling error:', err)
      } finally {
        polling = false
      }
    })()
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
