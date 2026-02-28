/**
 * useChildPaneManager - child pane 상태 관리
 *
 * App.tsx에서 추출된 훅으로, child pane IPC 구독, 포커스 관리,
 * 분할 비율 관리를 담당합니다.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import type { AgentInfo } from '../../shared/types'

interface ChildPaneEntry {
  title: string
  initialContent: string
}

interface UseChildPaneManagerParams {
  sessionAgents: Record<string, AgentInfo[]>
}

interface UseChildPaneManagerReturn {
  childPaneMap: Record<string, Map<number, ChildPaneEntry>>
  focusedPane: Record<string, number | null>
  splitRatios: Record<string, number>
  /** 에이전트가 있는 세션 ID 집합 */
  sessionsWithPanes: Set<string>
  /** child pane 인덱스 목록 참조 (키보드 네비게이션용) */
  childPaneIndicesRef: React.MutableRefObject<Record<string, number[]>>
  handleFocusPane: (sessionId: string, paneIndex: number) => void
  handleFocusParent: (sessionId: string) => void
  handleSplitResize: (sessionId: string) => (e: React.MouseEvent) => void
  setFocusedPane: (sessionId: string, paneIndex: number | null) => void
}

export function useChildPaneManager({
  sessionAgents
}: UseChildPaneManagerParams): UseChildPaneManagerReturn {
  const [childPaneMap, setChildPaneMap] = useState<Record<string, Map<number, ChildPaneEntry>>>({})
  const [focusedPane, setFocusedPaneState] = useState<Record<string, number | null>>({})
  const [splitRatios, setSplitRatios] = useState<Record<string, number>>({})
  const childPaneIndicesRef = useRef<Record<string, number[]>>({})

  // IPC 구독: child pane 발견/제거
  useEffect(() => {
    const cleanupDiscovered = window.api.onChildPaneDiscovered(
      (sessionId: string, paneIndex: number, initialContent: string) => {
        setChildPaneMap((prev) => {
          const sessionPanes = new Map(prev[sessionId] || new Map<number, ChildPaneEntry>())
          sessionPanes.set(paneIndex, { title: '', initialContent })
          return { ...prev, [sessionId]: sessionPanes }
        })
      }
    )

    const cleanupRemoved = window.api.onChildPaneRemoved(
      (sessionId: string, paneIndex: number) => {
        setChildPaneMap((prev) => {
          const sessionPanes = new Map(prev[sessionId] || new Map<number, ChildPaneEntry>())
          sessionPanes.delete(paneIndex)
          const next = { ...prev }
          if (sessionPanes.size === 0) {
            delete next[sessionId]
          } else {
            next[sessionId] = sessionPanes
          }
          return next
        })
      }
    )

    return () => { cleanupDiscovered(); cleanupRemoved() }
  }, [])

  // sessionAgents 변경 시 pane 인덱스 목록 갱신 + 포커스 정리
  useEffect(() => {
    const newIndicesMap: Record<string, number[]> = {}
    for (const [sessionId, agents] of Object.entries(sessionAgents)) {
      newIndicesMap[sessionId] = agents
        .filter((a) => a.paneIndex !== undefined && (a.status === 'pending' || a.status === 'running' || a.status === 'completed' || a.status === 'exited'))
        .map((a) => a.paneIndex!)
        .sort((a, b) => a - b)
    }

    for (const sessionId of Object.keys(childPaneIndicesRef.current)) {
      if (!newIndicesMap[sessionId]) {
        delete childPaneIndicesRef.current[sessionId]
      }
    }
    Object.assign(childPaneIndicesRef.current, newIndicesMap)

    setFocusedPaneState((prev) => {
      let changed = false
      const next = { ...prev }
      for (const [sessionId, focus] of Object.entries(prev)) {
        if (typeof focus !== 'number') continue
        const indices = newIndicesMap[sessionId]
        if (!indices || indices.length === 0 || !indices.includes(focus)) {
          delete next[sessionId]
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [sessionAgents])

  // team config 에이전트가 있는 세션만 split view 렌더 (config SSOT)
  const sessionsWithPanes = useMemo(
    () => new Set(
      Object.keys(sessionAgents).filter((id) => sessionAgents[id].length > 0)
    ),
    [sessionAgents]
  )

  const handleFocusPane = useCallback((sessionId: string, paneIndex: number) => {
    setFocusedPaneState((prev) => ({ ...prev, [sessionId]: paneIndex }))
  }, [])

  const handleFocusParent = useCallback((sessionId: string) => {
    setFocusedPaneState((prev) => ({ ...prev, [sessionId]: null }))
  }, [])

  const handleSplitResize = useCallback((sessionId: string) => {
    return (e: React.MouseEvent) => {
      e.preventDefault()
      const startX = e.clientX
      const startRatio = splitRatios[sessionId] ?? 0.35
      const container = (e.target as HTMLElement).parentElement
      if (!container) return
      const containerWidth = container.getBoundingClientRect().width

      const onMove = (me: MouseEvent): void => {
        const delta = me.clientX - startX
        const newRatio = Math.min(0.7, Math.max(0.2, startRatio + delta / containerWidth))
        setSplitRatios((prev) => ({ ...prev, [sessionId]: newRatio }))
      }

      const onUp = (): void => {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
      }

      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    }
  }, [splitRatios])

  const setFocusedPane = useCallback((sessionId: string, paneIndex: number | null) => {
    setFocusedPaneState((prev) => ({ ...prev, [sessionId]: paneIndex }))
  }, [])

  return {
    childPaneMap,
    focusedPane,
    splitRatios,
    sessionsWithPanes,
    childPaneIndicesRef,
    handleFocusPane,
    handleFocusParent,
    handleSplitResize,
    setFocusedPane
  }
}
