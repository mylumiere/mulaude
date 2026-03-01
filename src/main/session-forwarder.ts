/**
 * 세션 데이터 포워딩 모듈
 *
 * PTY 출력 데이터와 usage 캐시 변경을 렌더러로 전달합니다.
 * 16ms 배치 처리(~60fps)로 IPC 부하를 절감합니다.
 */

import type { BrowserWindow } from 'electron'
import { watchFile, unwatchFile } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { exec } from 'child_process'
import type { SessionManager } from './session-manager'
import { readUsageData } from './ipc-handlers'
import { IPC_BATCH_INTERVAL, USAGE_WATCH_INTERVAL, HUD_POLL_INTERVAL } from '../shared/constants'

/**
 * 16ms 배치 처리 유틸리티를 생성합니다.
 *
 * 동일 키에 대한 데이터를 누적한 뒤 일괄 전송하여
 * IPC 호출 횟수를 줄입니다. 3곳에서 사용되는 공통 패턴입니다.
 *
 * @param onFlush - 배치된 데이터를 전송하는 콜백. false 반환 시 전송 스킵
 * @returns append 함수 (키와 데이터를 누적)
 */
export function createBatchForwarder<K>(
  onFlush: (pending: Map<K, string>) => boolean | void
): (key: K, data: string) => void {
  const pending = new Map<K, string>()
  let flushScheduled = false

  const flush = (): void => {
    flushScheduled = false
    if (onFlush(pending) === false) return
    pending.clear()
  }

  return (key: K, data: string): void => {
    pending.set(key, (pending.get(key) || '') + data)
    if (!flushScheduled) {
      flushScheduled = true
      setTimeout(flush, IPC_BATCH_INTERVAL)
    }
  }
}

/**
 * 세션 데이터(PTY 출력 + 종료 이벤트)를 렌더러로 포워딩합니다.
 *
 * PTY 출력은 16ms 배치 처리로 IPC 부하를 절감합니다.
 * 종료 이벤트는 즉시 전달합니다.
 */
export function setupSessionDataForwarding(
  mainWindow: BrowserWindow,
  sessionManager: SessionManager
): void {
  const append = createBatchForwarder<string>((pending) => {
    if (mainWindow.isDestroyed()) return false
    // 모든 세션 데이터를 단일 IPC로 배치 전송 (세션 수에 비례하던 IPC 호출 → 1회)
    const batch: Record<string, string> = {}
    for (const [id, data] of pending) {
      batch[id] = data
    }
    mainWindow.webContents.send('session:data-batch', batch)
  })

  sessionManager.onAnyData((id: string, data: string) => {
    append(id, data)
  })

  sessionManager.onAnyExit((id: string, exitCode: number) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('session:exit', id, exitCode)
    }
  })
}

// ─── HUD 백그라운드 폴러 ───
// statusLine 제거 시에도 claude-hud 명령을 직접 실행하여 usage-cache.json 갱신 유지

let hudPollTimer: ReturnType<typeof setInterval> | null = null

/**
 * HUD 백그라운드 폴러를 시작합니다.
 * statusLine이 제거된 상태에서도 claude-hud 명령을 주기적으로 실행하여
 * usage-cache.json이 갱신되도록 합니다.
 */
export function startHudPoller(command: string): void {
  stopHudPoller()
  const run = (): void => { exec(command, { timeout: 10000 }, () => {}) }
  run()
  hudPollTimer = setInterval(run, HUD_POLL_INTERVAL)
}

/** HUD 백그라운드 폴러를 중지합니다. */
export function stopHudPoller(): void {
  if (hudPollTimer) {
    clearInterval(hudPollTimer)
    hudPollTimer = null
  }
}

/**
 * usage-cache.json 변경 감시 -> 렌더러에 자동 전달
 *
 * @returns cleanup 함수 (앱 종료 시 호출)
 */
export function watchUsageData(mainWindow: BrowserWindow): () => void {
  const usageCachePath = join(homedir(), '.claude', 'plugins', 'claude-hud', '.usage-cache.json')
  try {
    watchFile(usageCachePath, { interval: USAGE_WATCH_INTERVAL }, () => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('usage:updated', readUsageData())
      }
    })
  } catch {
    // 파일 없으면 무시
  }
  return (): void => {
    try { unwatchFile(usageCachePath) } catch { /* ignore */ }
  }
}
