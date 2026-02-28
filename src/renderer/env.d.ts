/// <reference types="vite/client" />

import type { SessionInfo, HookEvent, UsageData, TmuxPaneInfo } from '../shared/types'

interface Window {
  api: {
    createSession: (workingDir: string) => Promise<SessionInfo>
    destroySession: (id: string) => Promise<void>
    listSessions: () => Promise<SessionInfo[]>
    writeSession: (id: string, data: string) => void
    resizeSession: (id: string, cols: number, rows: number) => void
    onSessionData: (callback: (id: string, data: string) => void) => () => void
    onSessionExit: (callback: (id: string, exitCode: number) => void) => () => void
    onSessionHook: (callback: (id: string, event: HookEvent) => void) => () => void
    onSessionPanes: (callback: (id: string, panes: TmuxPaneInfo[]) => void) => () => void
    writeChildPane: (sessionId: string, paneIndex: number, data: string) => void
    resizeChildPane: (sessionId: string, paneIndex: number, cols: number, rows: number) => void
    onChildPaneData: (callback: (sessionId: string, paneIndex: number, data: string) => void) => () => void
    onChildPaneDiscovered: (callback: (sessionId: string, paneIndex: number, title: string, initialContent: string) => void) => () => void
    onChildPaneRemoved: (callback: (sessionId: string, paneIndex: number) => void) => () => void
    openDirectory: () => Promise<string | null>
    sendNotification: (title: string, body: string) => void
    readUsage: () => Promise<UsageData | null>
    onUsageUpdated: (callback: (data: UsageData | null) => void) => () => void
  }
}
