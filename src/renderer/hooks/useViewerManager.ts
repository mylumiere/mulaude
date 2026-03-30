/**
 * useViewerManager — 세션별 Viewer 패널 상태/비율 관리
 *
 * useDiffManager와 동일한 패턴:
 * - viewerSessions: Set<string> — 열린 세션
 * - viewerData: Record<string, ViewerContent> — 파일 내용
 * - viewerRatios: Record<string, number> — 분할 비율
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { VIEWER_DEFAULT_RATIO, MIN_PANE_RATIO } from '../../shared/constants'
import type { ViewerContent } from '../../shared/types'

export interface UseViewerManagerReturn {
  viewerSessions: Set<string>
  viewerData: Record<string, ViewerContent>
  viewerRatios: Record<string, number>
  openViewer: (sessionId: string) => void
  closeViewer: (sessionId: string) => void
  cleanupViewer: (sessionId: string) => void
  handleToggleViewer: (sessionId: string) => void
  handleViewerResize: (sessionId: string) => (e: React.MouseEvent) => void
  refreshViewer: (sessionId: string) => void
}

export function useViewerManager(): UseViewerManagerReturn {
  const [viewerSessions, setViewerSessions] = useState<Set<string>>(new Set())
  const [viewerData, setViewerData] = useState<Record<string, ViewerContent>>({})
  const [viewerRatios, setViewerRatios] = useState<Record<string, number>>({})
  const containerRef = useRef<HTMLElement | null>(null)

  const openViewer = useCallback((sessionId: string) => {
    setViewerSessions(prev => {
      if (prev.has(sessionId)) return prev
      const next = new Set(prev)
      next.add(sessionId)
      return next
    })
    // IPC: auto-refresh 등록
    window.api.registerViewerSession(sessionId)
  }, [])

  const closeViewer = useCallback((sessionId: string) => {
    setViewerSessions(prev => {
      if (!prev.has(sessionId)) return prev
      const next = new Set(prev)
      next.delete(sessionId)
      return next
    })
    window.api.unregisterViewerSession(sessionId)
    setViewerData(prev => {
      if (!prev[sessionId]) return prev
      const next = { ...prev }
      delete next[sessionId]
      return next
    })
  }, [])

  const cleanupViewer = useCallback((sessionId: string) => {
    closeViewer(sessionId)
  }, [closeViewer])

  const handleToggleViewer = useCallback((sessionId: string) => {
    setViewerSessions(prev => {
      if (prev.has(sessionId)) {
        closeViewer(sessionId)
        return prev
      }
      openViewer(sessionId)
      return prev
    })
  }, [openViewer, closeViewer])

  const refreshViewer = useCallback((sessionId: string) => {
    const content = viewerData[sessionId]
    if (content) {
      window.api.fetchViewerContent(sessionId, content.filePath)
    }
  }, [viewerData])

  // viewer:result IPC 리스너
  useEffect(() => {
    const cleanup = window.api.onViewerResult((sessionId: string, content: ViewerContent) => {
      setViewerData(prev => ({ ...prev, [sessionId]: content }))
    })
    return cleanup
  }, [])

  // 리사이즈 핸들러 (useDiffManager 패턴)
  const handleViewerResize = useCallback((sessionId: string) => {
    return (e: React.MouseEvent) => {
      e.preventDefault()
      const container = (e.target as HTMLElement).parentElement
      if (!container) return
      containerRef.current = container

      const startX = e.clientX
      const startRatio = viewerRatios[sessionId] ?? VIEWER_DEFAULT_RATIO

      const onMouseMove = (ev: MouseEvent) => {
        if (!containerRef.current) return
        const rect = containerRef.current.getBoundingClientRect()
        const delta = (ev.clientX - startX) / rect.width
        const newRatio = Math.max(MIN_PANE_RATIO, Math.min(1 - MIN_PANE_RATIO, startRatio + delta))
        setViewerRatios(prev => ({ ...prev, [sessionId]: newRatio }))
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
  }, [viewerRatios])

  return {
    viewerSessions,
    viewerData,
    viewerRatios,
    openViewer,
    closeViewer,
    cleanupViewer,
    handleToggleViewer,
    handleViewerResize,
    refreshViewer
  }
}
