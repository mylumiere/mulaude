/**
 * Mulaude — 앱 진입점 (Main Process)
 *
 * Electron 앱 초기화, 창 생성, 모듈 간 연결만 담당합니다.
 * 실제 로직은 각 모듈에 위임합니다:
 *   - ipc-handlers.ts    — IPC 핸들러 등록
 *   - session-forwarder.ts — PTY 데이터 포워딩
 *   - statusline-manager.ts — Statusline + Usage API 통합
 *   - pane-poller.ts     — 에이전트 pane 폴링 + 자식 pane 포워딩
 *   - close-handler.ts   — 닫기 다이얼로그 + 번역
 */

import { app, BrowserWindow, screen, ipcMain, shell } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { SessionManager } from './session-manager'
import { HooksManager } from './hooks-manager'
import { NativeChatManager } from './native-chat-manager'
import { registerIpcHandlers, registerNativeIpcHandlers, registerCowrkIpcHandlers, cleanupPasteImages } from './ipc-handlers'
import { setupSessionDataForwarding } from './session-forwarder'
import { setupPanePolling, setupChildPaneForwarding } from './pane-poller'
import { startWatching as startStatuslineWatching, cleanup as cleanupStatusline } from './statusline-manager'
import { setupCloseHandler, dt, setLocale, getCloseAction, resetCloseAction } from './close-handler'
import { logger } from './logger'
import { unwatchAllPlans } from './plan-watcher'
import { stopAllPreviews } from './preview-launcher'
import { isDiffActive, debouncedRefresh, cleanupAllDiffs } from './diff-manager'
import { isViewerActive, viewerOnFileChange, cleanupAllViewers } from './viewer-manager'
import { DIFF_DEBOUNCE, VIEWER_DEBOUNCE } from '../shared/constants'
import { CowrkManager } from './cowrk-manager'
import { SCREEN_VISIBILITY_MARGIN, WINDOW_SAVE_DEBOUNCE } from '../shared/constants'
import type { AppMode } from '../shared/types'

// ─── 앱 모드 판별 (CLI 플래그) ───
const appMode: AppMode = process.argv.includes('--native') ? 'native' : 'terminal'

// 로거 초기화 (파일 로그 시작)
logger.init()
logger.info('App', `Mulaude v${app.getVersion()} starting (mode: ${appMode})`)

// macOS GPU 프로세스 크래시 방지
// Chromium GPU 프로세스가 예기치 않게 종료되는 문제를 우회합니다.
app.commandLine.appendSwitch('ignore-gpu-blocklist')
app.commandLine.appendSwitch('disable-gpu-compositing')

// ─── 크래시 핸들러 (uncaught exception / unhandled rejection) ───
process.on('uncaughtException', (error) => {
  logger.error('CRASH', 'Uncaught exception', error)
})
process.on('unhandledRejection', (reason) => {
  logger.error('CRASH', 'Unhandled rejection', reason)
})

// ─── statusLine 크래시 복구 ───
// 이전 실행에서 크래시로 종료된 경우 백업된 statusLine을 복원합니다.
try {
  const _settingsPath = join(app.getPath('home'), '.claude', 'settings.json')
  const _raw = readFileSync(_settingsPath, 'utf-8')
  const _settings = JSON.parse(_raw)
  if (_settings._mulaudeStatusLineBackup) {
    const _current = _settings.statusLine as { command?: string } | undefined
    // Mulaude statusline이 남아있거나 statusLine이 없는 경우 복원
    if (!_current || _current.command?.includes('mulaude')) {
      _settings.statusLine = _settings._mulaudeStatusLineBackup
      delete _settings._mulaudeStatusLineBackup
      writeFileSync(_settingsPath, JSON.stringify(_settings, null, 2), 'utf-8')
      logger.info('App', 'Restored statusLine from previous crash')
    }
  }
} catch {
  // 무시 (파일 없음 등)
}

const hooksManager = new HooksManager()

// ─── 윈도우 크기/위치 영속화 ───
const WINDOW_STATE_FILE = join(app.getPath('home'), '.mulaude', 'window-state.json')

interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  isMaximized?: boolean
}

