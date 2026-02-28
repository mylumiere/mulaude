/**
 * IPC 핸들러 등록 모듈
 *
 * renderer ↔ main 프로세스 간 통신을 위한 22개 IPC 핸들러를 등록합니다.
 * 세션 CRUD, 터미널 입출력, 다이얼로그, 사용량 데이터 등을 처리합니다.
 */

import { ipcMain, dialog, Notification } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { SessionManager } from './session-manager'
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

  // HUD 오버레이 숨기기/복원
  ipcMain.handle('hud:set-hidden', async (_event, hide: boolean) => {
    try {
      const settingsPath = join(homedir(), '.claude', 'settings.json')
      if (!existsSync(settingsPath)) return

      const raw = readFileSync(settingsPath, 'utf-8')
      const settings = JSON.parse(raw)

      if (hide) {
        // statusLine 백업 후 제거
        if (settings.statusLine) {
          settings._mulaudeStatusLineBackup = settings.statusLine
          delete settings.statusLine
        }
        // enabledPlugins에서 claude-hud 비활성화
        if (settings.enabledPlugins?.['claude-hud@claude-hud']) {
          settings._mulaudeHudPluginBackup = true
          settings.enabledPlugins['claude-hud@claude-hud'] = false
        }
      } else {
        // statusLine 복원
        if (settings._mulaudeStatusLineBackup) {
          settings.statusLine = settings._mulaudeStatusLineBackup
          delete settings._mulaudeStatusLineBackup
        }
        // claude-hud 플러그인 복원
        if (settings._mulaudeHudPluginBackup) {
          if (settings.enabledPlugins) {
            settings.enabledPlugins['claude-hud@claude-hud'] = true
          }
          delete settings._mulaudeHudPluginBackup
        }
      }

      writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8')
    } catch (err) {
      console.error('[IPC] hud:set-hidden failed:', err)
    }
  })
}
