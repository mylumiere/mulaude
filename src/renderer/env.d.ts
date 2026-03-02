/// <reference types="vite/client" />

import type { SessionInfo, HookEvent, UsageData, TmuxPaneInfo, AppMode, NativeInputRequest } from '../shared/types'

interface Window {
  api: {
    getAppMode: () => Promise<AppMode>
    createSession: (workingDir: string) => Promise<SessionInfo>
    destroySession: (id: string) => Promise<void>
    listSessions: () => Promise<SessionInfo[]>
    writeSession: (id: string, data: string) => void
    resizeSession: (id: string, cols: number, rows: number) => void
    onSessionData: (callback: (id: string, data: string) => void) => () => void
    onSessionDataById: (id: string, callback: (data: string) => void) => () => void
    captureScreen: (id: string) => Promise<string | null>
    onSessionExit: (callback: (id: string, exitCode: number) => void) => () => void
    onSessionHook: (callback: (id: string, event: HookEvent) => void) => () => void
    onSessionPanes: (callback: (id: string, panes: TmuxPaneInfo[]) => void) => () => void
    writeChildPane: (sessionId: string, paneIndex: number, data: string) => void
    resizeChildPane: (sessionId: string, paneIndex: number, cols: number, rows: number) => void
    onChildPaneData: (callback: (sessionId: string, paneIndex: number, data: string) => void) => () => void
    onChildPaneDataById: (sessionId: string, paneIndex: number, callback: (data: string) => void) => () => void
    onChildPaneDiscovered: (callback: (sessionId: string, paneIndex: number, title: string, initialContent: string) => void) => () => void
    onChildPaneRemoved: (callback: (sessionId: string, paneIndex: number) => void) => () => void
    checkClipboardForPaste: () => Promise<{ hasImage: boolean; hasText: boolean }>
    openDirectory: () => Promise<string | null>
    sendNotification: (title: string, body: string) => void
    readUsage: () => Promise<UsageData | null>
    onUsageUpdated: (callback: (data: UsageData | null) => void) => () => void
    setHudHidden: (hide: boolean) => Promise<void>
    setLocale: (locale: string) => void
    updateSessionName: (id: string, name: string) => void
    updateSessionSubtitle: (id: string, subtitle: string) => void
    restoreAllSessions: () => Promise<SessionInfo[]>
    checkTmux: () => Promise<{ available: boolean; version: string | null }>
    onSessionPaneCommand: (callback: (id: string, command: string) => void) => () => void
    onSessionTeamAgents: (callback: (id: string, agents: import('../shared/types').AgentInfo[]) => void) => () => void
    getLogPath: () => Promise<string>
    openLogFolder: () => void
    // Native Chat APIs
    sendNativeMessage: (sessionId: string, text: string) => void
    cancelNativeStream: (sessionId: string) => void
    onNativeStreamEvent: (cb: (sessionId: string, event: Record<string, unknown>) => void) => () => void
    onNativeTurnComplete: (cb: (sessionId: string, claudeSessionId: string) => void) => () => void
    onNativeTurnError: (cb: (sessionId: string, error: string) => void) => () => void
    respondToNativeInput: (sessionId: string, requestId: string, response: Record<string, unknown>) => void
    onNativeInputRequest: (cb: (sessionId: string, request: NativeInputRequest) => void) => () => void
    updateNativeQueue: (sessionId: string, text: string) => void
    clearNativeQueue: (sessionId: string) => void
  }
}
