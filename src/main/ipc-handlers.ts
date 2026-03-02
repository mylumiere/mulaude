/**
 * IPC 핸들러 등록 모듈
 *
 * renderer ↔ main 프로세스 간 통신을 위한 22개 IPC 핸들러를 등록합니다.
 * 세션 CRUD, 터미널 입출력, 다이얼로그, 사용량 데이터 등을 처리합니다.
 */

import { ipcMain, dialog, Notification, clipboard, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { SessionManager } from './session-manager'
import type { NativeChatManager } from './native-chat-manager'
import { startHudPoller, stopHudPoller } from './session-forwarder'
import type { UsageData } from '../shared/types'

/**
 * main 프로세스 다이얼로그 번역 함수
 *
 * renderer의 i18n.ts를 직접 import할 수 없으므로 (브라우저 API 의존),
 * 외부에서 dt 함수를 주입받습니다.
 */
type TranslateFn = (key: string, vars?: Record<string, string | number>) => string

/**
 * Claude 사용량 데이터를 읽습니다.
 * claude-hud 플러그인의 캐시 파일에서 사용량 정보를 파싱합니다.
 */
export function readUsageData(): UsageData | null {
  try {
    const cachePath = join(homedir(), '.claude', 'plugins', 'claude-hud', '.usage-cache.json')
    const raw = readFileSync(cachePath, 'utf-8')
    const parsed = JSON.parse(raw)
    return parsed.data || null
  } catch {
    return null
  }
}

/**
 * 모든 IPC 핸들러를 등록합니다.
 *
 * @param sessionManager - 세션 관리자 인스턴스
 * @param dt - 다이얼로그 번역 함수
 * @param setLocale - locale 변경 콜백
 */
export function registerIpcHandlers(
  sessionManager: SessionManager,
  dt: TranslateFn,
  setLocale: (locale: string) => void
): void {
  // 세션 생성
  ipcMain.handle('session:create', async (_event, workingDir: string) => {
    try {
      const session = sessionManager.createSession(workingDir)
      return {
        id: session.id,
        name: session.name,
        workingDir: session.workingDir,
        tmuxSessionName: session.tmuxSessionName,
        createdAt: session.createdAt
      }
    } catch (err) {
      console.error('[IPC] session:create failed:', err)
      throw err
    }
  })

  // 세션 삭제
  ipcMain.handle('session:destroy', async (_event, id: string) => {
    try {
      sessionManager.destroySession(id)
    } catch (err) {
      console.error('[IPC] session:destroy failed:', err)
      throw err
    }
  })

  // 세션 목록
  ipcMain.handle('session:list', async () => {
    try {
      return sessionManager.getSessionList()
    } catch (err) {
      console.error('[IPC] session:list failed:', err)
      throw err
    }
  })

  // tmux 상태 확인
  ipcMain.handle('tmux:check', async () => {
    try {
      return sessionManager.checkTmux()
    } catch (err) {
      console.error('[IPC] tmux:check failed:', err)
      throw err
    }
  })

  // 저장된 세션 복원
  ipcMain.handle('session:restore-all', async () => {
    try {
      return sessionManager.restoreAllSessions()
    } catch (err) {
      console.error('[IPC] session:restore-all failed:', err)
      throw err
    }
  })

  // 세션 이름 업데이트 (영속 저장소 동기화)
  ipcMain.on('session:name-update', (_event, id: string, name: string) => {
    try {
      sessionManager.getSessionStore().updateSessionName(id, name)
    } catch (err) {
      console.error('[IPC] session:name-update failed:', err)
    }
  })

  // 세션 부제목(subtitle) 업데이트 (자동 감지 작업명 -> 영속 저장소)
  ipcMain.on('session:subtitle-update', (_event, id: string, subtitle: string) => {
    try {
      sessionManager.getSessionStore().updateSessionSubtitle(id, subtitle)
    } catch (err) {
      console.error('[IPC] session:subtitle-update failed:', err)
    }
  })

  // 세션 화면 캡처 (세션 전환 시 xterm 복원용)
  ipcMain.handle('session:capture-screen', async (_event, id: string) => {
    try {
      return sessionManager.captureScreen(id)
    } catch (err) {
      console.error('[IPC] session:capture-screen failed:', err)
      return null
    }
  })

  // 렌더러에서 locale 변경 시 main에 전달
  ipcMain.on('app:set-locale', (_event, locale: string) => {
    setLocale(locale)
  })

  // 터미널 입력 전송
  ipcMain.on('session:write', (_event, id: string, data: string) => {
    sessionManager.write(id, data)
  })

  // 터미널 리사이즈
  ipcMain.on('session:resize', (_event, id: string, cols: number, rows: number) => {
    sessionManager.resize(id, cols, rows)
  })

  // 폴더 선택 다이얼로그
  ipcMain.handle('dialog:openDirectory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: dt('dialog.openDirectory')
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    return result.filePaths[0]
  })

  // 데스크톱 알림 (Electron 네이티브)
  ipcMain.on('notify', (_event, title: string, body: string) => {
    console.log(`[Notification] title="${title}" body="${body}" supported=${Notification.isSupported()}`)
    if (Notification.isSupported()) {
      const notif = new Notification({ title, body: body || title, silent: false })
      notif.show()
      notif.on('show', () => console.log('[Notification] shown'))
      notif.on('failed', (_, err) => console.error('[Notification] failed:', err))
    }
  })

  // Claude 사용량 데이터 읽기
  ipcMain.handle('usage:read', async () => {
    return readUsageData()
  })

  // 클립보드에 이미지가 있고 텍스트가 없는지 확인 (이미지 붙여넣기 감지용)
  ipcMain.handle('clipboard:check-paste', async () => {
    const image = clipboard.readImage()
    const text = clipboard.readText()
    return { hasImage: !image.isEmpty(), hasText: !!text.trim() }
  })

  // HUD 오버레이 숨기기/복원
  ipcMain.handle('hud:set-hidden', async (_event, hide: boolean) => {
    try {
      const settingsPath = join(homedir(), '.claude', 'settings.json')
      if (!existsSync(settingsPath)) return

      const raw = readFileSync(settingsPath, 'utf-8')
      const settings = JSON.parse(raw)

      if (hide) {
        // statusLine 백업 후 제거 (터미널 내 시각적 표시만 숨김)
        if (settings.statusLine) {
          settings._mulaudeStatusLineBackup = settings.statusLine
          delete settings.statusLine
        }
        // claude-hud 플러그인은 활성 유지 (usage-cache.json 갱신 필요)
        // 이전 버전에서 비활성화된 경우 복원
        if (settings._mulaudeHudPluginBackup) {
          if (settings.enabledPlugins) {
            settings.enabledPlugins['claude-hud@claude-hud'] = true
          }
          delete settings._mulaudeHudPluginBackup
        }
        // statusLine 제거로 claude-hud가 실행되지 않으므로 백그라운드 폴링으로 대체
        const backup = settings._mulaudeStatusLineBackup
        if (backup?.command) {
          startHudPoller(backup.command)
        }
      } else {
        // 백그라운드 폴러 중지 (statusLine 복원 → Claude Code가 직접 실행)
        stopHudPoller()
        // statusLine 복원
        if (settings._mulaudeStatusLineBackup) {
          settings.statusLine = settings._mulaudeStatusLineBackup
          delete settings._mulaudeStatusLineBackup
        }
      }

      writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8')
    } catch (err) {
      console.error('[IPC] hud:set-hidden failed:', err)
    }
  })
}

