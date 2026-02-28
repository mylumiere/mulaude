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
import type { SessionManager } from './session-manager'
import { readUsageData } from './ipc-handlers'
import { IPC_BATCH_INTERVAL } from '../shared/constants'

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
    for (const [id, data] of pending) {
      mainWindow.webContents.send('session:data', id, data)
    }
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

/**
 * usage-cache.json 변경 감시 -> 렌더러에 자동 전달
 *
 * @returns cleanup 함수 (앱 종료 시 호출)
 */
export function watchUsageData(mainWindow: BrowserWindow): () => void {
  const usageCachePath = join(homedir(), '.claude', 'plugins', 'claude-hud', '.usage-cache.json')
  try {
    watchFile(usageCachePath, { interval: 5000 }, () => {
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
