/**
 * useKeyboardShortcuts - 키보드 단축키 관리
 *
 *   Cmd+N: 새 프로젝트
 *   Cmd+1~9: 현재 프로젝트 내 세션 전환
 *   Opt+Cmd+1~9: 프로젝트 전환
 *   Cmd+←/→/↑/↓: 그리드 패인 간 포커스 이동
 *   Opt+Cmd+↑/↓: 에이전트 패인 이동
 *   Cmd+W: 포커스된 패인 닫기
 *   Cmd+Shift+Enter: 줌 토글
 *   Cmd+,: 설정
 */

import { useEffect } from 'react'
import type { SessionInfo, ProjectGroup } from '../../shared/types'

interface UseKeyboardShortcutsParams {
  projects: ProjectGroup[]
  activeSessionId: string | null
  sessions: SessionInfo[]
  createProject: () => void
  selectSession: (id: string) => void
  /** 세션별 포커스 상태 (null = 부모, number = pane 인덱스) */
  focusedPane: Record<string, number | null>
  /** 포커스 변경 함수 */
  setFocusedPane: (sessionId: string, paneIndex: number | null) => void
  /** 세션의 자식 pane 인덱스 목록 */
  getChildPaneIndices: (sessionId: string) => number[]
  /** 에이전트 pane이 있는 세션 */
  sessionsWithPanes: Set<string>
  /** 포커스된 패인 닫기 */
  closePane?: () => void
  /** 줌 토글 */
  toggleZoom?: () => void
  /** 방향 기반 포커스 이동 */
  focusDirection?: (direction: 'left' | 'right' | 'up' | 'down') => void
  /** 그리드 모드 여부 */
  isGridMode?: boolean
  /** 그리드에서 포커스된 패인의 세션 ID */
  getFocusedSessionId?: () => string | null
  /** 설정 열기 */
  openSettings?: () => void
  /** 단축키 모달 열기 */
  openShortcuts?: () => void
}

export function useKeyboardShortcuts({
  projects,
  activeSessionId,
  sessions,
  createProject,
  selectSession,
  focusedPane,
  setFocusedPane,
  getChildPaneIndices,
  sessionsWithPanes,
  closePane,
  toggleZoom,
  focusDirection,
  isGridMode,
  getFocusedSessionId,
  openSettings,
  openShortcuts
}: UseKeyboardShortcutsParams): void {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (!e.metaKey) return

      if (e.key === 'n' && !e.altKey && !e.shiftKey) {
        e.preventDefault(); createProject(); return
      }

      if (e.key === ',' && !e.altKey && !e.shiftKey) {
        e.preventDefault(); openSettings?.(); return
      }

      if (e.key === '/' && !e.altKey && !e.shiftKey) {
        e.preventDefault(); openShortcuts?.(); return
      }

      if (e.key === 'w' && !e.altKey && !e.shiftKey && isGridMode) {
        e.preventDefault()
        closePane?.()
        return
      }

      // ── 줌 토글 (Cmd+Shift+Enter) ──
      if (e.key === 'Enter' && e.shiftKey && !e.altKey && !e.ctrlKey && isGridMode) {
        e.preventDefault()
        toggleZoom?.()
        return
      }

      // ── Cmd+방향키: 그리드 패인 이동 ──
      if (!e.altKey && !e.ctrlKey && isGridMode && focusDirection) {
        if (e.key === 'ArrowLeft') {
          e.preventDefault(); focusDirection('left'); return
        }
        if (e.key === 'ArrowRight') {
          e.preventDefault(); focusDirection('right'); return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault(); focusDirection('up'); return
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault(); focusDirection('down'); return
        }
      }

      // ── 에이전트 패인 포커스 (Opt+Cmd+방향키) ──
      const agentSessionId = isGridMode ? getFocusedSessionId?.() : activeSessionId
      if (e.altKey && agentSessionId && sessionsWithPanes.has(agentSessionId)) {
        const sid = agentSessionId
        const focus = focusedPane[sid] ?? null
        const indices = getChildPaneIndices(sid)

        if (e.key === 'ArrowLeft') {
          e.preventDefault()
          setFocusedPane(sid, null)
          return
        }

        if (e.key === 'ArrowRight') {
          e.preventDefault()
          if (indices.length > 0 && focus === null) {
            setFocusedPane(sid, indices[0])
          }
          return
        }

        if (e.key === 'ArrowUp' && typeof focus === 'number') {
          e.preventDefault()
          const currentIdx = indices.indexOf(focus)
          if (currentIdx > 0) {
            setFocusedPane(sid, indices[currentIdx - 1])
          }
          return
        }

        if (e.key === 'ArrowDown' && typeof focus === 'number') {
          e.preventDefault()
          const currentIdx = indices.indexOf(focus)
          if (currentIdx < indices.length - 1) {
            setFocusedPane(sid, indices[currentIdx + 1])
          }
          return
        }
      }

      // ── 비-그리드 모드: Cmd+↑/↓ 세션 전환 ──
      if (!isGridMode && !e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault()
        if (!activeSessionId || sessions.length < 2) return
        const currentIdx = sessions.findIndex((s) => s.id === activeSessionId)
        if (currentIdx < 0) return
        if (e.key === 'ArrowUp' && currentIdx > 0) {
          selectSession(sessions[currentIdx - 1].id)
        } else if (e.key === 'ArrowDown' && currentIdx < sessions.length - 1) {
          selectSession(sessions[currentIdx + 1].id)
        }
        return
      }

      const num = parseInt(e.key, 10)
      if (num < 1 || num > 9 || isNaN(num)) return
      e.preventDefault()
      if (e.altKey) {
        const project = projects[num - 1]
        if (project?.sessions.length) selectSession(project.sessions[0].id)
      } else {
        const curProject = projects.find((p) => p.sessions.some((s) => s.id === activeSessionId))
        const target = curProject ? curProject.sessions[num - 1] : sessions[num - 1]
        if (target) selectSession(target.id)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [projects, activeSessionId, sessions, createProject, selectSession, focusedPane, setFocusedPane, getChildPaneIndices, sessionsWithPanes, closePane, toggleZoom, focusDirection, isGridMode, getFocusedSessionId, openSettings, openShortcuts])
}
