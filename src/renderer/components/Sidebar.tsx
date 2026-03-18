/**
 * Sidebar - 프로젝트 > 세션 구조의 사이드바 컨테이너
 *
 * 하위 컴포넌트:
 *   - ProjectHeader: 프로젝트 헤더 (이름, 접기, 세션 추가/삭제)
 *   - SessionRow: 세션 행 (상태 인디케이터, 인라인 편집, 상태 라벨)
 *   - AgentTree: 에이전트 트리 (접기/펼치기)
 *   - UsageGauge: Claude 사용량 게이지
 *   - StatusLegend: 상태 범례
 */

import { useState, useEffect, useCallback } from 'react'
import { Settings, Plus, BookOpen, Route, Keyboard, MessageSquareWarning, X, Eye, Bot } from 'lucide-react'
import type { ProjectGroup, SessionStatus, UsageData, AgentInfo, CowrkAgentState } from '../../shared/types'
import { type Locale, t } from '../i18n'
import ProjectHeader from './sidebar/ProjectHeader'
import SessionRow from './sidebar/SessionRow'
import AgentTree from './sidebar/AgentTree'
import UsageGauge from './sidebar/UsageGauge'
import CowrkSection from './cowrk/CowrkSection'
import RoadmapModal from './RoadmapModal'
import ShortcutsModal from './ShortcutsModal'
import './Sidebar.css'

interface SidebarProps {
  projects: ProjectGroup[]
  activeSessionId: string | null
  onSelectSession: (id: string) => void
  onCreateProject: () => void
  onAddSessionToProject: (workingDir: string) => void
  onDestroySession: (id: string) => void
  onRemoveProject: (workingDir: string) => void
  onUpdateSessionName: (id: string, name: string) => void
  onOpenSettings: () => void
  width: number
  locale: Locale
  sessionStatuses: Record<string, SessionStatus>
  attentionSessions: Set<string>
  usageData: UsageData | null
  contextPercents: Record<string, number>
  /** team config 기반 에이전트 (AgentTree용) */
  teamAgents: Record<string, AgentInfo[]>
  /** Hook 기반 Task 에이전트 카운터 (라벨용) */
  hookAgents: Record<string, AgentInfo[]>
  /** 부모 Claude session ID (세션 칩 표시용) */
  claudeSessionIds?: Record<string, string>
  /** 그리드에 현재 열려있는 세션 ID 셋 */
  gridSessionIds?: Set<string>
  /** 그리드 모드 여부 (분할 넛지용) */
  isGridMode?: boolean
  /** 튜토리얼 다시보기 */
  onRestartTutorial?: () => void
  /** Preview 토글 */
  previewSessions?: Set<string>
  onTogglePreview?: (sessionId: string) => void | Promise<void>
  /** 외부에서 단축키 모달 열기 (⌘/) */
  shortcutsOpen?: boolean
  onShortcutsClose?: () => void
  /** Cowrk 에이전트 목록 */
  cowrkAgents?: CowrkAgentState[]
  cowrkActiveAgent?: string | null
  cowrkChatMessages?: Record<string, import('../../shared/types').CowrkChatMessage[]>
  onSelectCowrkAgent?: (name: string) => void
  onCreateCowrkAgent?: () => void
}

