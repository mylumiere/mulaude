import { contextBridge, ipcRenderer } from 'electron'
import type { SessionInfo, HookEvent, UsageData, TmuxPaneInfo, AgentInfo } from '../shared/types'

/**
 * Preload 스크립트 - contextBridge를 통해 렌더러에 안전한 API를 노출합니다.
 *
 * window.api 객체로 접근 가능하며,
 * IPC 통신을 추상화하여 세션 관리 기능을 제공합니다.
 */
const api = {
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

  /** 터미널 데이터 출력 이벤트를 수신합니다 */
  onSessionData: (callback: (id: string, data: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, id: string, data: string): void => {
      callback(id, data)
    }
    ipcRenderer.on('session:data', handler)
    return () => ipcRenderer.removeListener('session:data', handler)
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
  }
}

contextBridge.exposeInMainWorld('api', api)

export type ApiType = typeof api
