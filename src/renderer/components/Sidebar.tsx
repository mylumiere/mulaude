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

import { useState, useEffect } from 'react'
import type { ProjectGroup, SessionStatus, UsageData, AgentInfo } from '../../shared/types'
import { type Locale, t } from '../i18n'
import ProjectHeader from './sidebar/ProjectHeader'
import SessionRow from './sidebar/SessionRow'
import AgentTree from './sidebar/AgentTree'
import UsageGauge from './sidebar/UsageGauge'
import StatusLegend from './sidebar/StatusLegend'
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
  sessionAgents: Record<string, AgentInfo[]>
  /** 그리드에 현재 열려있는 세션 ID 셋 */
  gridSessionIds?: Set<string>
  /** 튜토리얼 다시보기 */
  onRestartTutorial?: () => void
  /** 외부에서 단축키 모달 열기 (⌘/) */
  shortcutsOpen?: boolean
  onShortcutsClose?: () => void
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
  sessionAgents,
  sidebarFocused,
  sidebarCursorId,
  gridSessionIds,
  onRestartTutorial,
  shortcutsOpen,
  onShortcutsClose
}: SidebarProps): JSX.Element {
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set())
  const [collapsedAgents, setCollapsedAgents] = useState<Set<string>>(new Set())
  const [showRoadmap, setShowRoadmap] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)

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

  return (
    <div className="sidebar" style={{ width }}>
      <div className="sidebar-drag-region" />

      <div className="sidebar-header">
        <span className="sidebar-title">{t(locale, 'sidebar.title')}</span>
        <div className="sidebar-header-actions">
          {onRestartTutorial && (
            <button className="sidebar-icon-btn sidebar-tutorial-btn" onClick={onRestartTutorial} title={t(locale, 'tutorial.restart')}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M3 1.5C2.45 1.5 2 1.95 2 2.5v11c0 .55.45 1 1 1h7c.55 0 1-.45 1-1v-11c0-.55-.45-1-1-1H3z" stroke="currentColor" strokeWidth="1.2" fill="none"/>
                <path d="M4 1.5V5l1.5-1L7 5V1.5" stroke="currentColor" strokeWidth="1" fill="currentColor" opacity="0.3"/>
                <path d="M4.5 8h4M4.5 10h3" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" opacity="0.5"/>
                <path d="M12 4.5v9c0 .55-.45 1-1 1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.3"/>
              </svg>
            </button>
          )}
          <button className="sidebar-icon-btn sidebar-settings-btn" onClick={onOpenSettings} title={t(locale, 'settings.title')}>
            ⚙
          </button>
          <button className="sidebar-add-btn" onClick={onCreateProject} title={`${t(locale, 'sidebar.addProject')} (⌘N)`}>
            +
          </button>
        </div>
      </div>

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
                      const agents = sessionAgents[session.id] || []
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
                            shortcut={idx < 9 ? `⌘${idx + 1}` : ''}
                            locale={locale}
                            onSelect={() => onSelectSession(session.id)}
                            onDestroy={() => onDestroySession(session.id)}
                            onUpdateName={(name) => onUpdateSessionName(session.id, name)}
                          />
                          {agents.length > 0 && (
                            <AgentTree
                              agents={agents}
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

      {usageData && <UsageGauge usageData={usageData} />}
      <StatusLegend locale={locale} />

      <div className="sidebar-footer">
        <div className="sidebar-footer-buttons">
          <button className="sidebar-footer-btn" onClick={() => setShowRoadmap(true)}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M1 3.5A1.5 1.5 0 012.5 2h2A1.5 1.5 0 016 3.5v1A1.5 1.5 0 014.5 6h-2A1.5 1.5 0 011 4.5v-1z" fill="currentColor" opacity="0.4"/>
              <path d="M6 7.5A1.5 1.5 0 017.5 6h2A1.5 1.5 0 0111 7.5v1A1.5 1.5 0 019.5 10h-2A1.5 1.5 0 016 8.5v-1z" fill="currentColor" opacity="0.6"/>
              <path d="M10 11.5a1.5 1.5 0 011.5-1.5h2a1.5 1.5 0 011.5 1.5v1a1.5 1.5 0 01-1.5 1.5h-2a1.5 1.5 0 01-1.5-1.5v-1z" fill="currentColor" opacity="0.8"/>
              <path d="M4.5 6L7.5 6M9.5 10L11.5 10" stroke="currentColor" strokeWidth="1" strokeDasharray="2 1" opacity="0.3"/>
            </svg>
            {t(locale, 'footer.roadmap')}
          </button>
          <button className="sidebar-footer-btn" onClick={() => setShowShortcuts(true)}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <rect x="1" y="4" width="14" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2" fill="none" opacity="0.6"/>
              <rect x="3" y="6.5" width="2" height="1.5" rx="0.3" fill="currentColor" opacity="0.5"/>
              <rect x="6" y="6.5" width="2" height="1.5" rx="0.3" fill="currentColor" opacity="0.5"/>
              <rect x="9" y="6.5" width="2" height="1.5" rx="0.3" fill="currentColor" opacity="0.5"/>
              <rect x="12" y="6.5" width="1.5" height="1.5" rx="0.3" fill="currentColor" opacity="0.5"/>
              <rect x="4" y="9.5" width="8" height="1.5" rx="0.3" fill="currentColor" opacity="0.4"/>
            </svg>
            {t(locale, 'footer.shortcuts')}
          </button>
        </div>
        <div className="sidebar-contact">
          <a href="https://github.com/mylumiere/mulaude/issues" className="sidebar-contact-link" target="_blank" rel="noreferrer">{t(locale, 'footer.feedback')}</a>
          <div className="sidebar-contact-hint">{t(locale, 'footer.feedbackHint')}</div>
        </div>
      </div>

      {showRoadmap && <RoadmapModal onClose={() => setShowRoadmap(false)} />}
      {showShortcuts && <ShortcutsModal onClose={() => { setShowShortcuts(false); onShortcutsClose?.() }} locale={locale} />}
    </div>
  )
}