export default function Sidebar({
  projects,
  activeSessionId,
  onSelectSession,
  onCreateProject,
  onAddSessionToProject,
  onDestroySession,
  onRemoveProject,
  onUpdateSessionName,
  onOpenSettings,
  width,
  locale,
  sessionStatuses,
  attentionSessions,
  usageData,
  contextPercents,
  teamAgents,
  hookAgents,
  claudeSessionIds,
  sidebarFocused,
  sidebarCursorId,
  isGridMode,
  gridSessionIds,
  previewSessions,
  onTogglePreview,
  onRestartTutorial,
  shortcutsOpen,
  onShortcutsClose,
  cowrkAgents,
  cowrkActiveAgent,
  cowrkChatMessages,
  onSelectCowrkAgent,
  onCreateCowrkAgent
}: SidebarProps): JSX.Element {
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set())
  const [collapsedAgents, setCollapsedAgents] = useState<Set<string>>(new Set())
  const [showRoadmap, setShowRoadmap] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  /** 사이드바 탭: projects (기본) 또는 agents (cowrk) */
  const [sidebarTab, setSidebarTab] = useState<'projects' | 'agents'>('projects')
  const [nudgeDismissed, setNudgeDismissed] = useState(() => {
    try { return localStorage.getItem('mulaude-split-nudge-dismissed') === '1' } catch { return false }
  })

  // 분할 성공(isGridMode) 시 자동 dismiss
  useEffect(() => {
    if (isGridMode && !nudgeDismissed) {
      setNudgeDismissed(true)
      try { localStorage.setItem('mulaude-split-nudge-dismissed', '1') } catch {}
    }
  }, [isGridMode, nudgeDismissed])

  const dismissNudge = useCallback(() => {
    setNudgeDismissed(true)
    try { localStorage.setItem('mulaude-split-nudge-dismissed', '1') } catch {}
  }, [])

  // 전체 세션 수 계산
  const totalSessions = projects.reduce((sum, p) => sum + p.sessions.length, 0)
  const showNudge = totalSessions >= 2 && !isGridMode && !nudgeDismissed

  // 외부에서 ⌘/ 로 단축키 모달 열기
  useEffect(() => {
    if (shortcutsOpen) setShowShortcuts(true)
  }, [shortcutsOpen])

  const toggleProjectCollapse = (workingDir: string): void => {
    setCollapsedProjects((prev) => {
      const next = new Set(prev)
      if (next.has(workingDir)) next.delete(workingDir)
      else next.add(workingDir)
      return next
    })
  }

  const toggleAgentsCollapse = (sessionId: string): void => {
    setCollapsedAgents((prev) => {
      const next = new Set(prev)
      if (next.has(sessionId)) next.delete(sessionId)
      else next.add(sessionId)
      return next
    })
  }

  const hasCowrk = !!(cowrkAgents && onSelectCowrkAgent && onCreateCowrkAgent)

  return (
    <div className="sidebar" style={{ width }}>
      <div className="sidebar-drag-region" />

      <div className="sidebar-header">
        {hasCowrk ? (
          <div className="sidebar-tabs">
            <button
              className={`sidebar-tab${sidebarTab === 'projects' ? ' sidebar-tab--active' : ''}`}
              onClick={() => setSidebarTab('projects')}
            >
              {t(locale, 'sidebar.title')}
            </button>
            <button
              className={`sidebar-tab${sidebarTab === 'agents' ? ' sidebar-tab--active' : ''}`}
              onClick={() => setSidebarTab('agents')}
            >
              <Bot size={11} />
              Agents
              {cowrkAgents!.length > 0 && (
                <span className="sidebar-tab-badge">{cowrkAgents!.length}</span>
              )}
            </button>
          </div>
        ) : (
          <span className="sidebar-title">{t(locale, 'sidebar.title')}</span>
        )}
        <div className="sidebar-header-actions">
          {onRestartTutorial && (
            <button className="sidebar-icon-btn sidebar-tutorial-btn" onClick={onRestartTutorial} title={t(locale, 'tutorial.restart')}>
              <BookOpen size={14} />
            </button>
          )}
          <button className="sidebar-icon-btn sidebar-settings-btn" onClick={onOpenSettings} title={t(locale, 'settings.title')}>
            <Settings size={14} />
          </button>
          {sidebarTab === 'projects' && (
            <button className="sidebar-add-btn" onClick={onCreateProject} title={`${t(locale, 'sidebar.addProject')} (⌘N)`}>
              <Plus size={14} />
            </button>
          )}
          {sidebarTab === 'agents' && onCreateCowrkAgent && (
            <button className="sidebar-add-btn" onClick={onCreateCowrkAgent} title="New agent">
              <Plus size={14} />
            </button>
          )}
        </div>
      </div>

      {/* ─── Projects 탭 ─── */}
      {sidebarTab === 'projects' && (
        <>
          <div className="sidebar-list sidebar-list--with-legend">
            {projects.length === 0 ? (
              <div className="sidebar-empty">{t(locale, 'sidebar.empty')}</div>
            ) : (
              projects.map((project, projectIdx) => {
                const isCollapsed = collapsedProjects.has(project.workingDir)
                const projectShortcut = projectIdx < 9 ? `⌥⌘${projectIdx + 1}` : ''
                return (
                  <div key={project.workingDir} className="project-group">
                    <ProjectHeader
                      name={project.name}
                      workingDir={project.workingDir}
                      sessionCount={project.sessions.length}
                      isCollapsed={isCollapsed}
                      shortcut={projectShortcut}
                      locale={locale}
                      onToggleCollapse={() => toggleProjectCollapse(project.workingDir)}
                      onAddSession={() => onAddSessionToProject(project.workingDir)}
                      onRemoveProject={() => onRemoveProject(project.workingDir)}
                    />

                    {!isCollapsed && (
                      <div className="project-sessions">
                        {project.sessions.map((session, idx) => {
                          const team = teamAgents[session.id] || []
                          const hookEntry = !team.length
                            ? (hookAgents[session.id] || [])[0] ?? null
                            : null
                          return (
                            <div key={session.id} className="session-row-wrapper">
                              <SessionRow
                                session={session}
                                isActive={session.id === activeSessionId}
                                isCursor={sidebarFocused && sidebarCursorId === session.id}
                                isInGrid={gridSessionIds?.has(session.id)}
                                status={sessionStatuses[session.id]}
                                contextPercent={contextPercents[session.id]}
                                needsAttention={attentionSessions.has(session.id)}
                                claudeSessionId={claudeSessionIds?.[session.id]}
                                shortcut={idx < 9 ? `⌘${idx + 1}` : ''}
                                locale={locale}
                                onSelect={() => onSelectSession(session.id)}
                                onDestroy={() => onDestroySession(session.id)}
                                onUpdateName={(name) => onUpdateSessionName(session.id, name)}
                                previewAction={onTogglePreview ? (
                                  <button
                                    className={`sidebar-preview-btn${previewSessions?.has(session.id) ? ' sidebar-preview-btn--active' : ''}`}
                                    onClick={(e) => { e.stopPropagation(); onTogglePreview(session.id) }}
                                    title={t(locale, 'shortcuts.preview')}
                                    aria-label={t(locale, 'shortcuts.preview')}
                                  >
                                    <Eye size={11} />
                                  </button>
                                ) : undefined}
                              />
                              {hookEntry && (
                                <div className="session-hook-agents">
                                  <span className={`session-agent-indicator session-agent-indicator--${hookEntry.status}`} />
                                  <span className="session-hook-agents-label">{hookEntry.name}</span>
                                </div>
                              )}
                              {team.length > 0 && (
                                <AgentTree
                                  agents={team}
                                  isCollapsed={collapsedAgents.has(session.id)}
                                  onToggleCollapse={() => toggleAgentsCollapse(session.id)}
                                />
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>

          {showNudge && (
            <div className="split-nudge">
              <span className="split-nudge-text">{t(locale, 'nudge.splitTip')}</span>
              <button className="split-nudge-close" onClick={dismissNudge}><X size={12} /></button>
            </div>
          )}
        </>
      )}

      {/* ─── Agents 탭 ─── */}
      {sidebarTab === 'agents' && cowrkAgents && onSelectCowrkAgent && onCreateCowrkAgent && (
        <CowrkSection
          agents={cowrkAgents}
          activeAgent={cowrkActiveAgent ?? null}
          chatMessages={cowrkChatMessages || {}}
          onSelectAgent={onSelectCowrkAgent}
          onCreateAgent={onCreateCowrkAgent}
        />
      )}

      <UsageGauge usageData={usageData} locale={locale} />

      <div className="sidebar-footer">
        <div className="sidebar-footer-buttons">
          <button className="sidebar-footer-btn sidebar-footer-btn--icon" onClick={() => setShowRoadmap(true)} title={t(locale, 'footer.roadmap')}>
            <Route size={14} />
          </button>
          <button className="sidebar-footer-btn sidebar-footer-btn--icon" onClick={() => setShowShortcuts(true)} title={t(locale, 'footer.shortcuts')}>
            <Keyboard size={14} />
          </button>
          <a href="https://github.com/mylumiere/mulaude/issues" className="sidebar-footer-btn sidebar-footer-btn--icon" target="_blank" rel="noreferrer" title={t(locale, 'footer.feedback')}>
            <MessageSquareWarning size={14} />
          </a>
        </div>
      </div>

      {showRoadmap && <RoadmapModal onClose={() => setShowRoadmap(false)} />}
      {showShortcuts && <ShortcutsModal onClose={() => { setShowShortcuts(false); onShortcutsClose?.() }} locale={locale} />}
    </div>
  )
}
