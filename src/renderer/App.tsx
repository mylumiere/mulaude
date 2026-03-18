/**
 * App - 루트 컴포넌트
 *
 * 커스텀 hooks를 조합하여 세션 관리, 상태 감지, 알림, 키보드 단축키, 설정 등을 처리합니다.
 * 이 파일은 hooks 호출과 JSX 렌더링만 담당합니다.
 */

import { useRef, useCallback, useMemo, useState, useEffect } from 'react'
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
import { usePlanManager } from './hooks/usePlanManager'
import { usePlanTrigger } from './hooks/usePlanTrigger'
import { usePreviewManager } from './hooks/usePreviewManager'
import { usePreviewTrigger } from './hooks/usePreviewTrigger'
import { useCowrkAgents } from './hooks/useCowrkAgents'
import CowrkChatPanel from './components/cowrk/CowrkChatPanel'
import CowrkCreateDialog from './components/cowrk/CowrkCreateDialog'
import type { PermissionMode } from './components/TerminalView'
import type { SessionInfo } from '../shared/types'

const PERMISSION_CYCLE: PermissionMode[] = ['default', 'acceptEdits', 'plan']

export default function App(): JSX.Element {
  const settings = useSettings()

  // 세션 부제목(subtitle) 업데이트 ref (useSessionStatus <-> useSessionManager 간 순환 의존 해소)
  const updateSessionSubtitleRef = useRef<(id: string, subtitle: string) => void>(() => {})

  const { sessionStatuses, contextPercents, teamAgents, hookAgents, claudeSessionIds, initSession, cleanupSession } =
    useSessionStatus({ locale: settings.locale, updateSessionSubtitleRef })

  // Plan 관리
  const planManager = usePlanManager()

  // 터미널 출력에서 트리거 키워드 감지 → Preview 자동 열기
  // (usePreviewManager보다 먼저 선언 — notifyClose를 전달하기 위한 중간 ref)
  const openPreviewWithUrlRef = useRef<(sessionId: string, url: string | null) => void>(() => {})
  const previewSessionsRef = useRef<Set<string>>(new Set())
  const { notifyClose: notifyPreviewClose } = usePreviewTrigger({
    openPreviewWithUrl: (...args) => openPreviewWithUrlRef.current(...args),
    previewSessionsRef
  })

  // sessions ref — 훅 초기화 순서 제약 우회 (previewManager → sessionManager)
  const sessionsRef = useRef<SessionInfo[]>([])

  // Preview 관리 (상태 + 액션 통합)
  const previewManager = usePreviewManager({
    sessionsRef,
    locale: settings.locale,
    notifyPreviewClose
  })

  // ref 동기화 (순환 의존 해소)
  openPreviewWithUrlRef.current = previewManager.openPreviewWithUrl
  previewSessionsRef.current = previewManager.previewSessions

  const sessionManager = useSessionManager({
    locale: settings.locale,
    initSession,
    cleanupSession: (id) => { cleanupSession(id); settings.cleanupSessionTheme(id); planManager.cleanupPlan(id); previewManager.cleanupPreview(id); window.api.stopPreview(id) }
  })

  // ref 연결 (초기 렌더 완료 후 실제 함수 참조)
  updateSessionSubtitleRef.current = sessionManager.updateSessionSubtitle
  sessionsRef.current = sessionManager.sessions

  // 터미널 출력에서 플랜 파일 경로 감지 → Plan 자동 열기
  usePlanTrigger({
    openPlan: planManager.openPlan,
    planSessionsRef: planManager.planSessionsRef
  })

  // Plan 토글: 열려있으면 닫기, 닫혀있으면 최근 플랜 파일 열기 / 없으면 파일 선택
  const handleTogglePlan = useCallback(async (sessionId: string) => {
    if (planManager.planSessionsRef.current.has(sessionId)) {
      planManager.closePlan(sessionId)
      return
    }
    try {
      const files = await window.api.listPlanFiles(sessionId)
      if (files.length > 0) {
        planManager.openPlan(sessionId, files[0].path)
      } else {
        // 플랜 파일 없음 → 파일 선택 다이얼로그
        const filePath = await window.api.openPlanFileDialog(sessionId)
        if (filePath) {
          planManager.openPlan(sessionId, filePath)
        }
      }
    } catch { /* 무시 */ }
  }, [planManager])

  // 세션 복원 후 미리보기 프로세스 재실행
  useEffect(() => {
    if (sessionManager.sessions.length > 0) previewManager.restorePreview()
  }, [sessionManager.sessions]) // eslint-disable-line react-hooks/exhaustive-deps

  // Claude 세션 ID를 main process에 저장 (재부팅 후 --resume에 사용)
  useEffect(() => {
    for (const [mulaudeId, claudeId] of Object.entries(claudeSessionIds)) {
      if (claudeId) window.api.updateClaudeSessionId(mulaudeId, claudeId)
    }
  }, [claudeSessionIds])

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
  } = useChildPaneManager({ sessionAgents: teamAgents })

  const { attentionSessions, clearAttention } = useNotifications({
    sessionStatuses,
    sessionAgents: teamAgents,
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
      // 이미 그리드에 열려있는 세션이면 해당 패인으로 포커스만 이동
      const existing = getAllLeaves(terminalLayout.tree.root).find(l => l.sessionId === id)
      if (existing) {
        terminalLayout.focusPane(existing.id)
      } else {
        terminalLayout.setPaneSession(terminalLayout.tree.focusedPaneId, id)
      }
    } else {
      sessionManager.selectSession(id)
    }
    clearAttention(id)
  }, [sessionManager.selectSession, clearAttention, terminalLayout])

  const tutorial = useTutorial(sessionManager.sessions.length)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  // Cowrk (영속 AI 팀원)
  const cowrk = useCowrkAgents()

  // 세션별 퍼미션 모드 상태
  const [permissionModes, setPermissionModes] = useState<Record<string, PermissionMode>>({})
  const cyclePermissionMode = useCallback((sessionId: string) => {
    setPermissionModes(prev => {
      const current = prev[sessionId] ?? 'default'
      const idx = PERMISSION_CYCLE.indexOf(current)
      const next = PERMISSION_CYCLE[(idx + 1) % PERMISSION_CYCLE.length]
      return { ...prev, [sessionId]: next }
    })
  }, [])

  // 드래그 스텝: 그리드 모드 진입 시 자동 진행
  useEffect(() => {
    if (tutorial.phase === 'steps' && tutorial.steps[tutorial.currentStep]?.action === 'drag' && terminalLayout.isGridMode) {
      tutorial.notifyAction()
    }
  }, [terminalLayout.isGridMode, tutorial])

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
    reopenClosedPane: terminalLayout.reopenClosedPane,
    toggleZoom: terminalLayout.toggleZoom,
    focusDirection: terminalLayout.focusDirection,
    isGridMode: terminalLayout.isGridMode,
    getFocusedSessionId: terminalLayout.getFocusedSessionId,
    togglePreview: () => {
      const sid = terminalLayout.isGridMode
        ? terminalLayout.getFocusedSessionId()
        : sessionManager.activeSessionId
      if (sid) previewManager.handleTogglePreview(sid)
    },
    openSettings: () => settings.setShowSettings(true),
    openShortcuts: () => setShortcutsOpen(true),
    tutorialPhase: tutorial.phase,
    tutorialStep: tutorial.phase === 'steps' ? tutorial.steps[tutorial.currentStep] ?? null : null
  })

  // 그리드 포커스 변경 → activeSessionId 동기화 + attention 해제
  useEffect(() => {
    if (!terminalLayout.isGridMode) return
    const focusedId = terminalLayout.getFocusedSessionId()
    if (focusedId && focusedId !== sessionManager.activeSessionId) {
      sessionManager.selectSession(focusedId)
    }
    if (focusedId) clearAttention(focusedId)
  }, [terminalLayout.tree.focusedPaneId, terminalLayout.isGridMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // 그리드에 열린 세션 ID 셋 (사이드바 표시용, 비-그리드 모드에서도 현재 세션 포함)
  const gridSessionIds = useMemo(() => {
    if (!terminalLayout.isGridMode) {
      if (sessionManager.activeSessionId) return new Set([sessionManager.activeSessionId])
      return new Set<string>()
    }
    return new Set(getAllLeaves(terminalLayout.tree.root).map((l) => l.sessionId))
  }, [terminalLayout.tree.root, terminalLayout.isGridMode, sessionManager.activeSessionId])

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
          teamAgents={teamAgents}
          hookAgents={hookAgents}
          claudeSessionIds={claudeSessionIds}
          isGridMode={terminalLayout.isGridMode}
          gridSessionIds={gridSessionIds}
          previewSessions={previewManager.previewSessions}
          onTogglePreview={previewManager.handleTogglePreview}
          onRestartTutorial={tutorial.restart}
          shortcutsOpen={shortcutsOpen}
          onShortcutsClose={() => setShortcutsOpen(false)}
          cowrkAgents={cowrk.agents}
          cowrkActiveAgent={cowrk.activeAgent}
          cowrkChatMessages={cowrk.chatMessages}
          onSelectCowrkAgent={cowrk.openChat}
          onCreateCowrkAgent={() => cowrk.setCreating(true)}
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
              sessionStatuses={sessionStatuses}
              sessionAgents={teamAgents}
              claudeSessionIds={claudeSessionIds}
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
              onToggleZoom={terminalLayout.toggleZoom}
              duplicateAlert={terminalLayout.duplicateAlert}
              gridAlert={terminalLayout.gridAlert}
              blockCenterDrop={tutorial.phase === 'steps' && tutorial.steps[tutorial.currentStep]?.action === 'drag'}
              previewSessions={previewManager.previewSessions}
              previewRatios={previewManager.previewRatios}
              onTogglePreview={previewManager.handleTogglePreview}
              onClosePreview={previewManager.handleClosePreview}
              onPreviewResize={previewManager.handlePreviewResize}
              pendingUrls={previewManager.pendingUrls}
              consumePendingUrl={previewManager.consumePendingUrl}
              previewAlert={previewManager.previewAlert}
              pendingSaveConfig={previewManager.pendingSaveConfig}
              onSaveLaunchConfig={previewManager.handleSaveLaunchConfig}
              onSkipSaveLaunchConfig={previewManager.handleSkipSaveLaunchConfig}
              processOrders={previewManager.processOrders}
              permissionModes={permissionModes}
              onCycleMode={cyclePermissionMode}
              planSessions={planManager.planSessions}
              planInfos={planManager.planInfos}
              planRatios={planManager.planRatios}
              onTogglePlan={handleTogglePlan}
              onClosePlan={planManager.closePlan}
              onPlanResize={planManager.handlePlanResize}
              onSwitchPlanFile={planManager.switchFile}
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
      <TutorialOverlay
        tutorial={tutorial}
        locale={settings.locale}
        globalThemeId={settings.globalThemeId}
        onLocaleChange={settings.handleLocaleChange}
        onThemeChange={settings.handleThemeChange}
      />
      {cowrk.activeAgent && (
        <CowrkChatPanel
          agentName={cowrk.activeAgent}
          messages={cowrk.chatMessages[cowrk.activeAgent] || []}
          isStreaming={cowrk.agents.find(a => a.name === cowrk.activeAgent)?.status === 'thinking'}
          onSend={(msg) => cowrk.askAgent(msg, activeSession?.workingDir)}
          onCancel={cowrk.cancelAgent}
          onClose={cowrk.closeChat}
          onDelete={() => cowrk.deleteAgent(cowrk.activeAgent!)}
          projectDir={activeSession?.workingDir}
        />
      )}
      <CowrkCreateDialog
        isOpen={cowrk.isCreating}
        onClose={() => cowrk.setCreating(false)}
        onCreate={cowrk.createAgent}
      />
      {settings.showSettings && (
        <SettingsModal
          locale={settings.locale}
          onLocaleChange={settings.handleLocaleChange}
          globalThemeId={settings.globalThemeId}
          onThemeChange={settings.handleThemeChange}
          fontSize={settings.fontSize}
          onFontSizeChange={settings.handleFontSizeChange}
          hideHud={settings.hideHud}
          onHideHudChange={settings.handleHideHudChange}
          keychainAccess={settings.keychainAccess}
          onKeychainAccessChange={settings.handleKeychainAccessChange}
          notifSettings={settings.notifSettings}
          onNotifChange={settings.handleNotifChange}
          sessions={sessionManager.sessions}
          onClose={() => settings.setShowSettings(false)}
        />
      )}
    </div>
  )
}
