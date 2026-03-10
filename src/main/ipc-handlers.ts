/**
 * IPC 핸들러 등록 모듈
 *
 * renderer ↔ main 프로세스 간 통신을 위한 22개 IPC 핸들러를 등록합니다.
 * 세션 CRUD, 터미널 입출력, 다이얼로그, 사용량 데이터 등을 처리합니다.
 */

import { ipcMain, dialog, Notification, clipboard, BrowserWindow } from 'electron'
import { writeFile, readFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import type { SessionManager } from './session-manager'
import type { NativeChatManager } from './native-chat-manager'
import { showOrphanDialog } from './close-handler'
import { getCachedUsageData, setHideHud, setKeychainAccess } from './statusline-manager'
import { launchPreview, stopPreview, writeLaunchConfig } from './preview-launcher'
import type { UsageData } from '../shared/types'

/** 이미지 파일 확장자 목록 */
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'tiff', 'tif']

/**
 * 클립보드에서 이미지를 추출하여 파일 경로를 반환합니다.
 *
 * 1. 텍스트가 있으면 null (일반 텍스트 paste에 위임)
 * 2. macOS Finder에서 파일 복사 시 → public.file-url에서 실제 경로 추출
 *    (clipboard.readImage()는 파일 아이콘을 반환하므로 사용하지 않음)
 * 3. 스크린샷 등 직접 이미지 데이터 → temp 파일로 저장
 */
async function saveClipboardImageToFile(): Promise<string | null> {
  const formats = clipboard.availableFormats()

  // macOS Finder 파일 복사 감지: text/uri-list 포맷이 있으면 파일 경로 추출
  if (formats.includes('text/uri-list')) {
    // macOS 네이티브 pasteboard 타입으로 file URL 읽기 시도
    for (const fmt of ['public.file-url', 'public.url', 'NSFilenamesPboardType']) {
      try {
        const buf = clipboard.readBuffer(fmt)
        if (buf.length > 0) {
          const raw = buf.toString('utf-8').replace(/\0/g, '').trim()
          // file:// URI에서 경로 추출
          if (raw.startsWith('file://')) {
            const filePath = decodeURIComponent(new URL(raw).pathname)
            const ext = filePath.toLowerCase().split('.').pop() || ''
            if (IMAGE_EXTENSIONS.includes(ext)) return filePath
          }
          // NSFilenamesPboardType: plist XML에서 경로 추출
          if (raw.includes('<string>')) {
            const match = raw.match(/<string>(.*?)<\/string>/)
            if (match) {
              const filePath = match[1]
              const ext = filePath.toLowerCase().split('.').pop() || ''
              if (IMAGE_EXTENSIONS.includes(ext)) return filePath
            }
          }
        }
      } catch {
        // 포맷 읽기 실패 → 다음 포맷 시도
      }
    }
    // Finder 복사지만 이미지 파일이 아닌 경우 → null (일반 paste에 위임)
    return null
  }

  // 텍스트가 있으면 일반 텍스트 paste에 위임
  const text = clipboard.readText()
  if (text.trim()) return null

  // 스크린샷 등 직접 이미지 데이터 → temp 파일로 저장
  const image = clipboard.readImage()
  if (image.isEmpty()) return null
  const pngBuffer = image.toPNG()
  const filePath = join(tmpdir(), `mulaude-paste-${Date.now()}.png`)
  await writeFile(filePath, pngBuffer)
  return filePath
}

/**
 * main 프로세스 다이얼로그 번역 함수
 *
 * renderer의 i18n.ts를 직접 import할 수 없으므로 (브라우저 API 의존),
 * 외부에서 dt 함수를 주입받습니다.
 */
type TranslateFn = (key: string, vars?: Record<string, string | number>) => string

/**
 * Claude 사용량 데이터를 읽습니다.
 * statusline-manager의 OAuth API 캐시에서 반환합니다.
 */
