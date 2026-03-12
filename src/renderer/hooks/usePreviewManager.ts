/**
 * usePreviewManager — 세션별 Preview 토글 상태와 분할 비율 관리
 */

import { useState, useCallback, useRef } from 'react'
import { PREVIEW_DEFAULT_RATIO, MIN_PANE_RATIO } from '../../shared/constants'
import { savePreviewSessions, loadPreviewSessions, deletePreviewState, savePreviewState } from '../utils/preview-storage'

interface UsePreviewManagerReturn {
  previewSessions: Set<string>
  previewRatios: Record<string, number>
  pendingUrls: Record<string, string>
  consumePendingUrl: (sessionId: string) => string | null
  togglePreview: (sessionId: string) => void
  openPreview: (sessionId: string) => void
  openPreviewWithUrl: (sessionId: string, url: string | null) => void
  closePreview: (sessionId: string) => void
  cleanupPreview: (sessionId: string) => void
  handlePreviewResize: (sessionId: string) => (e: React.MouseEvent) => void
  /** ref로 최신 상태 즉시 참조 (usePreviewTrigger용) */
  previewSessionsRef: React.MutableRefObject<Set<string>>
}

export function usePreviewManager(): UsePreviewManagerReturn {
  const [previewSessions, setPreviewSessions] = useState<Set<string>>(() => {
    return new Set(loadPreviewSessions())
  })
  const [previewRatios, setPreviewRatios] = useState<Record<string, number>>({})
  const [pendingUrls, setPendingUrls] = useState<Record<string, string>>({})
  const containerRef = useRef<HTMLElement | null>(null)

  // 최신 상태를 ref로 동기화 (useEffect closure stale 방지)
  const previewSessionsRef = useRef(previewSessions)
  previewSessionsRef.current = previewSessions

  const persist = useCallback((sessions: Set<string>) => {
    savePreviewSessions(Array.from(sessions))
  }, [])

  const openPreview = useCallback((sessionId: string) => {
    setPreviewSessions(prev => {
      if (prev.has(sessionId)) return prev
      const next = new Set(prev)
      next.add(sessionId)
      persist(next)
      return next
    })
  }, [persist])

  const togglePreview = useCallback((sessionId: string) => {
    setPreviewSessions(prev => {
      const next = new Set(prev)
      if (next.has(sessionId)) next.delete(sessionId)
      else next.add(sessionId)
      persist(next)
      return next
    })
  }, [persist])

  const openPreviewWithUrl = useCallback((sessionId: string, url: string | null) => {
    if (url) {
      setPendingUrls(prev => ({ ...prev, [sessionId]: url }))
      savePreviewState(sessionId, { url })
    }
    openPreview(sessionId)
  }, [openPreview])

  const consumePendingUrl = useCallback((sessionId: string): string | null => {
    const url = pendingUrls[sessionId] || null
    if (url) {
      setPendingUrls(prev => {
        const next = { ...prev }
        delete next[sessionId]
        return next
      })
    }
    return url
  }, [pendingUrls])

  const closePreview = useCallback((sessionId: string) => {
    setPreviewSessions(prev => {
      if (!prev.has(sessionId)) return prev
      const next = new Set(prev)
      next.delete(sessionId)
      persist(next)
      return next
    })
  }, [persist])

  const cleanupPreview = useCallback((sessionId: string) => {
    closePreview(sessionId)
    deletePreviewState(sessionId)
  }, [closePreview])

  const handlePreviewResize = useCallback((sessionId: string) => {
    return (e: React.MouseEvent) => {
      e.preventDefault()
      const container = (e.target as HTMLElement).parentElement
      if (!container) return
      containerRef.current = container

      const startX = e.clientX
      const startRatio = previewRatios[sessionId] ?? PREVIEW_DEFAULT_RATIO

      const onMouseMove = (ev: MouseEvent) => {
        if (!containerRef.current) return
        const rect = containerRef.current.getBoundingClientRect()
        const delta = (ev.clientX - startX) / rect.width
        const newRatio = Math.max(MIN_PANE_RATIO, Math.min(1 - MIN_PANE_RATIO, startRatio + delta))
        setPreviewRatios(prev => ({ ...prev, [sessionId]: newRatio }))
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
  }, [previewRatios])

  return {
    previewSessions, previewRatios, pendingUrls, consumePendingUrl,
    togglePreview, openPreview, openPreviewWithUrl, closePreview, cleanupPreview,
    handlePreviewResize, previewSessionsRef
  }
}
