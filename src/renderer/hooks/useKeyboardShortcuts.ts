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
import type { TutorialStep, TutorialPhase } from './useTutorial'

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
  /** 닫은 패인 되살리기 */
  reopenClosedPane?: () => void
  /** 줌 토글 */
  toggleZoom?: () => void
  /** 방향 기반 포커스 이동 */
  focusDirection?: (direction: 'left' | 'right' | 'up' | 'down') => void
  /** 그리드 모드 여부 */
  isGridMode?: boolean
  /** 그리드에서 포커스된 패인의 세션 ID */
  getFocusedSessionId?: () => string | null
  /** 프리뷰 토글 */
  togglePreview?: () => void
  /** Diff 토글 */
  toggleDiff?: () => void
  /** Viewer 토글 */
  toggleViewer?: () => void
  /** 커맨드 팔레트 열기 */
  openCommandPalette?: () => void
  /** 설정 열기 */
  openSettings?: () => void
  /** 단축키 모달 열기 */
  openShortcuts?: () => void
  /** Team Chat 토글 */
  toggleTeamChat?: () => void
  /** 튜토리얼 상태 (활성 시 허용된 키만 통과) */
  tutorialPhase?: TutorialPhase
  tutorialStep?: TutorialStep | null
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
  reopenClosedPane,
  toggleZoom,
  togglePreview,
  toggleDiff,
  toggleViewer,
  openCommandPalette,
  focusDirection,
  isGridMode,
  getFocusedSessionId,
  openSettings,
  openShortcuts,
  toggleTeamChat,
  tutorialPhase,
  tutorialStep
}: UseKeyboardShortcutsParams): void {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (!e.metaKey) return

      // ⌘Q (종료)는 항상 허용
      if (e.key === 'q') return

      // 튜토리얼 진행 중: 현재 스텝에서 허용된 단축키만 통과
      if (tutorialPhase === 'steps') {
        if (tutorialStep?.action === 'shortcut' && tutorialStep.shortcutKeys) {
          if (!tutorialStep.shortcutKeys.includes(e.key)) {
            e.preventDefault()
            return
          }
          // 허용된 키 — 아래로 계속 진행
        } else {
          // shortcut 스텝이 아닌 경우 모든 단축키 차단
          e.preventDefault()
          return
        }
      }

      if (e.key === 'n' && !e.altKey && !e.shiftKey) {
        e.preventDefault(); createProject(); return
      }

      // ── 커맨드 팔레트 (Cmd+K) ──
      if (e.key === 'k' && !e.altKey && !e.shiftKey) {
        e.preventDefault(); openCommandPalette?.(); return
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

      // ── 닫은 패인 되살리기 (Cmd+Shift+T) ──
      if (e.key === 't' && e.shiftKey && !e.altKey && !e.ctrlKey) {
        e.preventDefault()
        reopenClosedPane?.()
        return
      }

      // ── 프리뷰 토글 (Cmd+Shift+P) ──
      if (e.key === 'p' && e.shiftKey && !e.altKey && !e.ctrlKey) {
        e.preventDefault()
        togglePreview?.()
        return
      }

      // ── Diff 토글 (Cmd+Shift+D) ──
      if (e.key === 'd' && e.shiftKey && !e.altKey && !e.ctrlKey) {
        e.preventDefault()
        toggleDiff?.()
        return
      }

      // ── Viewer 토글 (Cmd+Shift+V) ──
      if (e.key === 'v' && e.shiftKey && !e.altKey && !e.ctrlKey) {
        e.preventDefault()
        toggleViewer?.()
        return
      }

      // ── Team Chat 토글 (Cmd+Shift+G) ──
      if (e.key.toLowerCase() === 'g' && e.shiftKey && !e.altKey && !e.ctrlKey) {
        e.preventDefault()
        toggleTeamChat?.()
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

      // ── 비-그리드 모드: Cmd+↑/↓ 세션 전환 (사이드바 표시 순서 기준) ──
      if (!isGridMode && !e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault()
        if (!activeSessionId || sessions.length < 2) return
        const visualOrder = projects.flatMap((p) => p.sessions)
        const currentIdx = visualOrder.findIndex((s) => s.id === activeSessionId)
        if (currentIdx < 0) return
        if (e.key === 'ArrowUp' && currentIdx > 0) {
          selectSession(visualOrder[currentIdx - 1].id)
        } else if (e.key === 'ArrowDown' && currentIdx < visualOrder.length - 1) {
          selectSession(visualOrder[currentIdx + 1].id)
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
  }, [projects, activeSessionId, sessions, createProject, selectSession, focusedPane, setFocusedPane, getChildPaneIndices, sessionsWithPanes, closePane, reopenClosedPane, toggleZoom, togglePreview, toggleDiff, toggleViewer, openCommandPalette, focusDirection, isGridMode, getFocusedSessionId, openSettings, openShortcuts, tutorialPhase, tutorialStep])
}
