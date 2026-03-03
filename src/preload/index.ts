import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { SessionInfo, HookEvent, UsageData, TmuxPaneInfo, AgentInfo, AppMode, NativeInputRequest } from '../shared/types'

/**
 * Preload 스크립트 - contextBridge를 통해 렌더러에 안전한 API를 노출합니다.
 *
 * window.api 객체로 접근 가능하며,
 * IPC 통신을 추상화하여 세션 관리 기능을 제공합니다.
 */

/* ═══════ 세션 데이터 디스패처 (성능 최적화) ═══════ */

/**
 * 세션별 데이터 콜백 레지스트리.
 * 기존: N개의 ipcRenderer.on 리스너가 모든 데이터를 브로드캐스트 수신.
 * 개선: 1개의 배치 리스너 → 세션 ID로 O(1) 디스패치.
 */
const sessionDataCallbacks = new Map<string, Set<(data: string) => void>>()
/** 전체 세션 데이터를 수신하는 글로벌 콜백 (상태 파싱용) */
const globalDataCallbacks = new Set<(id: string, data: string) => void>()

// 단일 IPC 리스너로 모든 세션 데이터 수신 (배치)
ipcRenderer.on('session:data-batch', (_event, batch: Record<string, string>) => {
  for (const id in batch) {
    const data = batch[id]
    // 세션별 콜백 (TerminalView)
    const cbs = sessionDataCallbacks.get(id)
    if (cbs) for (const cb of cbs) cb(data)
    // 글로벌 콜백 (상태 파싱)
    for (const gcb of globalDataCallbacks) gcb(id, data)
  }
})

