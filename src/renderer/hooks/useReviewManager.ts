/**
 * useReviewManager — 세션별 Codex 리뷰 패널 상태/비율 관리
 *
 * useDiffManager 패턴을 따르되, 리뷰는 on-demand(비동기 실행)이므로
 * 진행 상태(status)와 누적 텍스트(text)를 함께 관리합니다.
 *
 * - reviewSessions: Set<string> — 패널이 열린 세션
 * - reviewData: Record<string, ReviewState> — 세션별 리뷰 상태
 * - reviewRatios: Record<string, number> — 분할 비율
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { REVIEW_DEFAULT_RATIO, MIN_PANE_RATIO } from '../../shared/constants'

export type ReviewStatus = 'idle' | 'running' | 'done' | 'error'

export interface ReviewState {
  status: ReviewStatus
  /** 누적된 리뷰 텍스트 (마크다운) */
  text: string
  /** 에러 메시지 (status === 'error'일 때) */
  error?: string
}

export interface UseReviewManagerReturn {
  reviewSessions: Set<string>
  reviewData: Record<string, ReviewState>
  reviewRatios: Record<string, number>
  openReview: (sessionId: string) => void
  closeReview: (sessionId: string) => void
  cleanupReview: (sessionId: string) => void
  handleToggleReview: (sessionId: string) => void
  rerunReview: (sessionId: string) => void
  handleReviewResize: (sessionId: string) => (e: React.MouseEvent) => void
}

export function useReviewManager(): UseReviewManagerReturn {
  const [reviewSessions, setReviewSessions] = useState<Set<string>>(new Set())
  const [reviewData, setReviewData] = useState<Record<string, ReviewState>>({})
  const [reviewRatios, setReviewRatios] = useState<Record<string, number>>({})
  const containerRef = useRef<HTMLElement | null>(null)

  const startReview = useCallback((sessionId: string) => {
    setReviewData(prev => ({ ...prev, [sessionId]: { status: 'running', text: '' } }))
    window.api.runReview(sessionId)
  }, [])

  const openReview = useCallback((sessionId: string) => {
    setReviewSessions(prev => {
      if (prev.has(sessionId)) return prev
      const next = new Set(prev)
      next.add(sessionId)
      return next
    })
    startReview(sessionId)
  }, [startReview])

  const closeReview = useCallback((sessionId: string) => {
    setReviewSessions(prev => {
      if (!prev.has(sessionId)) return prev
      const next = new Set(prev)
      next.delete(sessionId)
      return next
    })
    window.api.cancelReview(sessionId)
    setReviewData(prev => {
      if (!prev[sessionId]) return prev
      const next = { ...prev }
      delete next[sessionId]
      return next
    })
  }, [])

  const cleanupReview = useCallback((sessionId: string) => {
    closeReview(sessionId)
  }, [closeReview])

  const handleToggleReview = useCallback((sessionId: string) => {
    setReviewSessions(prev => {
      if (prev.has(sessionId)) {
        closeReview(sessionId)
        return prev
      }
      openReview(sessionId)
      return prev
    })
  }, [openReview, closeReview])

  /** 패널을 닫지 않고 리뷰만 다시 실행 */
  const rerunReview = useCallback((sessionId: string) => {
    window.api.cancelReview(sessionId)
    startReview(sessionId)
  }, [startReview])

  // review:chunk — 스트리밍 누적 텍스트
  useEffect(() => {
    const cleanup = window.api.onReviewChunk((sessionId: string, text: string) => {
      setReviewData(prev => ({ ...prev, [sessionId]: { status: 'running', text } }))
    })
    return cleanup
  }, [])

  // review:result — 완료
  useEffect(() => {
    const cleanup = window.api.onReviewResult((sessionId: string, text: string) => {
      setReviewData(prev => ({ ...prev, [sessionId]: { status: 'done', text } }))
    })
    return cleanup
  }, [])

  // review:error
  useEffect(() => {
    const cleanup = window.api.onReviewError((sessionId: string, error: string) => {
      setReviewData(prev => ({
        ...prev,
        [sessionId]: { status: 'error', text: prev[sessionId]?.text ?? '', error }
      }))
    })
    return cleanup
  }, [])

  // 리사이즈 핸들러 (useDiffManager 패턴)
  const handleReviewResize = useCallback((sessionId: string) => {
    return (e: React.MouseEvent) => {
      e.preventDefault()
      const container = (e.target as HTMLElement).parentElement
      if (!container) return
      containerRef.current = container

      const startX = e.clientX
      const startRatio = reviewRatios[sessionId] ?? REVIEW_DEFAULT_RATIO

      const onMouseMove = (ev: MouseEvent) => {
        if (!containerRef.current) return
        const rect = containerRef.current.getBoundingClientRect()
        const delta = (ev.clientX - startX) / rect.width
        const newRatio = Math.max(MIN_PANE_RATIO, Math.min(1 - MIN_PANE_RATIO, startRatio + delta))
        setReviewRatios(prev => ({ ...prev, [sessionId]: newRatio }))
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
  }, [reviewRatios])

  return {
    reviewSessions,
    reviewData,
    reviewRatios,
    openReview,
    closeReview,
    cleanupReview,
    handleToggleReview,
    rerunReview,
    handleReviewResize
  }
}
