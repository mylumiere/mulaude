/**
 * 세션 데이터 포워딩 모듈
 *
 * PTY 출력 데이터를 렌더러로 전달합니다.
 * 16ms 배치 처리(~60fps)로 IPC 부하를 절감합니다.
 */

import type { BrowserWindow } from 'electron'
import type { SessionManager } from './session-manager'
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