function loadWindowState(): WindowState {
  try {
    return JSON.parse(readFileSync(WINDOW_STATE_FILE, 'utf-8'))
  } catch {
    return { width: 1200, height: 800 }
  }
}

function saveWindowState(win: BrowserWindow): void {
  try {
    const isMaximized = win.isMaximized()
    const bounds = isMaximized ? win.getNormalBounds() : win.getBounds()
    const state: WindowState = { ...bounds, isMaximized }
    mkdirSync(join(app.getPath('home'), '.mulaude'), { recursive: true })
    writeFileSync(WINDOW_STATE_FILE, JSON.stringify(state))
  } catch {
    // 무시
  }
}

function isVisibleOnScreen(state: WindowState): boolean {
  if (state.x === undefined || state.y === undefined) return false
  const displays = screen.getAllDisplays()
  return displays.some(d => {
    const { x, y, width, height } = d.workArea
    return state.x! >= x - SCREEN_VISIBILITY_MARGIN && state.x! <= x + width &&
           state.y! >= y - SCREEN_VISIBILITY_MARGIN && state.y! <= y + height
  })
}

function createWindow(): BrowserWindow {
  const saved = loadWindowState()
  const pos = isVisibleOnScreen(saved) ? { x: saved.x, y: saved.y } : {}

  const mainWindow = new BrowserWindow({
    width: saved.width,
    height: saved.height,
    ...pos,
    minWidth: 600,
    minHeight: 400,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 12 },
    backgroundColor: '#1a1a2e',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  if (saved.isMaximized) mainWindow.maximize()

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // 크기/위치 변경 시 저장 (디바운스)
  let saveTimeout: ReturnType<typeof setTimeout> | null = null
  const debouncedSave = (): void => {
    if (saveTimeout) clearTimeout(saveTimeout)
    saveTimeout = setTimeout(() => saveWindowState(mainWindow), WINDOW_SAVE_DEBOUNCE)
  }
  mainWindow.on('resize', debouncedSave)
  mainWindow.on('move', debouncedSave)
  mainWindow.on('close', () => saveWindowState(mainWindow))

  // Preview iframe이 X-Frame-Options / CSP frame-ancestors에 의해 차단되지 않도록
  // 응답 헤더에서 해당 값을 제거합니다. (SSO 리다이렉트 등)
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders }
    delete headers['X-Frame-Options']
    delete headers['x-frame-options']
    const cspKeys = ['Content-Security-Policy', 'content-security-policy']
    for (const key of cspKeys) {
      if (headers[key]) {
        headers[key] = headers[key].map(v =>
          v.replace(/frame-ancestors\s+[^;]+;?/gi, '')
        )
      }
    }
    callback({ cancel: false, responseHeaders: headers })
  })

  // 파일 드롭 시 Electron 기본 네비게이션 차단 (renderer drop 핸들러에서 처리)
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('file://')) {
      event.preventDefault()
      console.log('[drop] blocked file navigation:', url)
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.mulaude.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Hooks 시스템 초기화
  hooksManager.install()

  // 앱 모드 IPC
  ipcMain.handle('app:getMode', () => appMode)

  // 로그 파일 관련 IPC
  ipcMain.handle('app:getLogPath', () => logger.getLogPath())
  ipcMain.on('app:openLogFolder', () => {
    shell.showItemInFolder(logger.getLogPath())
  })

  // 창 생성
  const mainWindow = createWindow()

  // ─── Cowrk (영속 AI 팀원) — 양쪽 모드 공통 ───
  const cowrkManager = new CowrkManager()
  registerCowrkIpcHandlers(cowrkManager)

  cowrkManager.onStreamChunk = (agentName, chunk) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('cowrk:stream-chunk', agentName, chunk)
    }
  }
  cowrkManager.onTurnComplete = (agentName, response) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('cowrk:turn-complete', agentName, response)
    }
  }
  cowrkManager.onTurnError = (agentName, error) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('cowrk:turn-error', agentName, error)
    }
  }

  if (appMode === 'native') {
    // ─── Native Chat 모드 ───
    const nativeChatManager = new NativeChatManager(hooksManager.getIpcDir())
    registerNativeIpcHandlers(nativeChatManager, dt, setLocale, mainWindow)

    // 스트림 이벤트 → 렌더러 전달
    nativeChatManager.onStreamEvent = (sessionId, event) => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('native:stream-event', sessionId, event)
      }
    }
    nativeChatManager.onTurnComplete = (sessionId, claudeSessionId) => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('native:turn-complete', sessionId, claudeSessionId)
      }
    }
    nativeChatManager.onTurnError = (sessionId, error) => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('native:turn-error', sessionId, error)
      }
    }
    nativeChatManager.onInputRequest = (sessionId, request) => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('native:input-request', sessionId, request)
      }
    }

    // Hook 이벤트 → 렌더러 전달 (terminal 모드와 동일)
    hooksManager.onEvent((sessionId, event) => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('session:hook', sessionId, event)
      }
    })

    // Statusline 감시 시작 (기본: HUD 숨김, 키체인 비활성 — 렌더러가 저장된 설정으로 IPC 갱신)
    startStatuslineWatching(mainWindow, true, false)

    app.on('window-all-closed', () => {
      logger.info('App', 'Window closed, shutting down')
      nativeChatManager.destroyAll()
      nativeChatManager.getSessionStore().saveImmediate()
      unwatchAllPlans()
      cleanupAllDiffs()
      cleanupAllViewers()
      cowrkManager.destroyAll()
      stopAllPreviews()
      hooksManager.cleanup()
      cleanupStatusline()
      cleanupPasteImages()

      app.quit()
    })
  } else {
    // ─── Terminal 모드 (기존 동작) ───
    const sessionManager = new SessionManager()
    sessionManager.setIpcDir(hooksManager.getIpcDir())
    registerIpcHandlers(sessionManager, dt, setLocale)
    setupSessionDataForwarding(mainWindow, sessionManager)
    setupCloseHandler(mainWindow, sessionManager)

    // Hook 이벤트 → 렌더러 전달 + diff auto-refresh
    hooksManager.onEvent((sessionId, event) => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('session:hook', sessionId, event)
      }
      // PostToolUse(Edit/Write) → diff 패널이 열려있으면 자동 갱신
      if (
        event.hook_event_name === 'PostToolUse' &&
        (event.tool_name === 'Edit' || event.tool_name === 'Write') &&
        isDiffActive(sessionId)
      ) {
        debouncedRefresh(sessionId, DIFF_DEBOUNCE)
      }
      // PostToolUse(Edit/Write) → viewer 패널이 열려있으면 자동 갱신
      if (
        event.hook_event_name === 'PostToolUse' &&
        (event.tool_name === 'Edit' || event.tool_name === 'Write') &&
        isViewerActive(sessionId)
      ) {
        const filePath = event.tool_input?.file_path as string | undefined
        if (filePath) {
          viewerOnFileChange(sessionId, filePath, VIEWER_DEBOUNCE)
        }
      }
    })

    // 에이전트 pane 폴링 (2초 간격) + 자식 pane 스트리밍 포워딩
    const cleanupPanePolling = setupPanePolling(mainWindow, sessionManager)
    setupChildPaneForwarding(mainWindow, sessionManager)
    // Statusline 감시 시작 (기본: HUD 숨김, 키체인 비활성 — 렌더러가 저장된 설정으로 IPC 갱신)
    startStatuslineWatching(mainWindow, true, false)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        const win = createWindow()
        setupSessionDataForwarding(win, sessionManager)
      }
    })

    // 앱 종료 시 리소스 정리
    app.on('window-all-closed', () => {
      logger.info('App', 'Window closed, shutting down')
      const action = getCloseAction()
      if (action === 'keep') {
        // tmux 세션 보존 — PTY만 종료
        sessionManager.detachAll()
      } else {
        // 모든 세션 완전 종료
        sessionManager.destroyAll()
      }
      // 디바운스된 save가 있으면 즉시 flush
      sessionManager.getSessionStore().saveImmediate()
      resetCloseAction()
      unwatchAllPlans()
      cleanupAllDiffs()
      cleanupAllViewers()
      cowrkManager.destroyAll()
      stopAllPreviews()
      cleanupPanePolling()
      hooksManager.cleanup()
      cleanupStatusline()
      cleanupPasteImages()

      app.quit()
    })
  }
})