const api = {
  /** 앱 모드 조회 (terminal / native) */
  getAppMode: (): Promise<AppMode> =>
    ipcRenderer.invoke('app:getMode'),

  /** 새 Claude CLI 세션을 생성합니다 */
  createSession: (workingDir: string): Promise<SessionInfo> =>
    ipcRenderer.invoke('session:create', workingDir),

  /** 특정 세션을 종료합니다 */
  destroySession: (id: string): Promise<void> =>
    ipcRenderer.invoke('session:destroy', id),

  /** 활성 세션 목록을 가져옵니다 */
  listSessions: (): Promise<SessionInfo[]> =>
    ipcRenderer.invoke('session:list'),

  /** 특정 세션에 터미널 입력을 전송합니다 */
  writeSession: (id: string, data: string): void =>
    ipcRenderer.send('session:write', id, data),

  /** 특정 세션의 터미널 크기를 변경합니다 */
  resizeSession: (id: string, cols: number, rows: number): void =>
    ipcRenderer.send('session:resize', id, cols, rows),

  /** tmux copy-mode 스크롤 (fire-and-forget) */
  scrollSession: (id: string, direction: 'up' | 'down', lines?: number): void =>
    ipcRenderer.send('session:scroll', id, direction, lines ?? 1),

  /** 전체 세션 데이터 이벤트를 수신합니다 (상태 파싱용 글로벌 리스너) */
  onSessionData: (callback: (id: string, data: string) => void): (() => void) => {
    globalDataCallbacks.add(callback)
    return () => { globalDataCallbacks.delete(callback) }
  },

  /** 특정 세션의 데이터만 수신합니다 (TerminalView용 세션별 리스너) */
  onSessionDataById: (id: string, callback: (data: string) => void): (() => void) => {
    if (!sessionDataCallbacks.has(id)) sessionDataCallbacks.set(id, new Set())
    sessionDataCallbacks.get(id)!.add(callback)
    return () => {
      const cbs = sessionDataCallbacks.get(id)
      if (cbs) { cbs.delete(callback); if (cbs.size === 0) sessionDataCallbacks.delete(id) }
    }
  },

  /** 세션 종료 이벤트를 수신합니다 */
  onSessionExit: (callback: (id: string, exitCode: number) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, id: string, exitCode: number): void => {
      callback(id, exitCode)
    }
    ipcRenderer.on('session:exit', handler)
    return () => ipcRenderer.removeListener('session:exit', handler)
  },

  /** 폴더 선택 다이얼로그를 엽니다 */
  openDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:openDirectory'),

  /** 데스크톱 알림 전송 (Electron 네이티브) */
  sendNotification: (title: string, body: string): void =>
    ipcRenderer.send('notify', title, body),

  /** Claude 사용량 데이터 읽기 */
  readUsage: (): Promise<UsageData | null> =>
    ipcRenderer.invoke('usage:read'),

  /** HUD 오버레이 숨기기/복원 */
  setHudHidden: (hide: boolean): Promise<void> =>
    ipcRenderer.invoke('hud:set-hidden', hide),

  /** 사용량 업데이트 이벤트 수신 */
  onUsageUpdated: (callback: (data: UsageData | null) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: UsageData | null): void => {
      callback(data)
    }
    ipcRenderer.on('usage:updated', handler)
    return () => ipcRenderer.removeListener('usage:updated', handler)
  },

  /** Claude Code hook 이벤트 수신 (Notification, PreToolUse 등) */
  onSessionHook: (callback: (id: string, event: HookEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, id: string, hookEvent: HookEvent): void => {
      callback(id, hookEvent)
    }
    ipcRenderer.on('session:hook', handler)
    return () => ipcRenderer.removeListener('session:hook', handler)
  },

  /** tmux 설치 여부 및 버전 확인 */
  checkTmux: (): Promise<{ available: boolean; version: string | null }> =>
    ipcRenderer.invoke('tmux:check'),

  /** 저장된 세션 복원 (앱 재시작 시) */
  restoreAllSessions: (): Promise<SessionInfo[]> =>
    ipcRenderer.invoke('session:restore-all'),

  /** 세션 이름 업데이트 (영속 저장소 동기화) */
  updateSessionName: (id: string, name: string): void =>
    ipcRenderer.send('session:name-update', id, name),

  /** 세션 부제목(subtitle) 업데이트 (자동 감지 작업명 → 영속 저장소) */
  updateSessionSubtitle: (id: string, subtitle: string): void =>
    ipcRenderer.send('session:subtitle-update', id, subtitle),

  /** 세션 화면 캡처 (세션 전환 시 xterm 복원용)
   *  cols/rows 제공 시 tmux resize를 await한 후 캡처 (atomic resize+capture) */
  captureScreen: (id: string, cols?: number, rows?: number): Promise<string | null> =>
    ipcRenderer.invoke('session:capture-screen', id, cols, rows),

  /** 현재 locale을 main 프로세스에 전달 (다이얼로그 다국어용) */
  setLocale: (locale: string): void =>
    ipcRenderer.send('app:set-locale', locale),

  /** 에이전트 pane 상태 폴링 이벤트 수신 */
  onSessionPanes: (callback: (id: string, panes: TmuxPaneInfo[]) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, id: string, panes: TmuxPaneInfo[]): void => {
      callback(id, panes)
    }
    ipcRenderer.on('session:panes', handler)
    return () => ipcRenderer.removeListener('session:panes', handler)
  },

  /** 자식 pane에 데이터 쓰기 (TTY 입력) */
  writeChildPane: (sessionId: string, paneIndex: number, data: string): void =>
    ipcRenderer.send('childpane:write', sessionId, paneIndex, data),

  /** 자식 pane 리사이즈 */
  resizeChildPane: (sessionId: string, paneIndex: number, cols: number, rows: number): void =>
    ipcRenderer.send('childpane:resize', sessionId, paneIndex, cols, rows),

  /** 자식 pane 출력 데이터 수신 */
  onChildPaneData: (callback: (sessionId: string, paneIndex: number, data: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, sessionId: string, paneIndex: number, data: string): void => {
      callback(sessionId, paneIndex, data)
    }
    ipcRenderer.on('childpane:data', handler)
    return () => ipcRenderer.removeListener('childpane:data', handler)
  },

  /** 새 자식 pane 발견 이벤트 수신 */
  onChildPaneDiscovered: (callback: (sessionId: string, paneIndex: number, initialContent: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, sessionId: string, paneIndex: number, initialContent: string): void => {
      callback(sessionId, paneIndex, initialContent)
    }
    ipcRenderer.on('childpane:discovered', handler)
    return () => ipcRenderer.removeListener('childpane:discovered', handler)
  },

  /** 자식 pane 제거 이벤트 수신 */
  onChildPaneRemoved: (callback: (sessionId: string, paneIndex: number) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, sessionId: string, paneIndex: number): void => {
      callback(sessionId, paneIndex)
    }
    ipcRenderer.on('childpane:removed', handler)
    return () => ipcRenderer.removeListener('childpane:removed', handler)
  },

  /** 메인 pane 현재 프로세스명 수신 (쉘 감지용) */
  onSessionPaneCommand: (callback: (id: string, command: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, id: string, command: string): void => {
      callback(id, command)
    }
    ipcRenderer.on('session:pane-command', handler)
    return () => ipcRenderer.removeListener('session:pane-command', handler)
  },

  /** Team config 기반 에이전트 목록 수신 (tmuxPaneId로 확정된 매칭) */
  onSessionTeamAgents: (callback: (id: string, agents: AgentInfo[]) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, id: string, agents: AgentInfo[]): void => {
      callback(id, agents)
    }
    ipcRenderer.on('session:team-agents', handler)
    return () => ipcRenderer.removeListener('session:team-agents', handler)
  },

  /** 클립보드 이미지를 temp 파일로 저장하고 경로 반환 (이미지 붙여넣기용) */
  saveClipboardImage: (): Promise<string | null> =>
    ipcRenderer.invoke('clipboard:save-paste-image'),

  /** 드롭된 File 객체에서 실제 파일 경로 추출 (Electron webUtils) */
  getPathForFile: (file: File): string =>
    webUtils.getPathForFile(file),

  /** 로그 파일 경로 가져오기 */
  getLogPath: (): Promise<string> =>
    ipcRenderer.invoke('app:getLogPath'),

  /** 로그 파일이 있는 폴더를 Finder에서 열기 */
  openLogFolder: (): void =>
    ipcRenderer.send('app:openLogFolder'),

  // ─── Native Chat APIs ───

  /** 네이티브 채팅 메시지 전송 (claude -p 프로세스 spawn) */
  sendNativeMessage: (sessionId: string, text: string): void =>
    ipcRenderer.send('native:send-message', sessionId, text),

  /** 진행 중인 네이티브 채팅 스트림 취소 (SIGTERM) */
  cancelNativeStream: (sessionId: string): void =>
    ipcRenderer.send('native:cancel', sessionId),

  /** 네이티브 채팅 스트림 이벤트 수신 (JSON 라인 단위) */
  onNativeStreamEvent: (cb: (sessionId: string, event: Record<string, unknown>) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, sessionId: string, evt: Record<string, unknown>): void => {
      cb(sessionId, evt)
    }
    ipcRenderer.on('native:stream-event', handler)
    return () => ipcRenderer.removeListener('native:stream-event', handler)
  },

  /** 네이티브 채팅 턴 완료 이벤트 수신 */
  onNativeTurnComplete: (cb: (sessionId: string, claudeSessionId: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, sessionId: string, claudeSessionId: string): void => {
      cb(sessionId, claudeSessionId)
    }
    ipcRenderer.on('native:turn-complete', handler)
    return () => ipcRenderer.removeListener('native:turn-complete', handler)
  },

  /** 네이티브 채팅 턴 에러 이벤트 수신 */
  onNativeTurnError: (cb: (sessionId: string, error: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, sessionId: string, error: string): void => {
      cb(sessionId, error)
    }
    ipcRenderer.on('native:turn-error', handler)
    return () => ipcRenderer.removeListener('native:turn-error', handler)
  },

  /** Permission/Question 응답 전달 (렌더러 → main → claude stdin) */
  respondToNativeInput: (sessionId: string, requestId: string, response: Record<string, unknown>): void =>
    ipcRenderer.send('native:input-response', sessionId, requestId, response),

  /** 큐 메시지 업데이트 (텍스트 수정) */
  updateNativeQueue: (sessionId: string, text: string): void =>
    ipcRenderer.send('native:update-queue', sessionId, text),

  /** 큐 메시지 삭제 */
  clearNativeQueue: (sessionId: string): void =>
    ipcRenderer.send('native:clear-queue', sessionId),

  /** Permission/Question 입력 요청 이벤트 수신 (main → 렌더러) */
  onNativeInputRequest: (cb: (sessionId: string, request: NativeInputRequest) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, sessionId: string, request: NativeInputRequest): void => {
      cb(sessionId, request)
    }
    ipcRenderer.on('native:input-request', handler)
    return () => ipcRenderer.removeListener('native:input-request', handler)
  }
}

