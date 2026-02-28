/**
 * App - 루트 컴포넌트
 *
 * 커스텀 hooks를 조합하여 세션 관리, 상태 감지, 알림, 키보드 단축키, 설정 등을 처리합니다.
 * 이 파일은 hooks 호출과 JSX 렌더링만 담당합니다.
 */

import { useRef, useCallback, useMemo, useState } from 'react'
import Sidebar from './components/Sidebar'
import TerminalGrid from './components/TerminalGrid'
import SettingsModal from './components/SettingsModal'
import TmuxMissingBanner from './components/TmuxMissingBanner'
import TutorialOverlay from './components/TutorialOverlay'
import { t } from './i18n'
import { useSettings } from './hooks/useSettings'
import { useSessionStatus } from './hooks/useSessionStatus'
import { useSessionManager } from './hooks/useSessionManager'
import { useNotifications } from './hooks/useNotifications'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { useChildPaneManager } from './hooks/useChildPaneManager'
import { useTerminalLayout, getAllLeaves } from './hooks/useTerminalLayout'
import { useTutorial } from './hooks/useTutorial'

export default function App(): JSX.Element {
  const settings = useSettings()

  // 세션 부제목(subtitle) 업데이트 ref (useSessionStatus <-> useSessionManager 간 순환 의존 해소)
  const updateSessionSubtitleRef = useRef<(id: string, subtitle: string) => void>(() => {})

  const { sessionStatuses, contextPercents, sessionAgents, initSession, cleanupSession } =
    useSessionStatus({ locale: settings.locale, updateSessionSubtitleRef })

  const sessionManager = useSessionManager({
    locale: settings.locale,
    initSession,
    cleanupSession: (id) => { cleanupSession(id); settings.cleanupSessionTheme(id) }
  })

  // ref 연결 (초기 렌더 완료 후 실제 함수 참조)
  updateSessionSubtitleRef.current = sessionManager.updateSessionSubtitle

  // child pane 상태 관리
  const {
    childPaneMap,
    focusedPane,
    splitRatios,
    sessionsWithPanes,
    childPaneIndicesRef,
    handleFocusPane,
    handleFocusParent,
    handleSplitResize,
    setFocusedPane
  } = useChildPaneManager({ sessionAgents })

  const { attentionSessions, clearAttention } = useNotifications({
    sessionStatuses,
    sessionAgents,
    sessions: sessionManager.sessions,
    activeSessionId: sessionManager.activeSessionId,
    notifSettings: settings.notifSettings,
    locale: settings.locale
  })

  // 이진 트리 레이아웃 관리
  const terminalLayout = useTerminalLayout({
    activeSessionId: sessionManager.activeSessionId,
    sessions: sessionManager.sessions
  })

  const handleSelectSession = useCallback((id: string) => {
    if (terminalLayout.isGridMode) {
      // 그리드 모드: 포커스된 패인의 세션을 변경
      terminalLayout.setPaneSession(terminalLayout.tree.focusedPaneId, id)
    } else {
      sessionManager.selectSession(id)
    }
    clearAttention(id)
  }, [sessionManager.selectSession, clearAttention, terminalLayout])

  const tutorial = useTutorial(sessionManager.sessions.length, sessionManager.createProject)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  useKeyboardShortcuts({
    projects: sessionManager.projects,
    activeSessionId: sessionManager.activeSessionId,
    sessions: sessionManager.sessions,
    createProject: sessionManager.createProject,
    selectSession: handleSelectSession,
    focusedPane,
    setFocusedPane: (sessionId: string, paneIndex: number | null) => {
      setFocusedPane(sessionId, paneIndex)
    },
    getChildPaneIndices: (sessionId: string) => childPaneIndicesRef.current[sessionId] || [],
    sessionsWithPanes,
    closePane: terminalLayout.closePane,
    toggleZoom: terminalLayout.toggleZoom,
    focusDirection: terminalLayout.focusDirection,
    isGridMode: terminalLayout.isGridMode,
    getFocusedSessionId: terminalLayout.getFocusedSessionId,
    openSettings: () => settings.setShowSettings(true),
    openShortcuts: () => setShortcutsOpen(true)
  })

  // 그리드에 열린 세션 ID 셋 (사이드바 표시용)
  const gridSessionIds = useMemo(() => {
    if (!terminalLayout.isGridMode) return new Set<string>()
    return new Set(getAllLeaves(terminalLayout.tree.root).map((l) => l.sessionId))
  }, [terminalLayout.tree.root, terminalLayout.isGridMode])

  // 활성 세션의 프로젝트명 / 세션명
  const activeSession = sessionManager.sessions.find(s => s.id === sessionManager.activeSessionId)
  const activeProject = activeSession
    ? sessionManager.projects.find(p => p.sessions.some(s => s.id === activeSession.id))
    : null

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
          sessionAgents={sessionAgents}
          gridSessionIds={gridSessionIds}
          onRestartTutorial={tutorial.restart}
          shortcutsOpen={shortcutsOpen}
          onShortcutsClose={() => setShortcutsOpen(false)}
        />
        <div className="resize-handle" onMouseDown={settings.handleResizeStart} />
        <div className="terminal-area">
          {sessionManager.sessions.length > 0 ? (
            <TerminalGrid
              tree={terminalLayout.tree}
              sessions={sessionManager.sessions}
              isGridMode={terminalLayout.isGridMode}
              locale={settings.locale}
              getSessionThemeId={settings.getSessionThemeId}
              contextPercents={contextPercents}
              sessionAgents={sessionAgents}
              sessionsWithPanes={sessionsWithPanes}
              childPaneMap={childPaneMap}
              focusedPane={focusedPane}
              splitRatios={splitRatios}
              handleFocusPane={handleFocusPane}
              handleFocusParent={handleFocusParent}
              handleSplitResize={handleSplitResize}
              onFocusPane={terminalLayout.focusPane}
              onClosePane={terminalLayout.closePane}
              onResize={terminalLayout.handleResize}
              onDropSession={terminalLayout.dropSession}
              onMovePane={terminalLayout.movePane}
              duplicateAlert={terminalLayout.duplicateAlert}
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
      {sessionManager.tmuxMissing && (
        <TmuxMissingBanner
          locale={settings.locale}
          onDismiss={sessionManager.dismissTmuxBanner}
        />
      )}
      <TutorialOverlay tutorial={tutorial} locale={settings.locale} />
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