export function readUsageData(): UsageData | null {
  return getCachedUsageData()
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
  // cols/rows가 제공되면 tmux resize를 await한 후 캡처 (atomic resize+capture)
  ipcMain.handle('session:capture-screen', async (_event, id: string, cols?: number, rows?: number) => {
    try {
      return sessionManager.captureScreen(id, cols, rows)
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

  // tmux copy-mode 스크롤 (1줄 단위)
  ipcMain.on('session:scroll', (_event, id: string, direction: 'up' | 'down', lines: number) => {
    sessionManager.scroll(id, direction, lines)
  })

  // 폴더 선택 다이얼로그
  ipcMain.handle('dialog:openDirectory', async (event) => {
    const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const result = await dialog.showOpenDialog({
      ...(parentWindow ? { parentWindow } : {}),
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

  // HUD 오버레이 숨김 토글 (렌더러 → statusline-manager)
  ipcMain.on('hud:set-hidden', (_event, hide: boolean) => {
    setHideHud(hide)
  })

  // Keychain OAuth 접근 토글 (렌더러 → statusline-manager)
  ipcMain.on('keychain:set-access', (_event, enabled: boolean) => {
    setKeychainAccess(enabled)
  })

  // 클립보드 이미지를 파일 경로로 반환 (Finder 파일 복사 → 실제 경로, 스크린샷 → temp 저장)
  ipcMain.handle('clipboard:save-paste-image', async () => {
    try {
      return await saveClipboardImageToFile()
    } catch (err) {
      console.error('[IPC] clipboard:save-paste-image failed:', err)
      return null
    }
  })

  // Preview: 프로젝트 감지 + dev 서버 프로세스 실행
  ipcMain.handle('preview:launch', async (_event, sessionId: string, workingDir: string) => {
    return launchPreview(sessionId, workingDir)
  })

  // Preview: 프로세스 종료
  ipcMain.handle('preview:stop', async (_event, sessionId: string) => {
    stopPreview(sessionId)
  })

  // Preview: 사용자 확인 후 launch.json 저장
  ipcMain.handle('preview:save-config', async (_event, workingDir: string, config: { version?: string; configurations: { name: string; runtimeExecutable: string; runtimeArgs?: string[]; port?: number; cwd?: string }[] }) => {
    await writeLaunchConfig(workingDir, config)
  })

  // 미연결 tmux 세션 감지 및 정리
  ipcMain.handle('session:check-orphans', async () => {
    try {
      const orphans = sessionManager.getOrphanedTmuxSessions()
      if (orphans.length === 0) {
        return { found: 0, cleaned: false }
      }

      console.log(`[IPC] found ${orphans.length} orphaned tmux sessions:`, orphans)

      const mainWindow = BrowserWindow.getAllWindows()[0]
      if (!mainWindow) {
        return { found: orphans.length, cleaned: false }
      }

      const choice = await showOrphanDialog(mainWindow, orphans.length)
      if (choice === 'clean') {
        sessionManager.killOrphanedSessions(orphans)
        return { found: orphans.length, cleaned: true }
      }

      return { found: orphans.length, cleaned: false }
    } catch (err) {
      console.error('[IPC] session:check-orphans failed:', err)
      return { found: 0, cleaned: false }
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

  ipcMain.handle('dialog:openDirectory', async (event) => {
    const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const result = await dialog.showOpenDialog({
      ...(parentWindow ? { parentWindow } : {}),
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

  // HUD 오버레이 숨김 토글 (렌더러 → statusline-manager)
  ipcMain.on('hud:set-hidden', (_event, hide: boolean) => {
    setHideHud(hide)
  })

  // Keychain OAuth 접근 토글 (렌더러 → statusline-manager)
  ipcMain.on('keychain:set-access', (_event, enabled: boolean) => {
    setKeychainAccess(enabled)
  })

  ipcMain.handle('clipboard:save-paste-image', async () => {
    try {
      return await saveClipboardImageToFile()
    } catch (err) {
      console.error('[IPC] clipboard:save-paste-image failed:', err)
      return null
    }
  })

  // ─── 터미널 전용 API의 No-op 핸들러 (Sidebar 등에서 호출 가능) ───

  ipcMain.handle('session:capture-screen', async () => null)
}