/**
 * Native Chat 모드용 IPC 핸들러를 등록합니다.
 *
 * Terminal 모드와 동일한 채널명(session:create 등)을 사용하되,
 * NativeChatManager에 위임합니다. 터미널 전용 API(session:write, session:resize 등)는
 * 등록하지 않고, 대신 native:send-message, native:cancel 등을 추가합니다.
 *
 * @param nativeChatManager - Native Chat 세션 관리자
 * @param dt - 다이얼로그 번역 함수
 * @param setLocale - locale 변경 콜백
 * @param mainWindow - 메인 BrowserWindow (clipboard 등에 사용)
 */
export function registerNativeIpcHandlers(
  nativeChatManager: NativeChatManager,
  dt: TranslateFn,
  setLocale: (locale: string) => void,
  _mainWindow: BrowserWindow
): void {
  // ─── 세션 CRUD (terminal 모드와 동일한 채널명) ───

  ipcMain.handle('session:create', async (_event, workingDir: string) => {
    try {
      return nativeChatManager.createSession(workingDir)
    } catch (err) {
      console.error('[IPC] session:create failed:', err)
      throw err
    }
  })

  ipcMain.handle('session:destroy', async (_event, id: string) => {
    try {
      nativeChatManager.destroySession(id)
    } catch (err) {
      console.error('[IPC] session:destroy failed:', err)
      throw err
    }
  })

  ipcMain.handle('session:list', async () => {
    try {
      return nativeChatManager.getSessionList()
    } catch (err) {
      console.error('[IPC] session:list failed:', err)
      throw err
    }
  })

  // tmux 체크 → 항상 available (배너 표시 방지)
  ipcMain.handle('tmux:check', async () => {
    return { available: true, version: null }
  })

  ipcMain.handle('session:restore-all', async () => {
    try {
      return nativeChatManager.restoreAllSessions()
    } catch (err) {
      console.error('[IPC] session:restore-all failed:', err)
      throw err
    }
  })

  // ─── 세션 메타데이터 업데이트 ───

  ipcMain.on('session:name-update', (_event, id: string, name: string) => {
    try {
      nativeChatManager.getSessionStore().updateSessionName(id, name)
    } catch (err) {
      console.error('[IPC] session:name-update failed:', err)
    }
  })

  ipcMain.on('session:subtitle-update', (_event, id: string, subtitle: string) => {
    try {
      nativeChatManager.getSessionStore().updateSessionSubtitle(id, subtitle)
    } catch (err) {
      console.error('[IPC] session:subtitle-update failed:', err)
    }
  })

  // ─── Native Chat 전용 ───

  ipcMain.on('native:send-message', (_event, sessionId: string, text: string) => {
    nativeChatManager.sendMessage(sessionId, text)
  })

  ipcMain.on('native:cancel', (_event, sessionId: string) => {
    nativeChatManager.cancelMessage(sessionId)
  })

  // Permission/Question 응답 전달 (렌더러 → main → claude stdin)
  ipcMain.on('native:input-response', (_event, sessionId: string, requestId: string, response: Record<string, unknown>) => {
    nativeChatManager.respondToPrompt(sessionId, requestId, response)
  })

  // 큐 메시지 업데이트 (텍스트 수정)
  ipcMain.on('native:update-queue', (_event, sessionId: string, text: string) => {
    nativeChatManager.updateQueue(sessionId, text)
  })

  // 큐 메시지 삭제
  ipcMain.on('native:clear-queue', (_event, sessionId: string) => {
    nativeChatManager.clearQueue(sessionId)
  })

  // ─── 공유 핸들러 (두 모드 공통) ───

  ipcMain.on('app:set-locale', (_event, locale: string) => {
    setLocale(locale)
  })

  ipcMain.handle('dialog:openDirectory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: dt('dialog.openDirectory')
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.on('notify', (_event, title: string, body: string) => {
    if (Notification.isSupported()) {
      const notif = new Notification({ title, body: body || title, silent: false })
      notif.show()
    }
  })

  ipcMain.handle('usage:read', async () => {
    return readUsageData()
  })

  ipcMain.handle('clipboard:check-paste', async () => {
    const image = clipboard.readImage()
    const text = clipboard.readText()
    return { hasImage: !image.isEmpty(), hasText: !!text.trim() }
  })

  ipcMain.handle('hud:set-hidden', async (_event, hide: boolean) => {
    try {
      const settingsPath = join(homedir(), '.claude', 'settings.json')
      if (!existsSync(settingsPath)) return

      const raw = readFileSync(settingsPath, 'utf-8')
      const settings = JSON.parse(raw)

      if (hide) {
        if (settings.statusLine) {
          settings._mulaudeStatusLineBackup = settings.statusLine
          delete settings.statusLine
        }
        if (settings._mulaudeHudPluginBackup) {
          if (settings.enabledPlugins) settings.enabledPlugins['claude-hud@claude-hud'] = true
          delete settings._mulaudeHudPluginBackup
        }
        const backup = settings._mulaudeStatusLineBackup
        if (backup?.command) startHudPoller(backup.command)
      } else {
        stopHudPoller()
        if (settings._mulaudeStatusLineBackup) {
          settings.statusLine = settings._mulaudeStatusLineBackup
          delete settings._mulaudeStatusLineBackup
        }
      }

      writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8')
    } catch (err) {
      console.error('[IPC] hud:set-hidden failed:', err)
    }
  })

  // ─── 터미널 전용 API의 No-op 핸들러 (Sidebar 등에서 호출 가능) ───

  ipcMain.handle('session:capture-screen', async () => null)
}
