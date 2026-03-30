/**
 * useDiffManager — 세션별 Diff 패널 상태/비율 관리
 *
 * usePlanManager/usePreviewManager와 동일한 패턴:
 * - diffSessions: Set<string> — 열린 세션
 * - diffData: Record<string, DiffFile[]> — diff 결과
 * - diffRatios: Record<string, number> — 분할 비율
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { DIFF_DEFAULT_RATIO, MIN_PANE_RATIO } from '../../shared/constants'
import type { DiffFile } from '../../shared/types'

export interface UseDiffManagerReturn {
  diffSessions: Set<string>
  diffData: Record<string, DiffFile[]>
  diffRatios: Record<string, number>
  openDiff: (sessionId: string) => void
  closeDiff: (sessionId: string) => void
  cleanupDiff: (sessionId: string) => void
  handleToggleDiff: (sessionId: string) => void
  handleDiffResize: (sessionId: string) => (e: React.MouseEvent) => void
}

export function useDiffManager(): UseDiffManagerReturn {
  const [diffSessions, setDiffSessions] = useState<Set<string>>(new Set())
  const [diffData, setDiffData] = useState<Record<string, DiffFile[]>>({})
  const [diffRatios, setDiffRatios] = useState<Record<string, number>>({})
  const containerRef = useRef<HTMLElement | null>(null)

  const openDiff = useCallback((sessionId: string) => {
    setDiffSessions(prev => {
      if (prev.has(sessionId)) return prev
      const next = new Set(prev)
      next.add(sessionId)
      return next
    })
    // IPC: auto-refresh 등록 + 즉시 fetch
    window.api.registerDiffSession(sessionId)
    window.api.fetchDiff(sessionId)
  }, [])

  const closeDiff = useCallback((sessionId: string) => {
    setDiffSessions(prev => {
      if (!prev.has(sessionId)) return prev
      const next = new Set(prev)
      next.delete(sessionId)
      return next
    })
    window.api.unregisterDiffSession(sessionId)
    setDiffData(prev => {
      if (!prev[sessionId]) return prev
      const next = { ...prev }
      delete next[sessionId]
      return next
    })
  }, [])

  const cleanupDiff = useCallback((sessionId: string) => {
    closeDiff(sessionId)
  }, [closeDiff])

  const handleToggleDiff = useCallback((sessionId: string) => {
    setDiffSessions(prev => {
      if (prev.has(sessionId)) {
        closeDiff(sessionId)
        return prev  // closeDiff이 setState를 이미 호출하므로 prev 반환
      }
      openDiff(sessionId)
      return prev  // openDiff이 setState를 이미 호출하므로 prev 반환
    })
  }, [openDiff, closeDiff])

  // diff:result IPC 리스너
  useEffect(() => {
    const cleanup = window.api.onDiffResult((sessionId: string, files: DiffFile[]) => {
      setDiffData(prev => ({ ...prev, [sessionId]: files }))
    })
    return cleanup
  }, [])

  // 리사이즈 핸들러 (usePreviewManager 패턴)
  const handleDiffResize = useCallback((sessionId: string) => {
    return (e: React.MouseEvent) => {
      e.preventDefault()
      const container = (e.target as HTMLElement).parentElement
      if (!container) return
      containerRef.current = container

      const startX = e.clientX
      const startRatio = diffRatios[sessionId] ?? DIFF_DEFAULT_RATIO

      const onMouseMove = (ev: MouseEvent) => {
        if (!containerRef.current) return
        const rect = containerRef.current.getBoundingClientRect()
        const delta = (ev.clientX - startX) / rect.width
        const newRatio = Math.max(MIN_PANE_RATIO, Math.min(1 - MIN_PANE_RATIO, startRatio + delta))
        setDiffRatios(prev => ({ ...prev, [sessionId]: newRatio }))
      }

      const onMouseUp = () => {
        document.body.classList.remove('resizing')
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }

      document.body.classList.add('resizing')
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    }
  }, [diffRatios])

  return {
    diffSessions,
    diffData,
    diffRatios,
    openDiff,
    closeDiff,
    cleanupDiff,
    handleToggleDiff,
    handleDiffResize
  }
}
