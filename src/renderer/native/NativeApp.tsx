/**
 * NativeApp — 네이티브 모드 루트 컴포넌트
 *
 * 기존 App.tsx와 동일한 훅 구조 + Sidebar를 재사용하되,
 * 오른쪽 영역은 stream-json 기반 채팅 UI로 대체합니다.
 *
 * 터미널 전용 기능(useTerminalLayout, useChildPaneManager, useTutorial)은 제외합니다.
 */

import { useRef, useCallback, useMemo, useState, useEffect } from 'react'
import Sidebar from '../components/Sidebar'
import SettingsModal from '../components/SettingsModal'
import ChatView from './components/ChatView'
import { t } from '../i18n'
import { useSettings } from '../hooks/useSettings'
import { useSessionStatus } from '../hooks/useSessionStatus'
import { useSessionManager } from '../hooks/useSessionManager'
import { useNotifications } from '../hooks/useNotifications'
import { useNativeChat } from './hooks/useNativeChat'
import './NativeChat.css'

export default function NativeApp(): JSX.Element {
  const settings = useSettings()

  const updateSessionSubtitleRef = useRef<(id: string, subtitle: string) => void>(() => {})

  const { sessionStatuses, contextPercents, teamAgents, hookAgents, claudeSessionIds, initSession, cleanupSession, updateStatus } =
    useSessionStatus({ locale: settings.locale, updateSessionSubtitleRef })

  const sessionManager = useSessionManager({
    locale: settings.locale,
    initSession,
    cleanupSession: (id) => { cleanupSession(id); settings.cleanupSessionTheme(id) }
  })

  updateSessionSubtitleRef.current = sessionManager.updateSessionSubtitle

  const { messages, phase, sendMessage, cancelStream, respondToInput, editQueuedMessage, removeQueuedMessage } = useNativeChat({
    activeSessionId: sessionManager.activeSessionId
  })

  // 채팅 phase → 사이드바 상태 연동
  useEffect(() => {
    if (!sessionManager.activeSessionId) return
    const id = sessionManager.activeSessionId
    if (phase === 'streaming') {
      updateStatus(id, { state: 'thinking', label: '' }, 'hook')
    } else if (phase === 'idle') {
      updateStatus(id, { state: 'idle', label: '' }, 'hook')
    } else if (phase === 'error') {
      updateStatus(id, { state: 'error', label: '' }, 'hook')
    }
  }, [phase, sessionManager.activeSessionId, updateStatus])

  const { attentionSessions, clearAttention } = useNotifications({
    sessionStatuses,
    sessionAgents: teamAgents,
    sessions: sessionManager.sessions,
    activeSessionId: sessionManager.activeSessionId,
    notifSettings: settings.notifSettings,
    locale: settings.locale
  })

  const handleSelectSession = useCallback((id: string) => {
    sessionManager.selectSession(id)
    clearAttention(id)
  }, [sessionManager.selectSession, clearAttention])

  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  // 활성 세션 기준 grid ID 셋 (Sidebar에 전달)
  const gridSessionIds = useMemo(() => {
    if (sessionManager.activeSessionId) return new Set([sessionManager.activeSessionId])
    return new Set<string>()
  }, [sessionManager.activeSessionId])

  // 타이틀바 표시용
  const activeSession = sessionManager.sessions.find(s => s.id === sessionManager.activeSessionId)
  const activeProject = activeSession
    ? sessionManager.projects.find(p => p.sessions.some(s => s.id === activeSession.id))
    : null

  // 활성 세션의 메시지
  const activeMessages = sessionManager.activeSessionId
    ? (messages[sessionManager.activeSessionId] || [])
    : []

  // 키보드 단축키: ⌘N (새 프로젝트), ⌘W (세션 삭제)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.metaKey && e.key === 'n') {
        e.preventDefault()
        sessionManager.createProject()
      }
      if (e.metaKey && e.key === 'w') {
        e.preventDefault()
        if (sessionManager.activeSessionId) {
          sessionManager.destroySession(sessionManager.activeSessionId)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [sessionManager.createProject, sessionManager.destroySession, sessionManager.activeSessionId])

  return (
    <div className="app">
      <div className="titlebar">
        <div className="titlebar-title">Mulaude</div>
        {activeProject && activeSession && (
          <div className="titlebar-session">
            {activeProject.name} / {activeSession.name}
          </div>
        )}
      </div>
      <div className="app-main">
        <Sidebar
          projects={sessionManager.projects}
          activeSessionId={sessionManager.activeSessionId}
          onSelectSession={handleSelectSession}
          attentionSessions={attentionSessions}
          onCreateProject={sessionManager.createProject}
          onAddSessionToProject={sessionManager.addSession}
          onDestroySession={sessionManager.destroySession}
          onRemoveProject={sessionManager.removeProject}
          onUpdateSessionName={sessionManager.updateSessionName}
          onOpenSettings={() => settings.setShowSettings(true)}
          width={settings.sidebarWidth}
          locale={settings.locale}
          sessionStatuses={sessionStatuses}
          usageData={settings.usageData}
          contextPercents={contextPercents}
          teamAgents={teamAgents}
          hookAgents={hookAgents}
          claudeSessionIds={claudeSessionIds}
          gridSessionIds={gridSessionIds}
          shortcutsOpen={shortcutsOpen}
          onShortcutsClose={() => setShortcutsOpen(false)}
        />
        <div className="resize-handle" onMouseDown={settings.handleResizeStart} />
        <div className="terminal-area">
          {sessionManager.sessions.length > 0 ? (
            <ChatView
              messages={activeMessages}
              isStreaming={phase === 'streaming'}
              onSendMessage={sendMessage}
              onCancel={cancelStream}
              onRespondToInput={respondToInput}
              onEditQueued={editQueuedMessage}
              onRemoveQueued={removeQueuedMessage}
              sessionName={activeSession?.name}
            />
          ) : (
            <div className="empty-state">
              <div className="empty-icon">⌘</div>
              <h2>Mulaude</h2>
              <p>{t(settings.locale, 'empty.subtitle')}</p>
              <button className="empty-create-btn" onClick={sessionManager.createProject}>
                {t(settings.locale, 'empty.create')}
              </button>
            </div>
          )}
        </div>
      </div>
      {settings.showSettings && (
        <SettingsModal
          locale={settings.locale}
          onLocaleChange={settings.handleLocaleChange}
          globalThemeId={settings.globalThemeId}
          onThemeChange={settings.handleThemeChange}
          fontSize={settings.fontSize}
          onFontSizeChange={settings.handleFontSizeChange}
          notifSettings={settings.notifSettings}
          onNotifChange={settings.handleNotifChange}
          hideHud={settings.hideHud}
          onHideHudChange={settings.handleHideHudChange}
          sessions={sessionManager.sessions}
          onClose={() => settings.setShowSettings(false)}
        />
      )}
    </div>
  )
}