/* ═══════ 자식 pane 데이터 디스패처 (O(1) 키 기반) ═══════ */

const childPaneDataCallbacks = new Map<string, Set<(data: string) => void>>()

// 단일 IPC 리스너로 모든 childpane:data 수신 → 키 기반 O(1) 디스패치
ipcRenderer.on('childpane:data', (_event, sessionId: string, paneIndex: number, data: string) => {
  const key = `${sessionId}:${paneIndex}`
  const cbs = childPaneDataCallbacks.get(key)
  if (cbs) for (const cb of cbs) cb(data)
})

contextBridge.exposeInMainWorld('api', {
  ...api,
  /** 특정 세션+pane의 자식 pane 데이터만 수신 (O(1) 디스패치) */
  onChildPaneDataById: (sessionId: string, paneIndex: number, callback: (data: string) => void): (() => void) => {
    const key = `${sessionId}:${paneIndex}`
    if (!childPaneDataCallbacks.has(key)) childPaneDataCallbacks.set(key, new Set())
    childPaneDataCallbacks.get(key)!.add(callback)
    return () => {
      const cbs = childPaneDataCallbacks.get(key)
      if (cbs) { cbs.delete(callback); if (cbs.size === 0) childPaneDataCallbacks.delete(key) }
    }
  }
})

export type ApiType = typeof api
